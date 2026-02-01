import pino from "pino";
import { env } from "./config/env.js";

let transport;
if (env.LOG_PRETTY) {
  transport = pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
    },
  });
} else if (env.LOG_DESTINATION) {
  transport = pino.destination({
    dest: env.LOG_DESTINATION,
    sync: false,
  });
}

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.authorization", "request.headers.authorization"],
      remove: true,
    },
  },
  transport
);
