import { messaging } from "../config/firebaseAdmin.js";
import { supabase } from "../config/supabaseClient.js";

export const notificationService = {
  /**
   * Sends a push notification to all active devices of a specific user.
   * * @param {string} supabaseUserId - The Supabase Auth ID of the user.
   * @param {string} title - The notification title.
   * @param {string} body - The notification body text.
   * @param {object} data - Optional key-value pairs for background data processing.
   */
  async notifyUser(supabaseUserId, title, body, data = {}) {
    try {
      // 1. Fetch ALL active tokens for this user from trusted_devices
      const { data: devices, error } = await supabase
        .from("trusted_devices")
        .select("push_token")
        .eq("user_id", supabaseUserId)
        .eq("is_revoked", false);

      if (error || !devices || devices.length === 0) {
        console.warn(`⚠️ No active devices found for user ${supabaseUserId}`);
        return null;
      }

      // Extract valid tokens
      const tokens = devices
        .map((device) => device.push_token)
        .filter((token) => token !== null && token !== "");

      if (tokens.length === 0) {
        console.warn(
          `⚠️ Devices found, but push_tokens were null for user ${supabaseUserId}`,
        );
        return null;
      }

      // 2. Safely format data (FCM HTTP v1 requires ALL data payload values to be strings)
      const stringifiedData = {};
      Object.keys(data).forEach((key) => {
        if (data[key] !== null && data[key] !== undefined) {
          stringifiedData[key] = String(data[key]);
        }
      });

      // Tell Flutter to handle the tap event
      stringifiedData["click_action"] = "FLUTTER_NOTIFICATION_CLICK";

      // 3. Construct the FCM HTTP v1 Multicast message payload
      const message = {
        tokens: tokens,
        data: stringifiedData,
        android: {
          priority: "high",
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
            },
          },
        },
      };

      // Only add the visual notification block if title and body exist
      if (title && body) {
        message.notification = { title, body };

        // Android specific UI settings
        message.android.notification = {
          channelId: "vango_notifications_v4", // Bumping to v4 to ensure fresh settings
          sound: "default",
          priority: "MAX",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        };

        // iOS specific UI settings
        message.apns.payload.aps = {
          ...message.apns.payload.aps,
          sound: "default",
          badge: 1,
          interruptionLevel: "active",
        };
      }

      // 4. Dispatch using the modern Firebase Admin SDK
      const response = await messaging.sendEachForMulticast(message);
      console.log(
        `✅ Push sent: ${response.successCount} success, ${response.failureCount} failed.`,
      );

      // 5. Automatic Cleanup: Revoke tokens that are no longer valid (app uninstalled, token rotated, etc.)
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === "messaging/invalid-registration-token" ||
              errorCode === "messaging/registration-token-not-registered"
            ) {
              failedTokens.push(tokens[idx]);
            } else {
              // Log other types of failures for debugging (e.g., quota exceeded)
              console.error(
                `⚠️ FCM Delivery Error for token index ${idx}:`,
                resp.error,
              );
            }
          }
        });

        if (failedTokens.length > 0) {
          console.log(
            `🧹 Revoking ${failedTokens.length} stale devices in Supabase...`,
          );

          const { error: updateError } = await supabase
            .from("trusted_devices")
            .update({ is_revoked: true, updated_at: new Date().toISOString() })
            .in("push_token", failedTokens);

          if (updateError) {
            console.error(
              "❌ Failed to revoke stale tokens in Supabase:",
              updateError.message,
            );
          }
        }
      }

      return response;
    } catch (error) {
      console.error("❌ Notification Service Crash:", error.message);
      return null;
    }
  },
};
