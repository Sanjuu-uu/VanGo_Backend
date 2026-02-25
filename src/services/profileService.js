import { supabase } from "../config/supabaseClient.js";

/**
 * Updates or inserts general user metadata (role, approval, FCM tokens)
 */
export async function upsertUserMeta({
  supabaseUserId,
  role,
  emailVerifiedAt,
  phoneVerifiedAt,
  profileCompletedAt,
  isApproved,
  fcmToken
}) {
  if (!supabaseUserId) {
    throw new Error("supabaseUserId is required for upsertUserMeta");
  }

  const payload = {
    supabase_user_id: supabaseUserId,
  };

  if (role !== undefined) payload.role = role;
  if (isApproved !== undefined) payload.is_approved = isApproved;
  if (fcmToken !== undefined) payload.fcm_token = fcmToken;

  if (emailVerifiedAt !== undefined) {
    payload.email_verified_at = emailVerifiedAt ?? null;
  }
  if (phoneVerifiedAt !== undefined) {
    payload.phone_verified_at = phoneVerifiedAt ?? null;
  }
  if (profileCompletedAt !== undefined) {
    payload.profile_completed_at = profileCompletedAt ?? null;
  }

  // Skip if nothing to update
  if (Object.keys(payload).length === 1) return;

  const { error } = await supabase
    .from("users_meta")
    .upsert(payload, { onConflict: "supabase_user_id" });

  if (error) {
    throw new Error(`Failed to upsert users_meta: ${error.message}`);
  }
}

/**
 * Specific function to update only the FCM token
 */
export async function updateFcmToken(supabaseUserId, fcmToken) {
  const { data, error } = await supabase
    .from('users_meta')
    .update({ 
      fcm_token: fcmToken,
      updated_at: new Date().toISOString() 
    })
    .eq('supabase_user_id', supabaseUserId)
    .select();

  if (error) {
    console.error("❌ Database Update Error:", error.message);
    throw new Error(`Supabase Error: ${error.message}`);
  }
  return data;
}

/**
 * PARENT PROFILE LOGIC
 * Includes location_area for the Flutter HomeScreen header
 */
export async function upsertParentProfile(supabaseUserId, data) {
  const payload = {
    supabase_user_id: supabaseUserId,
    full_name: data?.fullName ?? null,
    phone: data?.phone ?? null,
    email: data?.email ?? null,
    relationship: data?.relationship ?? null,
    // Added to support the HomeScreen dynamic location text
    location_area: data?.locationArea ?? "Not Set", 
    updated_at: new Date().toISOString(),
  };

  if (data?.notificationPrefs !== undefined) {
    payload.notification_prefs = data.notificationPrefs;
  }

  // 1. Update the Parent table
  const { data: parentData, error } = await supabase
    .from("parents")
    .upsert(payload, { onConflict: "supabase_user_id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert parent profile: ${error.message}`);
  }

  // 2. Sync with users_meta table
  const metaPayload = {
    supabase_user_id: supabaseUserId,
    profile_completed_at: new Date().toISOString(),
    role: "parent",
    is_approved: true, 
  };

  if (data?.fcmToken !== undefined) {
    metaPayload.fcm_token = data.fcmToken;
  }

  const { error: metaError } = await supabase
    .from("users_meta")
    .upsert(metaPayload, { onConflict: "supabase_user_id" });

  if (metaError) {
    console.warn("Failed to update users_meta completion status:", metaError.message);
  }

  return parentData;
}

export async function getParentProfile(supabaseUserId) {
  const { data, error } = await supabase
    .from("parents")
    .select("*")
    .eq("supabase_user_id", supabaseUserId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }
  return data;
}

// --- DRIVER & VEHICLE LOGIC ---

function buildDriverPayload(supabaseUserId, data) {
  const payload = { supabase_user_id: supabaseUserId };

  if (data.firstName !== undefined) payload.first_name = data.firstName;
  if (data.lastName !== undefined) payload.last_name = data.lastName;
  if (data.phone !== undefined) payload.phone = data.phone;

  const profile = {};
  if (data.dateOfBirth !== undefined) profile.dateOfBirth = data.dateOfBirth;
  if (data.emergencyContact !== undefined) profile.emergencyContact = data.emergencyContact;

  if (Object.keys(profile).length > 0) payload.profile = profile;

  return payload;
}

export async function upsertDriverProfile(supabaseUserId, data) {
  await upsertUserMeta({
    supabaseUserId,
    role: "driver",
    fcmToken: data?.fcmToken
  });

  const payload = buildDriverPayload(supabaseUserId, data ?? {});

  const { data: result, error } = await supabase
    .from("drivers")
    .upsert(payload, { onConflict: "supabase_user_id" })
    .select("id")
    .single();

  if (error || !result) {
    throw new Error(`Failed to upsert driver profile: ${error?.message ?? "missing driver"}`);
  }
  return result.id;
}

export async function getDriverIdBySupabaseId(supabaseUserId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load driver profile: ${error.message}`);
  if (data) return data.id;

  const { data: created, error: insertError } = await supabase
    .from("drivers")
    .insert({ supabase_user_id: supabaseUserId })
    .select("id")
    .single();

  if (insertError || !created) {
    throw new Error(`Driver profile creation failed: ${insertError?.message ?? "insert failed"}`);
  }
  return created.id;
}

export async function upsertDriverVehicle(driverId, vehicleData) {
  const { data, error } = await supabase
    .from("vehicles")
    .upsert(
      {
        driver_id: driverId,
        vehicle_make: vehicleData.vehicleMake,
        vehicle_model: vehicleData.vehicleModel,
        seat_count: vehicleData.seatCount,
        route_name: vehicleData.routeName,
        vehicle_type: vehicleData.vehicleType,
        vehicle_year: vehicleData.vehicleYear,
        vehicle_color: vehicleData.vehicleColor,
        license_plate: vehicleData.licensePlate,
        province: vehicleData.province,
        district: vehicleData.district,
        city: vehicleData.city,
      },
      { onConflict: "driver_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Supabase Upsert Error: ${error.message}`);
  return data;
}

export async function getDriverVehicle(driverId) {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load vehicle: ${error.message}`);
  return data;
}