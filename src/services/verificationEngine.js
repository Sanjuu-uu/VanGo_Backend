import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { supabase } from "../config/supabaseClient.js";
import { processDocumentWithAi } from "./documentAiService.js";
import { verifyNicMatchesDob } from "../utils/sriLankanNicValidator.js";

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
      SourceImage: { Bytes: faceBuffer },      // The Live Selfie
      TargetImage: { Bytes: licenseBuffer },   // The Driver's License
      SimilarityThreshold: 80, // Requires 80% similarity to be considered a match
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

    const { NIC_NUMBER, DOB } = textractResult.data;

    // --- TEST 3: SRI LANKAN NIC MATHEMATICAL CHECK ---
    if (!NIC_NUMBER || !DOB) {
      return { status: "pending_admin", reason: "Could not find NIC or DOB on the document." };
    }

    const nicCheck = verifyNicMatchesDob(NIC_NUMBER, DOB);
    if (!nicCheck.match) {
      return { 
        status: "rejected", 
        reason: "Tampering detected: Date of birth on card does not match NIC validation." 
      };
    }

    // --- ALL TESTS PASSED! ---
    // (You can add Vehicle Insurance checks here later)
    
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