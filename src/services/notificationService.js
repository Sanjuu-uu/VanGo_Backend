import { messaging } from "../config/firebaseAdmin.js";
import { supabase } from "../config/supabaseClient.js";

export const notificationService = {
  async notifyUser(supabaseUserId, title, body, data = {}) {
    try {
      // 1. Fetch ALL active tokens for this driver from trusted_devices
      const { data: devices, error } = await supabase
        .from("trusted_devices")
        .select("push_token")
        .eq("user_id", supabaseUserId)
        .eq("is_revoked", false); // Only target active sessions

      if (error || !devices || devices.length === 0) {
        console.warn(`⚠️ No active devices found for user ${supabaseUserId}`);
        return null;
      }

      // Extract just the strings, ignoring nulls
      const tokens = devices
        .map(device => device.push_token)
        .filter(token => token !== null);

      if (tokens.length === 0) return null;

      // 2. Safely format data (FCM requires all values to be strings)
      const stringifiedData = {};
      Object.keys(data).forEach((key) => {
        if (data[key] !== null && data[key] !== undefined) {
          stringifiedData[key] = String(data[key]);
        }
      });
      stringifiedData["click_action"] = "FLUTTER_NOTIFICATION_CLICK";

      // 3. Construct the Multicast message
      const message = {
        tokens: tokens, // Send to array of tokens
        data: stringifiedData,
        android: { priority: "high" },
        apns: { payload: { aps: { contentAvailable: true } } },
      };

      if (title && body) {
        message.notification = { title, body };
        message.android.notification = {
          channelId: "vango_notifications_v3",
          sound: "default",
          priority: "MAX",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        };
        message.apns.payload.aps = { ...message.apns.payload.aps, sound: "default", badge: 1, interruptionLevel: "active" };
      }

      // 4. Send via Firebase using sendEachForMulticast
      const response = await messaging.sendEachForMulticast(message);
      console.log(`✅ Sent to ${response.successCount} devices, ${response.failureCount} failed.`);

      // 5. Cleanup invalid tokens automatically
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success && (
            resp.error.code === 'messaging/invalid-registration-token' ||
            resp.error.code === 'messaging/registration-token-not-registered'
          )) {
            failedTokens.push(tokens[idx]);
          }
        });

        if (failedTokens.length > 0) {
          console.log(`🧹 Cleaning up ${failedTokens.length} stale tokens...`);
          await supabase
            .from('trusted_devices')
            .update({ is_revoked: true }) // Mark as revoked instead of deleting for security logs
            .in('push_token', failedTokens);
        }
      }

      return response;

    } catch (error) {
      console.error("❌ Push Notification Error:", error.message);
      return null;
    }
  }
};