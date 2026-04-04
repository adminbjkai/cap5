/**
 * Debug routes (non-production only):
 *   POST /debug/enqueue          — create a video + enqueue job (quick debug)
 *   GET  /debug/job/:id          — inspect a job queue row
 *   POST /debug/videos           — create a bare video row
 *   POST /debug/jobs/enqueue     — enqueue an arbitrary job
 *   POST /debug/smoke            — full end-to-end smoke test (generates real MP4)
 */

import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query, withTransaction } from "@cap/db";
import {
  requireAuth,
  getInternalS3ClientAndBucket,
  PutObjectCommand,
  type JobType,
  type ProcessResponse
} from "../lib/shared.js";
import { parseBody, parseParams } from "../plugins/validation.js";
import {
  DebugCreateVideoSchema,
  DebugEnqueueJobSchema,
  JobIdParamSchema,
} from "../types/schemas.js";

const env = getEnv();

function log(app: FastifyInstance, fields: Record<string, unknown>) {
  if (app.serviceLogger) {
    app.serviceLogger.info("web-api log", fields);
  } else {
    console.log(JSON.stringify({ service: "web-api", ...fields }));
  }
}

async function generateTestMp4Buffer(args: { seconds: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const seconds = Math.max(1, Math.floor(args.seconds));
    const child = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=size=320x240:rate=25",
      "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=44100",
      "-t", String(seconds),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1"
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function debugRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------
  // POST /debug/enqueue — quick debug: create video + enqueue job
  // ------------------------------------------------------------------

  app.post("/debug/enqueue", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const videoResult = await query<{ id: string }>(
      env.DATABASE_URL,
      `INSERT INTO videos (name, source_type) VALUES ('Debug Queue Video', 'web_mp4') RETURNING id`
    );
    const videoId = videoResult.rows[0]!.id;

    const jobResult = await query<{ id: number }>(
      env.DATABASE_URL,
      `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
       VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
       RETURNING id`,
      [videoId, env.WORKER_MAX_ATTEMPTS]
    );
    const jobId = Number(jobResult.rows[0]!.id);

    log(app, { event: "debug.enqueue.created", videoId, jobId });
    return reply.send({ videoId, jobId });
  });

  // ------------------------------------------------------------------
  // GET /debug/job/:id — inspect a job queue row
  // ------------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/debug/job/:id", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const { id: jobId } = parseParams(JobIdParamSchema, req.params);

    const result = await query(
      env.DATABASE_URL,
      `SELECT id, video_id, job_type, status, attempts, locked_by, locked_until, lease_token, run_after, last_error, updated_at
       FROM job_queue
       WHERE id = $1`,
      [jobId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: "Job not found" });
    }

    return reply.send(result.rows[0]);
  });

  // ------------------------------------------------------------------
  // POST /debug/videos — create a bare video row
  // ------------------------------------------------------------------

  app.post<{ Body: { name?: string; sourceType?: "web_mp4" | "processed_mp4" | "hls" } }>("/debug/videos", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const { name, sourceType } = parseBody(DebugCreateVideoSchema, req.body);

    const result = await query<{ id: string }>(
      env.DATABASE_URL,
      `INSERT INTO videos (name, source_type) VALUES ($1, $2::source_type) RETURNING id`,
      [name, sourceType]
    );

    const videoId = result.rows[0]?.id;
    log(app, { event: "debug.video.created", videoId });
    return reply.send({ ok: true, videoId });
  });

  // ------------------------------------------------------------------
  // POST /debug/jobs/enqueue — enqueue an arbitrary job
  // ------------------------------------------------------------------

  app.post<{ Body: { videoId: string; jobType: JobType; payload?: Record<string, unknown>; priority?: number; maxAttempts?: number } }>("/debug/jobs/enqueue", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const { videoId, jobType, payload, priority, maxAttempts } = parseBody(DebugEnqueueJobSchema, req.body);

    const result = await query<{ id: number; status: string }>(
      env.DATABASE_URL,
      `INSERT INTO job_queue (video_id, job_type, status, priority, payload, max_attempts)
       VALUES ($1::uuid, $2::job_type, 'queued', COALESCE($3, 100), COALESCE($4::jsonb, '{}'::jsonb), COALESCE($5::int, $6::int))
       ON CONFLICT (video_id, job_type) WHERE status IN ('queued', 'leased', 'running')
       DO UPDATE SET updated_at = now()
       RETURNING id, status`,
      [videoId, jobType, priority ?? null, payload ? JSON.stringify(payload) : null, maxAttempts ?? null, env.WORKER_MAX_ATTEMPTS]
    );

    const jobId = result.rows[0]?.id;
    log(app, { event: "debug.job.enqueued", videoId, jobId, jobType });
    return reply.send({ ok: true, id: jobId, videoId, jobType, status: result.rows[0]?.status });
  });

  // ------------------------------------------------------------------
  // POST /debug/smoke — full end-to-end smoke test
  // ------------------------------------------------------------------

  app.post("/debug/smoke", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    try {
      const mp4 = await generateTestMp4Buffer({ seconds: 2 });
      const { client: s3Client, bucket } = getInternalS3ClientAndBucket();

      const created = await withTransaction(env.DATABASE_URL, async (client) => {
        const videoResult = await client.query<{ id: string }>(
          `INSERT INTO videos (name, source_type) VALUES ('Smoke Test Video', 'web_mp4') RETURNING id`
        );
        const videoId = videoResult.rows[0]!.id;
        const rawKey = `videos/${videoId}/raw/source.mp4`;

        await client.query(
          `INSERT INTO uploads (video_id, mode, phase, raw_key)
           VALUES ($1::uuid, 'singlepart', 'pending', $2)`,
          [videoId, rawKey]
        );

        const jobResult = await client.query<{ id: number }>(
          `INSERT INTO job_queue (video_id, job_type, status, priority, run_after, payload, max_attempts)
           VALUES ($1::uuid, 'process_video', 'queued', 100, now(), '{}'::jsonb, $2)
           RETURNING id`,
          [videoId, env.WORKER_MAX_ATTEMPTS]
        );

        await client.query(
          `UPDATE videos
           SET processing_phase = 'queued',
               processing_phase_rank = 10,
               processing_progress = GREATEST(processing_progress, 5),
               updated_at = now()
           WHERE id = $1::uuid
             AND processing_phase_rank < 10`,
          [videoId]
        );

        return { videoId, rawKey, jobId: Number(jobResult.rows[0]!.id) };
      });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: created.rawKey,
          Body: mp4,
          ContentType: "video/mp4"
        })
      );

      await query(
        env.DATABASE_URL,
        `UPDATE uploads
         SET phase = 'uploaded', updated_at = now()
         WHERE video_id = $1::uuid
           AND phase IN ('pending', 'uploading', 'completing')`,
        [created.videoId]
      );

      const processRes = await fetch(`${env.MEDIA_SERVER_BASE_URL}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: created.videoId,
          rawKey: created.rawKey
        })
      });

      if (!processRes.ok) {
        const text = await processRes.text();
        return reply.code(500).send({ ok: false, error: "media-server call failed", details: text });
      }

      const mediaJson = (await processRes.json()) as ProcessResponse;

      await withTransaction(env.DATABASE_URL, async (client) => {
        await client.query(
          `UPDATE videos
           SET processing_phase = 'complete',
               processing_phase_rank = 70,
               processing_progress = 100,
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
             AND processing_phase_rank < 70`,
          [
            created.videoId,
            mediaJson.resultKey,
            mediaJson.thumbnailKey,
            mediaJson.durationSeconds ?? null,
            mediaJson.width ?? null,
            mediaJson.height ?? null,
            mediaJson.fps ?? null
          ]
        );

        await client.query(
          `UPDATE job_queue
           SET status = 'succeeded',
               finished_at = now(),
               locked_by = NULL,
               locked_until = NULL,
               lease_token = NULL,
               updated_at = now()
           WHERE id = $1
             AND status IN ('queued', 'leased', 'running')`,
          [created.jobId]
        );
      });

      const finalVideoResult = await query(
        env.DATABASE_URL,
        `SELECT id, processing_phase, processing_phase_rank, processing_progress, result_key, thumbnail_key, error_message, completed_at, updated_at
         FROM videos WHERE id = $1::uuid`,
        [created.videoId]
      );

      const queueRow = await query(
        env.DATABASE_URL,
        `SELECT id, status, attempts, locked_by, locked_until, lease_token, last_error, updated_at
         FROM job_queue WHERE id = $1`,
        [created.jobId]
      );

      log(app, { event: "debug.smoke.complete", videoId: created.videoId, jobId: created.jobId });

      return reply.send({
        ok: true,
        videoId: created.videoId,
        rawKey: created.rawKey,
        jobId: created.jobId,
        media: mediaJson,
        finalVideo: finalVideoResult.rows[0] ?? null,
        queueJob: queueRow.rows[0] ?? null
      });
    } catch (error) {
      log(app, { event: "debug.smoke.error", error: String(error) });
      return reply.code(500).send({ ok: false, error: String(error) });
    }
  });
}
