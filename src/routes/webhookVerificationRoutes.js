import { supabase } from "../config/supabaseClient.js";
import { runFullDriverVerification } from "../services/verificationEngine.js";

export default async function webhookVerificationRoutes(fastify) {
  
  // This route is called automatically by Supabase Database Webhooks
  fastify.post("/webhooks/driver-verification", async (request, reply) => {
    
    // 1. Security Check
    const secretHeader = request.headers["x-webhook-secret"];
    const secretQuery = request.query["x-webhook-secret"];
    const providedSecret = secretHeader || secretQuery;
    
    if (providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      fastify.log.warn(`Unauthorized webhook attempt.`);
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = request.body;
    const newRecord = payload.record || {};
    const oldRecord = payload.old_record || {};

    // ------------------------------------------------------------------
    // 🔍 ADDED DEBUGGING LOGS 
    // ------------------------------------------------------------------
    fastify.log.info("===== WEBHOOK PAYLOAD DEBUG =====");
    fastify.log.info(`Driver ID: ${newRecord.id}`);
    fastify.log.info(`New Status: '${newRecord.verification_status}'`);
    fastify.log.info(`Old documents_uploaded_at: ${oldRecord.documents_uploaded_at}`);
    fastify.log.info(`New documents_uploaded_at: ${newRecord.documents_uploaded_at}`);
    fastify.log.info("=================================");

    // 2. We only want to run the AI if the documents_uploaded_at timestamp just changed!
    if (
      newRecord.documents_uploaded_at && 
      newRecord.documents_uploaded_at !== oldRecord?.documents_uploaded_at &&
      newRecord.verification_status === 'pending'
    ) {
      
      fastify.log.info(`🚀 Starting master verification for driver ${newRecord.id}`);

      try {
        // 3. Run the AI Engine!
        const result = await runFullDriverVerification(newRecord.supabase_user_id, newRecord.id);
        
        fastify.log.info(`🧠 AI Result -> Status: ${result.status} | Reason: ${result.reason}`);

        // 4. Update the database with the AI result
        await supabase
          .from("drivers")
          .update({ 
            verification_status: result.status,
            updated_at: new Date().toISOString() 
          })
          .eq("id", newRecord.id);

        fastify.log.info(`✅ Master verification complete for driver ${newRecord.id}: ${result.status}`);
      } catch (error) {
        fastify.log.error({ error }, "❌ Master verification failed in webhook");
      }
    } else {
        // ------------------------------------------------------------------
        // 🔍 WHY DID IT SKIP? 
        // ------------------------------------------------------------------
        if (!newRecord.documents_uploaded_at) {
            fastify.log.warn("⏭️ SKIPPED: 'documents_uploaded_at' is missing/null in the database.");
        } else if (newRecord.documents_uploaded_at === oldRecord?.documents_uploaded_at) {
            fastify.log.warn("⏭️ SKIPPED: The 'documents_uploaded_at' timestamp did not change.");
        } else if (newRecord.verification_status !== 'pending') {
            fastify.log.warn(`⏭️ SKIPPED: 'verification_status' is '${newRecord.verification_status}', but it must be 'pending'.`);
        }
    }

    // Always return 200 OK so Supabase knows the webhook was received
    return reply.send({ received: true });
  });
}