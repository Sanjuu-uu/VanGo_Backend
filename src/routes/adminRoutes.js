import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";
import { notificationService } from "../services/notificationService.js";

// Validation for status updates
const statusUpdateSchema = z.object({
  status: z.enum(["approved", "rejected", "pending"]),
  reason: z.string().optional(),
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
  fastify.get("/admin/drivers/:id/details", async (request, reply) => {
    const { id } = request.params;

    try {
      const { data: driver, error } = await supabase
        .from("drivers")
        .select("*, vehicle:vehicles(*)")
        .eq("id", id)
        .single();

      if (error) throw error;

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

  // PATCH /api/admin/drivers/:id/status
  fastify.patch("/admin/drivers/:id/status", async (request, reply) => {
    const { id } = request.params;
    const parseResult = statusUpdateSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const { status } = parseResult.data;

      // 1. Fetch the driver's supabase_user_id to sync with users_meta
      const { data: driver, error: fetchError } = await supabase
        .from("drivers")
        .select("supabase_user_id")
        .eq("id", id)
        .single();

      if (fetchError || !driver) {
        return reply.status(404).send({ message: "Driver not found" });
      }

      // 2. Update the driver verification status in 'drivers' table
      const { error: driverUpdateError } = await supabase
        .from("drivers")
        .update({
          verification_status: status,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (driverUpdateError) throw driverUpdateError;

      // 3. Update the global 'is_approved' flag in 'users_meta' table
      // This allows the app to know if the user is permitted to enter the main dashboard
      const { error: metaUpdateError } = await supabase
        .from("users_meta")
        .update({
          is_approved: status === "approved",
          updated_at: new Date().toISOString()
        })
        .eq("supabase_user_id", driver.supabase_user_id);

      if (metaUpdateError) throw metaUpdateError;

      // 4. Trigger Push Notification to the Driver
      try {
        let title = "Verification Update";
        let body = "Your account status has been updated.";

        if (status === "approved") {
          title = "Verification Successful";
          body = "Welcome! Your account is now active.";
        } else if (status === "rejected") {
          title = "Verification Failed";
          body = "Please check the app for details regarding your documents.";
        } else if (status === "pending") {
          title = "Verification Pending";
          body = "Your account is under review. We will notify you once approved.";
        }

        await notificationService.notifyUser(driver.supabase_user_id, title, body, {
          type: "verification_status_change",
          status: status
        });
      } catch (notifError) {
        // We log but don't fail the request if notification fails
        request.log.warn({ notifError }, "Failed to send status update notification");
      }

      // Note: If you have configured Supabase Realtime for the 'drivers' table,
      // the Flutter app will update the UI immediately upon this request finishing.

      return reply.send({
        status: "ok",
        newStatus: status,
        appliedTo: driver.supabase_user_id
      });
    } catch (error) {
      request.log.error({ error }, "Failed to update driver status");
      return reply.status(500).send({ message: error.message });
    }
  });
}