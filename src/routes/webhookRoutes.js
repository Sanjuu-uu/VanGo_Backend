import { notificationService } from "../services/notificationService.js";
import { NOTIFICATION_STRINGS } from "../config/notification_strings.js"; // Import your central strings
import { supabase } from "../config/supabaseClient.js";

export default async function webhookRoutes(fastify) {
  fastify.post("/webhooks/database", async (request, reply) => {
    // 1. SECURITY CHECK
    const secretHeader = request.headers["x-webhook-secret"];
    const providedSecret = secretHeader || request.query["x-webhook-secret"];
    
    if (providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      fastify.log.warn(`Unauthorized webhook attempt.`);
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { type, table, record, old_record } = request.body;

    try {
      // ---------------------------------------------------------
      // EVENT 1: Emergencies (New Insert)
      // ---------------------------------------------------------
      if (table === "emergencies" && type === "INSERT") {
        // Map "Vehicle Breakdown" to "VEHICLE_BREAKDOWN" to match your AppStrings keys
        const typeKey = record.emergency_type?.toUpperCase().replace(/\s+/g, "_");
        const content = NOTIFICATION_STRINGS.EMERGENCIES[typeKey] || NOTIFICATION_STRINGS.EMERGENCIES.DEFAULT;

        let finalBody = content.body;
        if (record.message && record.message.trim().length > 0) {
          finalBody += `\n\nNote: "${record.message}"`;
        }

        // Fetch parents (Update this query later to filter by specific trip)
        const { data: parents } = await supabase.from("parents").select("supabase_user_id");

        if (parents && parents.length > 0) {
          const promises = parents.map(p => 
            notificationService.notifyUser(p.supabase_user_id, content.title, finalBody, { type: "emergency" })
          );
          await Promise.all(promises);
          fastify.log.info(`Emergency alerts sent for: ${typeKey}`);
        }
      }

      // ---------------------------------------------------------
      // EVENT 2: Driver Verification Status Changes
      // ---------------------------------------------------------
      else if (table === "drivers" && type === "UPDATE") {
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
      // EVENT 3: New Chat Messages
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
      // EVENT 4: Parent Profile Setup
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