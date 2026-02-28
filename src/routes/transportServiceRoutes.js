import { supabase } from "../config/supabaseClient.js";

export default async function transportServiceRoutes(fastify) {
  fastify.post("/transport-services", async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;

      if (!authHeader) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const token = authHeader.replace("Bearer ", "");

      // Get user from token
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return reply.status(401).send({ message: "Invalid token" });
      }

      // Get driver id
      const { data: driver, error: driverError } = await supabase
        .from("drivers")
        .select("id")
        .eq("supabase_user_id", user.id)
        .maybeSingle();

      if (driverError || !driver) {
        return reply.status(400).send({ message: "Driver not found" });
      }

      const body = request.body;

      // Insert transport service
      const { error } = await supabase.from("transport_services").insert({
        driver_id: driver.id,

        title: body.title,
        description: body.description,

        vehicle_type: body.vehicleType,
        vehicle_brand: body.vehicleBrand,
        model_year: body.modelYear,

        price_per_month: body.price,
        seats_available: body.seats,

        province: body.province,
        district: body.district,
        home_town: body.homeTown,

        route_start: body.routeStart,
        route_start_lat: body.startLat,
        route_start_lng: body.startLng,

        route_stops: body.routeStops,
        schools: body.schools,

        morning_pickup_time: body.morningPickup,
        school_arrival_time: body.schoolArrival,
        afternoon_departure_time: body.afternoonDeparture,
        home_drop_time: body.homeDrop,

        operating_days: body.operatingDays,
        route_type: body.routeType,

        safety_features: body.safetyFeatures,
        vehicle_images: body.vehicleImages,

        is_active: true,
      });

      if (error) {
        throw error;
      }

      return reply.status(201).send({ message: "Ad created successfully" });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Failed to create ad" });
    }
  });
}