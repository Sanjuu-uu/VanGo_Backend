# Authentication Flow 

The VanGo stack pairs a Fastify + Supabase backend with Flutter mobile apps. Fastify (`src/server.js`) owns every REST endpoint, Supabase provides JWT auth plus Postgres storage, and both the driver and parent apps talk to Fastify through `BackendClient`, relaying Supabase access tokens in `Authorization` headers. Structured audit logs (`src/utils/auditLogger.js`) mirror every meaningful action so operators can watch the terminal in real time.

## Parent App Experience
1. **Launch & health check** – `main.dart` blocks on `AuthService.initialize()` which pings `/health`. If the backend is offline the user sees the offline screen and must retry once Fastify is up.
2. **Sign in / sign up** – the onboarding flow triggers `signInOrSignUp`, which calls Supabase Auth. On success, the app holds the returned session and the Supabase access token becomes the bearer header for every subsequent call.
3. **Phone OTP verification** – `verifyPhoneOtp` hits Supabase’s OTP endpoint, then `/api/auth/progress` so the backend records `role=parent`, `email_verified_at`, and `phone_verified_at` inside `users_meta`. The UI polls `/api/auth/status` until the phone step flips to complete.
4. **Profile & child creation** – tapping “Save profile” calls `/api/parents/profile`, and adding a child sends the form payload to `/api/parents/children`. The backend writes to `parents` and `children`, emitting audit logs such as `parent_child_created`.
5. **Linking to a driver** – the UI prompts for the driver’s invite code. Once the user submits, `/api/parents/link-driver` validates the code, inserts into `parent_driver_links`, updates `children.linked_driver_id`, and logs `parent_link_driver`. `/api/parents/link-status` gates the dashboard until at least one child is linked.
6. **Daily operations** – attendance toggles call `/api/parents/children/:id/attendance`, the finder UI queries `/api/parents/finder/services`, notifications load via `/api/parents/notifications`, messages hit `/api/parents/messages/*`, and the payments card calls `/api/parents/payments`. Every success produces a matching audit entry.

## Driver App Experience
1. **Launch & health check** – just like the parent app, `AuthService.initialize()` calls Supabase setup and then `/health`. The offline splash (`BackendOfflineApp`) prevents navigation unless the backend responds 200.
2. **Authentication** – `signInOrSignUp` handles Supabase login and session storage, while `verifyPhoneOtp` finishes phone verification and invokes `/api/auth/progress` with `role=driver`. The driver app only advances when `/api/auth/status` reports that email and phone steps are complete.
3. **Profile setup** – saving driver info posts to `/api/drivers/profile`, which now maps camelCase fields into the `drivers` table, logs `driver_profile_saved`, and enforces FK integrity through `users_meta`.
4. **Vehicle onboarding** – `/api/drivers/vehicle` persists the van metadata, logging seat counts, make/model, and price so operators can inspect what changed.
5. **Invite workflow** – the “Share code” UI calls `GET /api/drivers/invite` (reuse existing codes when valid) or `POST /api/drivers/invite` to mint a new one. The backend stores a hashed copy (`driver_invites`) plus the plain text for immediate display and logs either `driver_invite_issued` or `driver_invite_refreshed`.
6. **Ongoing checks** – Any future driver-only endpoints should keep using `verifySupabaseJwt` and emit audit logs so terminal monitoring stays accurate.

Both mobile apps rely on Supabase tokens and will not progress without the Fastify server online, guaranteeing a single source of truth for authentication and data changes.
