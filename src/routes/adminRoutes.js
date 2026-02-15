import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";

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

  // PATCH /api/admin/drivers/:id/status
  fastify.patch("/admin/drivers/:id/status", async (request, reply) => {
    const { id } = request.params;
    const parseResult = statusUpdateSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const { status } = parseResult.data;

      // Update the driver status
      const { error } = await supabase
        .from("drivers")
        .update({ 
          verification_status: status,
          // If approved, you might want to trigger a notification here
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      return reply.send({ status: "ok", newStatus: status });
    } catch (error) {
      request.log.error({ error }, "Failed to update driver status");
      return reply.status(500).send({ message: error.message });
    }
  });
}