# Development

This is the day-to-day guide for running, debugging, and changing the repo.

## Prerequisites

For local non-Docker development you need:

- Node 20+
- pnpm 9+
- PostgreSQL 16
- MinIO or another S3-compatible store
- FFmpeg / ffprobe

For the simplest path, use Docker Compose.

## Setup paths

### Docker Compose (recommended)

```bash
cp .env.example .env
# fill in at least: MEDIA_SERVER_WEBHOOK_SECRET, DEEPGRAM_API_KEY, GROQ_API_KEY
make up
make smoke
```

Stack services:

| Service | Purpose | Port |
|---|---|---|
| postgres | PostgreSQL 16 database | 5432 |
| migrate | Runs SQL migrations (one-shot) | — |
| minio | S3-compatible object storage | 8922 (API), 8923 (console) |
| minio-setup | Creates bucket + CORS (one-shot) | — |
| web-api | Fastify API server | 3000 |
| worker | Background job processor | — |
| media-server | FFmpeg video processing | 3100 |
| web-builder | Builds React SPA (one-shot) | — |
| web-internal | nginx reverse proxy + SPA | 8022 |

Default URLs:

- Web UI: http://localhost:8022
- API: http://localhost:3000
- Media server: http://localhost:3100
- MinIO API: http://localhost:8922
- MinIO console: http://localhost:8923

### Local, no Docker

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
bash scripts/dev-local.sh
```

The script accepts a mode argument to start specific services:

```bash
bash scripts/dev-local.sh          # all services (default)
bash scripts/dev-local.sh all      # same as above
bash scripts/dev-local.sh api      # web-api only (port 3000)
bash scripts/dev-local.sh worker   # worker only
bash scripts/dev-local.sh media-server  # media-server only (port 3100)
bash scripts/dev-local.sh web      # Vite dev server only (port 5173)
bash scripts/dev-local.sh migrate  # run migrations only
```

Local env overrides (set in `.env` or export):

```bash
DATABASE_URL=postgres://app:app@localhost:5432/cap5
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
MEDIA_SERVER_BASE_URL=http://localhost:3100
```

## Important env vars

Canonical sources:

- `.env.example`
- `packages/config/src/index.ts`

### Required secrets

| Var | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | HMAC signing key for JWT tokens. Min 32 chars. Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` or `openssl rand -base64 32` |
| `MEDIA_SERVER_WEBHOOK_SECRET` | Min 32 chars. Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `DEEPGRAM_API_KEY` | Deepgram API key for transcription |
| `GROQ_API_KEY` | Groq API key for AI enrichments |
| `S3_ACCESS_KEY` | MinIO/S3 access key |
| `S3_SECRET_KEY` | MinIO/S3 secret key |

### Runtime config

| Var | Default | Notes |
|---|---|---|
| `WEB_API_PORT` | 3000 | API listen port |
| `JWT_EXPIRES_IN` | 7d | JWT token lifetime (e.g. "7d", "24h", "1w") |
| `MEDIA_SERVER_PORT` | 3100 | Media-server listen port |
| `MEDIA_SERVER_BASE_URL` | http://media-server:3100 | Worker → media-server URL |
| `S3_ENDPOINT` | http://minio:9000 | Internal S3 endpoint (server-side) |
| `S3_PUBLIC_ENDPOINT` | http://localhost:8922 | Browser-facing S3 endpoint (signed URLs) |
| `S3_BUCKET` | cap5 | S3 bucket name |
| `S3_REGION` | us-east-1 | S3 region |
| `S3_FORCE_PATH_STYLE` | true | Required for MinIO |
| `LOG_LEVEL` | info | trace, debug, info, warn, error |
| `LOG_PRETTY` | — | Set to `true` for human-readable logs in dev |
| `WEBHOOK_MAX_SKEW_SECONDS` | 300 | Max timestamp skew for inbound webhooks |
| `OUTBOUND_WEBHOOK_SECRET` | — | Optional secret for signing outbound user webhooks; falls back to `MEDIA_SERVER_WEBHOOK_SECRET` |

### Worker tuning

| Var | Default | Notes |
|---|---|---|
| `WORKER_ID` | worker-1 | Unique identifier per worker instance |
| `WORKER_MAX_ATTEMPTS` | 6 | Max retries before dead-lettering |
| `WORKER_LEASE_SECONDS` | 60 | Job lock duration |
| `WORKER_POLL_MS` | 2000 | Poll interval between claim attempts |
| `WORKER_HEARTBEAT_MS` | 15000 | Heartbeat interval to extend lease |
| `WORKER_RECLAIM_MS` | 10000 | Interval to reclaim expired leases |
| `WORKER_CLAIM_BATCH_SIZE` | 5 | Exists in config but loop claims one at a time |

### Provider config

| Var | Default | Notes |
|---|---|---|
| `DEEPGRAM_MODEL` | nova-2 | Deepgram transcription model |
| `DEEPGRAM_BASE_URL` | https://api.deepgram.com | Deepgram API endpoint |
| `GROQ_MODEL` | llama-3.3-70b-versatile | Groq chat completion model |
| `GROQ_BASE_URL` | https://api.groq.com/openai/v1 | Groq API endpoint |
| `PROVIDER_TIMEOUT_MS` | 45000 | Timeout for Deepgram and Groq calls |

### Frontend build-time vars

These use the `VITE_` prefix and are baked in at build time, not read at runtime:

| Var | Notes |
|---|---|
| `VITE_S3_PUBLIC_ENDPOINT` | Set when running `pnpm dev` against Docker MinIO (e.g. `http://localhost:8922`). Leave unset for production — the frontend falls back to relative paths (`/cap5/...`) which nginx proxies to MinIO. |
| `VITE_S3_BUCKET` | Defaults to `cap5` |

## Common commands

### Docker

```bash
make up           # build and start all services
make down         # stop all services (preserves data volumes)
make logs         # tail all service logs (last 200 lines)
make migrate      # re-run migrations against running DB
make reset-db     # DESTRUCTIVE: wipe all volumes and rebuild from scratch
make smoke        # check /health and /ready endpoints
make prune        # DESTRUCTIVE: remove containers, volumes, orphans, and build cache
```

### Complete Docker cleanup

To completely remove everything (containers, volumes, images, build cache):

```bash
make prune                          # removes containers, volumes, orphans, build cache
docker rmi $(docker images 'cap5-*' -q) 2>/dev/null   # remove cap5 images
```

Or manually:

```bash
docker compose down -v --remove-orphans   # stop + remove volumes
docker builder prune -f                   # clear build cache
docker image prune -f                     # remove dangling images
```

### Development

```bash
pnpm install          # install all dependencies
pnpm build:all        # build shared packages then all apps
pnpm typecheck        # run TS type checks across all packages
pnpm lint             # lint all packages
pnpm test             # run all unit tests
pnpm db:migrate       # run pending migrations (local)

pnpm dev:web-api      # start API in watch mode
pnpm dev:worker       # start worker in watch mode
pnpm dev:media-server # start media-server in watch mode
pnpm dev:web          # start Vite dev server
```

### Testing

```bash
pnpm test                                  # all unit tests
pnpm --filter @cap/web test               # frontend tests only
pnpm --filter @cap/worker test            # worker tests only
pnpm --filter @cap/web-api test:e2e       # API E2E (needs running stack)
pnpm --filter @cap/web-api test:integration  # API integration tests
pnpm --filter @cap/web test:e2e           # frontend E2E (Playwright)
```

## Fast debugging checklist

### API won't start

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
- free disk under `/tmp` (media-server uses `/tmp/cap5-media/<videoId>`)

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

## Incident response runbook

This is the first-response checklist for production-style failures. Start by capturing the affected `videoId`, any `jobId`, timestamps, and the failing route or service before you restart anything.

### API unavailable or unhealthy

Check:

- `GET /health`
- `GET /ready`
- API logs
- database reachability and env validation errors

Mitigate:

- restore database connectivity first if readiness is failing
- restart `web-api` only after dependency failures are understood
- treat `GET /api/system/provider-status` returning `503` as degraded provider visibility, not necessarily a full API outage

### Queue stuck or uploads complete with no progress

Check:

- worker logs
- `GET /api/jobs/:id` for the affected job when you have one
- `job_queue` for rows stuck in `queued`, `leased`, `running`, or `dead`
- whether the worker is logging `worker.health.degraded`

Mitigate:

- restore worker execution first
- if `process_video` is blocked by media-server health, recover media-server before retrying videos
- use `POST /api/videos/:id/retry` only after the underlying failure is fixed

### Media-server unhealthy

Check:

- `curl http://localhost:3100/health`
- media-server logs
- FFmpeg / ffprobe availability
- S3/MinIO reachability
- free space under `/tmp` because media-server uses `/tmp/cap5-media/<videoId>`

Mitigate:

- restore FFmpeg availability or temporary disk capacity
- restart media-server after the local failure is corrected
- expect worker to keep skipping `process_video` jobs while media-server stays unhealthy

### Database unavailable or leases expiring

Check:

- PostgreSQL process health
- worker logs for `db.waiting`, reclaim churn, or repeated lease-loss failures
- whether jobs are being reclaimed into `queued` or `dead`

Mitigate:

- restore PostgreSQL before restarting workers
- once the database is stable, let reclaim settle and then retry only the videos that truly exhausted their attempt budget
- escalate immediately if data correctness is uncertain, not just job liveness

### Deepgram or Groq degraded

Check:

- `GET /api/system/provider-status`
- worker logs for provider timeouts or auth failures
- provider API keys and base URLs in env

Mitigate:

- avoid mass retries while the provider is still failing
- let transient failures consume normal retry behavior
- once the provider recovers, retry only affected videos that ended in a recoverable failed state

### Webhook failures

Check:

- required headers: `x-cap-timestamp`, `x-cap-signature`, `x-cap-delivery-id`
- timestamp skew
- HMAC signature
- request content type and JSON shape
- `webhook_events` rows for accepted/rejected deliveries

Mitigate:

- fix the sender first; replaying a malformed webhook will not help
- if progress is already reflected on the video row, do not force duplicate deliveries
- outbound user webhooks are signed too; check the raw body plus `x-cap-timestamp`, `x-cap-signature`, and `x-cap-delivery-id` before assuming transport-only failure

### After stabilization

- capture the exact failure mode, affected IDs, and timestamps
- document whether the problem was dependency, capacity, config, or code
- add or update tests and docs if the incident exposed a blind spot

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
- watch-page editing (including operator notes and selected-speaker-sequence playback filtering)
