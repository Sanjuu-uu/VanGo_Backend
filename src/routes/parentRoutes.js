import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertParentProfile } from "../services/profileService.js";
import { markInviteUsed, validateDriverInvite } from "../services/driverInviteService.js";
import { supabase } from "../config/supabaseClient.js";

// --- Validation Schemas ---
const parentProfileSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional(), 
  relationship: z.string().min(1).optional(),
});

const childSchema = z.object({
  childName: z.string().min(1),
  school: z.string().min(1),
  pickupLocation: z.string().min(1),
  pickupTime: z.string().min(1).default("06:45 AM"),
});

const driverLinkSchema = z.object({
  code: z.string().min(4),
  childId: z.string().uuid(),
});

const attendanceUpdateSchema = z.object({
  attendanceState: z.enum(["coming", "not_coming", "pending"]),
});

const finderQuerySchema = z.object({
  vehicleType: z.string().optional(),
  sortBy: z.enum(["rating", "price", "distance"]).optional(),
});

const messageBodySchema = z.object({
  body: z.string().min(1),
});

// --- Helper Functions ---
async function requireParentId(supabaseUserId) {
  const { data, error } = await supabase
    .from("parents")
    .select("id")
    .eq("supabase_user_id", supabaseUserId)
    .single();

  if (error || !data) {
    throw new Error("Parent profile not found");
  }

  return data.id;
}

async function ensureThreadAccess(threadId, parentId) {
  const { data, error } = await supabase.from("message_threads").select("id, parent_id").eq("id", threadId).single();
  if (error || !data) throw new Error("Thread not found");
  if (data.parent_id !== parentId) throw new Error("Forbidden");
}

async function requireChildForParent(childId, parentId) {
  const { data, error } = await supabase
    .from("children")
    .select("id, child_name, linked_driver_id")
    .eq("id", childId)
    .eq("parent_id", parentId)
    .single();

  if (error || !data) throw new Error("Child not found");
  return data;
}

async function fetchDriverSummary(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, first_name, last_name, phone")
    .eq("id", driverId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Driver not found");

  return {
    id: data.id,
    name: [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "Driver",
    phone: data.phone ?? null,
  };
}

// --- Main Routes ---
export default async function parentRoutes(fastify) {
  
  /**
   * NEW: Fetch the parent's own profile for the Flutter Header
   * Endpoint: GET /parents/me
   */
  fastify.get("/parents/me", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    try {
      const { data, error } = await supabase
        .from("parents")
        .select("full_name, location_area")
        .eq("supabase_user_id", request.user.id)
        .single();

      if (error) throw error;
      return reply.status(200).send(data);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch parent profile");
      return reply.status(500).send({ message: "Failed to load profile" });
    }
  });

  fastify.post("/parents/profile", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parseResult = parentProfileSchema.safeParse(request.body ?? {});
    if (!parseResult.success) return reply.status(400).send({ errors: parseResult.error.format() });

    try {
      await upsertParentProfile(request.user.id, {
        fullName: parseResult.data.fullName,
        phone: parseResult.data.phone,
        email: parseResult.data.email,
        relationship: parseResult.data.relationship
      });
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.error({ error }, "Failed to store parent profile");
      return reply.status(500).send({ message: "Failed to store profile" });
    }
  });

  fastify.post("/parents/children", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parseResult = childSchema.safeParse(request.body ?? {});
    if (!parseResult.success) return reply.status(400).send({ errors: parseResult.error.format() });

    try {
      const parentId = await requireParentId(request.user.id);
      const payload = {
        parent_id: parentId,
        child_name: parseResult.data.childName,
        school: parseResult.data.school,
        pickup_location: parseResult.data.pickupLocation,
        pickup_time: parseResult.data.pickupTime,
      };

      const { data, error } = await supabase
        .from("children")
        .insert(payload)
        .select("id, child_name, school, pickup_location, pickup_time, attendance_state, payment_status, linked_driver_id")
        .single();

      if (error || !data) throw new Error(error?.message ?? "Failed to create child");
      return reply.status(201).send(data);
    } catch (error) {
      request.log.error({ error }, "Failed to create child record");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/parents/children", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("children")
        .select("id, child_name, school, pickup_location, pickup_time, attendance_state, payment_status, linked_driver_id")
        .eq("parent_id", parentId)
        .order("child_name", { ascending: true });

      if (error) throw new Error(error.message);
      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.error({ error }, "Failed to load children");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.patch("/parents/children/:childId/attendance", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parseResult = attendanceUpdateSchema.safeParse(request.body ?? {});
    if (!parseResult.success) return reply.status(400).send({ errors: parseResult.error.format() });

    const childId = request.params?.childId;
    if (!childId) return reply.status(400).send({ message: "Missing childId" });

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("children")
        .update({ attendance_state: parseResult.data.attendanceState })
        .eq("id", childId)
        .eq("parent_id", parentId)
        .select("id")
        .single();

      if (error) {
        if (error.code === "PGRST116") return reply.status(404).send({ message: "Child not found" });
        throw new Error(error.message);
      }
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.warn({ error }, "Failed to update attendance");
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.get("/parents/notifications", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("parent_notifications")
        .select("id, category, title, body, created_at, read_at")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);
      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.error({ error }, "Failed to load notifications");
      return reply.status(500).send({ message: error.message });
    }
  });

  // (Keeping other methods like link-driver, payments, messages for completeness...)
  // ... [Your existing payments, messages, and finder routes go here] ...
}