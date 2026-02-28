import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";
import { runFullDriverVerification } from "../services/verificationEngine.js";

export default async function verificationRoutes(fastify) {
  fastify.addHook("preHandler", verifySupabaseJwt);

  fastify.post("/verification/trigger-master-check", async (request, reply) => {
    const userId = request.user.id;

    try {
      // 1. Get driver info
      const { data: driver, error: driverError } = await supabase
        .from("drivers")
        .select("id, verification_status")
        .eq("supabase_user_id", userId)
        .single();

      if (driverError || !driver) return reply.status(404).send({ message: "Driver not found" });

      // If they are already approved/rejected, don't run it again
      if (driver.verification_status !== "pending") {
        return reply.send({ status: driver.verification_status, message: "Already processed" });
      }

      // 2. RUN THE MASTER AI ENGINE
      const result = await runFullDriverVerification(userId, driver.id);

      // 3. Update the Driver Status in Database
      await supabase
        .from("drivers")
        .update({ 
          verification_status: result.status,
          updated_at: new Date().toISOString() 
        })
        .eq("id", driver.id);

      // 4. (Optional) Save extracted data to driver_documents table here...

      return reply.send({
        success: true,
        final_status: result.status,
        reason: result.reason
      });

    } catch (error) {
      request.log.error({ error }, "Failed to trigger master check");
      return reply.status(500).send({ message: "Server error" });
    }
  });
}