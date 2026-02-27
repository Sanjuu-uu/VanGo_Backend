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
}).passthrough();

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

// Updated: allow ttlMinutes to be nullable for "lifetime" QR codes
const inviteQuerySchema = z.object({
  ttlMinutes: z.coerce.number().int().positive().max(525600).optional().nullable(), // max 1 year if provided
  maxUses: z.coerce.number().int().positive().max(100).optional(),
  force: z.coerce.boolean().optional(),
});

function resolveInviteOptions(data, defaultMaxUses = 1) {
  return {
    ttlMinutes: data.ttlMinutes ?? null, // null means it's a lifetime code
    maxUses: data.maxUses ?? defaultMaxUses,
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
      await updateFcmToken(request.user.id, parseResult.data.fcmToken);
      
      return reply.status(200).send({ 
        status: "ok", 
        message: "Token synced perfectly" 
      });
    } catch (error) {
      request.log.error("❌ FCM SYNC ERROR:", error); 
      return reply.status(500).send({ 
        message: "Failed to save FCM token",
        error: error.message 
      });
    }
  });

  /**
   * ADMIN ACTION: Verify Driver
   * Manually approve or reject a driver and trigger push notifications
   * NEW: Creates lifetime QR invite code limited to seat capacity upon approval
   */
  fastify.post("/drivers/verify", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const { driverId, status, rejectionReason } = request.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return reply.status(400).send({ message: "Invalid status." });
    }
    if (!driverId) {
      return reply.status(400).send({ message: "driverId (Supabase User ID) is required" });
    }

    try {
      // 3. Update verification_status in the 'drivers' table AND fetch internal id
      const { data: driverRow, error: dbError } = await supabase
        .from('drivers')
        .update({
          verification_status: status,
          updated_at: new Date().toISOString()
        })
        .eq('supabase_user_id', driverId)
        .select('id')
        .single();

      if (dbError) throw dbError;

      // 4. Sync with 'users_meta' table
      const { error: metaError } = await supabase
        .from('users_meta')
        .update({
          is_approved: status === 'approved',
          updated_at: new Date().toISOString()
        })
        .eq('supabase_user_id', driverId);

      if (metaError) console.warn("⚠️ users_meta sync failed:", metaError.message);

      // --- NEW: AUTO CREATE SEAT-BOUND INVITE ON APPROVAL ---
      if (status === 'approved' && driverRow) {
        try {
          const { data: vehicleData } = await supabase
            .from('vehicles')
            .select('seat_count')
            .eq('driver_id', driverRow.id)
            .maybeSingle();
            
          const seatCount = vehicleData?.seat_count || 5; // Default 5 if no vehicle found
          
          // Generate a lifetime code (ttlMinutes = null) bounded to the seat capacity
          await issueDriverInvite(driverRow.id, null, seatCount);
        } catch (inviteErr) {
          request.log.error("⚠️ Failed to auto-generate invite code on approval:", inviteErr);
        }
      }

      // 5. Prepare Push Notification data
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

    const parseResult = driverProfileSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
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

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      
      const vehicle = await getDriverVehicle(driverId);
      const seatCount = vehicle?.seat_count || 1;
      
      const options = resolveInviteOptions(parsedQuery.data, seatCount);

      if (!options.force) {
        const active = await fetchActiveDriverInvite(driverId);
        if (active) return reply.status(200).send(toInviteResponse(active));
      }
      
      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(200).send(invite);
    } catch (error) {
      return reply.status(500).send({ message: "Failed to fetch invite", error: error.message });
    }
  });

  fastify.post("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ message: "Unauthenticated" });

    const parsedQuery = inviteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) return reply.status(400).send({ errors: parsedQuery.error.format() });

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      
      // Pull vehicle data to ensure default uses = max seats if not specified
      const vehicle = await getDriverVehicle(driverId);
      const seatCount = vehicle?.seat_count || 1;

      const options = resolveInviteOptions(parsedQuery.data, seatCount);

      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(201).send(invite);
    } catch (error) {
      return reply.status(500).send({ message: "Failed to issue invite", error: error.message });
    }
  });

  // 1. Get History of Invites
  fastify.get("/drivers/invite/history", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      
      const { data, error } = await supabase
        .from("driver_invites")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Map it for the app
      const history = (data || []).map(row => {
        const stillValid = !row.expires_at || new Date(row.expires_at) > new Date();
        const hasCapacity = (row.uses ?? 0) < (row.max_uses ?? 1);
        return {
          id: row.id,
          code: row.code_plain,
          expiresAt: row.expires_at,
          maxUses: row.max_uses,
          remainingUses: Math.max((row.max_uses ?? 0) - (row.uses ?? 0), 0),
          isActive: stillValid && hasCapacity
        };
      });

      return reply.status(200).send(history);
    } catch (error) {
      return reply.status(500).send({ message: "Failed to load invite history" });
    }
  });

  // 2. Edit an existing Invite
  fastify.patch("/drivers/invite/:inviteId", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const { inviteId } = request.params;
    const { maxUses, ttlMinutes } = request.body;

    try {
      const updates = {};
      if (maxUses !== undefined) updates.max_uses = maxUses;
      if (ttlMinutes !== undefined) {
        updates.expires_at = ttlMinutes === null 
          ? null 
          : new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      }

      const { data, error } = await supabase
        .from("driver_invites")
        .update(updates)
        .eq("id", inviteId)
        .select()
        .single();

      if (error) throw error;
      return reply.status(200).send({ status: "ok", data });
    } catch (error) {
      return reply.status(500).send({ message: "Failed to update invite" });
    }
  });

  // 3. Revoke an Invite
  fastify.patch("/drivers/invite/:inviteId/revoke", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const { inviteId } = request.params;
    try {
      // Setting expires_at to past ensures it's instantly inactive
      const { error } = await supabase
        .from("driver_invites")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() }) 
        .eq("id", inviteId);

      if (error) throw error;
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      return reply.status(500).send({ message: "Failed to revoke invite" });
    }
  });

}