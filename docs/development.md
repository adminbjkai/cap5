# Development

This is the day-to-day guide for running, debugging, and changing the repo.

## Prerequisites

For local non-Docker development you need:

- Node 20+
- pnpm
- PostgreSQL
- MinIO or another S3-compatible store
- FFmpeg / ffprobe

For the simplest path, use Docker Compose.

## Setup paths

### Docker Compose

```bash
cp .env.example .env
make up
make smoke
```

Stack includes:

- postgres
- migrate job
- minio
- minio setup job
- web-api
- worker
- media-server
- web-builder
- web-internal

### Local, no Docker

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
bash scripts/dev-local.sh
```

Useful modes:

```bash
bash scripts/dev-local.sh all
bash scripts/dev-local.sh api
bash scripts/dev-local.sh worker
bash scripts/dev-local.sh media-server
bash scripts/dev-local.sh web
bash scripts/dev-local.sh migrate
```

## Important env vars

Canonical sources:

- `.env.example`
- `packages/config/src/index.ts`

Critical vars:

- `DATABASE_URL`
- `MEDIA_SERVER_WEBHOOK_SECRET` (min 32 chars)
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

Important runtime vars:

- `WEB_API_PORT`
- `MEDIA_SERVER_PORT`
- `MEDIA_SERVER_BASE_URL`
- `S3_ENDPOINT`
- `S3_PUBLIC_ENDPOINT`
- `S3_BUCKET` (currently defaults to `cap4` in code)
- `WORKER_MAX_ATTEMPTS`
- `WORKER_POLL_MS`
- `WORKER_HEARTBEAT_MS`
- `WORKER_RECLAIM_MS`

Frontend build-time vars used separately from `@cap/config`:

- `VITE_S3_PUBLIC_ENDPOINT`
- `VITE_S3_BUCKET`

## Common commands

```bash
make up
make down
make logs
make migrate
make reset-db
make smoke

pnpm build:all
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @cap/web test:e2e
pnpm --filter @cap/web-api test:e2e
pnpm --filter @cap/web-api test:integration
```

## Fast debugging checklist

### API won’t start

Check:

- `.env` exists
- `DATABASE_URL` is valid
- `MEDIA_SERVER_WEBHOOK_SECRET` is at least 32 chars
- provider keys are set

The config package fails fast on invalid env, so startup errors are usually explicit.

### Upload finishes but nothing processes

Check:

- upload completion endpoint returned a `jobId`
  - single-part: `/api/uploads/complete`
  - multipart: `/api/uploads/multipart/complete`
- worker is running
- `GET /api/jobs/:id`
- `job_queue.last_error`

### Media processing fails

Check:

- `curl http://localhost:3100/health`
- media-server logs
- worker logs
- FFmpeg availability
- S3/MinIO reachability

### Transcript missing

Check:

- `videos.transcription_status`
- Deepgram key/config
- whether processing marked the video as `no_audio`
- worker logs for transcription path

### AI missing

Check:

- `videos.ai_status`
- Groq key/config
- transcript exists and is non-empty
- worker logs for AI path

### Webhook rejected

Check:

- required headers exist
- timestamp skew
- HMAC signature
- `videoId` / phase validity
- `webhook_events` entries and API logs

## How to change the repo safely

### If you change schema

- add a migration under `db/migrations/`
- keep docs aligned in `docs/system.md` or `docs/contracts.md` if behavior changes

### If you change env/config

- update `.env.example`
- update `packages/config/src/index.ts`
- update this doc only at the level of critical developer-facing guidance

### If you change routes or payloads

- update `docs/contracts.md`
- update tests in `apps/web-api/tests/` or frontend API consumers as needed

### If you change worker behavior

- update `docs/system.md`
- cover handler behavior with tests where practical

## Verification before merging changes

Run at least:

```bash
pnpm build:all
pnpm typecheck
pnpm lint
pnpm test
```

Add targeted E2E/integration runs when you touch:

- upload flow
- queue behavior
- transcription / AI pipeline
- webhooks
- watch-page editing
