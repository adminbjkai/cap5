import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { PoolClient } from "pg";
import type { JobRow, JobType } from "../types.js";
import { ack } from "../queue/index.js";

const env = getEnv();

export class DeletedVideoSkipError extends Error {
  constructor(videoId: string) {
    super(`video ${videoId} deleted`);
    this.name = "DeletedVideoSkipError";
  }
}

export function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: "worker", event, ...fields }));
}

export function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isFatalError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "fatal" in error
    && (error as { fatal?: unknown }).fatal === true;
}

export function parseTranscriptTextFromSegments(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      const text = (segment as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}

export async function ensureVideoNotDeleted(job: JobRow, phase: string): Promise<void> {
  const result = await withTransaction(env.DATABASE_URL, async (client) => {
    return client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM videos WHERE id = $1::uuid`,
      [job.video_id]
    );
  });

  if (result.rowCount === 0) {
    throw new Error(`video ${job.video_id} not found`);
  }

  if (result.rows[0]?.deleted_at) {
    log("job.deleted.skip", {
      job_id: job.id,
      video_id: job.video_id,
      job_type: job.job_type,
      phase
    });
    throw new DeletedVideoSkipError(job.video_id);
  }
}

export async function markTerminalFailure(job: JobRow, errorMessage: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    if (job.job_type === "process_video") {
      await client.query(
        `UPDATE videos
         SET processing_phase = 'failed',
             processing_phase_rank = 80,
             processing_progress = GREATEST(processing_progress, $3),
             error_message = $2,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND (
             processing_phase_rank < 80
             OR (processing_phase_rank = 80 AND processing_progress < $3)
           )`,
        [job.video_id, errorMessage, 100]
      );
      return;
    }

    if (job.job_type === "transcribe_video") {
      await client.query(
        `UPDATE videos
         SET transcription_status = 'failed',
             ai_status = CASE WHEN ai_status IN ('not_started', 'queued') THEN 'skipped' ELSE ai_status END,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND transcription_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      return;
    }

    if (job.job_type === "generate_ai") {
      await client.query(
        `UPDATE videos
         SET ai_status = 'failed',
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND ai_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
    }
  });
}

/**
 * Reset a dead job or insert a new one for downstream processing.
 * Extracted from the copy-pasted pattern in process_video and transcribe_video handlers.
 */
export async function enqueueDownstream(
  client: PoolClient,
  videoId: string,
  jobType: JobType,
  priority: number,
  maxAttempts: number
): Promise<void> {
  const resetResult = await client.query(
    `UPDATE job_queue
     SET status = 'queued',
         attempts = 0,
         run_after = now(),
         last_error = NULL,
         updated_at = now()
     WHERE video_id = $1::uuid
       AND job_type = $2
       AND status = 'dead'
     RETURNING id`,
    [videoId, jobType]
  );

  if ((resetResult.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, $2, 'queued', $3, now(), '{}'::jsonb, $4)
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()`,
      [videoId, jobType, priority, maxAttempts]
    );
  }
}

export { ack };
