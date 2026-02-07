import crypto from "node:crypto";
import { supabase } from "../config/supabaseClient.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_COLUMNS = "id, driver_id, code_plain, code_hash, expires_at, max_uses, uses";

function randomCode(length = 8) {
  return Array.from({ length })
    .map(() => ALPHABET[crypto.randomInt(0, ALPHABET.length)])
    .join("");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function isInviteActive(row) {
  const stillValid = !row.expires_at || new Date(row.expires_at) > new Date();
  const hasCapacity = (row.uses ?? 0) < (row.max_uses ?? 1);
  return stillValid && hasCapacity;
}

function serializeInvite(row) {
  return {
    code: row.code_plain,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    remainingUses: Math.max((row.max_uses ?? 0) - (row.uses ?? 0), 0),
  };
}

export async function fetchActiveDriverInvite(driverId) {
  const { data, error } = await supabase
    .from("driver_invites")
    .select(INVITE_COLUMNS)
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`Failed to load driver invites: ${error.message}`);
  }

  return (data ?? []).find((row) => isInviteActive(row)) ?? null;
}

export async function issueDriverInvite(driverId, ttlMinutes = 60, maxUses = 1) {
  const plainCode = randomCode();
  const hashed = hashCode(plainCode);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("driver_invites")
    .insert({
      driver_id: driverId,
      code_plain: plainCode,
      code_hash: hashed,
      max_uses: maxUses,
      expires_at: expiresAt,
    })
    .select(INVITE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to create driver invite: ${error?.message ?? "missing invite"}`);
  }

  return serializeInvite(data);
}

export async function validateDriverInvite(code) {
  const hashed = hashCode(code);
  const { data, error } = await supabase
    .from("driver_invites")
    .select("id, driver_id, uses, max_uses, expires_at")
    .eq("code_hash", hashed)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Invalid or expired code");
  }

  if (data.uses >= data.max_uses) {
    throw new Error("Code already used");
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new Error("Code expired");
  }

  return data;
}

export function toInviteResponse(row) {
  return serializeInvite(row);
}

export async function markInviteUsed(inviteId) {
  const { data, error } = await supabase.from("driver_invites").select("uses").eq("id", inviteId).maybeSingle();

  if (error || !data) {
    throw new Error("Unable to fetch invite usage count");
  }

  const { error: updateError } = await supabase
    .from("driver_invites")
    .update({ uses: (data.uses ?? 0) + 1 })
    .eq("id", inviteId);

  if (updateError) {
    throw new Error(`Failed to update invite usage: ${updateError.message}`);
  }
}