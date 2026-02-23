import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

const jwksUrl = new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
const jwks = createRemoteJWKSet(jwksUrl);

function readBearerToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken;
  }

  const authHeader = socket.handshake?.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export function createSocketJwtMiddleware() {
  return async (socket, next) => {
    try {
      const token = readBearerToken(socket);
      if (!token) {
        return next(new Error("Missing bearer token"));
      }

      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${env.SUPABASE_URL}/auth/v1`,
      });

      socket.data.user = {
        id: String(payload.sub),
        role: typeof payload.role === "string" ? payload.role : undefined,
      };

      return next();
    } catch (_error) {
      return next(new Error("Invalid or expired token"));
    }
  };
}
