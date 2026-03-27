# API

Base URL: `http://localhost:3000`

## Conventions

- JSON request/response bodies unless noted
- mutations generally require `Idempotency-Key`
- UUIDs are used for videos
- job IDs are numeric

## Health and system

### `GET /health`
Returns service liveness.

### `GET /ready`
Readiness endpoint from the health plugin.

### `GET /api/system/provider-status`
Returns current configured/observed status for Deepgram and Groq.

## Videos

### `POST /api/videos`
Create a video row and upload record.

Request body:

```json
{
  "name": "Optional title",
  "webhookUrl": "https://example.com/hook"
}
```

Headers:

- `Idempotency-Key: <value>`

Response:

```json
{
  "videoId": "uuid",
  "rawKey": "videos/<id>/raw/source.mp4",
  "webhookUrl": "https://example.com/hook"
}
```

Validation notes:

- `webhookUrl` must be `http` or `https`
- internal hostnames like `localhost`, `minio`, `postgres`, `media-server`, `web-api`, `worker`, `.internal`, `.local` are rejected

### `GET /api/videos/:id/status`
Returns the full watch-page state for one active video.

Includes:

- processing phase/progress
- result and thumbnail keys
- transcription and AI statuses
- transcript text, segments, speaker labels
- AI output: title, summary, key points, chapters, entities, action items, quotes
- dead-letter error messages for transcription/AI if present

### `PATCH /api/videos/:id/watch-edits`
Edits watch-page metadata.

Headers:

- `Idempotency-Key`

Body can include one or more of:

```json
{
  "title": "New title",
  "transcriptText": "Edited transcript text",
  "speakerLabels": { "0": "Host", "1": "Guest" }
}
```

Behavior:

- title prefers `ai_outputs.title` if that row exists; otherwise updates `videos.name`
- transcript edits rewrite `transcripts.segments_json` while preserving timing/confidence where possible
- speaker labels update `transcripts.speaker_labels_json`

### `POST /api/videos/:id/delete`
Soft-deletes a video.

Headers:

- `Idempotency-Key`

Behavior:

- sets `videos.deleted_at`
- enqueues `cleanup_artifacts` delayed by 5 minutes

### `POST /api/videos/:id/retry`
Retries failed transcription and/or AI jobs.

Headers:

- `Idempotency-Key`

Behavior:

- resets matching `dead|running|leased` jobs back to `queued`
- resets attempts and clears `last_error`
- updates `videos.transcription_status` / `videos.ai_status` to `queued` when applicable

## Uploads

### `POST /api/uploads/signed`
Returns a signed PUT URL for single-part upload.

Headers:

- `Idempotency-Key`

Body:

```json
{ "videoId": "uuid", "contentType": "video/mp4" }
```

### `POST /api/uploads/complete`
Marks a single-part upload complete and queues `process_video`.

Headers:

- `Idempotency-Key`

Body:

```json
{ "videoId": "uuid" }
```

### `POST /api/uploads/multipart/initiate`
Starts multipart upload.

### `POST /api/uploads/multipart/presign-part`
Returns a signed URL for one part.

### `POST /api/uploads/multipart/complete`
Completes multipart upload and queues `process_video`.

### `POST /api/uploads/multipart/abort`
Aborts a multipart upload.

## Library

### `GET /api/library/videos`
Cursor-paginated listing of non-deleted videos.

Query params:

- `cursor`
- `limit` (1-50, default 24)
- `sort` = `created_desc` | `created_asc`

Response includes:

- `displayTitle`
- `thumbnailKey`
- `hasThumbnail`
- `hasResult`
- `processingPhase`
- `transcriptionStatus`
- `aiStatus`
- `createdAt`
- `durationSeconds`
- `nextCursor`

## Jobs

### `GET /api/jobs/:id`
Returns one job row.

Fields include:

- `id`
- `video_id`
- `job_type`
- `status`
- `attempts`
- `locked_by`
- `locked_until`
- `lease_token`
- `run_after`
- `last_error`
- `updated_at`

## Media-server inbound webhook

### `POST /api/webhooks/media-server/progress`
HMAC-verified progress callback.

Required headers:

- `x-cap-timestamp`
- `x-cap-signature`
- `x-cap-delivery-id`

Payload:

```json
{
  "jobId": "123",
  "videoId": "uuid",
  "phase": "processing",
  "progress": 60,
  "message": "optional",
  "error": "optional",
  "metadata": {
    "duration": 12.34,
    "width": 1920,
    "height": 1080,
    "fps": 29.97
  }
}
```

Behavior:

- verifies timestamp skew
- verifies `v1=<hex>` HMAC signature over `timestamp.rawBody`
- stores dedupe/provenance in `webhook_events`
- updates `videos` only if phase/progress move forward monotonically
- may queue `deliver_webhook` if `webhook_url` exists

## Debug routes

Registered only when `NODE_ENV !== production`.

- `POST /debug/enqueue`
- `GET /debug/job/:id`
- `POST /debug/videos`
- `POST /debug/jobs/enqueue`
- `POST /debug/smoke`
