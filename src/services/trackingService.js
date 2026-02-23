import { supabase } from "../config/supabaseClient.js";
import { randomUUID } from "node:crypto";

const HISTORY_SAVE_MIN_SECONDS = 10;
const GEOFENCE_DEFAULT_RADIUS_METERS = 120;
const RETENTION_DEFAULT_DAYS = 30;

function toIsoOrNow(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toRadians(degree) {
  return (degree * Math.PI) / 180;
}

function distanceMetersBetween(pointA, pointB) {
  const earthRadiusMeters = 6371000;

  const latitudeDelta = toRadians(pointB.latitude - pointA.latitude);
  const longitudeDelta = toRadians(pointB.longitude - pointA.longitude);

  const latitudeARad = toRadians(pointA.latitude);
  const latitudeBRad = toRadians(pointB.latitude);

  const haversineA =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2) *
      Math.cos(latitudeARad) *
      Math.cos(latitudeBRad);

  const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));
  return earthRadiusMeters * haversineC;
}

function distanceKmBetween(pointA, pointB) {
  return distanceMetersBetween(pointA, pointB) / 1000;
}

export async function getDriverIdBySupabaseUserId(supabaseUserId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

export async function getParentIdBySupabaseUserId(supabaseUserId) {
  const { data, error } = await supabase
    .from("parents")
    .select("id")
    .eq("supabase_user_id", supabaseUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

export async function resolveTripDriverId(tripId) {
  const latestLocation = await supabase
    .from("active_trip_locations")
    .select("driver_id")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (latestLocation.error) {
    throw new Error(latestLocation.error.message);
  }

  if (latestLocation.data?.driver_id) {
    return latestLocation.data.driver_id;
  }

  const session = await supabase
    .from("driver_trip_sessions")
    .select("driver_id")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (session.error) {
    throw new Error(session.error.message);
  }

  return session.data?.driver_id ?? null;
}

export async function isParentLinkedToDriver(parentId, driverId) {
  const { data, error } = await supabase
    .from("children")
    .select("id")
    .eq("parent_id", parentId)
    .eq("linked_driver_id", driverId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

export async function canSupabaseUserAccessTrip(supabaseUserId, tripId) {
  const tripDriverId = await resolveTripDriverId(tripId);
  if (!tripDriverId) {
    return { allowed: false, reason: "Trip not found" };
  }

  const driverId = await getDriverIdBySupabaseUserId(supabaseUserId);
  if (driverId && driverId === tripDriverId) {
    return { allowed: true, userType: "driver", driverId: tripDriverId };
  }

  const parentId = await getParentIdBySupabaseUserId(supabaseUserId);
  if (!parentId) {
    return { allowed: false, reason: "Only linked parent can access this trip" };
  }

  const isLinked = await isParentLinkedToDriver(parentId, tripDriverId);
  if (!isLinked) {
    return { allowed: false, reason: "Parent is not linked to this driver" };
  }

  return { allowed: true, userType: "parent", driverId: tripDriverId, parentId };
}

export async function updateTripSessionStatus({ tripId, driverId, status, tripPhase }) {
  await assertTripOwnedByDriver(tripId, driverId);

  const nowIso = new Date().toISOString();
  const safeStatus = status;
  const safeTripPhase = tripPhase ?? (safeStatus === "completed" ? "completed" : "en_route_to_pickups");

  const upsertSession = await supabase
    .from("driver_trip_sessions")
    .upsert(
      {
        trip_id: tripId,
        driver_id: driverId,
        status: safeStatus,
        started_at: nowIso,
        ended_at: safeStatus === "completed" ? nowIso : null,
        updated_at: nowIso,
      },
      { onConflict: "trip_id" }
    )
    .select("id, trip_id, driver_id, status, started_at, ended_at, created_at, updated_at")
    .single();

  if (upsertSession.error) {
    throw new Error(upsertSession.error.message);
  }

  const latestUpdate = await supabase
    .from("active_trip_locations")
    .update({
      trip_phase: safeTripPhase,
      updated_at: nowIso,
    })
    .eq("trip_id", tripId)
    .eq("driver_id", driverId)
    .select("trip_id")
    .maybeSingle();

  if (latestUpdate.error) {
    throw new Error(latestUpdate.error.message);
  }

  return {
    id: upsertSession.data.id,
    tripId: upsertSession.data.trip_id,
    driverId: upsertSession.data.driver_id,
    status: upsertSession.data.status,
    tripPhase: safeTripPhase,
    startedAt: upsertSession.data.started_at,
    endedAt: upsertSession.data.ended_at,
    createdAt: upsertSession.data.created_at,
    updatedAt: upsertSession.data.updated_at,
  };
}

export async function startOrCreateTripSessionForDriver({ driverId, tripPhase }) {
  const nowIso = new Date().toISOString();
  const safeTripPhase = tripPhase ?? "en_route_to_pickups";

  const existingSession = await supabase
    .from("driver_trip_sessions")
    .select("trip_id")
    .eq("driver_id", driverId)
    .in("status", ["active", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSession.error) {
    throw new Error(existingSession.error.message);
  }

  if (existingSession.data?.trip_id) {
    return updateTripSessionStatus({
      tripId: existingSession.data.trip_id,
      driverId,
      status: "active",
      tripPhase: safeTripPhase,
    });
  }

  const tripId = randomUUID();

  const createSession = await supabase
    .from("driver_trip_sessions")
    .insert({
      trip_id: tripId,
      driver_id: driverId,
      status: "active",
      started_at: nowIso,
      ended_at: null,
      updated_at: nowIso,
    })
    .select("id, trip_id, driver_id, status, started_at, ended_at, created_at, updated_at")
    .single();

  if (createSession.error) {
    throw new Error(createSession.error.message);
  }

  return {
    id: createSession.data.id,
    tripId: createSession.data.trip_id,
    driverId: createSession.data.driver_id,
    status: createSession.data.status,
    tripPhase: safeTripPhase,
    startedAt: createSession.data.started_at,
    endedAt: createSession.data.ended_at,
    createdAt: createSession.data.created_at,
    updatedAt: createSession.data.updated_at,
  };
}

export async function getTripSession(tripId) {
  const { data, error } = await supabase
    .from("driver_trip_sessions")
    .select("id, trip_id, driver_id, status, started_at, ended_at, created_at, updated_at")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    tripId: data.trip_id,
    driverId: data.driver_id,
    status: data.status,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function saveDriverLocation(locationPayload) {
  await assertTripOwnedByDriver(locationPayload.tripId, locationPayload.driverId);

  const recordedAt = toIsoOrNow(locationPayload.recordedAt);
  const nowIso = new Date().toISOString();

  const upsertSession = await supabase.from("driver_trip_sessions").upsert(
    {
      trip_id: locationPayload.tripId,
      driver_id: locationPayload.driverId,
      status: "active",
      started_at: recordedAt,
      updated_at: nowIso,
    },
    { onConflict: "trip_id" }
  );

  if (upsertSession.error) {
    throw new Error(upsertSession.error.message);
  }

  const upsertLatest = await supabase.from("active_trip_locations").upsert(
    {
      trip_id: locationPayload.tripId,
      driver_id: locationPayload.driverId,
      latitude: locationPayload.latitude,
      longitude: locationPayload.longitude,
      speed_kmh: locationPayload.speedKmh,
      heading: locationPayload.heading,
      accuracy_m: locationPayload.accuracyM,
      trip_phase: locationPayload.tripPhase,
      recorded_at: recordedAt,
      updated_at: nowIso,
    },
    { onConflict: "trip_id" }
  );

  if (upsertLatest.error) {
    throw new Error(upsertLatest.error.message);
  }

  const shouldSaveHistory = await canInsertHistory(locationPayload.tripId, recordedAt);
  if (shouldSaveHistory) {
    const insertHistory = await supabase.from("trip_location_history").insert({
      trip_id: locationPayload.tripId,
      driver_id: locationPayload.driverId,
      latitude: locationPayload.latitude,
      longitude: locationPayload.longitude,
      speed_kmh: locationPayload.speedKmh,
      heading: locationPayload.heading,
      accuracy_m: locationPayload.accuracyM,
      trip_phase: locationPayload.tripPhase,
      recorded_at: recordedAt,
    });

    if (insertHistory.error) {
      throw new Error(insertHistory.error.message);
    }
  }

  const geofenceEvents = await detectAndPersistGeofenceEvents({
    tripId: locationPayload.tripId,
    driverId: locationPayload.driverId,
    latitude: locationPayload.latitude,
    longitude: locationPayload.longitude,
    recordedAt,
  });

  return {
    tripId: locationPayload.tripId,
    driverId: locationPayload.driverId,
    latitude: locationPayload.latitude,
    longitude: locationPayload.longitude,
    speedKmh: locationPayload.speedKmh,
    heading: locationPayload.heading,
    accuracyM: locationPayload.accuracyM,
    tripPhase: locationPayload.tripPhase,
    recordedAt,
    geofenceEvents,
  };
}

async function detectAndPersistGeofenceEvents(locationPayload) {
  const points = await getTripGeofencePoints(locationPayload.tripId);
  if (!points.length) {
    return [];
  }

  const createdEvents = [];

  for (const point of points) {
    const distanceM = distanceMetersBetween(
      {
        latitude: locationPayload.latitude,
        longitude: locationPayload.longitude,
      },
      {
        latitude: point.latitude,
        longitude: point.longitude,
      }
    );

    const isInside = distanceM <= (point.radiusM ?? GEOFENCE_DEFAULT_RADIUS_METERS);
    const lastEvent = await getLastGeofenceEventForPoint(point.id);

    if (isInside && lastEvent?.eventType !== "entered") {
      const enteredEvent = await createGeofenceEvent({
        pointId: point.id,
        tripId: locationPayload.tripId,
        driverId: locationPayload.driverId,
        label: point.label,
        eventType: "entered",
        distanceM,
        latitude: locationPayload.latitude,
        longitude: locationPayload.longitude,
        recordedAt: locationPayload.recordedAt,
      });

      createdEvents.push(enteredEvent);
    }

    if (!isInside && lastEvent?.eventType === "entered") {
      const exitedEvent = await createGeofenceEvent({
        pointId: point.id,
        tripId: locationPayload.tripId,
        driverId: locationPayload.driverId,
        label: point.label,
        eventType: "exited",
        distanceM,
        latitude: locationPayload.latitude,
        longitude: locationPayload.longitude,
        recordedAt: locationPayload.recordedAt,
      });

      createdEvents.push(exitedEvent);
    }

    if (isInside) {
      const alreadyReached = await hasReachedEventForPoint(point.id);
      if (!alreadyReached) {
        const reachedEvent = await createGeofenceEvent({
          pointId: point.id,
          tripId: locationPayload.tripId,
          driverId: locationPayload.driverId,
          label: point.label,
          eventType: "reached",
          distanceM,
          latitude: locationPayload.latitude,
          longitude: locationPayload.longitude,
          recordedAt: locationPayload.recordedAt,
        });

        createdEvents.push(reachedEvent);
      }
    }
  }

  return createdEvents;
}

async function getLastGeofenceEventForPoint(pointId) {
  const { data, error } = await supabase
    .from("trip_geofence_events")
    .select("event_type, recorded_at")
    .eq("point_id", pointId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    eventType: data.event_type,
    recordedAt: data.recorded_at,
  };
}

async function hasReachedEventForPoint(pointId) {
  const { data, error } = await supabase
    .from("trip_geofence_events")
    .select("id")
    .eq("point_id", pointId)
    .eq("event_type", "reached")
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

async function createGeofenceEvent(eventPayload) {
  const { data, error } = await supabase
    .from("trip_geofence_events")
    .insert({
      point_id: eventPayload.pointId,
      trip_id: eventPayload.tripId,
      driver_id: eventPayload.driverId,
      label: eventPayload.label,
      event_type: eventPayload.eventType,
      distance_m: eventPayload.distanceM,
      latitude: eventPayload.latitude,
      longitude: eventPayload.longitude,
      recorded_at: eventPayload.recordedAt,
    })
    .select("id, point_id, trip_id, driver_id, label, event_type, distance_m, latitude, longitude, recorded_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    id: data.id,
    pointId: data.point_id,
    tripId: data.trip_id,
    driverId: data.driver_id,
    label: data.label,
    eventType: data.event_type,
    distanceM: data.distance_m,
    latitude: data.latitude,
    longitude: data.longitude,
    recordedAt: data.recorded_at,
  };
}

export async function getTripGeofencePoints(tripId) {
  const { data, error } = await supabase
    .from("trip_geofence_points")
    .select("id, trip_id, driver_id, label, latitude, longitude, radius_m, is_active")
    .eq("trip_id", tripId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    driverId: row.driver_id,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radius_m,
    isActive: row.is_active,
  }));
}

export async function upsertTripGeofencePoint(pointPayload) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("trip_geofence_points")
    .upsert(
      {
        trip_id: pointPayload.tripId,
        driver_id: pointPayload.driverId,
        label: pointPayload.label,
        latitude: pointPayload.latitude,
        longitude: pointPayload.longitude,
        radius_m: pointPayload.radiusM ?? GEOFENCE_DEFAULT_RADIUS_METERS,
        is_active: pointPayload.isActive ?? true,
        updated_at: nowIso,
      },
      { onConflict: "trip_id,label" }
    )
    .select("id, trip_id, driver_id, label, latitude, longitude, radius_m, is_active, updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    id: data.id,
    tripId: data.trip_id,
    driverId: data.driver_id,
    label: data.label,
    latitude: data.latitude,
    longitude: data.longitude,
    radiusM: data.radius_m,
    isActive: data.is_active,
    updatedAt: data.updated_at,
  };
}

export async function getTripGeofenceEvents(tripId, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const { data, error } = await supabase
    .from("trip_geofence_events")
    .select("id, point_id, trip_id, driver_id, label, event_type, distance_m, latitude, longitude, recorded_at")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    pointId: row.point_id,
    tripId: row.trip_id,
    driverId: row.driver_id,
    label: row.label,
    eventType: row.event_type,
    distanceM: row.distance_m,
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAt: row.recorded_at,
  }));
}

async function assertTripOwnedByDriver(tripId, driverId) {
  const latest = await supabase
    .from("active_trip_locations")
    .select("driver_id")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (latest.error) {
    throw new Error(latest.error.message);
  }

  if (latest.data?.driver_id && latest.data.driver_id !== driverId) {
    throw new Error("Driver is not allowed to update this trip");
  }

  const session = await supabase
    .from("driver_trip_sessions")
    .select("driver_id")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (session.error) {
    throw new Error(session.error.message);
  }

  if (session.data?.driver_id && session.data.driver_id !== driverId) {
    throw new Error("Driver is not allowed to update this trip");
  }
}

async function canInsertHistory(tripId, recordedAtIso) {
  const { data, error } = await supabase
    .from("trip_location_history")
    .select("recorded_at")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.recorded_at) {
    return true;
  }

  const last = new Date(data.recorded_at).getTime();
  const current = new Date(recordedAtIso).getTime();

  return current - last >= HISTORY_SAVE_MIN_SECONDS * 1000;
}

export async function getLatestTripLocation(tripId) {
  const { data, error } = await supabase
    .from("active_trip_locations")
    .select(
      "trip_id, driver_id, latitude, longitude, speed_kmh, heading, accuracy_m, trip_phase, recorded_at, updated_at"
    )
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    tripId: data.trip_id,
    driverId: data.driver_id,
    latitude: data.latitude,
    longitude: data.longitude,
    speedKmh: data.speed_kmh,
    heading: data.heading,
    accuracyM: data.accuracy_m,
    tripPhase: data.trip_phase,
    recordedAt: data.recorded_at,
    updatedAt: data.updated_at,
  };
}

export async function getTripLocationHistory(tripId, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const { data, error } = await supabase
    .from("trip_location_history")
    .select("trip_id, driver_id, latitude, longitude, speed_kmh, heading, accuracy_m, trip_phase, recorded_at")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    tripId: row.trip_id,
    driverId: row.driver_id,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speed_kmh,
    heading: row.heading,
    accuracyM: row.accuracy_m,
    tripPhase: row.trip_phase,
    recordedAt: row.recorded_at,
  }));
}

function deleteBeforeIsoDate(days) {
  const now = Date.now();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return new Date(now - days * millisecondsPerDay).toISOString();
}

function buildPlaybackStats(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      totalPoints: 0,
      totalDistanceKm: 0,
      durationSeconds: 0,
      averageSpeedKmh: null,
      startedAt: null,
      endedAt: null,
    };
  }

  let totalDistanceKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalDistanceKm += distanceKmBetween(points[index - 1], points[index]);
  }

  const startDate = toDateOrNull(points[0].recordedAt);
  const endDate = toDateOrNull(points[points.length - 1].recordedAt);

  const durationSeconds =
    startDate && endDate ? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000)) : 0;

  const averageSpeedKmh =
    durationSeconds > 0 ? Number(((totalDistanceKm / durationSeconds) * 3600).toFixed(2)) : null;

  return {
    totalPoints: points.length,
    totalDistanceKm: Number(totalDistanceKm.toFixed(3)),
    durationSeconds,
    averageSpeedKmh,
    startedAt: points[0].recordedAt,
    endedAt: points[points.length - 1].recordedAt,
  };
}

export async function getTripPlayback(tripId, options = {}) {
  const safeLimit = Math.min(Math.max(Number(options.limit) || 300, 1), 1000);
  const ascending = options.order !== "desc";

  let query = supabase
    .from("trip_location_history")
    .select("trip_id, driver_id, latitude, longitude, speed_kmh, heading, accuracy_m, trip_phase, recorded_at")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending })
    .limit(safeLimit);

  if (options.from) {
    query = query.gte("recorded_at", toIsoOrNow(options.from));
  }

  if (options.to) {
    query = query.lte("recorded_at", toIsoOrNow(options.to));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const points = (data ?? []).map((row) => ({
    tripId: row.trip_id,
    driverId: row.driver_id,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speed_kmh,
    heading: row.heading,
    accuracyM: row.accuracy_m,
    tripPhase: row.trip_phase,
    recordedAt: row.recorded_at,
  }));

  return {
    tripId,
    range: {
      from: options.from ? toIsoOrNow(options.from) : null,
      to: options.to ? toIsoOrNow(options.to) : null,
      order: ascending ? "asc" : "desc",
      limit: safeLimit,
    },
    stats: buildPlaybackStats(points),
    points,
  };
}

export async function listDriverTripSessions(driverId, limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const { data, error } = await supabase
    .from("driver_trip_sessions")
    .select("id, trip_id, driver_id, status, started_at, ended_at, created_at, updated_at")
    .eq("driver_id", driverId)
    .order("started_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    driverId: row.driver_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function cleanupTrackingHistory(olderThanDays = RETENTION_DEFAULT_DAYS) {
  const days = Math.max(Number(olderThanDays) || RETENTION_DEFAULT_DAYS, 1);
  const thresholdIso = deleteBeforeIsoDate(days);

  const historyDeletion = await supabase
    .from("trip_location_history")
    .delete()
    .lt("created_at", thresholdIso)
    .select("id");

  if (historyDeletion.error) {
    throw new Error(historyDeletion.error.message);
  }

  const geofenceDeletion = await supabase
    .from("trip_geofence_events")
    .delete()
    .lt("created_at", thresholdIso)
    .select("id");

  if (geofenceDeletion.error) {
    throw new Error(geofenceDeletion.error.message);
  }

  return {
    thresholdIso,
    deletedHistoryRows: (historyDeletion.data ?? []).length,
    deletedGeofenceRows: (geofenceDeletion.data ?? []).length,
  };
}
