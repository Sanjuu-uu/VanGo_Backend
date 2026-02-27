import { notificationService } from "../services/notificationService.js";
import { NOTIFICATION_STRINGS } from "../config/notification_strings.js"; 
import { supabase } from "../config/supabaseClient.js";

export default async function webhookRoutes(fastify) {
  fastify.post("/webhooks/database", async (request, reply) => {
    // 1. SECURITY CHECK: Verify this request actually came from YOUR Supabase
    const secretHeader = request.headers["x-webhook-secret"];
    const providedSecret = secretHeader || request.query["x-webhook-secret"];
    
    if (providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      fastify.log.warn(`Unauthorized webhook attempt.`);
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { type, table, record, old_record } = request.body;

    try {
      // ---------------------------------------------------------
      // EVENT 1: Driver Verification Status Changes
      // ---------------------------------------------------------
      if (table === "drivers" && type === "UPDATE") {
        const newStatus = record.verification_status?.toUpperCase(); // e.g., "APPROVED"
        const oldStatus = old_record?.verification_status?.toUpperCase();

        if (newStatus && newStatus !== oldStatus) {
          const content = NOTIFICATION_STRINGS.DRIVERS[newStatus];
          
          if (content) {
            await notificationService.notifyUser(
              record.supabase_user_id,
              content.title,
              content.body,
              { status: record.verification_status }
            );
          }
        }
      }

      // ---------------------------------------------------------
      // EVENT 2: New Chat Messages
      // ---------------------------------------------------------
      else if (table === "chat_messages" && type === "INSERT") {
        await notificationService.notifyUser(
          record.receiver_id,
          NOTIFICATION_STRINGS.CHAT.NEW_MESSAGE,
          record.message_text,
          { type: "chat", sender_id: record.sender_id },
        );
      }

      // ---------------------------------------------------------
      // EVENT 3: Parent Profile Setup
      // ---------------------------------------------------------
      else if (table === "parents" && type === "UPDATE") {
        const isNowCreated = record.is_account_created === true;
        const wasCreatedBefore = old_record?.is_account_created === true;

        if (isNowCreated && !wasCreatedBefore) {
          const content = NOTIFICATION_STRINGS.PARENTS.WELCOME;
          await notificationService.notifyUser(
            record.supabase_user_id,
            content.title,
            content.body,
            { type: "parent_welcome" }
          );
        }
      }

      return reply.send({ success: true, message: "Webhook processed" });
    } catch (error) {
      fastify.log.error("Webhook processing error:", error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}