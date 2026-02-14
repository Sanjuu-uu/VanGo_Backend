import { messaging } from "../config/firebaseAdmin.js";
import { supabase } from "../config/supabaseClient.js";

/**
 * Sends a push notification to a specific user by their Supabase ID
 */
export async function notifyUser(supabaseUserId, title, body, data = {}) {
  try {
    // 1. Fetch the FCM token for this user from users_meta
    const { data: userMeta, error } = await supabase
      .from("users_meta")
      .select("fcm_token")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (error || !userMeta?.fcm_token) {
      console.warn(`No FCM token found for user ${supabaseUserId}, skipping notification.`);
      return null;
    }

    // 2. Construct the message
    const message = {
      notification: {
        title,
        body,
      },
      data, // Optional: useful for sending IDs or deep-link URLs
      token: userMeta.fcm_token,
    };

    // 3. Send via Firebase
    const response = await messaging.send(message);
    return response;
  } catch (error) {
    console.error("Push Notification Error:", error);
    // We don't throw the error here so that the main process (like saving a profile) 
    // doesn't fail just because a notification couldn't be sent.
    return null;
  }
}