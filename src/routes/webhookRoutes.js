import { notificationService } from "../services/notificationService.js";

export default async function webhookRoutes(fastify) {
  fastify.post("/webhooks/database", async (request, reply) => {
    // 1. SECURITY CHECK: Verify this request actually came from YOUR Supabase
    const secretHeader = request.headers["x-webhook-secret"];
    const secretQuery = request.query["x-webhook-secret"];
    const providedSecret = secretHeader || secretQuery;
    if (providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      fastify.log.warn(
        `Unauthorized webhook attempt. Provided secret: ${providedSecret}`,
      );
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { type, table, record, old_record } = request.body;

    try {
      // ---------------------------------------------------------
      // EVENT 1: Driver Verification Status Changes
      // ---------------------------------------------------------
      if (table === "drivers" && type === "UPDATE") {
        const newStatus = record.verification_status?.toLowerCase();
        const oldStatus = old_record?.verification_status?.toLowerCase();

        // Only notify if the status actually changed
        if (newStatus && newStatus !== oldStatus) {
          let title = "";
          let body = "";

          if (newStatus === "approved") {
            title = "Account Approved! 🎉";
            body = "Congratulations! You are now approved to drive with VanGo.";
          } else if (newStatus === "rejected") {
            title = "Action Required: Account Update";
            body =
              "There was an issue with your documents. Please open the app to review.";
          } else if (newStatus === "pending") {
            title = "Profile Under Review";
            body =
              "We have received your details. Our team is currently reviewing your profile.";
          }

          if (title) {
            await notificationService.notifyUser(
              record.supabase_user_id,
              title,
              body,
              { status: newStatus },
            );
          }
        }
      }

      

      // ---------------------------------------------------------
      // EVENT 2: New Chat Messages (Example)
      // ---------------------------------------------------------
      else if (table === "chat_messages" && type === "INSERT") {
        await notificationService.notifyUser(
          record.receiver_id,
          "New Message",
          record.message_text,
          { type: "chat", sender_id: record.sender_id },
        );
      }

      // ---------------------------------------------------------
      // EVENT 3: Add more tables here as your app grows!
      // ---------------------------------------------------------
else if (table === "parents" && type === "UPDATE") {
        
        // --- Check: Was the account just fully created? ---
        const isNowCreated = record.is_account_created === true;
        const wasCreatedBefore = old_record?.is_account_created === true;

        // This guarantees the notification ONLY sends exactly once:
        // the very first time 'is_account_created' flips to true.
        if (isNowCreated && !wasCreatedBefore) {
          await notificationService.notifyUser(
            record.supabase_user_id, // Ensure this matches your column name!
            "Welcome to VanGo! 🎉",
            "Your parent profile has been successfully set up.",
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
