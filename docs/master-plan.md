---
title: "Master Plan"
description: "High-level synthesis of the project and its current state"
---

# cap5 — Master Plan

**Status:** Current-state reference
**Last reviewed:** 2026-03-24

This document is not a feature backlog. For current technical contracts, use:

- [API reference](api.md)
- [Architecture](architecture.md)
- [Database schema](database.md)
- [Environment variables](environment.md)
- [Local development](local-dev.md)
- [Deployment](deployment.md)

---

## Current State

cap5 is a single-tenant video processing platform with:

- React watch app
- Fastify API
- PostgreSQL-backed job queue
- background worker
- FFmpeg media-server
- S3-compatible object storage

Current repo state:

- upload -> process -> transcript -> AI summary flow is implemented
- recordings auto-upload after capture; file selections remain explicit upload actions
- custom video controls, transcript search, confidence review, command palette, speaker diarization, editable speaker labels, and summary enrichments are shipped
- the checked-in Docker Compose stack is self-bootstrapping via the `migrate` service
- GitHub Actions is consolidated into one authoritative workflow at `.github/workflows/test.yml`
- the repo has no end-user authentication layer; auth is out of scope for the current state

Current validation commands:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm --filter @cap/web test:e2e`
- `pnpm --filter @cap/web-api test:e2e`
- `pnpm db:migrate`
- `make smoke` against a running stack

---

## Current System Shape

- `web-api` owns HTTP routes, health/readiness, idempotency, and queue enqueue paths
- `worker` claims `job_queue` work with PostgreSQL leasing and calls Deepgram, Groq, and `media-server`
- `media-server` exposes `/health` and `/process`; the mainline worker path calls it synchronously
- `webhook` terminology is split:
  - incoming media progress route: `POST /api/webhooks/media-server/progress`
  - outgoing user callbacks: `deliver_webhook` jobs to `videos.webhook_url`
- frontend assets are built by `web-builder` and served by nginx in `web-internal`

For the detailed contract, use [architecture.md](architecture.md), [api.md](api.md), and [database.md](database.md).
