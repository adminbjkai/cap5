# Worker

The worker is in `apps/worker`.

## Responsibilities

- claim jobs from PostgreSQL
- maintain leases via heartbeat
- reclaim expired leases
- execute handlers
- retry transient failures
- mark terminal failures when retry budget is exhausted

## Current job handlers

### `process_video`

- reads raw upload key
- transitions processing phases
- calls media-server `/process`
- stores result/thumbnail/metadata on `videos`
- queues `transcribe_video` if audio exists
- otherwise marks `no_audio` / `skipped`

### `transcribe_video`

- downloads processed media
- extracts audio when possible
- calls Deepgram
- writes `transcripts`
- stores VTT in object storage
- queues `generate_ai`
- may queue `deliver_webhook`

### `generate_ai`

- reads transcript segments
- builds transcript text
- calls Groq
- writes `ai_outputs`
- may queue `deliver_webhook`

### `cleanup_artifacts`

- scheduled after soft delete
- intended to remove associated storage artifacts

### `deliver_webhook`

- POSTs plain JSON to stored `webhookUrl`
- retries according to normal job semantics

## Queue behavior

The worker loop:

- waits for DB readiness
- periodically reclaims expired leases
- periodically runs maintenance
- skips `process_video` claims when media server health is bad
- polls every `WORKER_POLL_MS`

## Failure behavior

- handler exceptions call `fail(...)`
- transient failures are requeued
- exhausted failures go `dead`
- terminal failures may update video state through shared handler helpers

## Operational notes

- `WORKER_CLAIM_BATCH_SIZE` exists in env parsing, but the current main loop claims one job at a time through `claimOne(...)`
- long-running jobs rely on heartbeats to keep leases alive
