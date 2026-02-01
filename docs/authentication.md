# Authentication Flow Guide

Use this guide to understand how Supabase Auth, the Fastify backend, and both mobile apps work together.

## Components & File Paths
- `src/middleware/verifySupabaseJwt.js`: verifies every request’s Supabase access token against `SUPABASE_JWT_JWKS_URL`.
- `src/routes/authRoutes.js`: exposes `/api/auth/complete`, which records the user’s role and verification timestamps.
- `scripts/workflowSmokeTest.js`: shows how to programmatically create users, sign in, and call the API with their access tokens.
- Flutter clients store the Supabase session returned by `supabase.auth.signInWithPassword` and pass the access token to the backend via `Authorization: Bearer <token>`.

## Environment Variables
Set these in `.env` (validated by `src/config/env.js`):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (used for public client operations such as login, mainly in scripts)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side Postgres writes)
- `SUPABASE_JWT_JWKS_URL` (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`)

## Request Steps
1. Mobile app signs in through Supabase and receives an access token.
2. The app calls backend endpoints with `Authorization: Bearer <token>`.
3. `verifySupabaseJwt` checks that the token issuer matches `${SUPABASE_URL}/auth/v1` and attaches `request.user`.
4. `/api/auth/complete` expects `{ role, emailVerifiedAt, phoneVerifiedAt }`. It writes to `users_meta` so other services can see the verification status.
5. Subsequent routes (driver/parent onboarding, linking, etc.) rely on `request.user.id` to scope Supabase queries.

## Error Handling
- **Missing bearer token (401):** ensure the client attaches the header for every request after login.
- **Invalid or expired token (401):** refresh the Supabase session and confirm the JWKS URL is correct.
- **Failed to record verification (500):** likely means the `users_meta` table is missing; run `db/schema.sql` in Supabase.
