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

export async function runFullDriverVerification(userId, driverId) {
  try {
    const licensePath = `${userId}/driver/license_front.jpg`;
    const facePath = `${userId}/driver/face.jpg`;

    // 1. Download both images from Supabase Storage
    const [licenseReq, faceReq] = await Promise.all([
      supabase.storage.from("driver-documents").download(licensePath),
      supabase.storage.from("driver-documents").download(facePath)
    ]);

    if (licenseReq.error || faceReq.error) {
      return { status: "pending_admin", reason: "Missing required document files in storage." };
    }

    const licenseBuffer = Buffer.from(await licenseReq.data.arrayBuffer());
    const faceBuffer = Buffer.from(await faceReq.data.arrayBuffer());

    // --- TEST 1: AWS REKOGNITION FACE MATCH ---
    const compareFacesCommand = new CompareFacesCommand({
      SourceImage: { Bytes: faceBuffer },      
      TargetImage: { Bytes: licenseBuffer },   
      SimilarityThreshold: 80, 
    });

    const faceResult = await rekognitionClient.send(compareFacesCommand);
    
    if (!faceResult.FaceMatches || faceResult.FaceMatches.length === 0) {
      return { 
        status: "rejected", 
        reason: "Face mismatch: The selfie does not match the photo on the Driving License." 
      };
    }

    // --- TEST 2: AWS TEXTRACT DATA EXTRACTION ---
    const textractResult = await processDocumentWithAi("driver-documents", licensePath, "driving_license");
    if (!textractResult.success) {
      return { status: "pending_admin", reason: "AI could not read the document clearly." };
    }

    const { NIC_NUMBER, DOB, EXPIRY_DATE } = textractResult.data;

    // --- TEST 3: SRI LANKAN DL MATHEMATICAL CHECK ---
    if (!NIC_NUMBER || !DOB) {
      console.log("Textract Raw Data:", textractResult.data);
      return { status: "pending_admin", reason: "Could not find ID. No. or DOB on the Driving License." };
    }

    const nicCheck = verifyLicenseNicMatchesDob(NIC_NUMBER, DOB);
    
    // ---------------------------------------------------------
    // 🔍 ADD THIS LOGGING BLOCK TO SEE THE EXACT MISMATCH
    // ---------------------------------------------------------
    console.log("================ NIC COMPARISON DEBUG ================");
    console.log("1. Raw NIC from AWS: ", NIC_NUMBER);
    console.log("2. Raw DOB from AWS: ", DOB);
    console.log("3. DOB calculated mathematically from NIC: ", nicCheck.calculatedDob);
    console.log("4. DOB formatted for comparison: ", nicCheck.ocrDob);
    console.log("5. Match Result: ", nicCheck.match);
    console.log("======================================================");

    if (!nicCheck.match) {
      return { 
        status: "rejected", 
        reason: `Tampering detected: ${nicCheck.reason}` 
      };
    }

    // --- SAVE TO DRIVER_DOCUMENTS TABLE ---
    let parsedExpiry = null;
    if (EXPIRY_DATE) {
       parsedExpiry = dayjs(EXPIRY_DATE, ["DD/MM/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "YYYY.MM.DD"]);
    }

    const { error: dbError } = await supabase
      .from("driver_documents")
      .upsert({
        driver_id: driverId,
        vehicle_id: null, // License is not tied to a specific vehicle
        document_type: "driving_license",
        file_path: licensePath,
        extracted_data: textractResult.data,
        expiry_date: parsedExpiry?.isValid() ? parsedExpiry.format("YYYY-MM-DD") : null,
        status: "approved", // If it made it this far down, the doc is approved!
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id, vehicle_id, document_type' });

    if (dbError) {
      console.error("Failed to save to driver_documents:", dbError);
    }

    // --- ALL TESTS PASSED! ---
    return { 
      status: "approved", 
      reason: "All automated security checks passed.",
      aiData: textractResult.data
    };

  } catch (error) {
    console.error("Master Verification Error:", error);
    return { status: "pending_admin", reason: "Internal system error during AI processing." };
  }
}