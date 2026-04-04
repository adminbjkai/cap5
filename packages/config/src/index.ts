import { z } from "zod";

const BaseEnv = z.object({
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  LOG_PRETTY: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  MEDIA_SERVER_WEBHOOK_SECRET: z.string().min(32),
  WEBHOOK_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  DEEPGRAM_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  DEEPGRAM_MODEL: z.string().default("nova-2"),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  DEEPGRAM_BASE_URL: z.string().url().default("https://api.deepgram.com"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  WEB_API_PORT: z.coerce.number().int().positive().default(3000),
  MEDIA_SERVER_PORT: z.coerce.number().int().positive().default(3100),
  MEDIA_SERVER_BASE_URL: z.string().url().default("http://media-server:3100"),
  WORKER_ID: z.string().default("worker-1"),
  WORKER_CLAIM_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(15000),
  WORKER_RECLAIM_MS: z.coerce.number().int().positive().default(10000),
  // S3 / object storage
  S3_ENDPOINT: z.string().url().default("http://minio:9000"),
  S3_PUBLIC_ENDPOINT: z.string().url().default("http://localhost:8922"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default("cap5"),
  S3_FORCE_PATH_STYLE: z.string().default("true"),
  // Auth (optional here so worker/media-server don't crash; web-api validates at runtime)
  JWT_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),
});

export type AppEnv = z.infer<typeof BaseEnv>;

export function getEnv(raw: Record<string, string | undefined> = process.env): AppEnv {
  return BaseEnv.parse(raw);
}

