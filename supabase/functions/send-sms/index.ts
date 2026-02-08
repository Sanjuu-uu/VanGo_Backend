// No import needed for Deno.serve in modern Supabase/Deno runtime

Deno.serve(async (req) => {
  try {
    // 1. Parse Payload
    const payload = await req.json();
    
    // KEEP THIS FOR DEBUGGING, BUT REMOVE BEFORE GOING LIVE
    console.log("PAYLOAD RECEIVED:", JSON.stringify(payload, null, 2));

    // 2. Extract Data
    // Standard Supabase Auth "Send SMS" hook sends: { user: { phone: "+..." }, otp: "123456" }
    const otp = payload.otp || payload.sms?.otp;
    
    // Check all possible locations for phone
    const phone = 
      payload.user?.phone || 
      payload.user?.user_metadata?.phone || 
      payload.sms?.phone || 
      payload.phone;
    
    // 3. Validate
    if (!phone || !otp) {
      console.error("VALIDATION FAILED. Phone:", phone, "OTP:", otp);
      return new Response(
        JSON.stringify({ error: "Missing phone or otp" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Clean Phone Number (Remove '+' and spaces)
    // Supabase: +94771234567 -> FitSMS: 94771234567
    const recipient = phone.replace(/[+\s]/g, ""); 
    console.log(`Sending OTP to recipient: ${recipient}`);

    // 5. Config
    const FITSMS_TOKEN = Deno.env.get("FITSMS_API_TOKEN");
    const SENDER_ID = Deno.env.get("FITSMS_SENDER_ID") || "VanGo";

    if (!FITSMS_TOKEN) {
      throw new Error("Missing FITSMS_API_TOKEN in Supabase Secrets");
    }

    // 6. Call FitSMS v4
    const fitSmsPayload = {
      recipient: recipient,
      sender_id: SENDER_ID,
      type: "plain",
      message: `Your VanGo verification code is: ${otp}`,
    };

    const response = await fetch("https://app.fitsms.lk/api/v4/sms/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FITSMS_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(fitSmsPayload),
    });

    const data = await response.json();
    console.log("FitSMS Response:", JSON.stringify(data));

    if (data.status === "success") {
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } else {
      console.error("FitSMS Error:", data);
      return new Response(JSON.stringify({ error: data.message || "FitSMS Failed" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }

  } catch (error: any) {
    console.error("Edge Function Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});