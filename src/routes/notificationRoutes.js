import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { notificationService } from "../services/notificationService.js";

export default async function notificationRoutes(fastify) {
  // Test endpoint to trigger a notification manually
  fastify.post(
    "/notifications/test",
    { preHandler: verifySupabaseJwt },
    async (request, reply) => {
      const { title, body } = request.body;

      const result = await notificationService.notifyUser(
        request.user.id, // Sends to the currently logged in user testing it
        title || "Test Notification",
        body || "It works! 🚀",
      );

      if (!result) {
        return reply
          .status(500)
          .send({ message: "Failed to send notification. Check server logs." });
      }

      return {
        status: "ok",
        message: "Notification sent",
        firebaseResponse: result,
      };
    },
  );
}
