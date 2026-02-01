import Fastify from "fastify";
import authRoutes from "./routes/authRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import requestLoggingPlugin from "./plugins/requestLoggingPlugin.js";

const fastify = Fastify({
  logger,
});

fastify.register(requestLoggingPlugin);

fastify.register(authRoutes, { prefix: "/api" });
fastify.register(driverRoutes, { prefix: "/api" });
fastify.register(parentRoutes, { prefix: "/api" });

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