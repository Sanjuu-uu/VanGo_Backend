# VanGo Backend Server & Workflow

This document explains how the Fastify server inside `VanGo_Backend` runs, what each major file does, and the workflow the mobile teams should use when connecting to it.

## Technology Stack
- **Node.js + Fastify:** Fastify hosts all HTTP endpoints with low overhead and built-in schema validation hooks.
- **Supabase (Auth + Postgres + Storage):** Supabase Auth issues the JWTs that every request must carry, and the Postgres service stores users, drivers, parents, invites, vehicles, children, links, notifications, and messaging threads. Storage is available for future document uploads.
- **Pino logging:** Structured logs capture request metadata, duration, and outcomes so driver and parent app engineers can trace issues quickly.
- **Zod validation:** Every JSON payload is validated with Zod to guarantee consistent server-side contracts with the Flutter clients.
- **Workflow smoke test:** The scripted workflow provisions test users through Supabase, proving that both driver and parent flows work end to end before QA touches the apps.

## Key Files
- `src/server.js` boots Fastify, registers the shared request logging plugin, and mounts every route module with the `/api` prefix.
- `src/routes/authRoutes.js`, `src/routes/driverRoutes.js`, and `src/routes/parentRoutes.js` contain all HTTP handlers. Each route validates JSON payloads with Zod and requires Supabase JWTs through the shared middleware.
- `src/middleware/verifySupabaseJwt.js` verifies Supabase-issued tokens against the JWKS URL defined in `.env`.
- `src/config/env.js` validates the environment variables before the server starts.
- `src/logger.js` configures `pino` and applies redaction for the `Authorization` header.
- `scripts/workflowSmokeTest.js` runs an end-to-end script that provisions temporary Supabase users, hits the API, and proves that driver/parent flows work.

## Starting the Server
1. Copy the `.env.example` guidance from `README.md` and fill out `.env` with Supabase URL, anon key, service role key, JWKS URL, and optional logging values.
2. Install dependencies with `npm install`.
3. Run `npm start` for watch mode or `npm run start:prod` for a single run. Both scripts load `.env` automatically via `--env-file=.env`.
4. Watch the terminal output for lines such as `API listening on 8080` and request logs in the format `reqId`, `method`, `url`, `statusCode`, and `durationMs`.
5. Call `curl http://localhost:8080/api/health` before opening either Flutter app. Both apps read this endpoint on launch and stay in an offline splash state unless it returns 200.

## Supabase Integration
1. **Auth:** Supabase Auth issues the JWTs that `verifySupabaseJwt` consumes. The issuer must match `${SUPABASE_URL}/auth/v1`, and the JWKS URL must point to `.../auth/v1/.well-known/jwks.json` so key rotation works automatically.
2. **Service Role Client:** Writes to Postgres always happen through the service role key, which allows upserts into `users_meta`, `drivers`, `parents`, `children`, `driver_invites`, and the messaging tables. Never expose this key to clients; only the backend and internal scripts should use it.
3. **Anon Client:** Scripts and tests may use the anon key to perform sign-in flows without exposing sensitive privileges.
4. **Schema:** `db/schema.sql` defines the canonical tables. If any endpoint returns `PGRST205` or missing-table errors, rerun that script inside the Supabase SQL editor to rebuild the schema cache.
5. **Storage & Future Work:** Storage buckets are available for KYC uploads once the driver app begins sending documents. The backend already handles references through the Supabase client.

## Request Lifecycle
1. Fastify receives a request and `requestLoggingPlugin` logs the start event.
2. `verifySupabaseJwt` checks the `Authorization: Bearer ...` header, verifies the JWT issuer (`${SUPABASE_URL}/auth/v1`), and attaches `request.user`.
3. The route’s Zod schema validates the JSON body or query string. Errors return `400` with the Zod format so Flutter clients can surface field-level issues.
4. Business logic lives in `src/services/*.js`. These call Supabase Postgres via the service role client (`src/config/supabaseClient.js`).
5. Responses bubble back through Fastify. The logging plugin records completion plus latency, which helps diagnose slow Supabase calls.
