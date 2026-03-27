---
title: "Tasks"
description: "Current project focus"
---

# Tasks — cap5

## Current Focus

Active work items are tracked in GitHub Issues at https://github.com/adminbjkai/cap5/issues.

Current verification baseline:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm --filter @cap/web test:e2e`
- `pnpm --filter @cap/web-api test:e2e`
- `pnpm db:migrate`
- `make smoke` against a running stack

## Deferred / Out Of Scope

- end-user authentication
- accessibility follow-up beyond the currently shipped state
