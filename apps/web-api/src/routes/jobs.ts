/**
 * Job routes:
 *   GET /api/jobs/:id — fetch a single job queue row
 */

import type { FastifyInstance } from "fastify";
import { getEnv } from "@cap/config";
import { query } from "@cap/db";

import { requireAuth } from "../lib/shared.js";
import { parseParams } from "../plugins/validation.js";
import { JobIdParamSchema } from "../types/schemas.js";

const env = getEnv();

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
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

    const job = result.rows[0];
    // Convert id from bigint string to number for API contract
    return reply.send({
      id: Number(job.id),
      video_id: job.video_id,
      job_type: job.job_type,
      status: job.status,
      attempts: job.attempts,
      locked_by: job.locked_by,
      locked_until: job.locked_until,
      lease_token: job.lease_token,
      run_after: job.run_after,
      last_error: job.last_error,
      updated_at: job.updated_at
    });
  });
}
