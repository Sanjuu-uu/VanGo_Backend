import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_JWKS_URL: z.string().url(),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.string().default("8080"),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173,https://vango.lk,https://www.vango.lk"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_PRETTY: z.string().default("false"),
  LOG_DESTINATION: z.string().optional(),
  TRACKING_RETENTION_ENABLED: z.string().default("true"),
  TRACKING_RETENTION_DAYS: z.string().default("30"),
  TRACKING_RETENTION_INTERVAL_MINUTES: z.string().default("720"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
}

export const env = {
  ...parsed.data,
  API_PORT: Number(parsed.data.API_PORT),
  CORS_ALLOWED_ORIGINS: parsed.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  LOG_PRETTY: parsed.data.LOG_PRETTY?.toLowerCase() === "true",
  TRACKING_RETENTION_ENABLED: parsed.data.TRACKING_RETENTION_ENABLED?.toLowerCase() !== "false",
  TRACKING_RETENTION_DAYS: Number(parsed.data.TRACKING_RETENTION_DAYS),
  TRACKING_RETENTION_INTERVAL_MINUTES: Number(parsed.data.TRACKING_RETENTION_INTERVAL_MINUTES),
};