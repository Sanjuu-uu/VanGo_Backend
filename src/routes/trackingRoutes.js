import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import {
  canSupabaseUserAccessTrip,
  getDriverIdBySupabaseUserId,
  getLatestTripLocation,
  getTripSession,
  getTripGeofenceEvents,
  getTripLocationHistory,
  getTripPlayback,
  startOrCreateTripSessionForDriver,
  updateTripSessionStatus,
} from "../services/trackingService.js";

const tripParamsSchema = z.object({
  tripId: z.string().uuid(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const geofenceQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const playbackQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const tripActionSchema = z.object({
  tripPhase: z.enum(["idle", "en_route_to_pickups", "picking_up", "en_route_to_school", "completed"]).optional(),
});

export default async function trackingRoutes(fastify) {
  fastify.post("/tracking/trips/start", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const bodyResult = tripActionSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      return reply.status(400).send({ errors: bodyResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseUserId(request.user.id);
      if (!driverId) {
        return reply.status(403).send({ message: "Only drivers can start trip tracking" });
      }

      const session = await startOrCreateTripSessionForDriver({
        driverId,
        tripPhase: bodyResult.data.tripPhase ?? "en_route_to_pickups",
      });

      return reply.status(200).send(session);
    } catch (error) {
      request.log.error({ error }, "Failed to start or create trip session");
      return reply.status(500).send({ message: "Failed to start trip session" });
    }
  });

  fastify.post("/tracking/trips/:tripId/start", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    const bodyResult = tripActionSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      return reply.status(400).send({ errors: bodyResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseUserId(request.user.id);
      if (!driverId) {
        return reply.status(403).send({ message: "Only drivers can start trip tracking" });
      }

      const session = await updateTripSessionStatus({
        tripId: paramsResult.data.tripId,
        driverId,
        status: "active",
        tripPhase: bodyResult.data.tripPhase ?? "en_route_to_pickups",
      });

      return reply.status(200).send(session);
    } catch (error) {
      request.log.error({ error }, "Failed to start trip session");
      return reply.status(500).send({ message: "Failed to start trip session" });
    }
  });

  fastify.post("/tracking/trips/:tripId/pause", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    const bodyResult = tripActionSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      return reply.status(400).send({ errors: bodyResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseUserId(request.user.id);
      if (!driverId) {
        return reply.status(403).send({ message: "Only drivers can pause trip tracking" });
      }

      const session = await updateTripSessionStatus({
        tripId: paramsResult.data.tripId,
        driverId,
        status: "paused",
        tripPhase: bodyResult.data.tripPhase ?? "picking_up",
      });

      return reply.status(200).send(session);
    } catch (error) {
      request.log.error({ error }, "Failed to pause trip session");
      return reply.status(500).send({ message: "Failed to pause trip session" });
    }
  });

  fastify.post("/tracking/trips/:tripId/end", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    try {
      const driverId = await getDriverIdBySupabaseUserId(request.user.id);
      if (!driverId) {
        return reply.status(403).send({ message: "Only drivers can end trip tracking" });
      }

      const session = await updateTripSessionStatus({
        tripId: paramsResult.data.tripId,
        driverId,
        status: "completed",
        tripPhase: "completed",
      });

      return reply.status(200).send(session);
    } catch (error) {
      request.log.error({ error }, "Failed to end trip session");
      return reply.status(500).send({ message: "Failed to end trip session" });
    }
  });

  fastify.get("/tracking/trips/:tripId/session", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    try {
      const access = await canSupabaseUserAccessTrip(request.user.id, paramsResult.data.tripId);
      if (!access.allowed) {
        return reply.status(403).send({ message: access.reason ?? "Forbidden" });
      }

      const session = await getTripSession(paramsResult.data.tripId);
      if (!session) {
        return reply.status(404).send({ message: "Trip session not found" });
      }

      return reply.status(200).send(session);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch trip session");
      return reply.status(500).send({ message: "Failed to fetch trip session" });
    }
  });

  fastify.get("/tracking/trips/:tripId/latest", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    try {
      const access = await canSupabaseUserAccessTrip(request.user.id, paramsResult.data.tripId);
      if (!access.allowed) {
        return reply.status(403).send({ message: access.reason ?? "Forbidden" });
      }

      const latest = await getLatestTripLocation(paramsResult.data.tripId);
      if (!latest) {
        return reply.status(404).send({ message: "No location available for this trip" });
      }

      return reply.status(200).send(latest);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch latest trip location");
      return reply.status(500).send({ message: "Failed to fetch latest location" });
    }
  });

  fastify.get("/tracking/trips/:tripId/history", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    const queryResult = historyQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    try {
      const access = await canSupabaseUserAccessTrip(request.user.id, paramsResult.data.tripId);
      if (!access.allowed) {
        return reply.status(403).send({ message: access.reason ?? "Forbidden" });
      }

      const history = await getTripLocationHistory(paramsResult.data.tripId, queryResult.data.limit ?? 100);
      return reply.status(200).send(history);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch trip history");
      return reply.status(500).send({ message: "Failed to fetch location history" });
    }
  });

  fastify.get("/tracking/trips/:tripId/geofence-events", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    const queryResult = geofenceQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    try {
      const access = await canSupabaseUserAccessTrip(request.user.id, paramsResult.data.tripId);
      if (!access.allowed) {
        return reply.status(403).send({ message: access.reason ?? "Forbidden" });
      }

      const events = await getTripGeofenceEvents(paramsResult.data.tripId, queryResult.data.limit ?? 100);
      return reply.status(200).send(events);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch geofence events");
      return reply.status(500).send({ message: "Failed to fetch geofence events" });
    }
  });

  fastify.get("/tracking/trips/:tripId/playback", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const paramsResult = tripParamsSchema.safeParse(request.params ?? {});
    if (!paramsResult.success) {
      return reply.status(400).send({ errors: paramsResult.error.format() });
    }

    const queryResult = playbackQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ errors: queryResult.error.format() });
    }

    const query = queryResult.data;
    if (query.from && query.to && new Date(query.from).getTime() > new Date(query.to).getTime()) {
      return reply.status(400).send({ message: "`from` must be earlier than or equal to `to`" });
    }

    try {
      const access = await canSupabaseUserAccessTrip(request.user.id, paramsResult.data.tripId);
      if (!access.allowed) {
        return reply.status(403).send({ message: access.reason ?? "Forbidden" });
      }

      const playback = await getTripPlayback(paramsResult.data.tripId, {
        from: query.from,
        to: query.to,
        limit: query.limit,
        order: query.order,
      });

      return reply.status(200).send(playback);
    } catch (error) {
      request.log.error({ error }, "Failed to fetch trip playback");
      return reply.status(500).send({ message: "Failed to fetch trip playback" });
    }
  });
}
