import { z } from "zod";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { verifySupabaseJwt } from "../middleware/verifySupabaseJwt.js";
import { supabase } from "../config/supabaseClient.js";
import { processDocumentWithAi } from "../services/documentAiService.js";
import { verifyNicMatchesDob } from "../utils/sriLankanNicValidator.js";

// Enable custom date parsing for dayjs
dayjs.extend(customParseFormat);

const documentRequestSchema = z.object({
  document_type: z.enum(['driving_license', 'insurance', 'emission_report', 'revenue_license']),
  file_path: z.string(), // e.g., "user_id/driver/license_front.jpg"
  vehicle_id: z.string().uuid().optional(),
});

export default async function documentRoutes(fastify) {
  // Protect all routes with JWT middleware
  fastify.addHook("preHandler", verifySupabaseJwt);

  fastify.post("/documents/verify", async (request, reply) => {
    const parseResult = documentRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ errors: parseResult.error.format() });
    }

    const { document_type, file_path, vehicle_id } = parseResult.data;
    const userId = request.user.id; // From verifySupabaseJwt

    try {
      // 1. Get the driver's internal UUID using their Supabase Auth ID
      const { data: driverData, error: driverError } = await supabase
        .from("drivers")
        .select("id")
        .eq("supabase_user_id", userId)
        .single();

      if (driverError || !driverData) {
        return reply.status(404).send({ message: "Driver profile not found" });
      }

      const driverId = driverData.id;
      const bucketName = "driver-documents"; // Assuming all docs go here

      // 2. Call the AI Extraction Service
      const aiResult = await processDocumentWithAi(bucketName, file_path, document_type);
      
      if (!aiResult.success) {
        return reply.status(500).send({ message: "Failed to process document with AI", error: aiResult.error });
      }

      const extractedData = aiResult.data;
      let status = "approved";
      let rejection_reason = null;
      let expiryDateStr = extractedData.EXPIRY_DATE; 
      let parsedExpiry = null;

      // Try to parse the expiry date safely (Textract might return "24.05.2025" or "24/05/2025")
      if (expiryDateStr) {
         parsedExpiry = dayjs(expiryDateStr, ["DD/MM/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "YYYY.MM.DD"]);
         if (parsedExpiry.isValid() && parsedExpiry.isBefore(dayjs())) {
             status = "rejected";
             rejection_reason = "Document is expired.";
         }
      }

      // 3. The Cross-Validation Engine (Applying the Rules)
      if (status !== "rejected") {
          if (document_type === "driving_license") {
            // Rule: Sri Lankan NIC Mathematical Match
            if (extractedData.NIC_NUMBER && extractedData.DOB) {
              const nicCheck = verifyNicMatchesDob(extractedData.NIC_NUMBER, extractedData.DOB);
              if (!nicCheck.match) {
                status = "rejected";
                rejection_reason = nicCheck.reason; // E.g., "DOB on card does not match NIC mathematical validation"
              }
            } else {
              status = "pending_admin";
              rejection_reason = "AI could not clearly read NIC or DOB. Requires manual review.";
            }

          } else if (["insurance", "revenue_license", "emission_report"].includes(document_type)) {
            // Rule: Vehicle License Plate Match
            if (!vehicle_id) {
                return reply.status(400).send({ message: "vehicle_id is required for vehicle documents" });
            }

            const { data: vehicleData } = await supabase
              .from("vehicles")
              .select("license_plate")
              .eq("id", vehicle_id)
              .single();

            if (vehicleData && extractedData.PLATE_NUMBER) {
              // Normalize text (remove spaces, dashes, make uppercase)
              const dbPlate = vehicleData.license_plate.replace(/[^A-Z0-9]/ig, "").toUpperCase();
              const docPlate = extractedData.PLATE_NUMBER.replace(/[^A-Z0-9]/ig, "").toUpperCase();

              if (dbPlate !== docPlate) {
                status = "rejected";
                rejection_reason = `Document plate (${docPlate}) does not match registered vehicle plate (${dbPlate}).`;
              }
            } else {
              status = "pending_admin";
              rejection_reason = "AI could not clearly read the License Plate. Requires manual review.";
            }
          }
      }

      // 4. Upsert into the `driver_documents` table
      // We use UPSERT matching on unique active docs to handle renewals seamlessly
      const { data: docRecord, error: dbError } = await supabase
        .from("driver_documents")
        .upsert({
          driver_id: driverId,
          vehicle_id: vehicle_id || null,
          document_type,
          file_path,
          extracted_data: extractedData,
          expiry_date: parsedExpiry?.isValid() ? parsedExpiry.format("YYYY-MM-DD") : null,
          status,
          rejection_reason,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id, vehicle_id, document_type' })
        .select()
        .single();

      if (dbError) throw dbError;

      // 5. Update Driver's Overall Verification Status (if everything is approved)
      // (You can expand this later to check if ALL required docs are approved)
      
      return reply.send({
        message: "Document processed successfully",
        status: status,
        rejection_reason,
        extracted_data: extractedData
      });

    } catch (error) {
      request.log.error({ error }, "Document verification pipeline failed");
      return reply.status(500).send({ message: "Internal Server Error", details: error.message });
    }
  });
}