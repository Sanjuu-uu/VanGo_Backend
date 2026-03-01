import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { supabase } from "../config/supabaseClient.js";
import { processDocumentWithAi } from "./documentAiService.js";
import { verifyLicenseNicMatchesDob } from "../utils/sriLankanLicenseValidator.js"; 
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Helper function to map Vehicle Types to required Sri Lankan License Classes
function getRequiredLicenseClasses(vehicleType) {
  if (!vehicleType) return [];
  const type = vehicleType.toLowerCase();
  if (type.includes('bus')) return ['D', 'D1', 'DE'];
  if (type.includes('van') || type.includes('dual')) return ['B', 'B1', 'PB'];
  if (type.includes('car')) return ['B', 'B1'];
  if (type.includes('tuk') || type.includes('three')) return ['G'];
  return []; // Default if unknown
}

export async function runFullDriverVerification(userId, driverId) {
  try {
    const licenseFrontPath = `${userId}/driver/license_front.jpg`;
    const licenseBackPath = `${userId}/driver/license_back.jpg`;
    const facePath = `${userId}/driver/face.jpg`;

    // 1. Download all 3 images & fetch DB records concurrently for speed
    const [licenseFrontReq, licenseBackReq, faceReq, driverRecord, vehicleRecord] = await Promise.all([
      supabase.storage.from("driver-documents").download(licenseFrontPath),
      supabase.storage.from("driver-documents").download(licenseBackPath),
      supabase.storage.from("driver-photos").download(facePath),
      supabase.from("drivers").select("profile").eq("id", driverId).single(),
      supabase.from("vehicles").select("vehicle_type").eq("driver_id", driverId).maybeSingle()
    ]);

    if (licenseFrontReq.error || faceReq.error || licenseBackReq.error) {
      return { status: "pending_admin", reason: "Missing required front/back document files or selfie." };
    }

    const licenseFrontBuffer = Buffer.from(await licenseFrontReq.data.arrayBuffer());
    const faceBuffer = Buffer.from(await faceReq.data.arrayBuffer());

    // --- TEST 1: AWS REKOGNITION FACE MATCH ---
    const compareFacesCommand = new CompareFacesCommand({
      SourceImage: { Bytes: faceBuffer },      
      TargetImage: { Bytes: licenseFrontBuffer },   
      SimilarityThreshold: 80, 
    });

    const faceResult = await rekognitionClient.send(compareFacesCommand);
    if (!faceResult.FaceMatches || faceResult.FaceMatches.length === 0) {
      return { status: "rejected", reason: "Face mismatch: The selfie does not match the photo on the Driving License." };
    }

    // --- TEST 2: TEXTRACT (FRONT & BACK) ---
    const [frontResult, backResult] = await Promise.all([
       processDocumentWithAi("driver-documents", licenseFrontPath, "driving_license_front"),
       processDocumentWithAi("driver-documents", licenseBackPath, "driving_license_back")
    ]);

    if (!frontResult.success || !backResult.success) {
      return { status: "pending_admin", reason: "AI could not clearly read the front or back of the document." };
    }

    const { NIC_NUMBER, DOB, FULL_NAME, LICENSE_NUMBER, ADDRESS } = frontResult.data;
    const { VEHICLE_CLASSES, EXPIRY_DATES } = backResult.data;

    // --- TEST 3: NIC & DOB MATHEMATICAL CHECK ---
    if (!NIC_NUMBER || !DOB) {
      return { status: "pending_admin", reason: "Could not find ID. No. or DOB on the Driving License." };
    }

    const nicCheck = verifyLicenseNicMatchesDob(NIC_NUMBER, DOB);
    if (!nicCheck.match) {
      return { status: "rejected", reason: `Tampering detected: ${nicCheck.reason}` };
    }

    // --- TEST 4: USER PROFILE DOB CROSS-CHECK ---
    const profileDob = driverRecord.data?.profile?.dateOfBirth;
    if (profileDob) {
      // Compare the profile DOB against the mathematically proven DOB from the license
      if (profileDob !== nicCheck.calculatedDob) {
        return { 
          status: "rejected", 
          reason: `Registration Mismatch: Your registered Date of Birth (${profileDob}) does not match your official Driving License.` 
        };
      }
    }

    // --- TEST 5: VEHICLE CLASS CHECK ---
    const vehicleType = vehicleRecord.data?.vehicle_type;
    const requiredClasses = getRequiredLicenseClasses(vehicleType);
    
    if (requiredClasses.length > 0 && VEHICLE_CLASSES) {
      // e.g. If requiredClasses = ['D'] (Bus), check if "B, B1, D" contains 'D'
      const hasRequiredClass = requiredClasses.some(reqClass => 
        new RegExp(`\\b${reqClass}\\b`, 'i').test(VEHICLE_CLASSES) // Matches exact word boundaries
      );

      if (!hasRequiredClass) {
        return { 
          status: "rejected", 
          reason: `License Restriction: You registered a ${vehicleType}, which requires class ${requiredClasses.join(' or ')}. Your license classes are: ${VEHICLE_CLASSES}` 
        };
      }
    }

    // --- SAVE TO DRIVER_DOCUMENTS TABLE ---
    const combinedExtractedData = {
      ...frontResult.data,
      ...backResult.data,
      CALCULATED_DOB: nicCheck.calculatedDob
    };

    const { error: dbError } = await supabase
      .from("driver_documents")
      .upsert({
        driver_id: driverId,
        vehicle_id: null, 
        document_type: "driving_license",
        file_path: licenseFrontPath, 
        extracted_data: combinedExtractedData, // Saves Name, Address, Classes, License No!
        status: "approved", 
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id, vehicle_id, document_type' });

    if (dbError) {
      console.error("Failed to save to driver_documents:", dbError);
    }

    return { 
      status: "approved", 
      reason: "All automated security checks passed.",
      aiData: combinedExtractedData
    };

  } catch (error) {
    console.error("Master Verification Error:", error);
    return { status: "pending_admin", reason: "Internal system error during AI processing." };
  }
}