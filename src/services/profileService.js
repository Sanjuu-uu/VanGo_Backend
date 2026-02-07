import { supabase } from "../config/supabaseClient.js";

export async function upsertUserMeta({ supabaseUserId, role, emailVerifiedAt, phoneVerifiedAt, profileCompletedAt }) {
  if (!supabaseUserId) {
    throw new Error("supabaseUserId is required for upsertUserMeta");
  }

  const payload = {
    supabase_user_id: supabaseUserId,
  };

  if (role !== undefined) {
    payload.role = role;
  }
  if (emailVerifiedAt !== undefined) {
    payload.email_verified_at = emailVerifiedAt ?? null;
  }
  if (phoneVerifiedAt !== undefined) {
    payload.phone_verified_at = phoneVerifiedAt ?? null;
  }
  if (profileCompletedAt !== undefined) {
    payload.profile_completed_at = profileCompletedAt ?? null;
  }

  if (Object.keys(payload).length === 1) {
    return;
  }

  const { error } = await supabase
    .from("users_meta")
    .upsert(payload, {
      onConflict: "supabase_user_id",
    });

  if (error) {
    throw new Error(`Failed to upsert users_meta: ${error.message}`);
  }
}

function buildDriverPayload(supabaseUserId, data) {
  const payload = {
    supabase_user_id: supabaseUserId,
  };

  if (data.firstName !== undefined) {
    payload.first_name = data.firstName;
  }
  if (data.lastName !== undefined) {
    payload.last_name = data.lastName;
  }
  if (data.phone !== undefined) {
    payload.phone = data.phone;
  }

  const profile = {};
  if (data.dateOfBirth !== undefined) {
    profile.dateOfBirth = data.dateOfBirth;
  }
  if (data.emergencyContact !== undefined) {
    profile.emergencyContact = data.emergencyContact;
  }

  if (Object.keys(profile).length > 0) {
    payload.profile = profile;
  }

  return payload;
}

export async function upsertDriverProfile(supabaseUserId, data) {
  const payload = buildDriverPayload(supabaseUserId, data ?? {});

  const { data: result, error } = await supabase
    .from("drivers")
    .upsert(payload, {
      onConflict: "supabase_user_id",
    })
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

  if (error) {
    throw new Error(`Failed to load driver profile: ${error.message}`);
  }

  if (data) {
    return data.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("drivers")
    .insert({ supabase_user_id: supabaseUserId })
    .select("id")
    .single();

  if (insertError || !created) {
    throw new Error(`Driver profile not found: ${insertError?.message ?? "insert failed"}`);
  }

  return created.id;
}

export async function upsertDriverVehicle(driverId, vehicle) {
  const sanitizedRoute = (() => {
    if (typeof vehicle.routeName !== "string") {
      return null;
    }
    const trimmed = vehicle.routeName.trim();
    return trimmed.length > 0 ? trimmed : null;
  })();

  const payload = {
    driver_id: driverId,
    vehicle_make: vehicle.vehicleMake,
    vehicle_model: vehicle.vehicleModel,
    seat_count: vehicle.seatCount,
    route_name: sanitizedRoute,
    vehicle_type: vehicle.vehicleType ?? "Van",
  };

  const { data, error } = await supabase
    .from("vehicles")
    .upsert(payload, { onConflict: "driver_id" })
    .select("id, driver_id, vehicle_make, vehicle_model, seat_count, route_name, vehicle_type, monthly_fee, distance_km, image_url, rating, created_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert vehicle: ${error?.message ?? "missing vehicle"}`);
  }

  return data;
}

export async function getDriverVehicle(driverId) {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, driver_id, vehicle_make, vehicle_model, seat_count, route_name, vehicle_type, monthly_fee, distance_km, image_url, rating, created_at")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load vehicle: ${error.message}`);
  }

  return data;
}

export async function upsertParentProfile(supabaseUserId, data) {
  const payload = {
    supabase_user_id: supabaseUserId,
    full_name: data?.fullName ?? null,
    phone: data?.phone ?? null,
  };

  if (data?.notificationPrefs !== undefined) {
    payload.notification_prefs = data.notificationPrefs;
  }

  const { error } = await supabase.from("parents").upsert(payload, {
    onConflict: "supabase_user_id",
  });

  if (error) {
    throw new Error(`Failed to upsert parent profile: ${error.message}`);
  }
}