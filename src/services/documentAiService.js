import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { supabase } from "../config/supabaseClient.js"; 

const textractClient = new TextractClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function processDocumentWithAi(bucket, filePath, documentType) {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (downloadError) throw new Error("Failed to download document from storage");

    const imageBuffer = await fileData.arrayBuffer();

    let queries = [];
    if (documentType === 'driving_license_front') {
      queries = [
        { Text: "What is 4c. Administrative number?", Alias: "NIC_NUMBER" }, 
        { Text: "What is 3. Date of birth?", Alias: "DOB" }, 
        { Text: "What is 1,2. Surname and Other names?", Alias: "FULL_NAME" },
        // NEW: Extract License Number and Address from the front
        { Text: "What is 5. Number of the LICENCE?", Alias: "LICENSE_NUMBER" },
        { Text: "What is 8. Permanent place of residence?", Alias: "ADDRESS" }
      ];
    } else if (documentType === 'driving_license_back') {
      queries = [
        // NEW: Extract categories and expiries from the back
        { Text: "What are the 9. Categories of vehicles?", Alias: "VEHICLE_CLASSES" },
        { Text: "What are the 11. Date of Expiry per category?", Alias: "EXPIRY_DATES" }
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

    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: Buffer.from(imageBuffer) },
      FeatureTypes: ["QUERIES"],
      QueriesConfig: { Queries: queries }
    });

    const response = await textractClient.send(command);

    const extractedData = {};
    const blocks = response.Blocks || [];
    
    for (const block of blocks) {
      if (block.BlockType === "QUERY_RESULT" && block.Text) {
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