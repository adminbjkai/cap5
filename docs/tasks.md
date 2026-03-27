# Current tasks and follow-ups

This file reflects the codebase as it exists now, not an aspirational backlog imported from older docs.

## Stabilization tasks

- Add tests for delete + cleanup-artifacts behavior
- Add tests for retry semantics around `dead` and `running` jobs
- Add explicit tests for unsigned outbound webhook delivery behavior and retry policy
- Add tests for watch-edits title precedence (`ai_outputs.title` vs `videos.name`)
- Add API tests for multipart upload abort/edge cases

## Product tasks

- Add auth and user model
- Add better notes persistence or richer note model if notes are meant to be durable
- Add a clearer processing timeline/history in the UI
- Add webhook delivery signing and verification guidance for consumers

## Operational tasks

- Add metrics and tracing
- Add production deployment manifests beyond compose
- Add backup/restore docs
