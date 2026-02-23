import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";
import { notificationService } from "../services/notificationService.js";
import {
  getDriverIdBySupabaseId,
  getDriverVehicle,
  upsertDriverProfile,
  upsertDriverVehicle,
  updateFcmToken,
} from "../services/profileService.js";
import {
  fetchActiveDriverInvite,
  issueDriverInvite,
  toInviteResponse,
} from "../services/driverInviteService.js";

// --- SCHEMAS ---

const driverProfileSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  fcmToken: z.string().optional().nullable(),
}).passthrough(); // Allow extra fields too

const vehicleSchema = z.object({
  vehicleMake: z.string().min(1),
  vehicleModel: z.string().min(1),
  vehicleYear: z.string().optional().nullable(),
  vehicleColor: z.string().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  seatCount: z.coerce.number().int().positive(),
  routeName: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  vehicleType: z.string().optional().default("Van"),
});

const inviteQuerySchema = z.object({
  ttlMinutes: z.coerce.number().int().positive().max(10080).optional(),
  maxUses: z.coerce.number().int().positive().max(50).optional(),
  force: z.coerce.boolean().optional(),
});

function resolveInviteOptions(data) {
  return {
    ttlMinutes: data.ttlMinutes ?? 1440,
    maxUses: data.maxUses ?? 1,
    force: data.force ?? false,
  };
}

// --- ROUTES ---

export default async function driverRoutes(fastify) {
  fastify.log.info("🔌 Registering /drivers routes...");

  fastify.get("/drivers/test-sync", async () => {
    return { status: "ok", message: "Driver routes are active" };
  });

 fastify.post("/drivers/fcm-token", { preHandler: verifySupabaseJwt }, async (request, reply) => {
  fastify.log.info(`🎯 HIT: /drivers/fcm-token for user: ${request.user?.id}`);
  
  if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

  const tokenSchema = z.object({
    fcmToken: z.string().min(1),
  });

  const parseResult = tokenSchema.safeParse(request.body ?? {});
  if (!parseResult.success) {
    return reply.status(400).send({ errors: parseResult.error.format() });
  }

  try {
    // Pass the ID and the validated token string
    await updateFcmToken(request.user.id, parseResult.data.fcmToken);
    
    return reply.status(200).send({ 
      status: "ok", 
      message: "Token synced perfectly" 
    });
  } catch (error) {
    // IMPORTANT: This logs the actual DB error to your console
    request.log.error("❌ FCM SYNC ERROR:", error); 
    
    return reply.status(500).send({ 
      message: "Failed to save FCM token",
      error: error.message // Temporarily send message to client for debugging
    });
  }});

  /**
   * ADMIN ACTION: Verify Driver
   * Manually approve or reject a driver and trigger push notifications
   */
  fastify.post("/drivers/verify", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    // 1. Ensure user is authenticated
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const { driverId, status, rejectionReason } = request.body;

    // 2. Validate Input
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return reply.status(400).send({ message: "Invalid status." });
    }
    if (!driverId) {
      return reply.status(400).send({ message: "driverId (Supabase User ID) is required" });
    }

    try {
      // 3. Update verification_status in the 'drivers' table
      const { error: dbError } = await supabase
        .from('drivers')
        .update({
          verification_status: status,
          updated_at: new Date().toISOString()
        })
        .eq('supabase_user_id', driverId);

      if (dbError) throw dbError;

      // 4. IMPORTANT: Sync with 'users_meta' table
      const { error: metaError } = await supabase
        .from('users_meta')
        .update({
          is_approved: status === 'approved',
          updated_at: new Date().toISOString()
        })
        .eq('supabase_user_id', driverId);

      if (metaError) console.warn("⚠️ users_meta sync failed:", metaError.message);

      // 5. Prepare Push Notification data (DATA ONLY)
      let dataPayload;

      if (status === 'approved') {
        dataPayload = { status: "approved" };
      } else if (status === 'rejected') {
        dataPayload = { status: "rejected", reason: rejectionReason || "" };
      } else if (status === 'pending') {
        dataPayload = { status: "pending" };
      }

      // 6. Send silent data payload to Flutter
      if (dataPayload) {
        await notificationService.notifyUser(driverId, null, null, dataPayload);
      }

      return reply.status(200).send({ status: "ok", message: `Driver ${status} and notified.` });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Failed to process verification" });
    }
  });

  /**
   * Update Driver Profile
   */
  fastify.post("/drivers/profile", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    // DEBUG: LOG THE INCOMING BODY
    request.log.info({ body: request.body }, "DEBUG: Incoming Profile Update Body");

    const parseResult = driverProfileSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      request.log.warn({ errors: parseResult.error.format() }, "DEBUG: Validation Failed");
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const driverId = await upsertDriverProfile(request.user.id, parseResult.data);
      return reply.status(200).send({ status: "ok", driverId });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Failed to store profile" });
    }
  });

  /**
   * Get Driver Profile
   */
  fastify.get("/drivers/profile", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    try {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, first_name, last_name, phone, profile, verification_status, created_at, updated_at")
        .eq("supabase_user_id", request.user.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return reply.status(404).send({ message: "Driver profile not found" });

      return reply.status(200).send({
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        verificationStatus: data.verification_status,
        profile: data.profile,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Failed to load profile" });
    }
  });

  /**
   * Get Vehicle Info
   */
  fastify.get("/drivers/vehicle", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const vehicle = await getDriverVehicle(driverId);
      return reply.status(200).send(vehicle ?? {});
    } catch (error) {
      return reply.status(404).send({ message: error.message });
    }
  });

  /**
   * Update Vehicle Info
   */
  fastify.post("/drivers/vehicle", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parseResult = vehicleSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const vehicle = await upsertDriverVehicle(driverId, parseResult.data);
      return reply.status(200).send({ status: "ok", vehicle });
    } catch (error) {
      return reply.status(500).send({ message: "Failed to store vehicle info" });
    }
  });

  /**
   * Invite Routes
   */
  fastify.get("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parsedQuery = inviteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) return reply.status(400).send({ errors: parsedQuery.error.format() });

    const options = resolveInviteOptions(parsedQuery.data);

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      if (!options.force) {
        const active = await fetchActiveDriverInvite(driverId);
        if (active) return reply.status(200).send(toInviteResponse(active));
      }
      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(200).send(invite);
    } catch (error) {
      return reply.status(500).send({ message: "Failed to fetch invite" });
    }
  });

  fastify.post("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parsedQuery = inviteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) return reply.status(400).send({ errors: parsedQuery.error.format() });

    const options = resolveInviteOptions(parsedQuery.data);

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(201).send(invite);
    } catch (error) {
      return reply.status(500).send({ message: "Failed to issue invite" });
    }
  });

}