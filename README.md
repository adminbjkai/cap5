# cap5

Single-tenant video processing platform for uploading or recording video, normalizing it into MP4, generating a transcript with speaker diarization, and producing AI enrichments.

## Repo map

- `apps/web` — React/Vite frontend for library, recording, watch, transcript edits, and review
- `apps/web-api` — Fastify API for videos, uploads, jobs, library, provider status, and inbound media-server webhooks
- `apps/worker` — PostgreSQL-backed async worker
- `apps/media-server` — FFmpeg/ffprobe processing service
- `packages/config` — env parsing and validation
- `packages/db` — DB pool + migrations
- `packages/logger` — structured logging
- `db/migrations` — schema source of truth

## Reality check

The repo directory is `cap5`, but a lot of runtime/config defaults still use `cap4` names today:

- root package name
- `.env.example` DB and bucket defaults
- default `S3_BUCKET`
- frontend storage keys and `/cap4` asset pathing

So treat **cap5 as the repo/project name** and **cap4 as current runtime naming still present in code** until that cleanup is done.

## What works now

- create video records
- signed single-part and multipart uploads to S3-compatible storage
- media normalization through the dedicated media server
- Deepgram transcription with speaker diarization
- editable transcript text and speaker labels in the watch UI
- Groq title / summary / chapters / entities / action items / quotes
- cursor-paginated library
- soft delete with delayed cleanup job
- retry path for eligible transcription / AI jobs
- inbound HMAC-verified media-server progress webhooks
- outbound notification webhooks to per-video `webhookUrl`
- PostgreSQL queue with leases, heartbeats, reclaim, and dead-lettering

## What is intentionally not here

- no auth / authorization
- no multi-tenancy
- no Redis / Kafka
- no signed outbound webhooks
- no active HLS pipeline despite enum/schema surface for it
- no full production platform manifests beyond Docker Compose

## Quick start

### Docker Compose

```bash
cp .env.example .env
# fill in at least: MEDIA_SERVER_WEBHOOK_SECRET, DEEPGRAM_API_KEY, GROQ_API_KEY
make up
make smoke
```

Default URLs:

- Web UI: http://localhost:8022
- API: http://localhost:3000
- Media server: http://localhost:3100
- MinIO API: http://localhost:8922
- MinIO console: http://localhost:8923

### Local, without Docker

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
bash scripts/dev-local.sh
```

That starts:

- API on `:3000`
- worker
- media server on `:3100`
- Vite app on `:5173`

## Common commands

| Command | Purpose |
|---|---|
| `make up` | Build and start the Docker stack |
| `make down` | Stop the Docker stack |
| `make logs` | Tail Docker logs |
| `make migrate` | Run pending DB migrations |
| `make reset-db` | Recreate the DB from scratch |
| `make smoke` | Check `/health` and `/ready` |
| `pnpm build:all` | Build shared packages and apps |
| `pnpm typecheck` | Run TS type checks |
| `pnpm lint` | Run linting |
| `pnpm test` | Run tests |

## Pipeline in 6 steps

1. `POST /api/videos` creates `videos` + `uploads`
2. client uploads raw media via signed single-part or multipart S3 flow
3. API marks upload complete and queues `process_video`
4. worker calls media-server to normalize MP4, thumbnail, and metadata
5. worker queues `transcribe_video`, then `generate_ai` when eligible
6. frontend polls status and shows playback, transcript, edits, and enrichments

## Where to look next

- [docs/system.md](docs/system.md) — how the system actually works
- [docs/development.md](docs/development.md) — run, debug, and change the repo
- [docs/contracts.md](docs/contracts.md) — API/webhook contracts and sensitive rules
- [docs/status.md](docs/status.md) — current gaps and next improvement areas
