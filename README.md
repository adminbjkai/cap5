# cap5

Single-tenant video processing platform — upload a recording, get back a transcript, AI-generated summary, chapters, and enrichments.

## Features

- **Upload flow** — singlepart or multipart upload to S3-compatible storage (MinIO)
- **Video processing** — FFmpeg-based transcoding via a dedicated media-server RPC service
- **Transcription** — Deepgram with speaker diarization; editable speaker labels
- **AI enrichment** — Groq-powered title, summary, chapters, entities, action items, and quotes
- **React watch app** — custom video controls, command palette (`Cmd+K`), keyboard shortcuts, transcript review, confidence highlighting, dark/light theme
- **PostgreSQL job queue** — `FOR UPDATE SKIP LOCKED`, no Redis required
- **HMAC-signed webhooks** — inbound progress callbacks with timestamp validation and deduplication
- **Idempotent API** — all mutations require `Idempotency-Key`
- **In-browser screen recording** — auto-uploads immediately after capture

## Quick Start

```bash
cp .env.example .env
# Fill in at least DEEPGRAM_API_KEY and GROQ_API_KEY
make up
```

Migrations run automatically on first boot. When the stack is healthy:

```bash
make smoke
```

## Service Ports

| Service         | URL                              | Notes                          |
|-----------------|----------------------------------|--------------------------------|
| Web app         | http://localhost:8022            | nginx serving built frontend   |
| API             | http://localhost:3000            | Fastify — `/health`, `/ready`  |
| MinIO API       | http://localhost:8922            | S3-compatible object storage   |
| MinIO console   | http://localhost:8923            | Bound to localhost only        |
| Media server    | http://localhost:3100            | Internal FFmpeg RPC            |

## Key Dev Commands

| Command                                  | What it does                                  |
|------------------------------------------|-----------------------------------------------|
| `make up`                                | Build and start all 9 Docker services         |
| `make down`                              | Stop all services (preserves volumes)         |
| `make logs`                              | Tail logs for all services                    |
| `make smoke`                             | Verify `/health` and `/ready` are up          |
| `make migrate`                           | Re-run migrations against a running database  |
| `make reset-db`                          | Wipe volumes and restart from scratch         |
| `make help`                              | List all Makefile targets                     |
| `pnpm lint`                              | ESLint across the workspace                   |
| `pnpm typecheck`                         | TypeScript type-check across the workspace    |
| `pnpm test`                              | Unit tests across the workspace               |
| `pnpm --filter @cap/web test:e2e`        | Web Playwright E2E suite                      |
| `pnpm --filter @cap/web-api test:e2e`    | API Playwright E2E suite                      |

## Documentation

| File                                         | Description                                               |
|----------------------------------------------|-----------------------------------------------------------|
| [docs/architecture.md](docs/architecture.md) | System design, service topology, state machine, data flow |
| [docs/api.md](docs/api.md)                   | HTTP endpoints and webhook contract                       |
| [docs/worker.md](docs/worker.md)             | Worker module structure, job types, leasing, retries      |
| [docs/database.md](docs/database.md)         | Tables, enums, indexes, and migration list                |
| [docs/environment.md](docs/environment.md)   | All environment variables with descriptions               |
| [docs/security.md](docs/security.md)         | HMAC signing, rate limiting, S3 access, no-auth rationale |
| [docs/local-dev.md](docs/local-dev.md)       | Docker and no-Docker local setup                          |
| [docs/deployment.md](docs/deployment.md)     | Production deployment guide                               |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues and fixes                             |
| [docs/design-system.md](docs/design-system.md) | UI tokens and component guide                          |
| [docs/tech-stack.md](docs/tech-stack.md)     | Languages, frameworks, and versions                       |
| [docs/agents.md](docs/agents.md)             | AI agent roles and conventions                            |
