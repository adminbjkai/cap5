import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { JobRow } from "../types.js";
import { ack } from "../queue/index.js";
import { buildWebVtt } from "../lib/transcript.js";
import { getObjectBuffer, putObjectBuffer } from "../lib/s3.js";
import { transcribeWithDeepgram, type TranscriptSegment } from "../providers/deepgram.js";
import { extractAudio } from "../lib/ffmpeg.js";
import { log, ensureVideoNotDeleted, enqueueDownstream, payloadString } from "./shared.js";

const env = getEnv();

// Module-level S3 client (initialized once)
import { getS3ClientAndBucket } from "../lib/s3.js";
const { client: s3Client, bucket: s3Bucket } = getS3ClientAndBucket();

export async function handleTranscribeVideo(job: JobRow): Promise<void> {
  const deepgramModel = payloadString(job.payload, "deepgramModel") ?? env.DEEPGRAM_MODEL;

  const prepared = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<{ result_key: string | null; transcription_status: string; deleted_at: string | null }>(
      `SELECT result_key, transcription_status, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (result.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const row = result.rows[0]!;
    if (row.deleted_at) {
      return { skip: true as const, resultKey: "", reason: "deleted" };
    }

    const status = String(row.transcription_status);

    if (status === "complete" || status === "no_audio" || status === "skipped" || status === "failed") {
      return { skip: true as const, resultKey: "", reason: `status_${status}` };
    }

    if (!row.result_key) {
      throw new Error(`result_key missing for video ${job.video_id}`);
    }

    await client.query(
      `UPDATE videos
       SET transcription_status = 'processing',
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND transcription_status IN ('queued', 'not_started')`,
      [job.video_id]
    );

    return { skip: false as const, resultKey: row.result_key, reason: "" };
  });

  if (prepared.skip) {
    log("job.transcribe.skip", {
      job_id: job.id,
      video_id: job.video_id,
      reason: prepared.reason
    });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("Missing DEEPGRAM_API_KEY in worker environment");
  }

  const mediaBuffer = await getObjectBuffer(s3Client, s3Bucket, prepared.resultKey);
  const audioBuffer = await extractAudio(mediaBuffer).catch((err: Error) => {
    log("job.transcribe.audio_extraction_failed", { video_id: job.video_id, error: err.message });
    return mediaBuffer;
  });

  const transcription = await transcribeWithDeepgram({
    apiKey: env.DEEPGRAM_API_KEY,
    baseUrl: env.DEEPGRAM_BASE_URL,
    model: deepgramModel,
    timeoutMs: env.PROVIDER_TIMEOUT_MS,
    mediaBuffer: audioBuffer,
    mediaContentType: audioBuffer === mediaBuffer ? "video/mp4" : "audio/mpeg"
  });

  if (!transcription.transcriptText.trim()) {
    await withTransaction(env.DATABASE_URL, async (client) => {
      await client.query(
        `UPDATE videos
         SET transcription_status = 'no_audio',
             ai_status = CASE WHEN ai_status IN ('not_started', 'queued') THEN 'skipped' ELSE ai_status END,
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND transcription_status IN ('processing', 'queued', 'not_started')`,
        [job.video_id]
      );
      await ack(client, job);
    });

    log("job.transcribe.no_audio", {
      job_id: job.id,
      video_id: job.video_id
    });
    return;
  }

  const segments: TranscriptSegment[] = transcription.segments;
  const vttText = buildWebVtt(segments);
  const vttKey = `videos/${job.video_id}/transcript/transcript.vtt`;

  await ensureVideoNotDeleted(job, "transcribe_before_vtt_upload");
  await putObjectBuffer(s3Client, s3Bucket, vttKey, Buffer.from(vttText, "utf8"), "text/vtt; charset=utf-8");

  await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ ai_status: string; deleted_at: string | null }>(
      `SELECT ai_status, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found during transcription finalize`);
    }

    if (videoResult.rows[0]!.deleted_at) {
      log("job.transcribe.skip", {
        job_id: job.id,
        video_id: job.video_id,
        reason: "deleted_during_finalize"
      });
      await ack(client, job);
      return;
    }

    await client.query(
      `INSERT INTO transcripts (video_id, provider, language, vtt_key, segments_json)
       VALUES ($1::uuid, 'deepgram', COALESCE($2, 'en'), $3, $4::jsonb)
       ON CONFLICT (video_id)
       DO UPDATE SET
         provider = EXCLUDED.provider,
         language = COALESCE(EXCLUDED.language, 'en'),
         vtt_key = EXCLUDED.vtt_key,
         segments_json = EXCLUDED.segments_json,
         updated_at = now()`,
      [job.video_id, transcription.language, vttKey, JSON.stringify(segments)]
    );

    const updateResult = await client.query<{ ai_status: string; webhook_url: string | null }>(
      `UPDATE videos
       SET transcription_status = 'complete',
           ai_status = CASE WHEN ai_status = 'not_started' THEN 'queued' ELSE ai_status END,
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND transcription_status IN ('processing', 'queued', 'not_started')
       RETURNING ai_status, webhook_url`,
      [job.video_id]
    );

    const row = updateResult.rows[0];
    const aiStatus = row?.ai_status;

    if (row?.webhook_url) {
      await client.query(
        `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
         VALUES ($1::uuid, 'deliver_webhook', 'queued', 10, now(), $2::jsonb, 5)
         ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [job.video_id, JSON.stringify({ webhookUrl: row.webhook_url, event: "video.transcription_complete", videoId: job.video_id })]
      );
    }

    if (aiStatus !== "queued") {
      await ack(client, job);
      return;
    }

    await enqueueDownstream(client, job.video_id, "generate_ai", 90, env.WORKER_MAX_ATTEMPTS);

    await ack(client, job);
  });

  log("job.transcribe.complete", {
    job_id: job.id,
    video_id: job.video_id,
    language: transcription.language,
    segments: transcription.segments.length
  });
}
