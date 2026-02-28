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

      // ---------------------------------------------------------
      // EVENT 4: NEW EMERGENCY TRIGGERED (Broadcast to all Parents)
      // ---------------------------------------------------------
      else if (table === "emergencies" && type === "INSERT") {
        // 1. Format the string to match your notification_strings keys (e.g. "Vehicle Breakdown" -> "VEHICLE_BREAKDOWN")
        const typeKey = record.emergency_type.toUpperCase().replace(/\s+/g, "_");
        const content = NOTIFICATION_STRINGS.EMERGENCIES[typeKey] || NOTIFICATION_STRINGS.EMERGENCIES.DEFAULT;
        
        // 2. Fetch ALL parents from the database
        const { data: parents, error: parentError } = await supabase
          .from("parents")
          .select("supabase_user_id");
        
        if (parentError) {
          fastify.log.error({ parentError }, "Failed to fetch parents for emergency broadcast");
        }

        if (parents && parents.length > 0) {
          // 3. Send Push Notification to every parent
          const notificationPromises = parents.map((parent) => {
            return notificationService.notifyUser(
              parent.supabase_user_id, 
              content.title, 
              content.body, 
              { 
                type: "emergency", 
                emergency_id: record.id,
                category: record.category 
              }
            );
          });

          await Promise.all(notificationPromises);

          // 4. Save a unique log for every parent in the notification_logs table
          const logEntries = parents.map(parent => ({
            user_id: parent.supabase_user_id,
            title: content.title,
            message: content.body,
            notification_type: "EMERGENCY_ALERT",
            reference_id: record.id
          }));

          const { error: logError } = await supabase.from("notification_logs").insert(logEntries);
          
          if (logError) {
             fastify.log.error("Failed to save notification logs:", logError);
          } else {
             fastify.log.info(`✅ Emergency broadcasted and logged for ${parents.length} parents.`);
          }
        }
      }0

      return reply.send({ success: true, message: "Webhook processed" });
    } catch (error) {
      fastify.log.error("Webhook processing error:", error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}