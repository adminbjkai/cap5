# cap5

Single-tenant video processing platform for uploading or recording video, processing it into a normalized MP4, generating a transcript with speaker diarization, and producing AI enrichments.

## What is in the repo

- `apps/web` — React/Vite watch app and recording UI
- `apps/web-api` — Fastify API for videos, uploads, jobs, library, provider status, and inbound media-server webhooks
- `apps/worker` — PostgreSQL-backed job worker
- `apps/media-server` — FFmpeg-based processing service
- `packages/config` — runtime environment parsing with Zod
- `packages/db` — pooled PostgreSQL access + migration runner
- `packages/logger` — structured logger helper
- `db/migrations` — SQL schema and incremental migrations

## Current capabilities

- Create video records and upload via signed single-part PUT or S3 multipart upload
- In-browser screen recording flow in the web app
- Media processing through the dedicated media server
- Deepgram transcription with diarization and editable speaker labels
- Groq summary generation with title, summary, chapters, entities, action items, and quotes
- Cursor-paginated library view
- Soft delete with delayed artifact cleanup
- Retry failed transcription/AI jobs
- Provider status endpoint for Deepgram and Groq
- Inbound HMAC-verified media-server progress webhooks
- Outbound notification webhooks to a per-video `webhookUrl`
- PostgreSQL job queue with leases, heartbeats, reclaim, and dead-lettering

## What it does not do

- No user auth or multi-tenant isolation
- No Redis/Kafka queue
- No signed outbound customer webhooks
- No HLS packaging path in the active pipeline despite `source_type` enum support
- No production deployment manifests beyond Docker Compose + docs

## Quick start

### Docker Compose

```bash
cp .env.example .env
# fill in at least: MEDIA_SERVER_WEBHOOK_SECRET, DEEPGRAM_API_KEY, GROQ_API_KEY
make up
make smoke
```

Service URLs by default:

- Web app (nginx): http://localhost:8022
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
- Worker
- Media server on `:3100`
- Vite web app on `:5173`

## Common commands

| Command | Purpose |
|---|---|
| `make up` | Build and start the Docker stack |
| `make down` | Stop the Docker stack |
| `make logs` | Tail Docker logs |
| `make migrate` | Run pending DB migrations |
| `make reset-db` | Recreate the database from scratch |
| `make smoke` | Check `/health` and `/ready` |
| `pnpm build:all` | Build shared packages and all apps |
| `pnpm test` | Run workspace tests |
| `pnpm typecheck` | Run workspace type checks |
| `pnpm lint` | Run linting |

## Docs

- [docs/architecture.md](docs/architecture.md)
- [docs/api.md](docs/api.md)
- [docs/database.md](docs/database.md)
- [docs/worker.md](docs/worker.md)
- [docs/environment.md](docs/environment.md)
- [docs/local-dev.md](docs/local-dev.md)
- [docs/deployment.md](docs/deployment.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/security.md](docs/security.md)
- [docs/design-system.md](docs/design-system.md)
- [docs/tech-stack.md](docs/tech-stack.md)
- [docs/tasks.md](docs/tasks.md)
- [docs/master-plan.md](docs/master-plan.md)
- [docs/qa.md](docs/qa.md)
