import fp from "fastify-plugin";

function buildLogContext(request) {
  return {
    reqId: request.id,
    method: request.method,
    url: request.url,
    userId: request.user?.id,
  };
}

async function requestLoggingPlugin(fastify) {
  fastify.addHook("onRequest", async (request) => {
    request.log.info(buildLogContext(request), "Incoming request");
    request.logContext = {
      startedAt: process.hrtime.bigint(),
    };
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const startedAt = request.logContext?.startedAt;
    const durationMs = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : undefined;
    request.log.info(
      {
        ...buildLogContext(request),
        statusCode: reply.statusCode,
        durationMs,
      },
      "Request completed"
    );
  });
}

export default fp(requestLoggingPlugin);
