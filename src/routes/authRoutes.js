import { z } from "zod";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { upsertUserMeta } from "../services/profileService.js";

const authCompleteSchema = z.object({
  role: z.enum(["driver", "parent"]),
  emailVerifiedAt: z.string().optional(),
  phoneVerifiedAt: z.string().optional(),
});

export default async function authRoutes(fastify) {
  fastify.post("/auth/complete", { preHandler: verifySupabaseJwt }, async (request, reply) => {
    const parseResult = authCompleteSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    if (!request.user) {
      return reply.status(401).send({ message: "Unauthenticated" });
    }

    try {
      await upsertUserMeta({
        supabaseUserId: request.user.id,
        role: parseResult.data.role,
        emailVerifiedAt: parseResult.data.emailVerifiedAt,
        phoneVerifiedAt: parseResult.data.phoneVerifiedAt,
      });

      return reply.status(200).send({ status: "ok" });
    } catch (error) {
      request.log.error({ error }, "Failed to complete auth");
      return reply.status(500).send({ message: "Failed to record verification" });
    }
  });
}