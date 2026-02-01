import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

const jwks = createRemoteJWKSet(new URL(env.SUPABASE_JWT_JWKS_URL));

export async function verifySupabaseJwt(request, reply) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ message: "Missing bearer token" });
    }

    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });

    request.user = {
      id: String(payload.sub),
      role: typeof payload.role === "string" ? payload.role : undefined,
    };
  } catch (error) {
    request.log.error({ error }, "JWT verification failed");
    return reply.status(401).send({ message: "Invalid or expired token" });
  }
}