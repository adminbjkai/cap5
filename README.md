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

## What works now

- create video records
- signed single-part and multipart uploads to S3-compatible storage
- media normalization through the dedicated media server
- Deepgram transcription with speaker diarization
- editable transcript text, speaker labels, server-backed operator notes, and selected-speaker-sequence playback in the watch UI
- Groq title / summary / chapters / entities / action items / quotes
- cursor-paginated library
- soft delete with delayed cleanup job
- retry path for eligible transcription / AI jobs
- inbound HMAC-verified media-server progress webhooks
- outbound notification webhooks to per-video `webhookUrl` with HMAC headers (`x-cap-timestamp`, `x-cap-signature`, `x-cap-delivery-id`)
- PostgreSQL queue with leases, heartbeats, reclaim, and dead-lettering
- `cap5` runtime naming across defaults, paths, local state, and webhook media type
- single-user email/password auth with stateless JWT (httpOnly cookies)

## What is intentionally not here

- no multi-tenancy
- no Redis / Kafka
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
| `make reset-db` | Recreate the DB from scratch (wipes volumes) |
| `make smoke` | Check `/health` and `/ready` |
| `make prune` | Remove containers, volumes, orphans, and build cache |
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

- [docs/system.md](docs/system.md) — runtime topology, architecture decisions, and capacity guidance
- [docs/development.md](docs/development.md) — run, debug, incident response, and safe repo changes
- [docs/contracts.md](docs/contracts.md) — API/webhook contracts, versioning stance, and contract changelog
- [docs/status.md](docs/status.md) — current gaps and next improvement areas
- [docs/auth-plan.md](docs/auth-plan.md) — current auth status and constraints
- [docs/review-auth-system.md](docs/review-auth-system.md) — dated auth-system code-review snapshot
- [docs/review-2026-04-10.md](docs/review-2026-04-10.md) — dated full-repo review + changelog (most recent)
