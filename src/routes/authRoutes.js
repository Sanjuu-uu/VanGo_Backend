import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertUserMeta } from "../services/profileService.js";
import { buildAuthStatus } from "../services/authStatusService.js";

const isoString = z.string().datetime();

const authProgressSchema = z.object({
  role: z.enum(["driver", "parent"]).optional(),
  emailVerifiedAt: isoString.optional(),
  phoneVerifiedAt: isoString.optional(),
  profileCompletedAt: isoString.optional(),
});

export default async function authRoutes(fastify) {
  fastify.post("/auth/progress", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const parseResult = authProgressSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    const payload = parseResult.data;
    const noUpdates =
      payload.role === undefined &&
      payload.emailVerifiedAt === undefined &&
      payload.phoneVerifiedAt === undefined &&
      payload.profileCompletedAt === undefined;

    if (noUpdates) {
      return reply.status(400).send({ message: "No fields to update" });
    }

    try {
      await upsertUserMeta({
        supabaseUserId: request.user.id,
        role: payload.role,
        emailVerifiedAt: payload.emailVerifiedAt,
        phoneVerifiedAt: payload.phoneVerifiedAt,
        profileCompletedAt: payload.profileCompletedAt,
      });

      const onboarding = await buildAuthStatus(request.user.id);
      return reply.status(200).send({ status: "ok", onboarding });
    } catch (error) {
      request.log.error({ error }, "Failed to capture auth progress");
      return reply.status(500).send({
        message: "Failed to store auth progress",
        detail: error?.message,
      });
    }
  });

  fastify.get("/auth/status", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      const onboarding = await buildAuthStatus(request.user.id);
      return reply.status(200).send(onboarding);
    } catch (error) {
      request.log.error({ error }, "Failed to load auth status");
      return reply.status(500).send({ message: "Failed to load auth status" });
    }
  });
}