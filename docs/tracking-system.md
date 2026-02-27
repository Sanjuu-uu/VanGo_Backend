# VanGo Live Tracking System (Simple Guide)

## Purpose
This system shows a school van moving live on the parent map while the driver is on an active trip.

## Core technology used
- Node.js + Fastify for backend APIs
- Socket.IO for real-time location streaming
- Supabase Postgres for storing latest and historical location data
- Flutter for mobile apps
- Geolocator for continuous GPS capture on driver side
- Google Maps Flutter for map rendering on parent side
- JWT auth (Supabase-issued tokens) for API and socket security

## How data flows
1. Driver starts live tracking in the app.
2. Driver phone reads GPS continuously.
3. Driver app sends each valid location update through a realtime socket event.
4. Backend verifies identity and access, then validates payload.
5. Backend writes latest location and throttled history.
6. Backend broadcasts the location to subscribed parent clients.
7. Parent app updates marker, path, and ETA immediately.

## Security model
- Only authenticated users can call tracking endpoints or use tracking socket events.
- A driver can publish only for trips owned by that driver.
- A parent can subscribe only to trips linked to their child/driver relationship.

## Storage model
- One table keeps the latest point per active trip (fast map open/reconnect).
- One table keeps historical points (route history and playback).
- Session status table tracks active/paused/completed trip tracking lifecycle.
- Geofence tables store checkpoints and entered/exited/reached events.

## Reconnect behavior
- Parent map first fetches latest location and recent history from API.
- Then it connects to realtime socket updates.
- If realtime disconnects, UI keeps last known state until reconnect.

## Performance behavior
- Driver sends based on time and movement thresholds.
- Backend stores every latest point, but history is throttled.
- Parent map updates only required marker/polyline state for smooth rendering.

## Operational notes
- Tracking retention cleanup runs on backend scheduler when enabled.
- Playback endpoint allows replaying stored trip paths for support/verification.
