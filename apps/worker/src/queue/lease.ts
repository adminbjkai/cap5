import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import type { PoolClient } from "pg";
import type { JobRow, FailResult } from "../types.js";
import { ACK_SQL, FAIL_SQL, MARK_RUNNING_SQL, HEARTBEAT_SQL } from "./sql.js";

const env = getEnv();

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "worker", event, ...fields }));
}

export async function ack(client: PoolClient, job: JobRow): Promise<void> {
  const result = await client.query(ACK_SQL, [job.id, env.WORKER_ID, job.lease_token]);
  if (result.rowCount === 0) {
    throw new Error(`unable to ack job ${job.id}: row not found or lease lost`);
  }
}

export async function fail(job: JobRow, error: unknown, fatal = false): Promise<FailResult | null> {
  return withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query<FailResult>(FAIL_SQL, [
      job.id,
      env.WORKER_ID,
      job.lease_token,
      error instanceof Error ? error.message : String(error),
      fatal
    ]);
    return result.rows[0] ?? null;
  });
}

export async function markRunning(client: PoolClient, job: JobRow): Promise<void> {
  const result = await client.query(MARK_RUNNING_SQL, [job.id, env.WORKER_ID, job.lease_token]);
  if (result.rowCount === 0) {
    throw new Error(`unable to transition job ${job.id} to running`);
  }
}

export async function heartbeat(job: JobRow): Promise<boolean> {
  const rowCount = await withTransaction(env.DATABASE_URL, async (client) => {
    const result = await client.query(HEARTBEAT_SQL, [job.id, env.WORKER_ID, job.lease_token, `${env.WORKER_LEASE_SECONDS} seconds`]);
    return result.rowCount;
  });
  return (rowCount ?? 0) > 0;
}

export function startHeartbeatLoop(job: JobRow): () => void {
  let stopped = false;
  let inFlight = false;

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;

    void heartbeat(job)
      .then((alive) => {
        if (!alive) {
          log("job.heartbeat.lost", {
            job_id: job.id,
            video_id: job.video_id,
            job_type: job.job_type
          });
        }
      })
      .catch((error) => {
        log("job.heartbeat.error", {
          job_id: job.id,
          video_id: job.video_id,
          job_type: job.job_type,
          error: String(error)
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, env.WORKER_HEARTBEAT_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
