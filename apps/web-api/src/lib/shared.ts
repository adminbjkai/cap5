/**
 * Shared helpers — re-exports focused modules for backward compatibility.
 * Direct imports from focused modules are preferred for new code.
 */

import crypto from "node:crypto";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";
import { PROCESSING_PHASE_RANK } from "../types/video.js";
import type { ProviderHealthState, ProviderStatusResponse, TranscriptSegmentRow } from "../types/video.js";

const env = getEnv();

// Re-exports from focused modules
export * from "./idempotency.js";
export * from "./s3.js";
export * from "./cursor.js";
export * from "./hmac.js";
export * from "./ai-output.js";
export * from "../types/video.js";

// ---------------------------------------------------------------------------
// Simple helpers
// ---------------------------------------------------------------------------

export function badRequest(message: string) {
  return { ok: false, error: message };
}

export function phaseRank(phase: string): number | null {
  const rank = PROCESSING_PHASE_RANK[phase];
  return typeof rank === "number" ? rank : null;
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function configuredSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function sanitizeProviderBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return value;
  }
}

export function requireIdempotencyKey(headers: Record<string, unknown>): string | null {
  const raw = headers["idempotency-key"];
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

export function normalizeEditableTranscriptSegments(existing: unknown, nextTranscriptText: string): TranscriptSegmentRow[] {
  const existingSegments = Array.isArray(existing)
    ? existing.filter((segment) => segment && typeof segment === "object") as TranscriptSegmentRow[]
    : [];

  const lines = nextTranscriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  if (existingSegments.length === 0) {
    return lines.map((text, index) => ({
      text,
      startSeconds: index * 5,
      endSeconds: index * 5 + 4,
      originalText: text
    }));
  }

  return lines.map((text, index) => {
    const fallback = existingSegments[Math.min(index, existingSegments.length - 1)] ?? {};
    const startSeconds = Number(fallback.startSeconds);
    const endSeconds = Number(fallback.endSeconds);
    const confidence = fallback.confidence;
    const speaker = fallback.speaker;
    const originalText = typeof fallback.originalText === "string"
      ? fallback.originalText
      : typeof fallback.text === "string"
        ? fallback.text
        : text;

    const normalizedStart = Number.isFinite(startSeconds) ? startSeconds : index * 5;
    const normalizedEnd = Number.isFinite(endSeconds) ? Math.max(normalizedStart, endSeconds) : normalizedStart + 4;

    return {
      text,
      startSeconds: normalizedStart,
      endSeconds: normalizedEnd,
      confidence: typeof confidence === "number" ? confidence : null,
      speaker: typeof speaker === "number" ? speaker : null,
      originalText
    };
  });
}

// ---------------------------------------------------------------------------
// Provider status helpers
// ---------------------------------------------------------------------------

export function deriveProviderHealthState(args: {
  configured: boolean;
  lastJobStatus: string | null;
  lastJobError: string | null;
  lastSuccessAt: string | null;
}): ProviderHealthState {
  if (!args.configured) return "unavailable";
  if (args.lastJobStatus === "queued" || args.lastJobStatus === "leased" || args.lastJobStatus === "running") {
    return "active";
  }
  if (args.lastJobStatus === "dead" || args.lastJobError) {
    return "degraded";
  }
  if (args.lastSuccessAt) {
    return "healthy";
  }
  return "idle";
}

export async function getSystemProviderStatus(): Promise<ProviderStatusResponse> {
  const [deepgramJobResult, groqJobResult, deepgramSuccessResult, groqSuccessResult] = await Promise.all([
    query<{
      id: number;
      video_id: string;
      status: string;
      updated_at: string;
      last_error: string | null;
    }>(
      env.DATABASE_URL,
      `SELECT id, video_id, status, updated_at, last_error
       FROM job_queue
       WHERE job_type = 'transcribe_video'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{
      id: number;
      video_id: string;
      status: string;
      updated_at: string;
      last_error: string | null;
    }>(
      env.DATABASE_URL,
      `SELECT id, video_id, status, updated_at, last_error
       FROM job_queue
       WHERE job_type = 'generate_ai'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{ updated_at: string }>(
      env.DATABASE_URL,
      `SELECT updated_at
       FROM transcripts
       WHERE provider = 'deepgram'
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    query<{ updated_at: string }>(
      env.DATABASE_URL,
      `SELECT updated_at
       FROM ai_outputs
       WHERE provider = 'groq'
       ORDER BY updated_at DESC
       LIMIT 1`
    )
  ]);

  const deepgramJob = deepgramJobResult.rows[0] ?? null;
  const groqJob = groqJobResult.rows[0] ?? null;
  const deepgramLastSuccessAt = deepgramSuccessResult.rows[0]?.updated_at ?? null;
  const groqLastSuccessAt = groqSuccessResult.rows[0]?.updated_at ?? null;
  const deepgramConfigured = configuredSecret(process.env.DEEPGRAM_API_KEY);
  const groqConfigured = configuredSecret(process.env.GROQ_API_KEY);

  return {
    checkedAt: new Date().toISOString(),
    providers: [
      {
        key: "deepgram",
        label: "Deepgram",
        purpose: "transcription",
        configured: deepgramConfigured,
        state: deriveProviderHealthState({
          configured: deepgramConfigured,
          lastJobStatus: deepgramJob?.status ?? null,
          lastJobError: deepgramJob?.last_error ?? null,
          lastSuccessAt: deepgramLastSuccessAt
        }),
        baseUrl: sanitizeProviderBaseUrl(process.env.DEEPGRAM_BASE_URL ?? env.DEEPGRAM_BASE_URL),
        model: process.env.DEEPGRAM_MODEL ?? env.DEEPGRAM_MODEL,
        lastSuccessAt: deepgramLastSuccessAt,
        lastJob: deepgramJob
          ? {
            id: deepgramJob.id,
            videoId: deepgramJob.video_id,
            status: deepgramJob.status,
            updatedAt: deepgramJob.updated_at,
            lastError: deepgramJob.last_error
          }
          : null
      },
      {
        key: "groq",
        label: "Groq",
        purpose: "ai",
        configured: groqConfigured,
        state: deriveProviderHealthState({
          configured: groqConfigured,
          lastJobStatus: groqJob?.status ?? null,
          lastJobError: groqJob?.last_error ?? null,
          lastSuccessAt: groqLastSuccessAt
        }),
        baseUrl: sanitizeProviderBaseUrl(process.env.GROQ_BASE_URL ?? env.GROQ_BASE_URL),
        model: process.env.GROQ_MODEL ?? env.GROQ_MODEL,
        lastSuccessAt: groqLastSuccessAt,
        lastJob: groqJob
          ? {
            id: groqJob.id,
            videoId: groqJob.video_id,
            status: groqJob.status,
            updatedAt: groqJob.updated_at,
            lastError: groqJob.last_error
          }
          : null
      }
    ]
  };
}
