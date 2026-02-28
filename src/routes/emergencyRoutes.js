// routes/emergencyRoutes.js
import { supabase } from "../config/supabaseClient.js";
import { notificationService } from "../services/notificationService.js";
import { NOTIFICATION_STRINGS } from "../config/notification_strings.js";

// 👇 Notice the name here is exactly emergencyRoutes
export default async function emergencyRoutes(fastify) {  
  
  // 👇 Notice the route here is exactly /emergency/trigger
  fastify.post("/emergency/trigger", async (request, reply) => {
    try {
      const { supabase_user_id, emergency_type, category } = request.body;

      if (!supabase_user_id || !emergency_type || !category) {
        request.log.warn("Missing emergency data from Flutter app");
        return reply.status(400).send({ error: "Missing required fields" });
      }

      const { data: emergencyRecord, error: dbError } = await supabase
        .from("emergencies")
        .insert([{ 
            supabase_user_id: supabase_user_id, 
            emergency_type: emergency_type, 
            category: category,  
            level: 1, 
            status: "active",
            is_solved: false
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      const typeKey = emergency_type.toUpperCase().replace(/\s+/g, "_");
      const content = NOTIFICATION_STRINGS.EMERGENCIES[typeKey] || NOTIFICATION_STRINGS.EMERGENCIES.DEFAULT;
      const finalBody = content.body;

      const { data: parents, error: parentError } = await supabase
        .from("parents")
        .select("supabase_user_id");
      
      if (parentError) {
        request.log.error({ parentError }, "Failed to fetch parents");
      }

      if (parents && parents.length > 0) {
        const notificationPromises = parents.map((parent) => {
          return notificationService.notifyUser(
            parent.supabase_user_id, 
            content.title, 
            finalBody, 
            { 
              type: "emergency", 
              emergency_id: emergencyRecord.id,
              category: category 
            }
          );
        });

        await Promise.all(notificationPromises);

        const logEntries = parents.map(parent => ({
          user_id: parent.supabase_user_id,
          title: content.title,
          message: finalBody,
          notification_type: "EMERGENCY_ALERT",
          reference_id: emergencyRecord.id
        }));

        const { error: logError } = await supabase.from("notification_logs").insert(logEntries);
        
        if (logError) {
           request.log.error("Failed to save notification logs:", logError);
        }
      }

      request.log.info({ emergencyId: emergencyRecord.id }, "✅ Emergency Logged and Notifications Sent");
      return reply.send({ success: true, message: "Logged and sent!",emergency_id: emergencyRecord.id });

    } catch (error) {
      request.log.error("Emergency trigger error:", error);
      return reply.status(500).send({ error: "Failed to process emergency" });
    }
  });
  fastify.post("/emergency/resolve", async (request, reply) => {
    try {
      const { emergency_id } = request.body;

      if (!emergency_id) {
        return reply.status(400).send({ error: "Missing emergency_id" });
      }

      // Update the database to mark it as solved
      const { error: dbError } = await supabase
        .from("emergencies")
        .update({ 
            is_solved: true, 
            status: "resolved" 
        })
        .eq("id", emergency_id);

      if (dbError) throw dbError;

      // Optional: You could send another push notification to parents here saying "Emergency Resolved!"

      return reply.send({ success: true, message: "Emergency marked as solved!" });

    } catch (error) {
      request.log.error("Emergency resolve error:", error);
      return reply.status(500).send({ error: "Failed to resolve emergency" });
    }
  });
}
  

