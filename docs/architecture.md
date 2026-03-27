# Architecture

## Runtime shape

This repo is a pnpm workspace with four runtime services:

1. **web** (`apps/web`) — React app for library, recording, watch/review, transcript editing, and summary viewing
2. **web-api** (`apps/web-api`) — Fastify HTTP API
3. **worker** (`apps/worker`) — background job runner using PostgreSQL as the queue
4. **media-server** (`apps/media-server`) — FFmpeg/ffprobe wrapper for transcoding, thumbnailing, and media probing

Shared packages:

- `@cap/config` validates env at runtime
- `@cap/db` provides pooled DB access and transactions
- `@cap/logger` provides structured logging helpers

State lives in:

- **PostgreSQL** — canonical metadata, workflow state, jobs, transcripts, AI outputs, webhook events, idempotency cache
- **MinIO / S3-compatible storage** — raw uploads, processed MP4s, thumbnails, VTT files

## Primary workflow

### 1. Create video

`POST /api/videos`

- inserts `videos`
- inserts `uploads`
- optionally stores a per-video outbound `webhook_url`
- returns `videoId` and `rawKey`

### 2. Upload raw media

Two supported paths:

- **single-part**
  - `POST /api/uploads/signed`
  - browser uploads to signed S3 URL
  - `POST /api/uploads/complete`
- **multipart**
  - `POST /api/uploads/multipart/initiate`
  - `POST /api/uploads/multipart/presign-part`
  - browser uploads each part
  - `POST /api/uploads/multipart/complete`
  - optional `POST /api/uploads/multipart/abort`

When upload completes, the API queues `process_video`.

### 3. Process video

Worker job: `process_video`

- fetches the raw upload key
- calls `media-server /process`
- media server downloads source from S3, transcodes to MP4, generates a thumbnail, probes metadata, uploads derived artifacts back to S3
- worker writes `result_key`, `thumbnail_key`, duration, width, height, fps
- if audio exists, queues `transcribe_video`
- if no audio, marks transcription `no_audio` and AI `skipped`

### 4. Transcribe

Worker job: `transcribe_video`

- downloads processed media from S3
- extracts audio with FFmpeg when possible
- sends audio/video to Deepgram
- stores transcript segments and VTT
- stores `speaker_labels_json` for editable display labels
- marks transcription complete
- queues `generate_ai`

### 5. Generate AI enrichments

Worker job: `generate_ai`

- flattens transcript text from stored segments
- calls Groq
- stores title, summary, chapters, entities, action items, quotes
- marks AI complete

### 6. Watch/review

The web app polls `GET /api/videos/:id/status` until terminal states are reached, then shows:

- normalized MP4 playback
- thumbnail
- transcript + editable transcript text
- editable speaker labels
- AI summary, chapters, entities, action items, quotes

## Queue model

The worker uses PostgreSQL-only queueing.

Key mechanics:

- `job_queue` stores all jobs
- active uniqueness is enforced per `(video_id, job_type)` for statuses `queued|leased|running`
- claiming uses lease semantics
- worker heartbeats extend leases
- expired leases are reclaimed
- retries are bounded by `WORKER_MAX_ATTEMPTS`
- exhausted jobs become `dead`

Current job types:

- `process_video`
- `transcribe_video`
- `generate_ai`
- `cleanup_artifacts`
- `deliver_webhook`

## Webhook architecture

### Inbound

The media server can report progress through `POST /api/webhooks/media-server/progress`.

Properties:

- raw-body HMAC verification using `MEDIA_SERVER_WEBHOOK_SECRET`
- timestamp skew enforcement
- dedupe by `(source, delivery_id)`
- monotonic phase/progress guard
- accepted events are recorded in `webhook_events`

### Outbound

If a video was created with `webhookUrl`, the worker can queue `deliver_webhook` jobs for:

- `video.progress`
- `video.transcription_complete`
- `video.ai_complete`

Outbound payloads are plain JSON POSTs. They are **not signed** in the current implementation.

## Frontend structure

The web app is React + Zustand + React Router.

Main flows:

- `HomePage` — library
- `RecordPage` — browser recording flow
- `VideoPage` — player, transcript review, summary rail, notes panel, retry/delete actions

Notable UI behavior present in code:

- command palette
- keyboard shortcuts
- custom video controls
- summary strip + compact summary card
- transcript edit panel and verified-segment helpers
- recent session persistence in local storage/session helpers

## Phase/state model

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

Separate status fields exist for:

- `transcription_status`
- `ai_status`

That split is important: media processing can be complete while transcription/AI are still running.
