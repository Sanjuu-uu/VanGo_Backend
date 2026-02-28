import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import authRoutes from "./routes/authRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import adminAuthRoutes from "./routes/adminAuthRoutes.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import requestLoggingPlugin from "./plugins/requestLoggingPlugin.js";
import { supabase } from "./config/supabaseClient.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import trackingRoutes from "./routes/trackingRoutes.js";
import { registerTrackingSocketServer } from "./realtime/trackingSocketServer.js";
import { cleanupTrackingHistory } from "./services/trackingService.js";
import webhookNotificationRoutes from "./routes/webhookNotificationRoutes.js";
import webhookVerificationRoutes from "./routes/webhookVerificationRoutes.js";
import documentRoutes from './routes/documentRoutes.js';
import verificationRoutes from './routes/verificationRoutes.js'

const fastify = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty", // Makes logs readable (optional)
      options: {
        colorize: true,
      },
    },
  },
});

await fastify.register(rateLimit, {
  max: 100, // Max 100 requests per minute per IP globally
  timeWindow: "1 minute",
});

await fastify.register(cors, {
  origin: env.CORS_ALLOWED_ORIGINS,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

fastify.register(requestLoggingPlugin);

fastify.register(authRoutes, { prefix: "/api" });
fastify.register(driverRoutes, { prefix: "/api" });
fastify.register(parentRoutes, { prefix: "/api" });
fastify.register(adminRoutes, { prefix: "/api" });
fastify.register(adminAuthRoutes, { prefix: "/api" });
fastify.register(notificationRoutes, { prefix: "/api" });
fastify.register(trackingRoutes, { prefix: "/api" });
fastify.register(webhookNotificationRoutes, { prefix: "/api" });
fastify.register(webhookVerificationRoutes, { prefix: "/api" });
fastify.register(documentRoutes, { prefix: "/api" });
fastify.register(verificationRoutes, { prefix: "/api" });

fastify.get("/api/health", async (request, reply) => {
  try {
    const { error } = await supabase
      .from("users_meta")
      .select("id", { count: "exact", head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    return reply
      .status(200)
      .send({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    request.log.error({ error }, "Health check failed");
    return reply
      .status(503)
      .send({ status: "error", message: "Supabase unavailable" });
  }
});

let retentionTimer = null;

async function runRetentionCleanup() {
  try {
    const result = await cleanupTrackingHistory(env.TRACKING_RETENTION_DAYS);
    fastify.log.info(
      {
        thresholdIso: result.thresholdIso,
        deletedHistoryRows: result.deletedHistoryRows,
        deletedGeofenceRows: result.deletedGeofenceRows,
      },
      "Tracking retention cleanup completed",
    );
  } catch (error) {
    fastify.log.error({ error }, "Tracking retention cleanup failed");
  }
}

function startRetentionCleanupScheduler() {
  if (!env.TRACKING_RETENTION_ENABLED) {
    fastify.log.info("Tracking retention cleanup is disabled by environment");
    return;
  }

  runRetentionCleanup();

  const intervalMs =
    Math.max(1, env.TRACKING_RETENTION_INTERVAL_MINUTES) * 60 * 1000;
  retentionTimer = setInterval(runRetentionCleanup, intervalMs);

  fastify.log.info(
    {
      retentionDays: env.TRACKING_RETENTION_DAYS,
      intervalMinutes: env.TRACKING_RETENTION_INTERVAL_MINUTES,
    },
    "Tracking retention cleanup scheduler started",
  );
}

async function start() {
  try {
    registerTrackingSocketServer(fastify);
    startRetentionCleanupScheduler();

    fastify.addHook("onClose", (_instance, done) => {
      if (retentionTimer) {
        clearInterval(retentionTimer);
        retentionTimer = null;
      }
      done();
    });

    await fastify.listen({ port: env.API_PORT, host: env.API_HOST });
    fastify.log.info(
      {
        host: env.API_HOST,
        port: env.API_PORT,
        corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
      },
      "API listening",
    );
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

start();
