import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertUserMeta } from "../services/profileService.js";
import { notifyUser } from "../services/notificationService.js";

export default async function notificationRoutes(fastify) {
  // Update token manually if needed
  fastify.post("/notifications/refresh-token", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const { fcmToken } = request.body;
    if (!fcmToken) return reply.status(400).send({ message: "Token required" });

    await upsertUserMeta({
      supabaseUserId: request.user.id,
      fcmToken,
    });

    return { status: "ok", message: "Token refreshed" };
  });

  // Test endpoint (Should be disabled in production)
  fastify.post("/notifications/test", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const { title, body } = request.body;
    
    const result = await notifyUser(
      request.user.id,
      title || "Test Notification",
      body || "It works! 🚀"
    );

    if (!result) {
      return reply.status(500).send({ message: "Failed to send notification. Check server logs." });
    }

    return { status: "ok", message: "Notification sent", firebaseResponse: result };
  });
}