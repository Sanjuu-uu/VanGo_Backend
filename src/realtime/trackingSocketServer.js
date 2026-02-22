import { Server } from "socket.io";
import { z } from "zod";
import { createSocketJwtMiddleware } from "./socketJwtAuth.js";
import { env } from "../config/env.js";
import {
  canSupabaseUserAccessTrip,
  getDriverIdBySupabaseUserId,
  saveDriverLocation,
} from "../services/trackingService.js";

const tripSubscribeSchema = z.object({
  tripId: z.string().uuid(),
});

const locationUpdateSchema = z.object({
  tripId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(250).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  accuracyM: z.number().min(0).max(5000).optional().nullable(),
  tripPhase: z.enum(["idle", "en_route_to_pickups", "picking_up", "en_route_to_school", "completed"]),
  recordedAt: z.string().datetime().optional(),
});

function tripRoom(tripId) {
  return `trip:${tripId}`;
}

function sendAck(ack, payload) {
  if (typeof ack === "function") {
    ack(payload);
  }
}

export function registerTrackingSocketServer(fastify) {
  const io = new Server(fastify.server, {
    cors: {
      origin: env.CORS_ALLOWED_ORIGINS,
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use(createSocketJwtMiddleware());

  io.on("connection", (socket) => {
    const userId = socket.data.user?.id;
    fastify.log.info({ socketId: socket.id, userId }, "Tracking socket connected");

    socket.on("parent:subscribe_trip", async (payload, ack) => {
      if (!userId) {
        sendAck(ack, { ok: false, message: "Unauthenticated" });
        return;
      }

      const parse = tripSubscribeSchema.safeParse(payload ?? {});
      if (!parse.success) {
        sendAck(ack, { ok: false, message: "Invalid subscribe payload", errors: parse.error.format() });
        return;
      }

      try {
        const access = await canSupabaseUserAccessTrip(userId, parse.data.tripId);
        if (!access.allowed || access.userType !== "parent") {
          sendAck(ack, { ok: false, message: access.reason ?? "Forbidden" });
          return;
        }

        await socket.join(tripRoom(parse.data.tripId));
        sendAck(ack, { ok: true, room: tripRoom(parse.data.tripId) });
      } catch (error) {
        fastify.log.error({ error, userId }, "Failed to subscribe parent to trip room");
        sendAck(ack, { ok: false, message: "Subscription failed" });
      }
    });

    socket.on("driver:location_update", async (payload, ack) => {
      if (!userId) {
        sendAck(ack, { ok: false, message: "Unauthenticated" });
        return;
      }

      const parse = locationUpdateSchema.safeParse(payload ?? {});
      if (!parse.success) {
        sendAck(ack, { ok: false, message: "Invalid location payload", errors: parse.error.format() });
        return;
      }

      try {
        const driverId = await getDriverIdBySupabaseUserId(userId);
        if (!driverId) {
          sendAck(ack, { ok: false, message: "Only drivers can publish location" });
          return;
        }

        const saved = await saveDriverLocation({
          ...parse.data,
          driverId,
        });

        await socket.join(tripRoom(saved.tripId));
        io.to(tripRoom(saved.tripId)).emit("trip:location_broadcast", saved);

        if (Array.isArray(saved.geofenceEvents) && saved.geofenceEvents.length > 0) {
          for (const geofenceEvent of saved.geofenceEvents) {
            io.to(tripRoom(saved.tripId)).emit("trip:geofence_event", geofenceEvent);
          }
        }

        sendAck(ack, { ok: true, recordedAt: saved.recordedAt });
      } catch (error) {
        fastify.log.error({ error, userId }, "Failed to process driver location update");
        sendAck(ack, { ok: false, message: "Location update failed" });
      }
    });

    socket.on("disconnect", (reason) => {
      fastify.log.info({ socketId: socket.id, reason, userId }, "Tracking socket disconnected");
    });
  });

  fastify.addHook("onClose", (instance, done) => {
    io.close();
    done();
  });

  fastify.decorate("trackingSocket", io);
}
