import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";
import {
  getTripPlayback,
  getTripGeofenceEvents,
  listDriverTripSessions,
  resolveTripDriverId,
  upsertTripGeofencePoint,
} from "../services/trackingService.js";

// Validation for status updates
const statusUpdateSchema = z.object({
  status: z.enum(["approved", "rejected", "pending"]),
  reason: z.string().optional(),
});

const playbackQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const geofencePointSchema = z.object({
  label: z.enum(["pickup", "school", "custom"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().positive().max(1000).optional(),
  isActive: z.boolean().optional(),
});

// Helper to get signed URLs for private images
async function getSignedUrl(bucket, path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600); // Valid for 1 hour
  return data?.signedUrl || null;
}

export default async function adminRoutes(fastify) {
  // Middleware: Ensure user is actually an Admin
  fastify.addHook("preHandler", verifySupabaseJwt);
  fastify.addHook("preHandler", async (request, reply) => {
    const { data, error } = await supabase
      .from("users_meta")
      .select("role")
      .eq("supabase_user_id", request.user.id)
      .single();

    if (error || data?.role !== "admin") {
      reply.status(403).send({ message: "Admin access required" });
    }
  });

  // PATCH /api/admin/drivers/:id/status
  fastify.patch("/admin/drivers/:id/status", async (request, reply) => {
    const { id } = request.params;
    const parseResult = statusUpdateSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const { status } = parseResult.data;

      // 1. Update the driver status AND return the supabase_user_id
      const { data: driver, error } = await supabase
        .from("drivers")
        .update({ 
          verification_status: status,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select("supabase_user_id") // We must select this to target the notification!
        .single();

      if (error) throw error;

      // 2. Determine Notification Content
      let title = '';
      let body = '';
      if (status === 'approved') {
        title = 'Account Approved! 🎉';
        body = 'Congratulations! You are now approved to drive with VanGo.';
      } else if (status === 'rejected') {
        title = 'Action Required: Account Update';
        body = 'There was an issue with your documents. Please open the app to review.';
      } else if (status === 'pending') {
        title = 'Profile Under Review';
        body = 'We have received your details. Our team is currently reviewing your profile.';
      }

      // 3. Trigger the new Custom Edge Function
      if (title && body && driver.supabase_user_id) {
        const { data: funcData, error: funcError } = await supabase.functions.invoke('send-custom-notification', {
          body: {
            target_user_id: driver.supabase_user_id,
            title: title,
            body: body,
            custom_data: { 
              status: status, 
              click_action: 'FLUTTER_NOTIFICATION_CLICK' 
            }
          }
        });

        if (funcError) {
          request.log.error({ funcError }, "Failed to send notification via Edge Function");
          // We don't throw here because the DB update was successful, we just log the push failure
        } else {
          request.log.info({ funcData }, "Custom notification dispatched");
        }
      }

      return reply.send({ status: "ok", newStatus: status });
    } catch (error) {
      request.log.error({ error }, "Failed to update driver status");
      return reply.status(500).send({ message: error.message });
    }
  });

  // GET /api/admin/drivers?status=pending
  fastify.get("/admin/drivers", async (request, reply) => {
    const status = request.query.status || "pending";

    try {
      // Fetch drivers with their vehicle info
      const { data: drivers, error } = await supabase
        .from("drivers")
        .select(`
          id, first_name, last_name, phone, verification_status, face_photo_uploaded_at, created_at,
          vehicle:vehicles (
            vehicle_make, vehicle_model, vehicle_type, image_url, route_name, seat_count
          )
        `)
        .eq("verification_status", status)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return reply.send(drivers);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch drivers");
      return reply.status(500).send({ message: error.message });
    }
  });

  // GET /api/admin/drivers/:id/details
  // Fetches full details + Signed URLs for documents
  fastify.get("/admin/drivers/:id/details", async (request, reply) => {
    const { id } = request.params;

    try {
      // 1. Get Driver Profile
      const { data: driver, error } = await supabase
        .from("drivers")
        .select("*, vehicle:vehicles(*)")
        .eq("id", id)
        .single();

      if (error) throw error;

      // 2. Generate Signed URLs for documents
      // Assuming paths are stored as "SUPABASE_USER_ID/filename"
      // We need the supabase_user_id from the driver record
      const userId = driver.supabase_user_id;

      const [faceUrl, licenseFrontUrl, licenseBackUrl] = await Promise.all([
        getSignedUrl("driver-photos", `${userId}/face.jpg`),
        getSignedUrl("driver-documents", `${userId}/license_front.jpg`),
        getSignedUrl("driver-documents", `${userId}/license_back.jpg`),
      ]);

      return reply.send({
        ...driver,
        documents: {
          faceUrl,
          licenseFrontUrl,
          licenseBackUrl,
        },
      });
    } catch (error) {
      request.log.error({ error }, "Failed to fetch driver details");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/admin/tracking/drivers/:driverId/trips", async (request, reply) => {
    const { driverId } = request.params;
    const queryResult = limitQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    try {
      const trips = await listDriverTripSessions(driverId, queryResult.data.limit ?? 100);
      return reply.send(trips);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch driver trips for admin");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/admin/tracking/trips/:tripId/playback", async (request, reply) => {
    const { tripId } = request.params;
    const queryResult = playbackQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    const query = queryResult.data;
    if (query.from && query.to && new Date(query.from).getTime() > new Date(query.to).getTime()) {
      return reply.status(400).send({ message: "`from` must be earlier than or equal to `to`" });
    }

    try {
      const playback = await getTripPlayback(tripId, {
        from: query.from,
        to: query.to,
        limit: query.limit,
        order: query.order,
      });

      return reply.send(playback);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch admin trip playback");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/admin/tracking/trips/:tripId/geofence-events", async (request, reply) => {
    const { tripId } = request.params;
    const queryResult = limitQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    try {
      const events = await getTripGeofenceEvents(tripId, queryResult.data.limit ?? 100);
      return reply.send(events);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch admin geofence events");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.put("/admin/tracking/trips/:tripId/geofence-points", async (request, reply) => {
    const { tripId } = request.params;
    const parseResult = geofencePointSchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const driverId = await resolveTripDriverId(tripId);
      if (!driverId) {
        return reply.status(404).send({ message: "Trip not found" });
      }

      const savedPoint = await upsertTripGeofencePoint({
        tripId,
        driverId,
        ...parseResult.data,
      });

      return reply.send(savedPoint);
    } catch (error) {
      request.log.error({ error }, "Failed to upsert geofence point");
      return reply.status(500).send({ message: error.message });
    }
  });
}