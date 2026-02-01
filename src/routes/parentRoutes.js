import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertParentProfile } from "../services/profileService.js";
import { markInviteUsed, validateDriverInvite } from "../services/driverInviteService.js";
import { supabase } from "../config/supabaseClient.js";

const parentProfileSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(5),
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
  if (error || !data) {
    throw new Error("Thread not found");
  }
  if (data.parent_id !== parentId) {
    throw new Error("Forbidden");
  }
}

export default async function parentRoutes(fastify) {
  fastify.post("/parents/profile", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = parentProfileSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      await upsertParentProfile(request.user.id, parseResult.data);
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.error({ error }, "Failed to store parent profile");
      return reply.status(500).send({ message: "Failed to store profile" });
    }
  });

  fastify.post("/parents/children", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = childSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

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
        .select("id, child_name, school, pickup_location, pickup_time, attendance_state, payment_status")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create child");
      }

      return reply.status(201).send(data);
    } catch (error) {
      request.log.error({ error }, "Failed to create child record");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/parents/children", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("children")
        .select("id, child_name, school, pickup_location, pickup_time, attendance_state, payment_status")
        .eq("parent_id", parentId)
        .order("child_name", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.error({ error }, "Failed to load children");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.patch("/parents/children/:childId/attendance", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = attendanceUpdateSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    const childId = request.params?.childId;
    if (!childId) {
      return reply.status(400).send({ message: "Missing childId" });
    }

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
        if (error.code === "PGRST116") {
          return reply.status(404).send({ message: "Child not found" });
        }
        throw new Error(error.message);
      }

      if (!data) {
        return reply.status(404).send({ message: "Child not found" });
      }

      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.warn({ error }, "Failed to update attendance");
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.post("/parents/link-driver", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = driverLinkSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      const invite = await validateDriverInvite(parseResult.data.code);

      const { error } = await supabase.from("parent_driver_links").insert({
        driver_id: invite.driver_id,
        child_id: parseResult.data.childId,
        status: "pending",
      });

      if (error) {
        throw new Error(error.message);
      }

      await markInviteUsed(invite.id);
      return reply.status(201).send({ driverId: invite.driver_id });
    } catch (error) {
      request.log.warn({ error }, "Failed to link driver");
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.get("/parents/notifications", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("parent_notifications")
        .select("id, category, title, body, created_at, read_at")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        throw new Error(error.message);
      }

      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.error({ error }, "Failed to load notifications");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.patch("/parents/notifications/:notificationId/read", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const notificationId = request.params?.notificationId;
    if (!notificationId) {
      return reply.status(400).send({ message: "Missing notificationId" });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      const { error } = await supabase
        .from("parent_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("parent_id", parentId);

      if (error) {
        throw new Error(error.message);
      }

      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.warn({ error }, "Failed to mark notification read");
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.get("/parents/finder/services", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const queryParse = finderQuerySchema.safeParse(request.query ?? {});
    if (!queryParse.success) {
      return reply.status(400).send({ errors: queryParse.error.format() });
    }

    try {
      const { vehicleType, sortBy } = queryParse.data;
      let query = supabase
        .from("vehicles")
        .select(
          "id, vehicle_type, seat_count, monthly_fee, distance_km, image_url, rating, route_name, driver:drivers(first_name, last_name)"
        )
        .limit(100);

      if (vehicleType) {
        query = query.eq("vehicle_type", vehicleType);
      }

      const sortColumn = sortBy === "price" ? "monthly_fee" : sortBy === "distance" ? "distance_km" : "rating";
      const ascending = sortBy === "price" || sortBy === "distance";
      query = query.order(sortColumn, { ascending, nullsFirst: ascending });

      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }

      const normalized = (data ?? []).map((row) => {
        const driver = row.driver ?? null;
        const driverName = [driver?.first_name, driver?.last_name].filter(Boolean).join(" ") || "Driver";
        return {
          id: row.id,
          driverName,
          vehicleType: row.vehicle_type,
          seats: row.seat_count,
          price: row.monthly_fee,
          distance: row.distance_km,
          route: row.route_name,
          rating: row.rating,
          vehicleImageUrl: row.image_url,
        };
      });

      return reply.status(200).send(normalized);
    } catch (error) {
      request.log.error({ error }, "Failed to load finder services");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/parents/messages/threads", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      const { data, error } = await supabase
        .from("message_threads")
        .select("id, title, last_message, last_activity, unread_parent_count")
        .eq("parent_id", parentId)
        .order("last_activity", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.error({ error }, "Failed to load threads");
      return reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/parents/messages/:threadId", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const threadId = request.params?.threadId;
    if (!threadId) {
      return reply.status(400).send({ message: "Missing threadId" });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      await ensureThreadAccess(threadId, parentId);

      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_type, body, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      await supabase
        .from("message_threads")
        .update({ unread_parent_count: 0 })
        .eq("id", threadId)
        .eq("parent_id", parentId);

      return reply.status(200).send(data ?? []);
    } catch (error) {
      request.log.warn({ error }, "Failed to load messages");
      return reply.status(400).send({ message: error.message });
    }
  });

  fastify.post("/parents/messages/:threadId", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const threadId = request.params?.threadId;
    if (!threadId) {
      return reply.status(400).send({ message: "Missing threadId" });
    }

    const parseResult = messageBodySchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const parentId = await requireParentId(request.user.id);
      await ensureThreadAccess(threadId, parentId);

      const { data, error } = await supabase
        .from("messages")
        .insert({
          thread_id: threadId,
          sender_type: "parent",
          body: parseResult.data.body,
        })
        .select("id, sender_type, body, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to send message");
      }

      await supabase
        .from("message_threads")
        .update({
          last_message: parseResult.data.body,
          last_activity: new Date().toISOString(),
        })
        .eq("id", threadId)
        .eq("parent_id", parentId);

      return reply.status(201).send(data);
    } catch (error) {
      request.log.error({ error }, "Failed to send message");
      return reply.status(500).send({ message: error.message });
    }
  });
}