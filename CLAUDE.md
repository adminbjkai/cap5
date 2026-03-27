# Working Memory — cap5

**Project:** cap5 — single-tenant video processing platform
**GitHub:** adminbjkai/cap5

---

## Current State

- upload -> process -> transcript -> AI summary flow is fully implemented
- recordings auto-upload after capture; file selections require manual "Upload and process"
- custom video controls, transcript search, confidence review, command palette, speaker diarization, editable speaker labels, and summary enrichments are shipped
- Docker Compose stack is self-bootstrapping via the `migrate` service
- GitHub Actions consolidated into one workflow: `.github/workflows/test.yml`
- No end-user authentication layer — out of scope by design
- Single maintainer: Murry (`@adminbjkai`)

---

## Key Files

### Documentation (`docs/`)

| File | Purpose |
|------|---------|
| `README.md` | Project overview, repo map, quick start |
| `CONTRIBUTING.md` | Dev workflow and contribution guide |
| `docs/system.md` | Runtime topology, pipeline, queue, state model |
| `docs/development.md` | Local dev, env, debugging, safe change workflow |
| `docs/contracts.md` | API/webhook contracts and sensitive rules |
| `docs/status.md` | Current gaps and improvement areas |

### Key Code Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/CommandPalette.tsx` | Command palette modal with keyboard navigation |
| `apps/web/src/components/CustomVideoControls.tsx` | Custom player chrome and transport controls |
| `apps/web/src/components/ShortcutsOverlay.tsx` | In-app keyboard shortcut reference modal |
| `apps/web/src/hooks/useKeyboardShortcuts.ts` | Shared keyboard shortcut registration logic |
| `db/migrations/0005_add_ai_enrichment_fields.sql` | Adds AI enrichment columns: entities/action items/quotes |
| `db/migrations/0006_add_transcript_speaker_labels.sql` | Adds transcript speaker label storage column |
| `docker/postgres/run-migrations.sh` | Migration runner script |
| `scripts/dev-local.sh` | Run all services without Docker |
| `apps/web-api/src/index.ts` | Fastify entry — rate limiting + route modules |
| `apps/web/src/` | React/Vite frontend |

---

## Architecture in 30 Seconds

- **9 Docker services:** postgres + migrate (auto-runs SQL) + minio + minio-setup + web-api + worker + media-server + web-builder + web-internal (nginx)
- **Migrations:** `migrate` service uses `schema_migrations` table to track applied migrations; runs on every `docker compose up`
- **Job queue:** PostgreSQL `FOR UPDATE SKIP LOCKED` — no Redis
- **State machine:** Monotonic `processing_phase_rank`, terminal states: `complete`, `failed`, `cancelled`
- **Webhooks:** inbound progress webhook route exists for signed callbacks; mainline worker flow calls media-server synchronously via `POST /process`
- **AI:** Deepgram (transcription) + Groq (title/summary/chapters)
- **URL routing:** Frontend uses relative `/cap5/...` paths → nginx proxies to MinIO (Docker); Vite dev server proxies to `localhost:9000` (local dev)

---

## URL Configuration

| Env var | Used by | Purpose |
|---------|---------|---------|
| `S3_ENDPOINT` | Backend (server→MinIO) | Internal Docker URL: `http://minio:9000` |
| `S3_PUBLIC_ENDPOINT` | Backend (presigned PUT URLs + dev UI) | Browser-accessible: `http://localhost:8922` |
| `VITE_S3_PUBLIC_ENDPOINT` | Frontend (build-time) | Leave unset for Docker nginx (uses relative path); set to `http://localhost:8922` for Vite dev + Docker infra |

---

## Service Topology

- `web-api` owns HTTP routes, health/readiness, idempotency, and queue enqueue paths
- `worker` claims `job_queue` work with PostgreSQL leasing; calls Deepgram, Groq, and `media-server`
- `media-server` exposes `/health` and `/process`
- Frontend assets built by `web-builder`, served by nginx in `web-internal`
- Incoming media progress route: `POST /api/webhooks/media-server/progress`
- Outgoing user callbacks: `deliver_webhook` jobs to `videos.webhook_url`

---

## Key Domain Terms

| Term | Meaning |
|------|---------|
| `job_status` enum | `queued \| leased \| running \| succeeded \| cancelled \| dead` — no `'failed'` |
| `schema_migrations` | Table tracking which SQL migrations have been applied |
| `migrate` service | Docker Compose service that auto-runs migrations on startup |
| `progress_bucket` | Webhook dedup column — prevents duplicate 10%-bucket updates |
| `delivery_id` | Incoming webhook delivery identifier stored on `webhook_events`, deduped by `(source, delivery_id)` |
| `phase_rank` | Integer enforcing monotonic state transitions |
| `SKIP LOCKED` | PostgreSQL clause for lock-free concurrent job claiming |
| speaker diarization | Per-segment speaker attribution with editable display labels |
| confidence review | Transcript mode focused on low-confidence segments for verification |
| command palette | Global quick-action modal opened via `Cmd+K` / `Ctrl+K` |
