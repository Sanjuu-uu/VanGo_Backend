import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertDriverProfile } from "../services/profileService.js";
import { issueDriverInvite } from "../services/driverInviteService.js";

const driverProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(5),
  dateOfBirth: z.string().optional(),
  emergencyContact: z.string().optional(),
});

const vehicleSchema = z.object({
  vehicleMake: z.string().min(1),
  vehicleModel: z.string().min(1),
  seatCount: z.number().int().positive(),
  routeName: z.string().optional(),
});

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
      await upsertDriverProfile(request.user.id, parseResult.data);
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.error({ error }, "Failed to store driver profile");
      return reply.status(500).send({ message: "Failed to store profile" });
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
      await upsertDriverProfile(request.user.id, { vehicle: parseResult.data });
      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.error({ error }, "Failed to store vehicle info");
      return reply.status(500).send({ message: "Failed to store vehicle info" });
    }
  });

  fastify.post("/drivers/invite", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const query = request.query ?? {};
    const ttlMinutes = Number(query.ttlMinutes ?? 1440);
    const maxUses = Number(query.maxUses ?? 1);

    try {
      const invite = await issueDriverInvite(request.user.id, ttlMinutes, maxUses);
      return reply.status(201).send(invite);
    } catch (error) {
      request.log.error({ error }, "Failed to issue driver invite");
      return reply.status(500).send({ message: "Failed to issue invite" });
    }
  });
}