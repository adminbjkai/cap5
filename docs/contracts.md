# Contracts

This is the compact reference for API/webhook behavior that is easy to break accidentally.

Base URL: `http://localhost:3000`

## General conventions

- JSON request/response bodies unless noted
- most mutations require `Idempotency-Key`
- video IDs are UUIDs
- job IDs are numeric
- all non-system routes require authentication (see Auth section below)

## Authentication

All non-system routes require authentication. System routes (`/health`, `/ready`, `/api/system/*`, `/api/webhooks/*`) remain public.

### `GET /api/auth/status`
Returns setup status. Public endpoint.

Response:
```json
{
  "setupRequired": true
}
```

Behavior:
- `setupRequired: true` when zero users exist in the database
- `setupRequired: false` when at least one user has been created

### `POST /api/auth/setup`
Create the initial account. Public endpoint, only works when zero users exist.

Body:
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

Response:
```json
{
  "ok": true,
  "userId": "uuid"
}
```

Behavior:
- succeeds only if zero users exist in the database
- returns 400 if attempted when a user already exists
- hashes password with bcrypt (cost 12)

### `POST /api/auth/login`
Authenticate with email and password. Public endpoint.

Body:
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

Response:
```json
{
  "ok": true,
  "token": "eyJ...",
  "expiresIn": "7d"
}
```

Behavior:
- returns 401 on invalid email or password
- sets `cap5_token` as an httpOnly, Secure, SameSite=Strict cookie
- token is a JWT signed with HS256, valid for 7 days by default

### `POST /api/auth/logout`
Clear authentication. Public endpoint (idempotent).

Response:
```json
{
  "ok": true
}
```

Behavior:
- clears the `cap5_token` httpOnly cookie
- always succeeds, even if not authenticated

### `GET /api/auth/me`
Get authenticated user info. Requires authentication.

Response:
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "createdAt": "2026-04-04T12:30:00Z"
}
```

Behavior:
- requires valid JWT in `Authorization: Bearer <token>` header or `cap5_token` cookie
- returns 401 if not authenticated
- returns 500 if user record no longer exists (shouldn't happen in normal operation)

### Authentication headers

Protected routes accept tokens in one of two ways:

1. **Authorization header:**
   ```
   Authorization: Bearer eyJ...
   ```

2. **httpOnly cookie:**
   ```
   Cookie: cap5_token=eyJ...
   ```

The cookie is set by `POST /api/auth/login` and is the browser's automatic transport mechanism.

## Versioning and change policy

- the API is currently unversioned and flat under `/api/...`
- the `0.1.0` values exposed in health metadata are informational build metadata, not a route-contract guarantee
- prefer additive changes first: new optional fields, new endpoints, or behavior behind existing tolerant clients
- if a breaking contract change becomes unavoidable, stage it behind a new route shape or explicit `/api/v2` namespace instead of silently mutating existing consumers
- keep `Idempotency-Key`, `x-cap-*` inbound webhook headers, and `application/cap5-webhook+json` stable unless there is a deliberate compatibility break
- update this file whenever an external request, response, header, or webhook behavior changes in a consumer-visible way

## Contract changelog

This is not a release log. It only records consumer-visible API and webhook changes that matter for compatibility.

| Date | Change | Compatibility note |
|---|---|---|
| 2026-03-27 | Canonical inbound webhook content type set to `application/cap5-webhook+json`. | Breaking for senders still posting the old media type. |
| 2026-03-27 | `x-cap-timestamp`, `x-cap-signature`, and `x-cap-delivery-id` retained as the stable inbound webhook header contract. | Compatible; header names did not change during `cap5` normalization. |

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
