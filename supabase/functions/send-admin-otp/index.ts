// supabase/functions/send-admin-otp/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ZEPTO_URL = "https://api.zeptomail.com/v1.1/email"; 
// ⚠️ IMPORTANT: Get this token from ZeptoMail Dashboard -> Send Mail Agents
const ZEPTO_TOKEN = Deno.env.get("ZEPTO_TOKEN")!; 

interface RequestData {
  email: string;
  code: string;
  ip: string;
}

serve(async (req) => {
  // CORS Headers (Required for browser calls)
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } 
    });
  }

  try {
    const { email, code, ip } = await req.json() as RequestData;

    // 1. Prepare ZeptoMail Data
    const payload = {
      // REPLACE with your verified ZeptoMail sender info
      from: { "address": "noreply@vango.lk", "name": "VanGo Security" }, 
      to: [{ "email_address": { "address": email, "name": "Admin" } }],
      subject: "Your Admin Verification Code",
      htmlbody: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #333;">Security Verification</h2>
          <p>A login attempt was detected from a new IP address: <strong>${ip}</strong></p>
          <p>Please use the following code to verify this device:</p>
          <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
            ${code}
          </div>
          <p style="color: #999; font-size: 12px;">This code expires in 10 minutes.</p>
        </div>
      `,
    };

    // 2. Call ZeptoMail API
    const response = await fetch(ZEPTO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Zoho-enczapikey ${ZEPTO_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ZeptoMail Error:", errorText);
      throw new Error("Failed to send email via ZeptoMail");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});