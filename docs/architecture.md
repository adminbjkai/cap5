---
title: "Architecture"
description: "System design, state machine, Docker services, and data flow"
---

# cap4 Architecture

Current system architecture for the repo in this branch. This document follows the code, migrations, and `docker-compose.yml`.

## Runtime Topology

The default Docker stack defines nine services:

1. `postgres` — primary database
2. `migrate` — one-shot migration runner
3. `minio` — S3-compatible object storage
4. `minio-setup` — bucket/bootstrap helper
5. `web-api` — Fastify HTTP API on port `3000`
6. `worker` — background job runner
7. `media-server` — FFmpeg RPC service on port `3100`
8. `web-builder` — one-shot frontend build copier for the shared `web_dist` volume
9. `web-internal` — nginx serving the built frontend on port `8022`

## High-Level Flow

```text
Browser
  -> web-internal (nginx, :8022)
  -> web-api (:3000)
  -> postgres + minio

web-api
  -> creates videos/uploads rows
  -> enqueues process_video jobs
  -> serves status, retry, delete, upload endpoints
  -> exposes /health and /ready for liveness/readiness
  -> exposes POST /api/webhooks/media-server/progress for signed progress callbacks

worker
  -> claims jobs from job_queue with leasing
  -> runs process_video / transcribe_video / generate_ai / cleanup_artifacts / deliver_webhook
  -> calls media-server, Deepgram, and Groq
  -> updates database state and queues downstream jobs

media-server
  -> exposes /health and /process endpoints
  -> worker calls POST /process (synchronous RPC)
  -> processes video: downloads, runs ffmpeg, uploads outputs
  -> returns completion status to worker
```

## Source Of Truth

- Schema and enums: `db/migrations`
- Environment defaults: `packages/config/src/index.ts`
- API contracts: `apps/web-api/src/routes/*`
- Worker behavior: `apps/worker/src/index.ts`

When this document conflicts with code or migrations, code and migrations win.

## State Model

`videos` owns the primary processing state:

- `processing_phase`
- `processing_phase_rank`
- `processing_progress`
- `transcription_status`
- `ai_status`

`processing_phase` is monotonic through the webhook/API update guards. Transcription and AI are tracked separately once video processing completes.

Current processing phases:

- `not_required`
- `queued`
- `downloading`
- `probing`
- `processing`
- `uploading`
- `generating_thumbnail`
- `complete`
- `failed`
- `cancelled`

Current transcription statuses:

- `not_started`
- `queued`
- `processing`
- `complete`
- `no_audio`
- `failed`
- `skipped`

Current AI statuses:

- `not_started`
- `queued`
- `processing`
- `complete`
- `failed`
- `skipped`

## Job Queue

The worker operates on `job_queue`, not an external broker.

Job types currently used by the system:

- `process_video`
- `transcribe_video`
- `generate_ai`
- `cleanup_artifacts`
- `deliver_webhook`

Key properties:

- jobs are leased before execution
- heartbeats extend active leases
- expired leases can be reclaimed
- successful jobs are acknowledged in the queue
- terminal failures become `dead`

The queue also enforces one active job per `(video_id, job_type)` for active states, which is why enqueue paths must be conflict-aware.

## Upload Lifecycle

1. `POST /api/videos` creates a `videos` row and a pending `uploads` row.
2. The client requests signed upload URLs from `uploads` routes.
3. The client uploads bytes to MinIO.
4. The client marks the upload complete.
5. The API enqueues `process_video`.
6. Worker processing fans out into transcription and AI jobs as needed.

## Webhooks

There are two separate webhook concepts:

- Incoming: `POST /api/webhooks/media-server/progress`
  Route exists for signed progress updates and is covered by the API contract plus debug/test tooling.
- Outgoing: `deliver_webhook` jobs
  Sent to a user-provided `videos.webhook_url` after selected milestones.

Incoming webhook requests are HMAC-signed, timestamp-validated, deduplicated by delivery ID, and applied only if they pass monotonic state guards.

Current checked-in runtime note:

- The main worker path calls `POST /process` on `apps/media-server` and waits for a synchronous result.
- The checked-in `apps/media-server/src/index.ts` implementation shown in this repo does not itself emit signed progress callbacks during that mainline path.
- `deliver_webhook` is unrelated to the internal media progress route; it sends outbound user webhooks stored in `videos.webhook_url`.
- Debug-only routes such as `/debug/smoke` exist only in non-production builds and are not part of the production contract.

## Diagrams

### Service Topology

```mermaid
graph TD
    Browser -->|":8022"| web-internal["web-internal\n(nginx :8022)"]
    Browser -->|":8922"| minio["minio\n(:8922 API, :8923 console)"]
    web-internal -->|static assets| web_dist[(web_dist volume)]
    web-builder -->|"cp dist/*"| web_dist
    web-internal -->|proxy /api/| web-api["web-api\n(Fastify :3000)"]
    web-api --> postgres[("postgres\n(:5432)")]
    web-api --> minio
    worker["worker"] --> postgres
    worker --> minio
    worker -->|"POST /process"| media-server["media-server\n(:3100)"]
    media-server --> minio
    media-server -->|optional progress callback| web-api
    worker -->|Deepgram API| deepgram((Deepgram))
    worker -->|Groq API| groq((Groq))
    migrate["migrate\n(one-shot)"] --> postgres
    minio-setup["minio-setup\n(one-shot)"] --> minio
```

### Job State Machine

```mermaid
stateDiagram-v2
    [*] --> queued : enqueue
    queued --> leased : claimOne (SKIP LOCKED)
    leased --> running : markRunning
    running --> succeeded : ack
    running --> leased : fail (retry budget remaining)
    running --> dead : fail (budget exhausted or fatal)
    dead --> queued : enqueueDownstream reset
    queued --> cancelled : external delete
    leased --> cancelled : external delete
    running --> cancelled : external delete
```

### Upload Sequence

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as web-api
    participant M as MinIO
    participant W as Worker
    participant MS as media-server
    participant DG as Deepgram
    participant GR as Groq

    B->>A: POST /api/videos (Idempotency-Key)
    A-->>B: { videoId, uploadId }

    B->>A: POST /api/uploads/signed (Idempotency-Key)
    A-->>B: { putUrl }

    B->>M: PUT <putUrl> (raw bytes)
    M-->>B: 200 OK

    B->>A: POST /api/uploads/complete (Idempotency-Key)
    A->>A: enqueue process_video
    A-->>B: 200 OK

    W->>A: (polling job_queue via DB)
    W->>MS: POST /process
    MS->>M: download raw upload
    MS->>MS: FFmpeg transcode
    MS->>M: upload processed MP4 + HLS + thumbnail
    MS-->>W: { status: complete }

    W->>W: enqueue transcribe_video
    W->>M: download audio
    W->>DG: transcribe (diarize=true)
    DG-->>W: segments + speaker data
    W->>A: (update transcripts table via DB)

    W->>W: enqueue generate_ai
    W->>GR: title/summary/chapters/entities
    GR-->>W: structured JSON
    W->>A: (update ai_outputs table via DB)

    W->>W: enqueue cleanup_artifacts
    W->>M: delete temp objects

    B->>A: GET /api/videos/:id/status
    A-->>B: { phase: complete, transcription, ai, ... }
```

## Frontend Serving

The production-style Compose flow does not run Vite as a long-lived container. Instead:

- `web-builder` copies the built frontend into the shared `web_dist` volume
- `web-internal` serves those static assets through nginx on port `8022`

For package-level frontend development, use the app-local tooling in `apps/web`.
