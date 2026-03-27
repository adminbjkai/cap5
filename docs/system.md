# System

This is the codebase-level guide to how cap5 works.

## Runtime topology

Main runtime services:

1. `apps/web` — React app
2. `apps/web-api` — Fastify API
3. `apps/worker` — background job runner using PostgreSQL as the queue
4. `apps/media-server` — FFmpeg/ffprobe wrapper

Shared infrastructure/services in the default stack:

- PostgreSQL — canonical metadata, queue state, transcripts, AI outputs, idempotency, webhook ledger
- MinIO / S3-compatible storage — raw uploads, processed MP4s, thumbnails, VTT
- nginx (`web-internal`) — serves the built frontend in Docker Compose

Truth anchors in code:

- schema: `db/migrations/`
- env contract: `packages/config/src/index.ts`
- API behavior: `apps/web-api/src/routes/`
- worker behavior: `apps/worker/src/handlers/`
- runtime topology: `docker-compose.yml`

## End-to-end lifecycle

### 1. Create video

`POST /api/videos`

- inserts a `videos` row
- inserts a matching `uploads` row
- optionally stores `webhook_url`
- returns `videoId` and `rawKey`

### 2. Upload raw media

Supported paths:

- single-part:
  - `POST /api/uploads/signed`
  - browser uploads to signed PUT URL
  - `POST /api/uploads/complete`
- multipart:
  - `POST /api/uploads/multipart/initiate`
  - `POST /api/uploads/multipart/presign-part`
  - browser uploads parts
  - `POST /api/uploads/multipart/complete`
  - optional `POST /api/uploads/multipart/abort`

Completing the upload queues `process_video`.

### 3. Process video

Worker job: `process_video`

- fetches the raw upload key
- calls `POST /process` on media-server
- media-server downloads the source from S3
- runs FFmpeg to create normalized MP4 + thumbnail
- probes duration/width/height/fps
- uploads derived artifacts back to S3
- worker writes result metadata to `videos`
- if audio exists, queues `transcribe_video`
- otherwise marks transcription `no_audio` and AI `skipped`

### 4. Transcribe

Worker job: `transcribe_video`

- downloads processed media from S3
- extracts audio with FFmpeg when possible
- sends media to Deepgram
- stores transcript segments + VTT in storage/DB
- stores editable `speaker_labels_json`
- marks transcription complete
- queues `generate_ai` when eligible

### 5. Generate AI enrichments

Worker job: `generate_ai`

- flattens transcript text from stored segments
- calls Groq
- stores title, summary, chapters, entities, action items, and quotes
- marks AI complete

### 6. Watch / review

The frontend polls `GET /api/videos/:id/status` and renders:

- processed MP4 playback
- thumbnail
- transcript and editable transcript text
- editable speaker labels
- summary, chapters, entities, action items, quotes
- retry and delete actions

## Queue model

The system uses PostgreSQL-only queueing.

Key mechanics:

- `job_queue` stores jobs
- active uniqueness exists per `(video_id, job_type)` for `queued|leased|running`
- worker claims jobs through lease semantics
- heartbeat extends active leases
- expired leases are reclaimed
- retries are bounded by `WORKER_MAX_ATTEMPTS`
- exhausted jobs become `dead`

Current job types:

- `process_video`
- `transcribe_video`
- `generate_ai`
- `cleanup_artifacts`
- `deliver_webhook`

Important implementation note:

- `WORKER_CLAIM_BATCH_SIZE` exists in env/config, but the current worker loop claims one job at a time

## Data model summary

### `videos`
Main per-video state:

- `processing_phase`, `processing_phase_rank`, `processing_progress`
- `transcription_status`
- `ai_status`
- `result_key`, `thumbnail_key`
- duration/size/fps metadata
- `webhook_url`
- `deleted_at`

### `uploads`
Upload lifecycle per video:

- mode: `singlepart|multipart`
- phase
- raw object key
- multipart upload id / etag manifest

### `job_queue`
Async work queue:

- job type, status, priority
- payload
- attempts / max attempts
- lease ownership fields
- `last_error`

### `transcripts`
Stored transcription output:

- provider, language, VTT key
- `segments_json`
- `speaker_labels_json`

### `ai_outputs`
Stored AI enrichment output:

- provider, model
- title, summary
- `chapters_json`
- `entities_json`
- `action_items_json`
- `quotes_json`

### `webhook_events`
Inbound media-server webhook ledger:

- delivery id, job id, video id
- phase/progress
- payload/signature
- accepted/rejected bookkeeping

### `idempotency_keys`
Mutation response cache keyed by endpoint + idempotency key.

## State model

Processing phases on `videos`:

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

Separate status fields:

- `transcription_status`
- `ai_status`

That split matters: media processing can be complete while transcription or AI is still running.

## Webhooks

### Inbound

`POST /api/webhooks/media-server/progress`

- HMAC-verified with `MEDIA_SERVER_WEBHOOK_SECRET`
- enforces timestamp skew
- dedupes deliveries
- applies monotonic phase/progress updates only
- records events in `webhook_events`

### Outbound

If a video has `webhookUrl`, the system can send:

- `video.progress` — queued by the API webhook route after accepted inbound progress updates
- `video.transcription_complete` — queued by the worker
- `video.ai_complete` — queued by the worker

Outbound payloads are plain JSON POSTs and are **not signed** today.

## Code map by responsibility

- API routes: `apps/web-api/src/routes/`
- API shared helpers: `apps/web-api/src/lib/`
- worker loop: `apps/worker/src/index.ts`
- worker handlers: `apps/worker/src/handlers/`
- media processing service: `apps/media-server/src/index.ts`
- frontend pages: `apps/web/src/pages/`
- frontend API client: `apps/web/src/lib/api.ts`

## Intentionally missing or incomplete

- auth / authorization
- multi-tenant isolation
- signed outbound webhooks
- active HLS processing path
- polished production deployment story beyond Docker Compose
