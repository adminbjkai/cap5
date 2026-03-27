# Agent notes

This repo does not contain a runtime agent framework. The practical “agents” here are service roles:

- `web-api` — request coordinator
- `worker` — async orchestration and provider calls
- `media-server` — media transformation worker

## Good defaults for contributors

- treat SQL migrations as the source of truth for schema docs
- treat `packages/config/src/index.ts` as the source of truth for env docs
- treat route files in `apps/web-api/src/routes` as the source of truth for API docs
- treat worker handlers as the source of truth for pipeline docs

## When updating docs

Prefer documenting what code does now over what older planning docs claimed it would do.
