---
title: "Backend Cleanup Next Steps"
description: "Focused maintenance ledger for backend cleanup, verification gaps, and safe next actions"
---

# Backend Cleanup Next Steps

**Last updated:** 2026-03-25
**Purpose:** Keep one focused maintenance document for backend cleanup work so future sessions can resume from a clear baseline instead of rediscovering repo state.

This file is intentionally narrower than `master-plan.md` and more action-oriented than `tasks.md`.

---

## Current Baseline

These low-risk cleanup items are already in place and should be treated as the current baseline:

- `apps/web-api/src/lib/shared.ts`
  `JobType` includes `deliver_webhook`
- `apps/web-api/src/routes/videos.ts`
  small readability cleanup only:
  `BLOCKED_WEBHOOK_HOSTS`,
  file-local request-validation helpers,
  clearer watch-edits comment
- `apps/web-api/tests/e2e/helpers.ts`
  shared API base URL and API health preflight helper
- `apps/web-api/tests/e2e/*.test.ts`
  API E2E suites now use the shared helper instead of repeating base URL/setup logic
- `apps/web-api/vitest.integration.config.ts`
  Vitest 4 config updated off deprecated `poolOptions`
- `apps/web-api/playwright.config.ts`
  prerequisites wording aligned to generic "API + backing services healthy" language
- `apps/web-api/tests/integration/full-flow.test.ts`
  prerequisites wording aligned to current local/CI reality
- `docs/database.md`
  `/api/videos/:id/status` AI payload note corrected to match current code

---

## Verified State

Verified locally on 2026-03-25:

- `pnpm --filter @cap/db build`
- `pnpm --filter @cap/web-api typecheck`
- `pnpm --filter @cap/web-api test`
- `pnpm --filter @cap/web-api exec playwright test --list`
- `pnpm --filter @cap/web-api exec vitest run --config vitest.integration.config.ts --reporter=dot --testNamePattern='^$'`

What is **not** currently re-verified in this cleanup track:

- live backend API Playwright E2E against a fully bootstrapped stack
- `pnpm test:integration` against a running API stack at `http://localhost:3000`
- full upload -> process -> transcript -> AI smoke after the latest cleanup edits

Do not claim backend E2E or integration are green unless they are rerun successfully in a properly bootstrapped environment.

---

## Guardrails

Use these rules for future cleanup passes:

- Prefer file-local helper extraction before shared-package moves.
- Keep behavior unchanged unless there is a clear, evidenced bug.
- Avoid cross-package backend refactors during a cleanup-only pass.
- Do not introduce new shared packages or ownership boundaries unless duplication is proven and validation is strong.
- Do not leave generated `dist/` output out of sync with reverted source changes.
- Keep test-harness messaging honest about external dependencies instead of trying to "fake pass" local backend suites.
- Treat code and migrations as the source of truth over older docs or historical notes.

Broad changes that were intentionally **not** kept in this maintenance track:

- cross-package shared type extraction into `@cap/db`
- S3 client centralization across services
- `withIdempotency` wrapper refactor across route files
- transcript utility moves from app code into `@cap/db`
- large worker restructuring or file splitting

Those are separate refactor projects, not cleanup-followup work.

---

## Recommended Next Actions

Prioritize these in order. Each should be done as a small, reviewable pass.

### 1. Document worker magic numbers and non-obvious formulas

Focus files:

- `apps/worker/src/index.ts`
- `apps/worker/src/providers/groq.ts`

What to do:

- add short comments for backoff timing, heartbeat timing expectations, chunk-size decisions, and failure thresholds
- document only values that currently require reverse-engineering

Why this is next:

- zero or near-zero behavior risk
- improves resume-ability immediately
- creates context before any future worker cleanup

Validation:

- code review
- `pnpm --filter @cap/worker typecheck`

### 2. Improve worker error-log context

Focus file:

- `apps/worker/src/index.ts`

What to do:

- add `video_id`, `job_type`, and a short phase tag where error logs currently omit them
- keep existing event names and behavior

Why this matters:

- makes failures debuggable without re-reading large handler blocks
- helps future cleanup and incident review

Validation:

- `pnpm --filter @cap/worker typecheck`
- `pnpm --filter @cap/worker test`

### 3. Finish the smallest remaining route-validation cleanup

Focus files:

- `apps/web-api/src/routes/uploads.ts`
- optionally `apps/web-api/src/lib/shared.ts` only if a helper is clearly stable and already proven

What to do:

- remove the most obvious remaining repeated `Idempotency-Key` extraction boilerplate
- keep helper scope narrow
- do not reintroduce a broad `withIdempotency` abstraction

Why this matters:

- reduces repeated route noise
- keeps route files easier to scan

Validation:

- `pnpm --filter @cap/web-api typecheck`
- `pnpm --filter @cap/web-api test`

### 4. Tighten backend test-harness trust notes

Focus files:

- `apps/web-api/tests/e2e/helpers.ts`
- `apps/web-api/tests/integration/full-flow.test.ts`
- `apps/web-api/playwright.config.ts`
- `docs/local-dev.md` if a real mismatch is verified

What to do:

- document current prerequisites clearly
- keep language aligned with CI and local custom setups
- avoid overstating what local test commands prove

Why this matters:

- reduces confusing false-negative test runs
- keeps future sessions from wasting time on environment mistakes

Validation:

- `pnpm --filter @cap/web-api exec playwright test --list`
- targeted config smoke checks only unless a live stack is actually running

### 5. Re-verify live backend suites before any larger cleanup

What to do:

- boot the required backend stack
- rerun backend E2E and integration in a real environment
- record exact pass/fail status with dates

Why this matters:

- prevents future cleanup work from building on stale assumptions
- separates actual runtime issues from harness/setup drift

Suggested commands when the stack is available:

- `pnpm --filter @cap/web-api test:e2e`
- `pnpm test:integration`
- `make smoke`

---

## Non-Goals For This Track

Keep these out of routine cleanup passes unless explicitly scoped:

- auth or multi-user work
- frontend redesign/refactor
- worker file splitting or architecture changes
- new shared packages for S3/config/route abstractions
- test framework consolidation between Vitest and Playwright

---

## Repo Hygiene Notes

To keep the repo neat and avoid confusing state:

- if an experimental refactor is reverted, rebuild any touched package that publishes `dist/` artifacts
- do not leave dead generated files behind after reverting source changes
- keep docs focused: `master-plan.md` for current-state synthesis, this file for cleanup actions, `tasks.md` for milestone/status snapshot
- if a cleanup pass becomes cross-package or changes ownership boundaries, stop and split it into a dedicated refactor task

---

## Resume Checklist

Before starting the next backend cleanup session:

1. Read this file first.
2. Confirm current `git status`.
3. Reconfirm which backend tests are actually green locally versus only green in CI.
4. Pick one cleanup action from this file, not several.
5. Keep the diff narrow and rerun only the validation relevant to the touched files.
