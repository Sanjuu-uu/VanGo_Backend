import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { supabase } from "../config/supabaseClient.js"; // Your existing supabase client

const textractClient = new TextractClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function processDocumentWithAi(bucket, filePath, documentType) {
  try {
    // 1. Download image from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (downloadError) throw new Error("Failed to download document from storage");

    const imageBuffer = await fileData.arrayBuffer();

    // 2. Define the Questions (Queries) based on document type
    let queries = [];
    if (documentType === 'driving_license') {
      queries = [
        // Using "ID. No." matches the label "4d. ID. No." on SL Licenses
        { Text: "What is the ID. No. or Identity Card Number?", Alias: "NIC_NUMBER" }, 
        // Using "3. Date of Birth" explicitly helps the AI find it
        { Text: "What is the Date of Birth?", Alias: "DOB" }, 
        // Using "4b. Expiry" explicitly helps it avoid the issue date
        { Text: "What is the Date of Expiry?", Alias: "EXPIRY_DATE" }, 
        { Text: "What is the Name?", Alias: "FULL_NAME" },
        { Text: "What are the Vehicle Classes?", Alias: "VEHICLE_CLASSES" }
      ];
    } else if (documentType === 'insurance') {
      queries = [
        { Text: "What is the Vehicle Registration Number?", Alias: "PLATE_NUMBER" },
        { Text: "What is the Period of Insurance To date or Expiry Date?", Alias: "EXPIRY_DATE" }
      ];
    } else if (documentType === 'revenue_license') {
      queries = [
        { Text: "What is the Registration No?", Alias: "PLATE_NUMBER" },
        { Text: "What is the Date of Expiry?", Alias: "EXPIRY_DATE" }
      ];
    }

    // 3. Send to AWS Textract
    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: Buffer.from(imageBuffer) },
      FeatureTypes: ["QUERIES"],
      QueriesConfig: { Queries: queries }
    });

    const response = await textractClient.send(command);

    // 4. Parse the results
    const extractedData = {};
    const blocks = response.Blocks || [];
    
    // Map Query results to our Aliases
    for (const block of blocks) {
      if (block.BlockType === "QUERY_RESULT" && block.Text) {
        // Find the parent query to get the Alias
        const queryBlock = blocks.find(b => 
          b.BlockType === "QUERY" && 
          b.Relationships?.some(rel => rel.Ids.includes(block.Id))
        );
        
        if (queryBlock?.Query?.Alias) {
          extractedData[queryBlock.Query.Alias] = block.Text;
        }
      }
    }

    return { success: true, data: extractedData, rawResponse: response };

  } catch (error) {
    console.error("Textract Error:", error);
    return { success: false, error: error.message };
  }
}