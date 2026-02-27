import { supabase } from "../config/supabaseClient.js";
import { notificationService } from "../services/notificationService.js";

export default async function emergencyRoutes(fastify) {
  fastify.post("/emergency/trigger", async (request, reply) => {
    try {
      const { driver_id, emergency_type, category, message } = request.body;

      // 🚨 STEP 1: IDENTIFY & LOG IT IN THE DATABASE FIRST
      // This creates the permanent audit trail!
      const { data: emergencyRecord, error: dbError } = await supabase
        .from("emergencies")
        .insert([{ 
            driver_id: driver_id, 
            emergency_type: emergency_type, 
            category: category, 
            message: message, 
            level: 1, 
            status: "active" // Starts as active until parent acknowledges it
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      // 🚨 STEP 2: SEND THE NOTIFICATIONS
      // Now that we have proof it was triggered, we alert the parents.
      
      const { data: parents } = await supabase.from("parents").select("id");
      
      const title = `🚨 CRITICAL ALERT: ${emergency_type}`;
      const body = message || "Please check the app immediately.";

      // Send to all parents (you can filter this by trip later)
      const notificationPromises = parents.map((parent) => {
        return notificationService.notifyUser(parent.id, title, body, { 
            type: "emergency", 
            emergency_id: emergencyRecord.id 
        });
      });

      await Promise.all(notificationPromises);

      // Tell the driver app it was a success!
      return reply.send({ success: true, message: "Logged and sent!" });

    } catch (error) {
      fastify.log.error("Emergency trigger error:", error);
      return reply.status(500).send({ error: "Failed to process emergency" });
    }
  });
}