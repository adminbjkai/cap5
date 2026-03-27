---
title: "Worker"
description: "Background job runner — module structure, job types, leasing, retries"
---

# Worker

The worker (`apps/worker`) consumes jobs from the `job_queue` PostgreSQL table. There is no external broker (no Redis, no RabbitMQ). Jobs are claimed with `SELECT … FOR UPDATE SKIP LOCKED`.

## Module Structure

```
apps/worker/src/
├── index.ts          Main loop: poll, claim, dispatch, error handling
├── types.ts          Shared TypeScript types (JobRow, JobType, FailResult)
│
├── queue/            Queue mechanics — all SQL-level operations
│   ├── index.ts      Re-exports all queue functions
│   ├── claim.ts      claimOne() and reclaimExpiredLeases()
│   ├── lease.ts      markRunning(), heartbeat(), startHeartbeatLoop(), ack(), fail()
│   ├── maintenance.ts  runMaintenance() — periodic housekeeping
│   └── sql.ts        All raw SQL strings
│
├── handlers/         One file per job type
│   ├── index.ts      HANDLER_MAP — routes job_type → handler function
│   ├── shared.ts     Shared utilities: log, ensureVideoNotDeleted, markTerminalFailure,
│   │                 enqueueDownstream, isFatalError, DeletedVideoSkipError
│   ├── process-video.ts
│   ├── transcribe-video.ts
│   ├── generate-ai.ts
│   ├── cleanup-artifacts.ts
│   └── deliver-webhook.ts
│
├── lib/              External-client helpers
│   ├── ffmpeg.ts     Calls POST /process on media-server
│   ├── s3.ts         S3/MinIO upload/download helpers
│   └── transcript.ts Transcript parsing utilities
│
└── providers/        Third-party API clients
    ├── deepgram.ts   Deepgram transcription (with diarization)
    ├── deepgram.test.ts
    ├── groq.ts       Groq AI enrichment (title, summary, chapters, entities, …)
    └── groq.test.ts
```

## Job Types

| `job_type`           | Handler                  | What it does                                                                                   |
|----------------------|--------------------------|------------------------------------------------------------------------------------------------|
| `process_video`      | `handleProcessVideo`     | Calls `POST /process` on media-server (sync RPC). Waits for FFmpeg result; updates video state; enqueues `transcribe_video` and `cleanup_artifacts` on success. |
| `transcribe_video`   | `handleTranscribeVideo`  | Downloads audio from MinIO; sends to Deepgram with `diarize=true`; stores `segments_json` and `vtt_key` in `transcripts`; enqueues `generate_ai`. |
| `generate_ai`        | `handleGenerateAi`       | Reads transcript; sends to Groq; validates schema; stores title, summary, chapters, entities, action items, and quotes in `ai_outputs`. |
| `cleanup_artifacts`  | `handleCleanupArtifacts` | Deletes temporary S3 objects (raw upload, intermediate files) after processing completes.      |
| `deliver_webhook`    | `handleDeliverWebhook`   | Sends an outbound HTTP POST to `videos.webhook_url` (user-configured). Retries on failure.    |

## Job State Machine

Each job row moves through these statuses:

```
queued
  │
  ▼  (worker calls claimOne)
leased
  │
  ▼  (worker calls markRunning)
running
  │
  ├──► succeeded   (worker calls ack)
  │
  └──► dead        (attempts ≥ max_attempts or fatal error)
           │
           └──► queued  (manual reset — enqueueDownstream resets dead → queued)

cancelled           (set externally; worker skips)
```

State transition table:

| From      | To         | Triggered by                                 |
|-----------|------------|----------------------------------------------|
| `queued`  | `leased`   | `claimOne` — SKIP LOCKED SELECT + UPDATE     |
| `leased`  | `running`  | `markRunning` — validates lease token        |
| `running` | `succeeded`| `ack` — validates worker ID + lease token    |
| `running` | `leased`   | `fail` with retry budget remaining           |
| `running` | `dead`     | `fail` with retry budget exhausted, or fatal |
| `dead`    | `queued`   | `enqueueDownstream` reset for downstream     |
| any       | `cancelled`| External API call (DELETE /api/videos/:id)   |

A unique constraint (`uq_job_queue_one_active_per_video_type`) prevents more than one active job (`queued | leased | running`) per `(video_id, job_type)` at a time.

## Leasing and Heartbeats

### Claim

`claimOne` atomically selects and updates a `queued` job to `leased` in a single transaction using `FOR UPDATE SKIP LOCKED`. The lease expiry is set to `now() + WORKER_LEASE_SECONDS`.

If `media-server` is unhealthy (checked via `/health`), `process_video` jobs are excluded from the claim query so the worker can still make progress on other job types.

### Heartbeat

Once a job transitions to `running`, `startHeartbeatLoop` fires every `WORKER_HEARTBEAT_MS` milliseconds to extend `locked_until`. This prevents a long-running job from being reclaimed by another worker instance.

The heartbeat loop:
- Skips if a previous heartbeat is still in-flight (no concurrent overlapping requests)
- Logs `job.heartbeat.lost` if the database row no longer matches the lease token (lease was stolen or job was cancelled)
- Stops automatically when the job completes or the handler returns

### Lease Reclaim

A `setInterval` fires every `WORKER_RECLAIM_MS` milliseconds. It calls `reclaimExpiredLeases`, which:
1. Finds jobs stuck in `leased` or `running` where `locked_until < now()`
2. Decrements their retry budget
3. Sets them back to `queued` (if budget remains) or `dead` (if exhausted)
4. Calls `markTerminalFailure` for newly dead jobs to update the video's state columns

## Error Handling and Retry Logic

### Transient errors

Any error thrown by a handler that is not marked `fatal` is treated as transient. `fail()` increments `attempts`, records `last_error`, and resets the job to `leased` state so it can be retried after the next claim cycle.

### Fatal errors

Handlers can throw an error object with `fatal: true`. `isFatalError` checks this flag. Fatal errors immediately set the job to `dead` regardless of remaining retry budget.

Groq errors where > 30% of transcript chunks fail are treated as fatal.

### Terminal failure side effects (`markTerminalFailure`)

When a job becomes `dead`, `markTerminalFailure` updates video-level state:

| Job type          | Video state update                                                                   |
|-------------------|--------------------------------------------------------------------------------------|
| `process_video`   | `processing_phase → 'failed'`, `phase_rank → 80`, `error_message` set               |
| `transcribe_video`| `transcription_status → 'failed'`, `ai_status → 'skipped'` (if not yet started)     |
| `generate_ai`     | `ai_status → 'failed'`                                                               |

### Deleted video handling

At the start of each handler, `ensureVideoNotDeleted` checks `videos.deleted_at`. If the video has been soft-deleted, it throws `DeletedVideoSkipError`. The main loop catches this and calls `ack()` to silently discard the job without counting it as a failure.

## Adding a New Job Type

1. **Add the enum value** in a new migration file under `db/migrations/`:
   ```sql
   ALTER TYPE job_type ADD VALUE 'my_new_job';
   ```

2. **Create the handler** at `apps/worker/src/handlers/my-new-job.ts`:
   ```ts
   import type { JobRow } from "../types.js";
   import { log, ensureVideoNotDeleted, ack } from "./shared.js";
   import { withTransaction } from "@cap/db";
   import { getEnv } from "@cap/config";

   const env = getEnv();

   export async function handleMyNewJob(job: JobRow): Promise<void> {
     await ensureVideoNotDeleted(job, "my_new_job");
     // ... do work ...
     await withTransaction(env.DATABASE_URL, async (client) => {
       await ack(client, job);
     });
     log("my_new_job.complete", { job_id: job.id, video_id: job.video_id });
   }
   ```

3. **Register the handler** in `apps/worker/src/handlers/index.ts`:
   ```ts
   import { handleMyNewJob } from "./my-new-job.js";

   export const HANDLER_MAP: Record<JobType, (job: JobRow) => Promise<void>> = {
     // existing handlers …
     my_new_job: handleMyNewJob,
   };
   ```

4. **Update `JobType`** in `apps/worker/src/types.ts` if it is not automatically inferred from the enum.

5. **Enqueue the job** from wherever it should be triggered using `enqueueDownstream` (from `shared.ts`) or a direct `INSERT INTO job_queue …` with `ON CONFLICT DO UPDATE SET updated_at = now()`.
