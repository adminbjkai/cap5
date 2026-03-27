import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { PoolClient } from "pg";
import type { JobRow, ProcessResponse, ProcessingPhase } from "../types.js";
import { PROCESSING_PHASE_META } from "../types.js";
import { ack } from "../queue/index.js";
import { log, enqueueDownstream } from "./shared.js";

const env = getEnv();

async function updateProcessingPhase(client: PoolClient, job: JobRow, phase: ProcessingPhase): Promise<boolean> {
  const next = PROCESSING_PHASE_META[phase];
  const result = await client.query<{ id: string }>(
    `UPDATE videos
     SET processing_phase = $2::processing_phase,
         processing_phase_rank = $3,
         processing_progress = GREATEST(processing_progress, $4),
         error_message = CASE WHEN $2::processing_phase = 'failed' THEN error_message ELSE NULL END,
         updated_at = now()
     WHERE id = $1::uuid
       AND deleted_at IS NULL
       AND (
         processing_phase_rank < $3
         OR (processing_phase_rank = $3 AND processing_progress < $4)
       )
     RETURNING id`,
    [job.video_id, phase, next.rank, next.progress]
  );

  if ((result.rowCount ?? 0) > 0) {
    log("job.process.phase_transition", {
      job_id: job.id,
      video_id: job.video_id,
      phase,
      phase_rank: next.rank,
      progress: next.progress
    });
    return true;
  }

  return false;
}

export async function handleProcessVideo(job: JobRow): Promise<void> {
  const preProcess = await withTransaction(env.DATABASE_URL, async (client) => {
    const videoResult = await client.query<{ processing_phase_rank: number; deleted_at: string | null }>(
      `SELECT processing_phase_rank, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (videoResult.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found`);
    }

    const videoRow = videoResult.rows[0]!;
    if (videoRow.deleted_at) {
      return { skip: true as const, rawKey: "", reason: "deleted" };
    }

    const currentRank = Number(videoRow.processing_phase_rank ?? 0);
    if (currentRank >= 70) {
      return { skip: true as const, rawKey: "", reason: "already_terminal" };
    }

    const uploadResult = await client.query<{ raw_key: string }>(
      `SELECT raw_key FROM uploads WHERE video_id = $1::uuid`,
      [job.video_id]
    );
    if (uploadResult.rowCount === 0) {
      throw new Error(`no upload row found for video ${job.video_id}`);
    }

    await updateProcessingPhase(client, job, "downloading");

    return { skip: false as const, rawKey: uploadResult.rows[0]!.raw_key, reason: "" };
  });

  if (preProcess.skip) {
    log("job.process.skip", { job_id: job.id, video_id: job.video_id, reason: preProcess.reason });
    await withTransaction(env.DATABASE_URL, async (client) => {
      await ack(client, job);
    });
    return;
  }

  const mediaRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId: job.video_id,
      rawKey: preProcess.rawKey
    })
  });

  if (!mediaRes.ok) {
    const text = await mediaRes.text();
    throw new Error(`media-server /process failed: ${mediaRes.status} ${text}`);
  }

  const mediaJson = (await mediaRes.json()) as ProcessResponse;
  const hasAudio = mediaJson.hasAudio !== false;

  await withTransaction(env.DATABASE_URL, async (client) => {
    const current = await client.query<{ transcription_status: string; ai_status: string; deleted_at: string | null }>(
      `SELECT transcription_status, ai_status, deleted_at
       FROM videos
       WHERE id = $1::uuid
       FOR UPDATE`,
      [job.video_id]
    );

    if (current.rowCount === 0) {
      throw new Error(`video ${job.video_id} not found during process finalize`);
    }

    if (current.rows[0]!.deleted_at) {
      log("job.process.skip", { job_id: job.id, video_id: job.video_id, reason: "deleted_during_finalize" });
      await ack(client, job);
      return;
    }

    await updateProcessingPhase(client, job, "probing");
    await updateProcessingPhase(client, job, "processing");
    await updateProcessingPhase(client, job, "uploading");
    await updateProcessingPhase(client, job, "generating_thumbnail");

    await client.query(
      `UPDATE videos
       SET processing_phase = 'complete',
           processing_phase_rank = 70,
           processing_progress = GREATEST(processing_progress, 100),
           result_key = $2,
           thumbnail_key = $3,
           duration_seconds = $4,
           width = $5,
           height = $6,
           fps = COALESCE($7, fps),
           error_message = NULL,
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL
         AND (
           processing_phase_rank < 70
           OR (processing_phase_rank = 70 AND processing_progress < 100)
         )`,
      [
        job.video_id,
        mediaJson.resultKey,
        mediaJson.thumbnailKey,
        mediaJson.durationSeconds ?? null,
        mediaJson.width ?? null,
        mediaJson.height ?? null,
        mediaJson.fps ?? null
      ]
    );

    log("job.process.phase_transition", {
      job_id: job.id,
      video_id: job.video_id,
      phase: "complete",
      phase_rank: PROCESSING_PHASE_META.complete.rank,
      progress: PROCESSING_PHASE_META.complete.progress
    });

    const transcriptionStatus = String(current.rows[0]!.transcription_status);

    if (hasAudio) {
      const shouldQueueTranscription = transcriptionStatus === "not_started" || transcriptionStatus === "queued";
      if (!shouldQueueTranscription) {
        await ack(client, job);
        return;
      }

      await client.query(
        `UPDATE videos
         SET transcription_status = 'queued',
             updated_at = now()
         WHERE id = $1::uuid
           AND deleted_at IS NULL
           AND transcription_status IN ('not_started', 'queued')`,
        [job.video_id]
      );

      await enqueueDownstream(client, job.video_id, "transcribe_video", 95, env.WORKER_MAX_ATTEMPTS);

      log("job.process.downstream_enqueued", {
        job_id: job.id,
        video_id: job.video_id,
        downstream_job_type: "transcribe_video"
      });

      await ack(client, job);
      return;
    }

    await client.query(
      `UPDATE videos
       SET transcription_status = CASE
             WHEN transcription_status IN ('not_started', 'queued', 'processing') THEN 'no_audio'
             ELSE transcription_status
           END,
           ai_status = CASE
             WHEN ai_status IN ('not_started', 'queued') THEN 'skipped'
             ELSE ai_status
           END,
           updated_at = now()
       WHERE id = $1::uuid
         AND deleted_at IS NULL`,
      [job.video_id]
    );

    log("job.process.no_audio", {
      job_id: job.id,
      video_id: job.video_id
    });

    await ack(client, job);
  });
}
