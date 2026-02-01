# VanGo Backend 

## Technology Stack
- **Node.js + Fastify:** Fastify hosts all HTTP endpoints with low overhead and built-in schema validation hooks.
- **Supabase (Auth + Postgres + Storage):** Supabase Auth issues the JWTs that every request must carry, and the Postgres service stores users, drivers, parents, invites, vehicles, children, links, notifications, and messaging threads. Storage is available for future document uploads.
- **Pino logging:** Structured logs capture request metadata, duration, and outcomes so driver and parent app engineers can trace issues quickly.
- **Zod validation:** Every JSON payload is validated with Zod to guarantee consistent server-side contracts with the Flutter clients.
- **Workflow smoke test:** The scripted workflow provisions test users through Supabase, proving that both driver and parent flows work end to end before QA touches the apps.

