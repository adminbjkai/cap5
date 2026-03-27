# Contracts

This is the compact reference for API/webhook behavior that is easy to break accidentally.

Base URL: `http://localhost:3000`

## General conventions

- JSON request/response bodies unless noted
- most mutations require `Idempotency-Key`
- video IDs are UUIDs
- job IDs are numeric
- there is no auth layer today

## Health and system

### `GET /health`
Liveness endpoint.

### `GET /ready`
Readiness endpoint from the API health plugin.

### `GET /api/system/provider-status`
Returns observed/configured status for Deepgram and Groq.

## Videos

### `POST /api/videos`
Creates a `videos` row and matching `uploads` row.

Body:

```json
{
  "name": "Optional title",
  "webhookUrl": "https://example.com/hook"
}
```

Rules:

- requires `Idempotency-Key`
- `webhookUrl` must use `http` or `https`
- obvious local/internal targets are blocked, including `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, several service names, `.internal`, and `.local`

### `GET /api/videos/:id/status`
Returns the watch-page payload for one active video.

Includes:

- processing phase/progress
- result and thumbnail keys
- transcription and AI statuses
- transcript text, segments, speaker labels
- AI output with title, summary, key points, chapters, entities, action items, quotes
- dead-letter error messages for transcription / AI when present

### `PATCH /api/videos/:id/watch-edits`
Editable watch-page metadata.

Body can include:

```json
{
  "title": "New title",
  "transcriptText": "Edited transcript text",
  "speakerLabels": { "0": "Host", "1": "Guest" }
}
```

Behavior:

- requires `Idempotency-Key`
- at least one field must be present
- title updates `ai_outputs.title` when that row exists, otherwise `videos.name`
- transcript edits rewrite `transcripts.segments_json` while preserving timing/confidence when possible
- speaker labels update `transcripts.speaker_labels_json`

### `POST /api/videos/:id/delete`
Soft delete.

Behavior:

- requires `Idempotency-Key`
- sets `videos.deleted_at`
- queues `cleanup_artifacts` delayed by 5 minutes

### `POST /api/videos/:id/retry`
Retry path for transcription / AI work.

Important nuance:

- this is **not** a generic restart-everything endpoint
- it re-queues eligible existing transcription/AI jobs when present
- it only resets matching `dead|running|leased` jobs
- it does not recreate uploads
- it does not rerun already-completed media processing

## Uploads

### `POST /api/uploads/signed`
Returns a signed single-part PUT URL.

Body:

```json
{ "videoId": "uuid", "contentType": "video/mp4" }
```

Notes:

- `contentType` is optional in code and defaults to `application/octet-stream`
- requires `Idempotency-Key`

### `POST /api/uploads/complete`
Marks single-part upload complete and queues `process_video`.

### `POST /api/uploads/multipart/initiate`
Starts multipart upload.

### `POST /api/uploads/multipart/presign-part`
Returns a signed URL for one part.

### `POST /api/uploads/multipart/complete`
Completes multipart upload and queues `process_video`.

### `POST /api/uploads/multipart/abort`
Aborts multipart upload.

## Library

### `GET /api/library/videos`
Cursor-paginated listing of non-deleted videos.

Query params:

- `cursor`
- `limit` (`1..50`, default `24`)
- `sort` = `created_desc` | `created_asc`

## Jobs

### `GET /api/jobs/:id`
Returns one job queue row.

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

## Inbound media-server webhook

### `POST /api/webhooks/media-server/progress`
Progress callback authenticated with HMAC.

Required headers:

- `x-cap-timestamp`
- `x-cap-signature`
- `x-cap-delivery-id`

Payload shape:

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
- verifies `v1=<hex>` HMAC over `timestamp.rawBody`
- stores dedupe/provenance in `webhook_events`
- updates `videos` only when phase/progress move forward monotonically
- may queue outbound `deliver_webhook`

Canonical content type is `application/cap5-webhook+json`.

## Outbound webhook events

Current outbound events:

- `video.progress`
- `video.transcription_complete`
- `video.ai_complete`

Important security note:

- outbound webhooks are currently plain JSON POSTs
- they are **not signed** today

## Security-sensitive rules to remember

- mutation endpoints lean on `Idempotency-Key`
- inbound media-server webhook uses HMAC + timestamp skew enforcement + timing-safe comparison
- create-video `webhookUrl` validation blocks some obvious internal/local targets, but this should not be treated as a complete outbound request policy
- progress updates are protected by a monotonic phase/progress guard

## Debug routes

Only registered when `NODE_ENV !== production`:

- `POST /debug/enqueue`
- `GET /debug/job/:id`
- `POST /debug/videos`
- `POST /debug/jobs/enqueue`
- `POST /debug/smoke`
