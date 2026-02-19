import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import {
  getDriverIdBySupabaseId,
  getDriverVehicle,
  upsertDriverProfile,
  upsertDriverVehicle,
} from "../services/profileService.js";
import {
  fetchActiveDriverInvite,
  issueDriverInvite,
  toInviteResponse,
} from "../services/driverInviteService.js";

const driverProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(5),
  dateOfBirth: z.string().optional(),
  emergencyContact: z.string().optional(),
});

// UPDATED: Added new structured fields
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

export default async function driverRoutes(fastify) {
  fastify.post("/drivers/profile", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = driverProfileSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const driverId = await upsertDriverProfile(request.user.id, parseResult.data);
      return reply.status(200).send({ status: "ok", driverId });
    } catch (error) {
      request.log.error({ error }, "Failed to store driver profile");
      return reply.status(500).send({ message: "Failed to store profile" });
    }
  });

  fastify.get("/drivers/vehicle", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const vehicle = await getDriverVehicle(driverId);
      return reply.status(200).send(vehicle ?? {});
    } catch (error) {
      request.log.warn({ error }, "Failed to load vehicle info");
      return reply.status(404).send({ message: error.message });
    }
  });

  fastify.post("/drivers/vehicle", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parseResult = vehicleSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const vehicle = await upsertDriverVehicle(driverId, parseResult.data);
      return reply.status(200).send({ status: "ok", vehicle });
    } catch (error) {
      request.log.error({ error }, "Failed to store vehicle info");
      return reply.status(500).send({ message: "Failed to store vehicle info" });
    }
  });

  // ... (Invite routes remain exactly the same)
  fastify.get("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parsedQuery = inviteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ errors: parsedQuery.error.format() });
    }

    const options = resolveInviteOptions(parsedQuery.data);

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      if (!options.force) {
        const active = await fetchActiveDriverInvite(driverId);
        if (active) {
          return reply.status(200).send(toInviteResponse(active));
        }
      }
      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(200).send(invite);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch driver invite");
      return reply.status(500).send({ message: "Failed to fetch invite" });
    }
  });

  fastify.post("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const parsedQuery = inviteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ errors: parsedQuery.error.format() });
    }

    const options = resolveInviteOptions(parsedQuery.data);

    try {
      const driverId = await getDriverIdBySupabaseId(request.user.id);
      const invite = await issueDriverInvite(driverId, options.ttlMinutes, options.maxUses);
      return reply.status(201).send(invite);
    } catch (error) {
      request.log.error({ error }, "Failed to issue driver invite");
      return reply.status(500).send({ message: "Failed to issue invite" });
    }
  });
}