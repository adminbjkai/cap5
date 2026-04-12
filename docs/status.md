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
- signed outbound user webhooks
- login throttling and auth event logging
- server-backed operator notes on the watch page
- stabilized right-rail tab rendering to prevent overlapping panel content across browsers
- speaker filtering now live-syncs transcript visibility with selected-speaker-sequence playback

What is still rough:

- no real production deployment story beyond Compose
- no active HLS path despite schema hints
- worker throughput scaling is still intentionally simple

## Quality snapshot

Automated coverage exists for:

- web app component tests
- web app Playwright specs
- API E2E around jobs, library, uploads, videos, webhooks
- API integration flow
- provider tests for Deepgram and Groq
- worker tests for outbound webhook signing and delivery
- worker tests for queue failure transitions and cleanup lifecycle
- worker tests for `claimOne()` and `reclaimExpiredLeases()` (parameters, SQL path, batch-size env)
- API unit tests for login throttling behavior
- web unit tests for speaker-filter chip `aria-pressed` toggle state
- web unit tests for `buildPlayableSpeakerRanges` edge cases (non-positive duration, boundary clamping, out-of-order input, non-finite/degenerate segments, filter-off passthrough)

Highest-risk gaps:

- full browser recording flow E2E
- more end-to-end delete/retry lifecycle coverage
- no checked-in formal load benchmark yet, despite the capacity guidance in `docs/system.md`

## Next improvement areas

### 1. Queue and workflow resilience

- expand delete + retry lifecycle coverage beyond current focused unit tests
- `WORKER_CLAIM_BATCH_SIZE` is now explicitly reserved/dormant in `packages/config` and ignored by the claim path; a separate `WORKER_RECLAIM_BATCH_SIZE` caps the reclaim tick. Revisit if/when the claim loop switches to batch claiming.

### 2. Frontend quality

- cover recording flow end-to-end
- improve error handling around dead jobs and degraded providers
- make processing/retry states clearer in the UI

### 3. Deployment/ops

- add a real production topology story
- add observability guidance
- add backup / restore guidance
- add storage lifecycle/retention guidance

### 4. Security follow-up

- review outbound request policy beyond current create-time webhook URL checks
- validate webhook consumer rollout and publish a small verifier example if needed
- review MinIO exposure defaults for anything beyond local/dev use

## Not a current truth source

Do not treat older roadmap-style docs as source of truth. The best code-level anchors remain:

- `db/migrations/`
- `packages/config/src/index.ts`
- `apps/web-api/src/routes/`
- `apps/worker/src/handlers/`
- `docker-compose.yml`
