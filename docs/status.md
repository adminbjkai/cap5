# Status

This file is the practical snapshot: what is true now, what is missing, and what should probably happen next.

## Current state

What works:

- upload -> process -> transcript -> AI pipeline
- single-part and multipart uploads
- watch-page transcript edits and speaker-label edits
- soft delete path
- queue-based retries for some eligible transcription / AI jobs
- provider status endpoint
- inbound webhook verification for media-server progress callbacks

What is still rough:

- outbound webhooks are unsigned
- no auth / authz
- no real production deployment story beyond Compose
- no active HLS path despite schema hints

## Quality snapshot

Automated coverage exists for:

- web app component tests
- web app Playwright specs
- API E2E around jobs, library, uploads, videos, webhooks
- API integration flow
- provider tests for Deepgram and Groq

Highest-risk gaps:

- delete + cleanup lifecycle
- retry semantics around `dead` / `running` jobs
- outbound webhook delivery behavior
- full browser recording flow E2E
- queue reclaim/dead-letter edge cases

## Next improvement areas

### 1. Security baseline

- add auth / authorization
- sign outbound webhooks
- strengthen outbound request policy beyond current create-time webhook URL checks
- review MinIO exposure defaults for anything beyond local/dev use

### 2. Queue and workflow resilience

- add tests for delete + cleanup artifacts
- add tests for retry semantics
- add tests for reclaim / expired leases / terminal failure transitions
- decide whether `WORKER_CLAIM_BATCH_SIZE` should be used or removed

### 3. Frontend quality

- cover recording flow end-to-end
- improve error handling around dead jobs and degraded providers
- make processing/retry states clearer in the UI

### 4. Deployment/ops

- add a real production topology story
- add observability guidance
- add backup / restore guidance
- add storage lifecycle/retention guidance

## Not a current truth source

Do not treat old roadmap-style docs as source of truth. The best code-level anchors remain:

- `db/migrations/`
- `packages/config/src/index.ts`
- `apps/web-api/src/routes/`
- `apps/worker/src/handlers/`
- `docker-compose.yml`
