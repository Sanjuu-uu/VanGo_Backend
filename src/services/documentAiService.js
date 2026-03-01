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
        // 4c is the NIC / Administrative number on the new SL format
        { Text: "What is 4c. Administrative number?", Alias: "NIC_NUMBER" }, 
        // 3 is the Date of Birth
        { Text: "What is 3. Date of birth?", Alias: "DOB" }, 
        // 11 is the expiry per category
        { Text: "What is 11. Date of Expiry per category?", Alias: "EXPIRY_DATE" }, 
        // 1,2 contains the full names
        { Text: "What is 1,2. Surname and Other names?", Alias: "FULL_NAME" },
        // 9 contains the vehicle classes (A, B1, etc.)
        { Text: "What is 9. Categories of vehicles?", Alias: "VEHICLE_CLASSES" }
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