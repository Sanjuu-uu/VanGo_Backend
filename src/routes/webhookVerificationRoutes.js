import { supabase } from "../config/supabaseClient.js";
import { runFullDriverVerification } from "../services/verificationEngine.js";

export default async function webhookVerificationRoutes(fastify) {
  
  // This route is called automatically by Supabase Database Webhooks
  fastify.post("/webhooks/driver-verification", async (request, reply) => {
    
    // 1. Security Check: Ensure the request is actually coming from YOUR Supabase project
    const secretHeader = request.headers["x-webhook-secret"];
    const secretQuery = request.query["x-webhook-secret"];
    const providedSecret = secretHeader || secretQuery;
    if (providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      fastify.log.warn(
        `Unauthorized webhook attempt. Provided secret: ${providedSecret}`,
      );
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = request.body;
    
    // Supabase webhook payload structure
    const newRecord = payload.record;
    const oldRecord = payload.old_record;

    // 2. We only want to run the AI if the documents_uploaded_at timestamp just changed!
    if (
      newRecord.documents_uploaded_at && 
      newRecord.documents_uploaded_at !== oldRecord?.documents_uploaded_at &&
      newRecord.verification_status === 'pending'
    ) {
      
      request.log.info(`Running master verification for driver ${newRecord.id}`);

      try {
        // 3. Run the AI Engine!
        const result = await runFullDriverVerification(newRecord.supabase_user_id, newRecord.id);

        // 4. Update the database with the AI result
        await supabase
          .from("drivers")
          .update({ 
            verification_status: result.status,
            updated_at: new Date().toISOString() 
          })
          .eq("id", newRecord.id);

        request.log.info(`Master verification complete for driver ${newRecord.id}: ${result.status}`);
      } catch (error) {
        request.log.error({ error }, "Master verification failed in webhook");
      }
    }

    // Always return 200 OK so Supabase knows the webhook was received
    return reply.send({ received: true });
  });
}