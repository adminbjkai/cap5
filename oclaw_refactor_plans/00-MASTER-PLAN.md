# cap4 — Master Refactor Plan

**Generated:** 2026-03-27  
**Status:** Ready to execute  
**Constraint:** No user authentication added. All existing features preserved.

---

## What This Is

This directory contains a full-stack refactor plan for cap4, produced by deep-dive audits of every layer of the codebase simultaneously. Each sub-plan is exhaustive and self-contained. This document is the sequenced execution roadmap that ties them all together.

Sub-plans:
- [`01-web-api-refactor.md`](./01-web-api-refactor.md) — Fastify API (`apps/web-api`)
- [`02-worker-refactor.md`](./02-worker-refactor.md) — Background worker (`apps/worker`)
- [`03-frontend-refactor.md`](./03-frontend-refactor.md) — React frontend (`apps/web`)
- [`04-infra-dx-refactor.md`](./04-infra-dx-refactor.md) — Infrastructure, shared packages, CI/CD
- [`05-docs-refactor.md`](./05-docs-refactor.md) — All documentation

---

## Top-Line Findings Summary

### 🔴 Critical (bugs / correctness issues)

| # | Location | Issue |
|---|----------|-------|
| 1 | `@cap/db` | Module-level singleton pool silently ignores different URLs after first call — tests that spin up isolated DBs get the wrong connection |
| 2 | `apps/worker` | `fail()` and `markTerminalFailure()` are separate transactions — window exists where `job_queue.status = 'dead'` but `videos.processing_phase` is still not `'failed'` |
| 3 | `apps/worker` | `groq.ts` AbortController timeout leaks on multi-chunk path — `clearTimeout` never fires |
| 4 | `docker-compose.yml` | `media-server` depends on `web-api` health — wrong dependency direction |
| 5 | `apps/worker` | `cleanup_artifacts` bypasses `ensureVideoNotDeleted` — inconsistent with every other job handler |
| 6 | CI | PostgreSQL 15 in CI vs 16 in prod — silent schema/behaviour divergence |

### 🟠 Major (maintainability / structural debt)

| # | Location | Issue |
|---|----------|-------|
| 7 | `apps/worker/src/index.ts` | 950-line god file — types, SQL, handlers, polling loop, heartbeat, maintenance all inline |
| 8 | `apps/web-api/src/lib/shared.ts` | ~550-line god file doing 6 unrelated jobs |
| 9 | `apps/web/src/pages/VideoPage.tsx` | 20+ useState calls — state is unmanaged |
| 10 | `apps/web/src/pages/RecordPage.tsx` | 450-line god component — recording, state machine, upload all inline |
| 11 | `apps/web-api` | Idempotency logic implemented 3× — canonical helper + 2 hand-rolled inline copies |
| 12 | `apps/web-api` | Zero input validation layer — manual string casts everywhere |
| 13 | `apps/worker` | Dead-job-reset + downstream enqueue pattern copy-pasted in 2 handlers |
| 14 | `apps/worker` | `claimOne()` mutates SQL via `.replace()` — fragile, untestable |
| 15 | `AGENTS.md` / `CLAUDE.md` | Verbatim duplicates — 1,000+ lines each |
| 16 | `packages/logger` | `pino-pretty` in `dependencies` not `devDependencies` — ships to prod |

### 🟡 Minor / Quick Wins

| # | Location | Issue |
|---|----------|-------|
| 17 | `apps/web` | `formatTimestamp` copy-pasted in 5 files |
| 18 | `apps/web` | ~30 inline `style={{ color: "var(--...)" }}` when Tailwind tokens exist |
| 19 | `apps/web` | `window.dispatchEvent` event bus used in 3 places — bypasses React |
| 20 | `apps/web` | `StatusPanel.tsx` is orphaned — just needs deleting |
| 21 | `apps/web-api` | `log()` helper duplicated in route files when plugin already injects `req.serviceLog` |
| 22 | `apps/web-api` | S3 client reconstructed on every request — no singleton |
| 23 | CI | 6 separate `pnpm install` runs — massive cache waste |
| 24 | `database.md` | Describes manual `psql` loop migration — contradicts actual Node runner |
| 25 | `packages/config` | Missing S3 + LOG_LEVEL vars from Zod schema |

---

## Recommended Execution Order

The refactor is organized into **6 phases**. Each phase is independently deployable and leaves the app fully functional. Later phases build on earlier ones but are never blocked by them.

### Phase 0 — Zero-Risk Housekeeping (1–2 days)
*No logic changes. Pure cleanup. Do first — nothing can break.*

1. Delete `apps/web/src/components/StatusPanel.tsx` (orphaned)
2. Consolidate `AGENTS.md` + `CLAUDE.md` into one file, delete the duplicate
3. Move `pino-pretty` to `devDependencies` in `packages/logger`
4. Fix PostgreSQL version in CI to match prod (16)
5. Consolidate CI's 6 `pnpm install` runs with shared cache
6. Fix `web-builder` missing `depends_on` in `docker-compose.yml`
7. Fix `media-server` depends-on direction in `docker-compose.yml`
8. Consolidate `formatTimestamp` into `apps/web/src/lib/format.ts` (remove 4 copies)
9. Replace ~30 inline `style={{ color: "var(--...)" }}` with Tailwind tokens

**Reference plans:** `03-frontend-refactor.md §Phase 1`, `04-infra-dx-refactor.md §Phase 1`, `05-docs-refactor.md §Phase 1`

---

### Phase 1 — Shared Package Hardening (2–3 days)
*Fixes the `@cap/db` singleton bug. Required before worker refactor.*

1. **`@cap/db`**: Fix singleton pool bug — add `resetPool(url)` + `disconnectPool()` for test isolation
2. **`@cap/db`**: Add `exports` field to `package.json`, consolidate competing migration runners
3. **`@cap/config`**: Add missing env vars (S3, LOG_LEVEL) to Zod schema; add strict `parse()` export
4. **`@cap/logger`**: Extract `createLogger(name)` factory; stop leaking raw pino to consumers
5. **`tsconfig.json`**: Remove `noEmit: true` from root; isolate DOM/vite types to `apps/web` only
6. **`eslint.config.js`**: Fix `parserOptions.project` for monorepo; promote `no-explicit-any` to error

**Reference plan:** `04-infra-dx-refactor.md §Shared Packages`, `§Database Layer`, `§TypeScript Config`, `§ESLint`

---

### Phase 2 — Worker Decomposition (3–4 days)
*The biggest single-file problem. Splits `apps/worker/src/index.ts` (~950 lines) into a clean module tree.*

Target structure:
```
apps/worker/src/
  types.ts              ← all shared types (JobType, JobRow, etc.)
  index.ts              ← lean orchestrator (~100 lines max)
  queue/
    sql.ts              ← all SQL string constants
    claim.ts            ← claimOne(), markRunning()
    lease.ts            ← heartbeat, startHeartbeatLoop, ack, fail
    maintenance.ts      ← reclaimExpiredLeases, runMaintenance
  handlers/
    process-video.ts
    transcribe-video.ts
    generate-ai.ts
    cleanup-artifacts.ts
    deliver-webhook.ts
    shared.ts           ← enqueueDownstream(), ensureVideoNotDeleted(), markTerminalFailure()
  lib/                  ← existing (ffmpeg, s3, transcript)
  providers/            ← existing (deepgram, groq)
```

Key fixes included:
- Fix `fail()` + `markTerminalFailure()` atomicity (merge into single transaction)
- Fix `claimOne()` SQL mutation — use proper parameterized exclusion
- Fix `cleanup_artifacts` S3 client re-init
- Fix groq AbortController timeout leak
- Extract `enqueueDownstream()` to eliminate copy-paste
- Add `HandlerContext` injection for testability

**Reference plan:** `02-worker-refactor.md §Proposed Structure`, `§Queue Layer Design`, `§Handler Refactors`

---

### Phase 3 — API Decomposition (3–4 days)
*Splits `apps/web-api/src/lib/shared.ts` and adds proper validation.*

Target structure:
```
apps/web-api/src/
  types/
    video.ts            ← VideoRow, UploadRow, JobRow types
    api.ts              ← request/response schemas (Zod)
  lib/
    idempotency.ts      ← single canonical implementation
    s3.ts               ← lazy singleton S3 client + helpers
    cursor.ts           ← encode/decode pagination cursors
    hmac.ts             ← HMAC signing/verification
    ai-output.ts        ← AI output parsing/normalization
  routes/
    videos.ts           ← (existing, trimmed)
    uploads.ts          ← (existing, trimmed)
    library.ts          ← (existing, trimmed)
    jobs.ts             ← (existing, trimmed)
    webhooks.ts         ← (existing, trimmed)
    system.ts           ← health/ready only
    debug/
      index.ts          ← dev-only routes (guarded)
  plugins/
    health.ts           ← (existing)
    logging.ts          ← (existing)
    validation.ts       ← NEW: Zod schema validation plugin
```

Key fixes included:
- Remove 2 hand-rolled idempotency copies; use canonical helper everywhere
- Add Zod validation per route (request body + params)
- Add lazy S3 singleton
- Remove duplicate `log()` in route files; use `req.serviceLog`
- Move debug routes out of production `system.ts`
- Standardize all error responses through one error serializer

**Reference plan:** `01-web-api-refactor.md §Proposed Structure`, `§Key Refactors`, `§Migration Path`

---

### Phase 4 — Frontend Restructure (4–5 days)
*The largest surface area change but lowest risk of data bugs.*

Target structure:
```
apps/web/src/
  components/
    ui/                 ← primitives: Button, Badge, FeedbackMessage, Spinner, Dialog
    player/             ← CustomVideoControls, PlayerCard, VideoRail
    transcript/         ← TranscriptCard, TranscriptParagraph, TranscriptLines, etc.
    library/            ← LibraryCard, EmptyLibrary
    layout/             ← AppShell, CommandPalette, ShortcutsOverlay
  pages/
    HomePage.tsx
    VideoPage.tsx       ← thin shell; state in useVideoStore
    RecordPage.tsx      ← split into useRecordingMachine hook + RecordUI component
  hooks/
    useKeyboardShortcuts.ts
    useVideoStore.ts    ← NEW: Zustand store for VideoPage
    useRecordingMachine.ts ← NEW: recording state machine hook
    useTranscriptState.ts  ← NEW: transcript state hook
  lib/
    api.ts              ← typed, error-handled API client
    format.ts           ← single formatTimestamp (canonical)
    sessions.ts
  types/
    video.ts
    transcript.ts
    api.ts
```

Key fixes included:
- Extract Zustand store for VideoPage (eliminate 20+ useState)
- Split RecordPage into hook + UI
- Replace `window.dispatchEvent` event bus with React context or store
- Group `VideoPageHeader`'s 25 props into 4 logical objects
- Split dual-mode `ChapterList` and `SummaryCard` into separate components
- Add `FeedbackMessage` primitive to eliminate repeated inline error/empty states
- Typed API client with error handling

**Reference plan:** `03-frontend-refactor.md §Proposed Structure`, `§State Management`, `§Component Refactors`

---

### Phase 5 — Docs & DX Polish (2–3 days)
*Final cleanup. Pays off the documentation debt.*

1. Rewrite `README.md` — single best entry point, cut the 25-line curl block, tighten doc index
2. Merge/delete `AGENTS.md` duplicate, rewrite surviving file for clarity
3. Fix `database.md` — remove manual `psql` loop description, align with Node runner
4. Create `docs/worker.md` — worker pipeline, job state machine, handler responsibilities
5. Create `docs/security.md` — HMAC, rate limiting, sandbox, no-auth rationale
6. Create `docs/openapi.yaml` — machine-readable API spec (or link to generated one)
7. Add 5 Mermaid diagrams to `docs/architecture.md`:
   - Service topology (Docker network)
   - Job state machine (processing_phase × transcription_status × ai_status)
   - Upload sequence diagram (browser → API → MinIO → worker → Deepgram → Groq)
   - Job queue pipeline (claim → heartbeat → ack/fail → reclaim)
   - nginx URL routing
8. Add `make help` target to Makefile
9. Improve `dev-local.sh` — replace fragile `declare -f` / `xargs` patterns

**Reference plans:** `05-docs-refactor.md`, `04-infra-dx-refactor.md §Makefile`, `§DX`

---

## Effort Summary

| Phase | Description | Effort | Risk |
|-------|-------------|--------|------|
| 0 | Zero-risk housekeeping | 1–2 days | 🟢 None |
| 1 | Shared package hardening | 2–3 days | 🟡 Low |
| 2 | Worker decomposition | 3–4 days | 🟡 Medium |
| 3 | API decomposition | 3–4 days | 🟡 Medium |
| 4 | Frontend restructure | 4–5 days | 🟡 Medium |
| 5 | Docs & DX polish | 2–3 days | 🟢 None |
| **Total** | | **15–21 days** | |

Phases 0–1 can be done in any order. Phases 2–4 can be done in parallel by separate developers once Phase 1 is complete. Phase 5 can be done at any time.

---

## What This Refactor Does NOT Change

- ❌ No user authentication added (explicitly out of scope)
- ❌ No API contract changes (all existing endpoints preserved with same schemas)
- ❌ No database schema migrations required
- ❌ No new external dependencies added (Zod is already in the monorepo)
- ❌ No change to the Docker Compose service topology (same 9 services)

---

## Definition of Done

A phase is complete when:
1. `pnpm lint` passes
2. `pnpm typecheck` passes
3. `pnpm test` passes
4. `pnpm --filter @cap/web test:e2e` passes
5. `pnpm --filter @cap/web-api test:e2e` passes
6. `make smoke` passes against a running stack
7. No regressions in the features listed in `docs/qa.md`

---

*Generated by Atiba (OpenClaw) via parallel subagent deep-dive audits. All plans in this directory are based on reading actual source files, not assumptions.*
