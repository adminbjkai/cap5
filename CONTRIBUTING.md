# Contributing to cap5

See [README.md](README.md) for repo layout and quick start, and [docs/development.md](docs/development.md) for setup details, debugging, and incident response.

## Contribution rules

- Keep docs aligned with code and migrations.
- Prefer small, reviewable commits.
- Preserve idempotency and monotonic state guarantees when touching API or worker flows.
- Add or update tests when behavior changes.
- Do not commit generated artifacts.

## Verification before opening a PR

```bash
pnpm build:all
pnpm typecheck
pnpm lint
pnpm test
```

Focused package checks:

```bash
pnpm --filter @cap/web test
pnpm --filter @cap/worker test
pnpm --filter @cap/web-api test:e2e
```

## Documentation

All docs live in `docs/`. When a route shape, env var, migration, or service contract changes, update the matching doc in the same commit:

- `docs/system.md` — architecture, data model, queue, webhooks
- `docs/development.md` — setup, debugging, incident response
- `docs/contracts.md` — API/webhook contracts
- `docs/status.md` — current gaps and next areas

## Maintainer

- `@adminbjkai`
