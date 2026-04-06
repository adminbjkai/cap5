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

What was weak at the start of this planning pass:

- outbound user webhooks were unsigned
- queue/workflow edge-case coverage was still selective
- production/ops guidance was still thinner than product and architecture guidance
- worker throughput/scaling choices were documented but not fully productized

## What changed in this pass

Phase 1 has started. The repo now includes signed outbound webhook delivery:

- outbound webhook requests now include:
  - `x-cap-timestamp`
  - `x-cap-signature`
  - `x-cap-delivery-id`
- signature format is `v1=<hex hmac sha256>` over `${timestamp}.${rawBody}`
- `OUTBOUND_WEBHOOK_SECRET` was added as an optional env var
- outbound signing falls back to `MEDIA_SERVER_WEBHOOK_SECRET` when no separate outbound secret is configured
- docs were updated to reflect the contract

That means the implementation plan below is not hypothetical anymore — phase 1 has begun and the first security gap has been closed.

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

### Goal
Tighten the externally visible trust boundary without introducing heavy architectural churn.

### Status
In progress / partially completed in this pass.

### Done now
- signed outbound webhook delivery
- optional separate outbound signing secret
- contract/doc updates for outbound webhook headers

### Remaining work in this phase
1. add delivery-path tests that assert signed outbound headers are present
2. validate whether outbound webhook consumers need a short migration note or example verifier
3. review `webhookUrl` policy again for SSRF posture and redirect handling
4. add auth-specific login throttling or lockout behavior
5. add auth failure audit logging

### Why this phase is first
This closes the clearest security gap with limited code surface area and sets a better baseline for production-style integrations.

## Phase 2 — Queue and workflow correctness

### Goal
Reduce the chance of stuck, duplicated, or inconsistently recovered pipeline states.

### Work items
1. add tests for delete → cleanup-artifacts lifecycle
2. add tests for retry semantics around `dead`, `running`, and reclaimed jobs
3. add tests for lease expiry / reclaim / terminal failure transitions
4. add explicit tests for outbound webhook retry behavior
5. decide whether `WORKER_CLAIM_BATCH_SIZE` should become real worker concurrency or be removed from config

### Expected outcome
The worker becomes easier to trust under failure, not just on the happy path.

## Phase 3 — Frontend resilience and operator clarity

### Goal
Make failure states and recovery paths obvious in the UI.

### Work items
1. improve presentation of dead-job / failed-phase states
2. make provider degradation clearer on watch and library screens
3. cover the recording flow end-to-end in browser automation
4. tighten retry affordances so operators know what will happen next

### Expected outcome
The app feels less like an engineering demo and more like an operational tool.

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

### Expected outcome
Scaling stops being “probably fine” and becomes an explicit, tested operational stance.

## Phase 5 — Production operations

### Goal
Make the app easier to deploy, observe, and recover.

### Work items
1. define a real production topology beyond local Compose
2. add observability guidance: logs, metrics, alerts, key failure signals
3. add backup/restore guidance for Postgres and object storage
4. add retention/lifecycle guidance for raw, processed, transcript, and derived artifacts
5. review public/system endpoints and deployment defaults for production exposure

### Expected outcome
The project becomes materially closer to safe production use.

## Phase 6 — Feature expansion only after the above

### Goal
Expand product surface once the core pipeline is hardened.

### Candidate work
1. either implement HLS properly or remove misleading schema/document hints
2. richer webhook ecosystem support
3. collaboration/sharing if product scope grows
4. analytics and usage insights if they become operationally useful

## Immediate next implementation recommendation

The next best code tasks after this pass are:

1. add worker tests for signed outbound webhook delivery
2. add route-specific auth throttling on login
3. add queue edge-case tests around reclaim and terminal failures

That order keeps momentum on the same hardening track and avoids context-switching into lower-value polish too early.

## Definition of done for the current hardening cycle

The current hardening cycle should be considered successful when all of the following are true:

- outbound webhook signing is implemented and documented
- auth/login hardening is no longer carrying obvious TODOs
- queue lifecycle edge cases are covered by automated tests
- the operator UI clearly communicates failure and retry states

## Notes for future implementation passes

- Keep `docs/status.md` short and truthful.
- Keep `docs/contracts.md` consumer-facing and stable.
- Keep this file focused on sequence and rationale, not exhaustive architecture detail.
- When a phase is materially started or completed, update this document so the plan stays live.
