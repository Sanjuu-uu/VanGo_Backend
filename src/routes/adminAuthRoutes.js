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

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).optional(),
  code: z.union([z.string(), z.number()]).optional(),
});

export default async function adminAuthRoutes(fastify) {

  // --- 1. ADMIN LOGIN ---
  fastify.post("/admin/login", async (request, reply) => {
    const parseResult = authSchema.safeParse(request.body);
    if (!parseResult.success) return reply.status(400).send(parseResult.error);

    const { email, password } = parseResult.data;
    const clientIp = getClientIp(request);

    try {
      // Check IP Whitelist
      let { data: accessRecord } = await supabase
        .from("admin_access_whitelist")
        .select("*")
        .eq("email", email)
        .eq("ip_address", clientIp)
        .maybeSingle();

      // IF IP IS NEW OR PENDING
      if (!accessRecord || accessRecord.status !== 'approved') {
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins

        // 1. SAVE CODE TO DB
        const { error: upsertError } = await supabase
          .from("admin_access_whitelist")
          .upsert({
            email,
            ip_address: clientIp,
            status: "pending",
            verification_code: code,
            code_expires_at: expiresAt.toISOString()
          }, { onConflict: "email, ip_address" });

        if (upsertError) {
          console.error("DB Write Failed:", upsertError);
          return reply.status(500).send({ message: "Server Error: Could not generate code." });
        }

        // 2. SEND EMAIL (Call Edge Function)
        console.log(`[EMAIL] Sending verification code to ${email}...`);
        
        const { error: funcError } = await supabase.functions.invoke('send-admin-otp', {
          body: { email, code, ip: clientIp }
        });

        if (funcError) {
          console.error("Email Sending Failed:", funcError);
          // Optional: Fallback to console log in dev if email fails
          console.log(`[FALLBACK] Code: ${code}`);
          return reply.status(500).send({ message: "Failed to send verification email." });
        }

        return reply.status(403).send({ 
          requiresVerification: true,
          message: `New Device detected. Verification code sent to ${email}.` 
        });
      }

      // NORMAL LOGIN FLOW (IP is Approved)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // CHECK ROLE
      const { data: meta } = await supabase
        .from("users_meta")
        .select("role")
        .eq("supabase_user_id", data.user.id)
        .single();

      if (meta?.role !== 'admin') {
        return reply.status(403).send({ message: "Not authorized as admin" });
      }

      return reply.send({ session: data.session, user: data.user });

    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: error.message });
    }
  });

  // --- 2. VERIFY IP ROUTE (Keep existing logic) ---
  fastify.post("/admin/verify-ip", async (request, reply) => {
    const { email, code } = request.body;
    const clientIp = getClientIp(request);

    // Fetch Record
    const { data: record, error } = await supabase
      .from("admin_access_whitelist")
      .select("*")
      .eq("email", email)
      .eq("ip_address", clientIp)
      .single();

    if (error || !record) {
      return reply.status(400).send({ message: "No verification request found." });
    }

    // COMPARE STRINGS
    if (String(record.verification_code).trim() !== String(code).trim()) {
      return reply.status(400).send({ message: "Invalid code" });
    }

    if (new Date(record.code_expires_at) < new Date()) {
      return reply.status(400).send({ message: "Code expired" });
    }

    // APPROVE IP
    await supabase
      .from("admin_access_whitelist")
      .update({ status: "approved", verification_code: null, code_expires_at: null })
      .eq("id", record.id);

    return reply.send({ success: true, message: "IP Verified!" });
  });
  fastify.post("/admin/register", async (request, reply) => {
    // Validate Input
    const parseResult = z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }).safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ message: "Invalid email or password (min 6 chars)" });
    }

    const { email, password } = parseResult.data;
    const clientIp = getClientIp(request);

    try {
      // 1. Create User in Supabase (Triggers Email if enabled)
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role: 'admin' } // Assign role immediately
        }
      });

      if (error) throw error;

      // 2. If User already exists but unverified, Supabase returns user but no session
      if (data.user && data.user.identities && data.user.identities.length === 0) {
         return reply.status(400).send({ message: "This email is already registered." });
      }

      // 3. Create Database Entries
      // We set role to 'admin' so they are ready once they verify email
      await supabase.from("users_meta").upsert({ 
        supabase_user_id: data.user.id, 
        role: "admin" 
      });
      
      // We whitelist this IP as 'pending' so the MFA flow works later
      await supabase.from("admin_access_whitelist").insert({ 
        email, 
        ip_address: clientIp, 
        status: "pending" 
      });

      return reply.send({ 
        success: true, 
        message: "Registration successful! Please check your email to verify your account." 
      });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: error.message });
    }
  });
  // --- VERIFY EMAIL CODE ROUTE ---
  fastify.post("/admin/verify-email", async (request, reply) => {
    const { email, code } = request.body;

    try {
      // 'signup' type is used for the first-time email verification
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'signup'
      });

      if (error) throw error;

      return reply.send({ 
        success: true, 
        message: "Email verified successfully! You can now log in." 
      });
    } catch (error) {
      return reply.status(400).send({ message: error.message || "Invalid Code" });
    }
  });
}