import { supabase } from "../config/supabaseClient.js";

export async function upsertUserMeta(payload) {
  const { error } = await supabase
    .from("users_meta")
    .upsert(
      {
        supabase_user_id: payload.supabaseUserId,
        role: payload.role,
        email_verified_at: payload.emailVerifiedAt ?? null,
        phone_verified_at: payload.phoneVerifiedAt ?? null,
      },
      {
        onConflict: "supabase_user_id",
      }
    );

  if (error) {
    throw new Error(`Failed to upsert users_meta: ${error.message}`);
  }
}

export async function upsertDriverProfile(supabaseUserId, data) {
  const { error } = await supabase
    .from("drivers")
    .upsert(
      {
        supabase_user_id: supabaseUserId,
        ...data,
      },
      {
        onConflict: "supabase_user_id",
      }
    );

  if (error) {
    throw new Error(`Failed to upsert driver profile: ${error.message}`);
  }
}

export async function upsertParentProfile(supabaseUserId, data) {
  const { error } = await supabase
    .from("parents")
    .upsert(
      {
        supabase_user_id: supabaseUserId,
        ...data,
      },
      {
        onConflict: "supabase_user_id",
      }
    );

  if (error) {
    throw new Error(`Failed to upsert parent profile: ${error.message}`);
  }
}