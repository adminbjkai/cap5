# cap5 — Current Status and Implementation Plan

## Purpose

This document turns the repository analysis into an execution plan. It is meant to answer two questions clearly:

1. what is true about cap5 right now
2. what should be implemented next, in what order, and why

This plan is intentionally tied to the live repo state, not to older aspirational roadmap notes.

## Current status snapshot

cap5 already has a working end-to-end product path:

- create video records
- upload raw media through signed single-part or multipart flows
- normalize media through the media-server
- transcribe with speaker diarization
- generate AI outputs
- review, edit, retry, and delete from the UI

Architecturally, the repo is in good shape:

- monorepo boundaries are clean
- docs are strong and mostly aligned with code
- auth exists and is wired end to end
- the worker queue has leases, heartbeats, reclaim, and dead-letter behavior

## What changed in the current hardening pass

Completed in the actual repo during this pass:

- signed outbound webhook delivery
- outbound webhook delivery-path tests
- auth login throttling and auth event logging
- queue failure-transition tests
- cleanup-artifact lifecycle tests
- implementation planning and doc cleanup
- server-backed operator notes feature
- right-rail tab rendering hardening for cross-browser panel isolation
- speaker-synced playback filtering feature refined into selected-speaker-sequence playback

## Execution principles

### 1. Security and trust boundaries before scale work
Do not optimize throughput before the external trust boundaries are credible.

### 2. Reliability before polish
A pipeline app lives or dies on whether jobs finish correctly and can be recovered safely.

### 3. Productized operations before big feature expansion
Before adding bigger features like HLS/live or collaboration, the stack needs a clearer deployment and observability story.

### 4. Each phase should leave the repo more testable and more explainable
Every meaningful implementation phase should update code, tests, and docs together.

## Recommended implementation order

## Phase 1 — Security baseline and webhook trust boundary

### Status
Substantially completed.

### Completed
- signed outbound webhook delivery
- optional separate outbound signing secret
- delivery-path tests for signed outbound requests
- auth-specific login throttling
- auth event logging for success/failure/rate-limited attempts

### Remaining follow-up
1. review `webhookUrl` policy again for SSRF posture and redirect handling
2. validate whether outbound webhook consumers need a short migration note or verifier example
3. optionally add debug-level logging for invalid token verification failures

## Phase 2 — Queue and workflow correctness

### Status
In progress.

### Completed
- tests for queue failure transitions via `fail()`
- tests for `markRunning()` lease-loss behavior
- tests for cleanup-artifact key collection and no-object path
- tests for `claimOne()` + `reclaimExpiredLeases()` (parameters, SQL path, batch-size env)
- `WORKER_CLAIM_BATCH_SIZE` is now explicitly reserved/dormant; reclaim was split out to a dedicated `WORKER_RECLAIM_BATCH_SIZE`
- edge-case unit coverage for `buildPlayableSpeakerRanges` (duration guard, boundary clamp, out-of-order inputs, non-finite/degenerate segments, filter-off passthrough)

### Remaining work
1. expand delete + retry lifecycle coverage beyond focused unit tests
2. revisit the claim loop itself (one-at-a-time vs batch) if/when worker throughput scaling is needed — at that point `WORKER_CLAIM_BATCH_SIZE` graduates from dormant to real

## Phase 3 — Frontend resilience and operator clarity

### Goal
Make failure states and recovery paths obvious in the UI.

### Work items
1. improve presentation of dead-job / failed-phase states
2. make provider degradation clearer on watch and library screens
3. cover the recording flow end-to-end in browser automation
4. tighten retry affordances so operators know what will happen next

## Phase 4 — Throughput and scaling path

### Goal
Choose and implement the real scaling model rather than leaving it implicit.

### Work items
1. decide between:
   - multi-process worker scaling as the primary model
   - true in-process worker concurrency
   - actual batch-claim execution
2. add a small load benchmark or repeatable capacity check
3. review media-server disk/memory pressure under concurrent large uploads
4. document the first practical scale ceiling and the next bottleneck after that

## Phase 5 — Production operations

### Goal
Make the app easier to deploy, observe, and recover.

### Work items
1. define a real production topology beyond local Compose
2. add observability guidance: logs, metrics, alerts, key failure signals
3. add backup/restore guidance for Postgres and object storage
4. add retention/lifecycle guidance for raw, processed, transcript, and derived artifacts
5. review public/system endpoints and deployment defaults for production exposure

## Phase 6 — Feature expansion only after the above

### Goal
Expand product surface once the core pipeline is hardened.

### Candidate work
1. either implement HLS properly or remove misleading schema/document hints
2. richer webhook ecosystem support
3. collaboration/sharing if product scope grows
4. analytics and usage insights if they become operationally useful

## Immediate next implementation recommendation

The next best code tasks are:

1. add reclaim / expired-lease coverage
2. expand delete/retry lifecycle coverage with broader integration-style tests
3. clarify dead-job and degraded-provider states in the UI

## Definition of done for the current hardening cycle

The current hardening cycle should be considered successful when all of the following are true:

- outbound webhook signing is implemented and documented
- auth/login hardening is in place and tested
- queue lifecycle edge cases are covered by automated tests
- the operator UI clearly communicates failure and retry states

## Notes for future implementation passes

- Keep `docs/status.md` short and truthful.
- Keep `docs/contracts.md` consumer-facing and stable.
- Keep this file focused on sequence and rationale, not exhaustive architecture detail.
- When a phase is materially started or completed, update this document so the plan stays live.
