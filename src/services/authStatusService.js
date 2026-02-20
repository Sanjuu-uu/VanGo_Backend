import { supabase } from "../config/supabaseClient.js";
import { fetchActiveDriverInvite } from "./driverInviteService.js";

function isoOrNull(value) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function baseStep(timestamp) {
  return {
    completed: Boolean(timestamp),
    completedAt: isoOrNull(timestamp) ?? undefined,
  };
}

async function loadUserMeta(supabaseUserId) {
  const { data, error } = await supabase
    .from("users_meta")
    .select("id, role, email_verified_at, phone_verified_at, profile_completed_at")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load users_meta row: ${error.message}`);
  }

  return data ?? null;
}

async function loadDriverStatus(supabaseUserId) {
  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id, first_name, last_name, phone, face_photo_uploaded_at, documents_uploaded_at, verification_status")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (driverError) {
    throw new Error(`Failed to load driver profile: ${driverError.message}`);
  }

  const driverId = driver?.id ?? null;
  let vehicleComplete = false;

  if (driverId) {
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (vehicleError) {
      throw new Error(`Failed to load driver vehicle: ${vehicleError.message}`);
    }

    vehicleComplete = Boolean(vehicle);
  }

  const invite = driverId ? await fetchActiveDriverInvite(driverId) : null;

  return {
    driverId,
    profileComplete: Boolean(driver?.first_name && driver?.last_name && driver?.phone),
    vehicleComplete,
    hasActiveInvite: Boolean(invite),
    facePhotoUploaded: Boolean(driver?.face_photo_uploaded_at),
    documentsUploaded: Boolean(driver?.documents_uploaded_at),
    verificationStatus: driver?.verification_status || 'pending',
  };
}

async function loadParentStatus(supabaseUserId) {
  const { data: parent, error: parentError } = await supabase
    .from("parents")
    .select("id, full_name, phone")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (parentError) {
    throw new Error(`Failed to load parent profile: ${parentError.message}`);
  }

  const parentId = parent?.id ?? null;
  let childCount = 0;
  let linkedChildren = 0;

  if (parentId) {
    const { data: children, error: childError } = await supabase
      .from("children")
      .select("id, linked_driver_id")
      .eq("parent_id", parentId);

    if (childError) {
      throw new Error(`Failed to load child records: ${childError.message}`);
    }

    childCount = children?.length ?? 0;
    linkedChildren = (children ?? []).filter((child) => Boolean(child.linked_driver_id)).length;
  }

  return {
    parentId,
    profileComplete: Boolean(parent?.full_name && parent?.phone),
    childCount,
    linkedChildren,
  };
}

function determineNextStep(role, steps) {
  const order = role === "parent" ? ["email", "phone", "profile", "link"] : ["email", "phone", "profile", "verification"];
  for (const stepName of order) {
    const step = steps[stepName];
    if (!step || !step.completed) {
      return stepName;
    }
  }
  return "completed";
}

export async function buildAuthStatus(supabaseUserId) {
  const meta = await loadUserMeta(supabaseUserId);
  const role = meta?.role ?? null;

  const steps = {
    email: baseStep(meta?.email_verified_at),
    phone: baseStep(meta?.phone_verified_at),
    profile: baseStep(meta?.profile_completed_at),
    link: role === "parent" ? baseStep(null) : undefined,
    verification: role === "driver" ? baseStep(null) : undefined,
  };

  let driver = null;
  let parent = null;

  if (role === "driver") {
    driver = await loadDriverStatus(supabaseUserId);
    steps.profile.completed = steps.profile.completed && driver.profileComplete && driver.vehicleComplete;
    steps.profile.completedAt = steps.profile.completed ? steps.profile.completedAt : undefined;
    steps.verification.completed = driver.facePhotoUploaded && driver.documentsUploaded;
  } else if (role === "parent") {
    parent = await loadParentStatus(supabaseUserId);
    steps.profile.completed = steps.profile.completed && parent.profileComplete && parent.childCount > 0;
    steps.profile.completedAt = steps.profile.completed ? steps.profile.completedAt : undefined;
    steps.link = {
      completed: parent.linkedChildren > 0,
      completedAt: undefined,
    };
  }

  const nextStep = determineNextStep(role, steps);
  const ready = nextStep === "completed";

  return {
    role,
    steps,
    driver,
    parent,
    nextStep,
    ready,
  };
}
