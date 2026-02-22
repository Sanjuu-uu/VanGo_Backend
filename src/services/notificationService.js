import { messaging } from "../config/firebaseAdmin.js";
import { supabase } from "../config/supabaseClient.js";

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

      // 2. Safely format data (FCM requires all values to be strings)
      const stringifiedData = {};
      Object.keys(data).forEach((key) => {
        if (data[key] !== null && data[key] !== undefined) {
          stringifiedData[key] = String(data[key]);
        }
      });

      // Add click_action so tapping the notification opens the app
      stringifiedData["click_action"] = "FLUTTER_NOTIFICATION_CLICK";

      // 3. Construct BASE message (Data-Only by default to wake up the app)
      const message = {
        data: stringifiedData,
        token: userMeta.fcm_token,
        android: {
          priority: "high", // Critical: Wakes up Android app in background
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true, // Critical: Wakes up iOS app in background
            },
          },
        },
      };

      // 4. ONLY attach visual 'notification' elements if title and body are provided
      if (title && body) {
        message.notification = { title, body };

        // Android specific visual settings
        message.android.notification = {
          channelId: "vango_notifications_v3",
          sound: "default",
          priority: "MAX",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        };

        // iOS specific visual settings
        message.apns.payload.aps.sound = "default";
        message.apns.payload.aps.badge = 1;
        message.apns.payload.aps.interruptionLevel = "active";
      }

      // 5. Send via Firebase
      const response = await messaging.send(message);

      const isDataOnly = !(title && body);
      console.log(`✅ High-Priority Notification sent to ${supabaseUserId}. (Data-Only: ${isDataOnly})`);

      return response;

    } catch (error) {
      console.error("❌ Push Notification Error:", error.message);

      if (
        error.code === "messaging/registration-token-not-registered" ||
        error.code === "messaging/invalid-registration-token"
      ) {
        console.log(`🧹 Removing stale/invalid token for user ${supabaseUserId}`);
        await supabase
          .from("users_meta")
          .update({ fcm_token: null })
          .eq("supabase_user_id", supabaseUserId);
      }

      return null;
    }
  }
};