# Database

The schema is defined by SQL migrations in `db/migrations`.

## Tables

### `videos`
Canonical per-video state.

Important columns:

- `id` UUID PK
- `name`
- `source_type`
- `processing_phase`
- `processing_phase_rank`
- `processing_progress`
- `transcription_status`
- `ai_status`
- `duration_seconds`, `width`, `height`, `fps`
- `result_key`, `thumbnail_key`
- `webhook_url`
- `deleted_at`
- `error_code`, `error_message`
- timestamps

Notes:

- `processing_phase_rank` is constrained to match the enum phase
- soft delete is implemented via `deleted_at`

### `uploads`
One row per video upload lifecycle.

Important columns:

- `video_id` PK/FK
- `mode` = `singlepart|multipart`
- `phase`
- `multipart_upload_id`
- `raw_key`
- `uploaded_bytes`, `total_bytes`
- `etag_manifest`

### `job_queue`
PostgreSQL-backed work queue.

Important columns:

- `id` bigserial PK
- `video_id`
- `job_type`
- `status`
- `priority`
- `payload`
- `attempts`, `max_attempts`
- `run_after`
- lease fields: `locked_by`, `locked_until`, `lease_token`
- `last_error`
- timestamps

Important indexes/constraints:

- claim index on `(status, priority desc, run_after, id)`
- partial unique index to allow only one active job per `(video_id, job_type)` for `queued|leased|running`

### `transcripts`
Stored transcription outputs.

Columns:

- `video_id` PK/FK
- `provider`
- `language`
- `vtt_key`
- `segments_json`
- `speaker_labels_json`
- timestamps

### `ai_outputs`
Stored AI enrichment outputs.

Columns:

- `video_id` PK/FK
- `provider`
- `model`
- `title`
- `summary`
- `chapters_json`
- `entities_json`
- `action_items_json`
- `quotes_json`
- timestamps

### `idempotency_keys`
Caches mutation responses by endpoint + key.

Columns:

- `endpoint`
- `idempotency_key`
- `request_hash`
- `status_code`
- `response_headers`
- `response_body`
- `created_at`
- `expires_at`

### `webhook_events`
Inbound media-server webhook ledger.

Columns:

- `source`
- `delivery_id`
- `job_id`
- `video_id`
- `phase`
- `phase_rank`
- `progress`
- `progress_bucket`
- `payload`
- `signature`
- `accepted`
- `reject_reason`
- timestamps

Dedupe indexes:

- unique `(source, delivery_id)`
- unique `(source, job_id, phase, progress_bucket)`

## Enums

Key enums currently present:

- `source_type`
- `upload_mode`
- `upload_phase`
- `processing_phase`
- `transcription_status`
- `ai_status`
- `job_type`
- `job_status`
- `ai_provider`

## Migrations present

1. `0001_init.sql` — core schema
2. `0002_video_soft_delete.sql` — adds `deleted_at`
3. `0003_add_webhook_reporting.sql` — adds `webhook_url`, `deliver_webhook` job type
4. `0004_fix_transcript_language.sql` — backfills and constrains transcript language
5. `0005_add_ai_enrichment_fields.sql` — entities/action items/quotes
6. `0006_add_transcript_speaker_labels.sql` — speaker label storage
