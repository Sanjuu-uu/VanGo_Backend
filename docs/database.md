# VanGo Database Reference

This file summarizes the Supabase Postgres schema required by the backend. Run `db/schema.sql` inside the Supabase SQL editor so every table exists before testing.

## Applying the Schema
1. Open your Supabase project dashboard.
2. Navigate to **SQL Editor** → **New Query**.
3. Paste the full contents of `db/schema.sql` from this repository.
4. Execute the script once. It is idempotent thanks to `create table if not exists`.

## Tables
### `users_meta`
- Source file: `src/services/profileService.js` (`upsertUserMeta`).
- Stores `supabase_user_id`, `role`, `email_verified_at`, and `phone_verified_at`.
- Populated by `/api/auth/complete` so Flutter apps know when both verifications are done.

### `drivers`
- Source file: `profileService.upsertDriverProfile`.
- Holds personal info plus nested JSON for `vehicle` when supplied via `/api/drivers/vehicle`.
- Join key for `vehicles`, `driver_invites`, and future telemetry tables.

### `vehicles`
- Created in `db/schema.sql` to separate large vehicle blobs when needed later.
- Current implementation keeps vehicle data inline with the driver, but the table is ready for future migrations.

### `driver_invites`
- Source file: `src/services/driverInviteService.js`.
- Columns include `code_hash`, `max_uses`, `uses`, `expires_at`, and `driver_id`.
- Issued through `/api/drivers/invite` and validated by `/api/parents/link-driver`.

### `parents`
- Source file: `profileService.upsertParentProfile`.
- Each record links back to `supabase_user_id` and stores contact info.

### `children`
- Source file: `src/routes/parentRoutes.js` (children endpoints).
- Columns match the payload names: `child_name`, `school`, `pickup_location`, `pickup_time`, `attendance_state`, `payment_status`.
- `parent_id` is resolved via `requireParentId()` inside the route file.

### `parent_driver_links`
- Bridges parents (via `child_id`) to drivers using invite codes.
- Created and set to `pending` inside `/api/parents/link-driver`.

### `parent_notifications`
- Read through `/api/parents/notifications` and updated via `/api/parents/notifications/:notificationId/read`.
- Use this table to power the parent inbox in the Flutter app.

### `message_threads` & `messages`
- Back the messaging endpoints under `/api/parents/messages/*`.
- `ensureThreadAccess()` in `parentRoutes.js` validates ownership before queries or inserts.

## Operational Notes
- All write operations use the Supabase **service role** key from `.env`. Never expose that key to the mobile apps.
- If the REST API returns `PGRST205 Could not find the table ...`, re-run `db/schema.sql` and check schema cache in Supabase.
- Add new tables or columns by editing `db/schema.sql` so the entire team shares a single source of truth.

Keeping the schema in sync with `db/schema.sql` ensures the backend code paths and Flutter clients can trust the data they read or write.
