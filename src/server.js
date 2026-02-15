import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import authRoutes from "./routes/authRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import requestLoggingPlugin from "./plugins/requestLoggingPlugin.js";
import { supabase } from "./config/supabaseClient.js";

const fastify = Fastify({ 
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty', // Makes logs readable (optional)
      options: {
        colorize: true
      }
    }
  }
});

await fastify.register(rateLimit, {
  max: 100, // Max 100 requests per minute per IP globally
  timeWindow: "1 minute",
});

fastify.register(requestLoggingPlugin);

fastify.register(authRoutes, { prefix: "/api" });
fastify.register(driverRoutes, { prefix: "/api" });
fastify.register(parentRoutes, { prefix: "/api" });

fastify.get("/api/health", async (request, reply) => {
  try {
    const { error } = await supabase
      .from("users_meta")
      .select("id", { count: "exact", head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    return reply.status(200).send({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    request.log.error({ error }, "Health check failed");
    return reply.status(503).send({ status: "error", message: "Supabase unavailable" });
  }
});

async function start() {
  try {
    await fastify.listen({ port: env.API_PORT, host: "0.0.0.0" });
    fastify.log.info(`API listening on ${env.API_PORT}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

start();