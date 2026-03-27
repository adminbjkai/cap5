import { getEnv } from "@cap/config";
import { withTransaction } from "@cap/db";
import {
  claimOne,
  reclaimExpiredLeases,
  runMaintenance,
  markRunning,
  heartbeat,
  startHeartbeatLoop,
  fail,
  ack,
} from "./queue/index.js";
import { HANDLER_MAP } from "./handlers/index.js";
import { markTerminalFailure, DeletedVideoSkipError, isFatalError, log } from "./handlers/shared.js";
import type { JobRow, JobType } from "./types.js";

const env = getEnv();

async function waitForDatabaseReady(): Promise<void> {
  while (true) {
    try {
      await withTransaction(env.DATABASE_URL, async (client) => {
        await client.query("SELECT 1");
      });
      log("db.ready", {});
      return;
    } catch (error) {
      log("db.waiting", { error: String(error) });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function isMediaServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${env.MEDIA_SERVER_BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function processJob(job: JobRow): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (client) => {
    await markRunning(client, job);
  });

  const stopHeartbeat = startHeartbeatLoop(job);

  try {
    const alive = await heartbeat(job);
    if (!alive) {
      throw new Error(`lease expired before handling job ${job.id}`);
    }

    await HANDLER_MAP[job.job_type](job);
    log("job.acked", { job_id: job.id, video_id: job.video_id, job_type: job.job_type });
  } catch (error) {
    if (error instanceof DeletedVideoSkipError) {
      await withTransaction(env.DATABASE_URL, async (client) => {
        await ack(client, job);
      });
      log("job.acked", {
        job_id: job.id,
        video_id: job.video_id,
        job_type: job.job_type,
        reason: "video_deleted"
      });
      return;
    }

    const isFatal = isFatalError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failed = await fail(job, errorMessage, isFatal);

    if (failed?.status === "dead") {
      await markTerminalFailure(job, errorMessage);
    }

    log("job.failed", {
      job_id: job.id,
      video_id: job.video_id,
      job_type: job.job_type,
      status: failed?.status ?? "unknown",
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      error: errorMessage
    });
  } finally {
    stopHeartbeat();
  }
}

async function main(): Promise<void> {
  log("worker.started", { worker_id: env.WORKER_ID });
  await waitForDatabaseReady();

  setInterval(() => {
    void reclaimExpiredLeases()
      .then((reclaimed) => {
        for (const row of reclaimed) {
          log("job.reclaimed", {
            job_id: String(row.id),
            video_id: String(row.video_id),
            job_type: String(row.job_type),
            status: String(row.status)
          });

          if (String(row.status) === "dead") {
            void markTerminalFailure(
              {
                id: Number(row.id),
                video_id: String(row.video_id),
                job_type: String(row.job_type) as JobType,
                lease_token: "",
                payload: {},
                attempts: 0,
                max_attempts: 0
              },
              "Lease expired and retry budget exhausted"
            );
          }
        }
      })
      .catch((error) => {
        log("reclaim.error", { error: String(error) });
      });
  }, env.WORKER_RECLAIM_MS);

  setInterval(() => {
    void runMaintenance().catch((error) => {
      log("maintenance.error", { error: String(error) });
    });
  }, 1000 * 60 * 60);

  while (true) {
    let excludeTypes: JobType[] = [];
    const mediaHealthy = await isMediaServerHealthy();
    if (!mediaHealthy) {
      excludeTypes = ["process_video"];
      log("worker.health.degraded", { reason: "media_server_unhealthy", skipping: excludeTypes });
    }

    const job = await claimOne(excludeTypes);
    if (job) {
      log("job.claimed", {
        job_id: job.id,
        video_id: job.video_id,
        job_type: job.job_type,
        attempts: job.attempts,
        max_attempts: job.max_attempts
      });
      await processJob(job);
    }

    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
  }
}

main().catch((error) => {
  log("worker.crash", { error: String(error) });
  process.exit(1);
});
