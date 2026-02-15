import { z } from "zod";
import { supabase } from "../config/supabaseClient.js";

import crypto from "crypto";

// --- HELPERS ---
function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.ip || request.socket.remoteAddress;
}

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

async function getLocationFromIp(ip) {
  try {
    if (ip === '127.0.0.1' || ip === '::1') return 'Localhost (Dev)';
    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();
    return data.status === 'success' ? `${data.city}, ${data.country}` : 'Unknown Location';
  } catch (error) { return 'Location Lookup Failed'; }
}

async function logAudit(email, ip, location, status, reason = "") {
  await supabase.from("admin_auth_logs").insert({
    email,
    ip_address: ip,
    location,
    status,
    user_agent: reason
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export default async function adminAuthRoutes(fastify) {

  // --- 1. SECURE ADMIN LOGIN ---
  fastify.post("/admin/login", {
    // LAYER 4: Rate Limiting (Specific to Login)
    config: {
      rateLimit: {
        max: 5, // Only 5 attempts allowed
        timeWindow: "15 minutes" // Block for 15 mins if exceeded
      }
    }
  }, async (request, reply) => {
    
    // 1. Input Validation
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) return reply.status(400).send(parseResult.error);

    const { email, password } = parseResult.data;
    const clientIp = getClientIp(request);
    const location = await getLocationFromIp(clientIp);

    try {
      // LAYER 3: Secure Password Check (Bcrypt via Supabase)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        await logAudit(email, clientIp, location, "failed", "Invalid Password");
        return reply.status(401).send({ message: "Invalid credentials" });
      }

      // LAYER 1 & 2: Role & Approval Check
      const { data: meta } = await supabase
        .from("users_meta")
        .select("role, is_approved")
        .eq("supabase_user_id", authData.user.id)
        .single();

      // Check 1: Must be Admin
      if (meta?.role !== 'admin') {
        await logAudit(email, clientIp, location, "failed", "Role Mismatch");
        return reply.status(403).send({ message: "Access Denied: You are not an admin." });
      }

      // Check 2: Must be Approved (The Manual Gate)
      if (meta?.is_approved !== true) {
        await logAudit(email, clientIp, location, "failed", "Account Not Approved");
        return reply.status(403).send({ message: "Your account is waiting for approval by a Super Admin." });
      }

      // LAYER 4: IP Whitelist / 2FA Context Check
      let { data: whitelist } = await supabase
        .from("admin_access_whitelist")
        .select("*")
        .eq("email", email)
        .eq("ip_address", clientIp)
        .maybeSingle();

      // If IP is New/Unknown -> Trigger 2FA
      if (!whitelist || whitelist.status !== 'approved') {
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 5 * 60000); // 5 mins

        // Save Code
        await supabase.from("admin_access_whitelist").upsert({
            email,
            ip_address: clientIp,
            location: location,
            status: "pending",
            verification_code: code,
            code_expires_at: expiresAt.toISOString()
        }, { onConflict: "email, ip_address" });

        // Send Email (ZeptoMail)
        const { error: funcError } = await supabase.functions.invoke('send-admin-otp', {
          body: { email, code, ip: clientIp, location }
        });

        if (funcError) console.error("Email Error:", funcError);

        await logAudit(email, clientIp, location, "challenge", "New Device Verification");

        return reply.status(403).send({ 
          requiresVerification: true,
          message: `Unrecognized device (${location}). Verification code sent.` 
        });
      }

      // SUCCESS: All 4 Layers Passed
      await logAudit(email, clientIp, location, "success", "Login Authorized");
      return reply.send({ session: authData.session, user: authData.user });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  // --- 2. VERIFY IP (2FA) ---
  fastify.post("/admin/verify-ip", async (request, reply) => {
    const { email, code } = request.body;
    const clientIp = getClientIp(request);

    const { data: record, error } = await supabase
      .from("admin_access_whitelist")
      .select("*")
      .eq("email", email)
      .eq("ip_address", clientIp)
      .single();

    if (error || !record) return reply.status(400).send({ message: "No verification request found." });

    if (String(record.verification_code).trim() !== String(code).trim()) {
      return reply.status(400).send({ message: "Invalid code" });
    }

    if (new Date(record.code_expires_at) < new Date()) {
      return reply.status(400).send({ message: "Code expired" });
    }

    // Approve IP
    await supabase.from("admin_access_whitelist")
      .update({ status: "approved", verification_code: null, code_expires_at: null })
      .eq("id", record.id);

    return reply.send({ success: true, message: "Device verified successfully." });
  });

  // --- 3. REGISTER (Updated with Default Approval = False) ---
  fastify.post("/admin/register", async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body); // Reusing login schema for simplicity
    if (!parseResult.success) return reply.status(400).send(parseResult.error);
    
    const { email, password } = parseResult.data;
    const clientIp = getClientIp(request);

    try {
      // Create User
      const { data, error } = await supabase.auth.signUp({ 
          email, 
          password, 
          options: { data: { role: 'admin' } } 
      });
      if (error) throw error;
      
      // Save Meta - DEFAULT APPROVED = FALSE
      await supabase.from("users_meta").upsert({ 
          supabase_user_id: data.user.id, 
          role: "admin",
          is_approved: false // <--- VITAL: User cannot log in until you manually change this to TRUE
      });

      await supabase.from("admin_access_whitelist").insert({ 
          email, 
          ip_address: clientIp, 
          status: "pending" 
      });

      return reply.send({ message: "Registered! Account pending approval by Super Admin." });
    } catch (e) {
      return reply.status(500).send({ message: e.message });
    }
  });
}