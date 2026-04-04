# cap5

Single-tenant video processing platform. No multi-tenancy, no Redis/Kafka.
Auth is being added — see `docs/auth-plan.md` for the implementation plan.

## Documentation

- `README.md` — repo map, quick start, pipeline overview
- `docs/system.md` — architecture, data model, queue model, webhooks
- `docs/development.md` — setup, env vars, debugging, incident response
- `docs/contracts.md` — API/webhook contracts and versioning policy
- `docs/status.md` — current gaps and next improvement areas
- `docs/auth-plan.md` — auth implementation plan (single-user JWT)

## Source of truth

- Schema: `db/migrations/`
- Env contract: `packages/config/src/index.ts`
- API routes: `apps/web-api/src/routes/`
- Worker handlers: `apps/worker/src/handlers/`
- Runtime topology: `docker-compose.yml`

## Key conventions

- Mutations require `Idempotency-Key` header
- Processing phases are monotonic (rank only moves forward)
- Inbound webhooks are HMAC-signed; outbound are not
- The worker loop claims one job at a time despite `WORKER_CLAIM_BATCH_SIZE` existing in config
- Soft delete with delayed `cleanup_artifacts` job (5 min)
