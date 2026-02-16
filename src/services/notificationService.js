import { messaging } from "../config/firebaseAdmin.js";
import { supabase } from "../config/supabaseClient.js";

// --- HIGHLIGHT: Exporting as a named constant object ---
export const notificationService = {
  async notifyUser(supabaseUserId, title, body, data = {}) {
    try {
      // 1. Fetch token from Supabase
      const { data: userMeta, error } = await supabase
        .from("users_meta")
        .select("fcm_token")
        .eq("supabase_user_id", supabaseUserId)
        .single();

      if (error || !userMeta?.fcm_token) {
        console.warn(`⚠️ No FCM token for user ${supabaseUserId}`);
        return null;
      }

      // 2. Construct Firebase message
      const message = {
        notification: { title, body },
        data, 
        token: userMeta.fcm_token,
      };

      // 3. Send via Firebase Admin SDK
      const response = await messaging.send(message);
      console.log("✅ Notification sent successfully");
      return response;
    } catch (error) {
      console.error("❌ Push Notification Error:", error);
      return null;
    }
  }
};