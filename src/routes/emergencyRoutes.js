// routes/emergencyRoutes.js
import { supabase } from "../config/supabaseClient.js";
import { notificationService } from "../services/notificationService.js";

export default async function emergencyRoutes(fastify) {
  fastify.post("/emergency/trigger", async (request, reply) => {
    try {
      // 👇 CHANGED: Used supabase_user_id to perfectly match Flutter and your SQL table
      const { supabase_user_id, emergency_type, category, message } = request.body;

      // Quick validation
      if (!supabase_user_id || !emergency_type || !category) {
        request.log.warn("Missing emergency data from Flutter app");
        return reply.status(400).send({ error: "Missing required fields" });
      }

      // 🚨 STEP 1: IDENTIFY & LOG IT IN THE DATABASE FIRST
      // This creates the permanent audit trail!
      const { data: emergencyRecord, error: dbError } = await supabase
        .from("emergencies")
        .insert([{ 
            supabase_user_id: supabase_user_id, // 👇 CHANGED: Matches SQL column
            emergency_type: emergency_type, 
            category: category, 
            message: message || null, 
            level: 1, 
            status: "active" // Starts as active until parent acknowledges it
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      // 🚨 STEP 2: SEND THE NOTIFICATIONS
      // Now that we have proof it was triggered, we alert the parents.
      
      const { data: parents, error: parentError } = await supabase.from("parents").select("id");
      
      if (parentError) {
        request.log.error({ parentError }, "Failed to fetch parents for notification");
        // We don't throw an error here because the emergency was still saved to the DB
      }

      const title = `🚨 CRITICAL ALERT: ${emergency_type}`;
      const body = message || "Please check the app immediately.";

      // Send to all parents (you can filter this by trip later)
      if (parents && parents.length > 0) {
        const notificationPromises = parents.map((parent) => {
          return notificationService.notifyUser(parent.id, title, body, { 
              type: "emergency", 
              emergency_id: emergencyRecord.id 
          });
        });

        await Promise.all(notificationPromises);
      }

      // Tell the driver app it was a success!
      request.log.info({ emergencyId: emergencyRecord.id }, "✅ Emergency Logged and Notifications Sent");
      return reply.send({ success: true, message: "Logged and sent!" });

    } catch (error) {
      fastify.log.error("Emergency trigger error:", error);
      return reply.status(500).send({ error: "Failed to process emergency" });
    }
  });
}