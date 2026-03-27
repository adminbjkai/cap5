import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { JobRow } from "../types.js";
import { ack } from "../queue/index.js";
import { summarizeWithGroq } from "../providers/groq.js";
import { log, payloadString, parseTranscriptTextFromSegments } from "./shared.js";

const env = getEnv();

export async function handleGenerateAi(job: JobRow): Promise<void> {
  const groqModel = payloadString(job.payload, "groqModel") ?? env.GROQ_MODEL;

  const transcriptRecord = await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{
      ai_status: string;
      transcription_status: string;
      deleted_at: string | null;
    }>(
      `SELECT ai_status, transcription_status, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const row = videoResult.rows[0]!;
    if (row.deleted_at) {
      return { skip: true as const, reason: "deleted", segmentsJson: null as unknown };
    }

    const transcriptResult = await client.query<{ segments_json: unknown }>(
      `SELECT segments_json FROM transcripts WHERE video_id = $1::uuid`,
      [job.video_id]
    );

    if (row.ai_status === "complete" || row.ai_status === "skipped" || row.ai_status === "failed") {
      return { skip: true as const, reason: `status_${row.ai_status}`, segmentsJson: null as unknown };
    }

    if (row.transcription_status === "no_audio" || row.transcription_status === "skipped" || row.transcription_status === "failed") {
      await client.query(
        `UPDATE videos
         SET ai_status = 'skipped',
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND ai_status IN ('not_started', 'queued', 'processing')`,
        [job.video_id]
      );
      return { skip: true as const, reason: `transcription_${row.transcription_status}`, segmentsJson: null as unknown };
    }

    await client.query(
      `UPDATE videos
       SET ai_status = 'processing',
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND ai_status IN ('queued', 'not_started')`,
      [job.video_id]
    );

    return { skip: false as const, reason: "", segmentsJson: transcriptResult.rows[0]?.segments_json ?? null };
  });

  if (transcriptRecord.skip) {
    log("job.ai.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: transcriptRecord.reason
    });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  if (!env.GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY in worker environment");
  }

  const transcriptText = parseTranscriptTextFromSegments(transcriptRecord.segmentsJson);
  if (!transcriptText) {
    await withTransaction(env.DATABASE_URL, async (client) => {
      await client.query(
        `UPDATE videos
         SET ai_status = 'skipped',
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND ai_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      await ack(client, job);
    });

    log("job.ai.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: "empty_transcript"
    });
    return;
  }

  const summary = await summarizeWithGroq({
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
    model: groqModel,
    timeoutMs: env.PROVIDER_TIMEOUT_MS,
    transcript: transcriptText
  });

  const chaptersJson = summary.chapters.length > 0
    ? summary.chapters.map((chapter, index) => ({
        order: index + 1,
        point: chapter.title,
        startSeconds: chapter.start
      }))
    : summary.keyPoints.map((point: string, index: number) => ({
        order: index + 1,
        point
      }));

  await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM videos WHERE id = $1::uuid FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found during ai finalize`);
    }

    if (videoResult.rows[0]!.deleted_at) {
      log("job.ai.skip", {
        job_id: job.id,
        video_id: job.video_id,
        reason: "deleted_during_finalize"
      });
      await ack(client, job);
      return;
    }

    await client.query(
      `INSERT INTO ai_outputs (video_id, provider, model, title, summary, chapters_json, entities_json, action_items_json, quotes_json)
       VALUES ($1::uuid, 'groq', $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
       ON CONFLICT (video_id)
       DO UPDATE SET
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         chapters_json = EXCLUDED.chapters_json,
         entities_json = EXCLUDED.entities_json,
         action_items_json = EXCLUDED.action_items_json,
         quotes_json = EXCLUDED.quotes_json,
         updated_at = now()`,
      [
        job.video_id,
        summary.model,
        summary.title,
        summary.summary,
        JSON.stringify(chaptersJson),
        summary.entities ? JSON.stringify(summary.entities) : null,
        summary.actionItems ? JSON.stringify(summary.actionItems) : null,
        summary.quotes ? JSON.stringify(summary.quotes) : null
      ]
    );

    const updateResult = await client.query<{ webhook_url: string | null }>(
      `UPDATE videos
       SET ai_status = 'complete',
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND ai_status IN ('processing', 'queued', 'not_started')
       RETURNING webhook_url`,
      [job.video_id]
    );

    const row = updateResult.rows[0];
    if (row?.webhook_url) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)
         ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [job.video_id, JSON.stringify({ webhookUrl: row.webhook_url, event: "video.ai_complete", videoId: job.video_id })]
      );
    }

    await ack(client, job);
  });

  log("job.ai.complete", {
    job_id: job.id,
    video_id: job.video_id,
    points: summary.keyPoints.length,
    model: summary.model
  });
}
