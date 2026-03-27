# Improvement plan

## 1. Security baseline

- Add authentication and authorization
- Sign outbound webhooks
- Centralize outbound request policy to reduce SSRF risk beyond create-time validation
- Review MinIO exposure defaults

## 2. Queue and workflow resilience

- Cover all handlers with integration tests around retries, reclaim, and dead-letter transitions
- Expose queue/admin observability endpoints or dashboards
- Decide whether `WORKER_CLAIM_BATCH_SIZE` should be used or removed

## 3. API/product coherence

- Standardize naming from `cap4` to `cap5` across env defaults, bucket names, docs, and UI copy
- Decide whether `source_type` support for `processed_mp4` / `hls` is real roadmap or dead schema surface
- Document or implement notes persistence explicitly

## 4. Frontend quality

- Expand E2E coverage for recording, retry, delete, transcript edits, and speaker labels
- Add error-state UX for dead jobs and webhook/provider degradation
- Reduce duplication between summary/transcript variants where useful

## 5. Deployment readiness

- Add real production topology docs
- Add secrets management guidance
- Add health/metrics/log aggregation guidance
- Add storage lifecycle/cleanup policy docs
