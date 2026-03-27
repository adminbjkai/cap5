# cap4 — Infrastructure & Developer Experience Refactor Plan

**Prepared by:** OpenClaw audit (senior DevOps / platform engineer perspective)  
**Audit date:** 2026-03-27  
**Project root:** `cap4 copy/`  
**Status:** Analysis only — no code changed

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Shared Packages Audit](#2-shared-packages-audit)
3. [Database Layer](#3-database-layer)
4. [Docker Compose](#4-docker-compose)
5. [Makefile & Scripts](#5-makefile--scripts)
6. [TypeScript Config](#6-typescript-config)
7. [ESLint Config](#7-eslint-config)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [Environment Variables & Secrets](#9-environment-variables--secrets)
10. [DX Improvements](#10-dx-improvements)
11. [Complexity Estimates](#11-complexity-estimates)
12. [Recommended Migration Path](#12-recommended-migration-path)

---

## 1. Executive Summary

cap4 is a well-structured, single-tenant video processing monorepo. The infra and DX foundations are solid — pnpm workspaces are clean, the Docker Compose stack is thoughtfully layered, and the migration system is functional. This audit identifies **targeted improvements** rather than fundamental rewrites.

**Top five issues by impact:**

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | `@cap/db` pool is a singleton without multi-instance isolation | correctness bug in tests | S |
| 2 | CI jobs duplicate `pnpm install` 6 times with no shared cache reuse between jobs | ~3× slower CI | M |
| 3 | Root `tsconfig.json` includes `noEmit: true` but emitting packages rely on per-package configs | confusing, one misstep breaks builds | S |
| 4 | `eslint.config.js` applies TypeScript-aware parsing globally but ignores `**/*.js` files from type-checking | partial rules for JS files | S |
| 5 | `scripts/dev-local.sh` calls `declare -f` + subprocess bash for `all` mode — fragile across shells | broken on some environments | S |

---

## 2. Shared Packages Audit

### 2.1 `@cap/config`

**File:** `packages/config/src/index.ts`

**What it does well:**
- Zod schema with coercion for all numeric env vars — solid.
- Single `getEnv()` export — clean API.
- All defaults match `.env.example` values — well aligned.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🟡 Medium | Missing S3 env vars | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PORT`, `MINIO_CONSOLE_PORT` are in `.env.example` but **absent from the Zod schema**. These are validated nowhere at startup. |
| 🟡 Medium | Missing `LOG_LEVEL` | `LOG_LEVEL` is documented and used by `@cap/logger` but not in `BaseEnv`. Logger silently falls back to `process.env.LOG_LEVEL` without startup validation. |
| 🟢 Low | No `VITE_*` stub | Vite frontend vars are not expected in this package (correct — they're build-time), but there's no note about this distinction in the schema file. |
| 🟢 Low | No `export` for `BaseEnv` schema | Downstream code can't derive partial types or extend the schema without reimporting zod. |

**Recommended changes:**
```typescript
// Add to BaseEnv:
LOG_LEVEL: z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
S3_ENDPOINT: z.string().url(),
S3_PUBLIC_ENDPOINT: z.string().url(),
S3_REGION: z.string().default('us-east-1'),
S3_ACCESS_KEY: z.string().min(1),
S3_SECRET_KEY: z.string().min(1),
S3_BUCKET: z.string().default('cap4'),
S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
MINIO_ROOT_USER: z.string().min(1),
MINIO_ROOT_PASSWORD: z.string().min(1),
MINIO_PORT: z.coerce.number().int().positive().default(8922),
MINIO_CONSOLE_PORT: z.coerce.number().int().positive().default(8923),
```

**package.json issues:**
- No `exports` field — relies on `"main"` for CJS compat. Since the package is `"type": "module"`, add:
  ```json
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
  ```
- No `scripts.lint`, `scripts.typecheck`, or `scripts.test` — only `build`. Inconsistent with `@cap/logger`.

---

### 2.2 `@cap/db`

**File:** `packages/db/src/index.ts`

**What it does well:**
- Clean `pg.Pool` wrapper with proper pool configuration (max:20, timeouts).
- `withTransaction` correctly handles rollback.
- Migration script is well-structured with `schema_migrations` tracking.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | Module-level singleton pool | `let pool: Pool \| null = null` is a module-level singleton. In test environments, multiple test suites sharing a process will share the same pool object — intentionally or not. A `resetPool()` export (for test teardown) is missing. |
| 🔴 High | `databaseUrl` passed per-call but pool created once | `getPool(databaseUrl)` creates the pool with the first URL it sees and ignores subsequent `databaseUrl` arguments silently. If two services or tests call `getPool()` with different URLs, only the first URL is used. |
| 🟡 Medium | No TypeScript type export for query helpers | Callers have to import `QueryResultRow` from `pg` directly. Exporting common utility types would improve ergonomics. |
| 🟡 Medium | `migrate.mjs` is plain JS | The migration runner at `scripts/migrate.mjs` is untyped JS while the rest of the package is TS. A `migrate.ts` compiled by the package build would be more consistent. |
| 🟡 Medium | `MIGRATIONS_DIR` override only by env | Migration dir is hardcoded relative to `__dirname` with an optional env override. Test suites that mount fixtures from different paths have no clean API override. |
| 🟢 Low | No `disconnectPool()` / pool drain | Long-lived processes that need graceful shutdown have no exported helper to drain the pool. |

**Recommended: add `resetPool` and `disconnectPool` exports:**
```typescript
export function resetPool(): void {
  pool = null;
}

export async function disconnectPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

---

### 2.3 `@cap/logger`

**File:** `packages/logger/src/index.ts`

**What it does well:**
- Pino with structured JSON, secret redaction, and `AsyncLocalStorage` for request context — very solid.
- `withContext` child logger pattern is ergonomic.
- `logRequest` helper handles the standard request/response pattern.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🟡 Medium | `pino-pretty` in `dependencies` not `devDependencies` | `pino-pretty` is a dev/DX dependency (pretty-print in dev mode). It's a production dependency here, adding ~1.5MB to production installs. |
| 🟡 Medium | Both `export { pino }` and `export default Logger` | Exporting the raw `pino` object leaks the underlying library to consumers. If pino is ever swapped, all consumers break. |
| 🟢 Low | `LogContext` index signature `[key: string]: string \| number \| boolean \| undefined` | Too permissive — allows any key. Structured keys should be explicit and the index signature removed or tightened. |
| 🟢 Low | `withContext` recreates Logger instance but loses `pretty` setting | When `pretty: true` is set on the original logger, child loggers from `withContext` don't inherit it (the constructor is called without `pretty`). |
| 🟢 Low | No `flush()` method | Pino's async transport (`pino-pretty`) buffers. In tests or short-lived processes, unflushed lines can be dropped. |

**Separate `pino-pretty` to devDependencies:**
```json
"dependencies": { "pino": "^9.5.0" },
"devDependencies": { "pino-pretty": "^13.0.0", ... }
```
Then mark it as an optional peer or add a conditional transport check.

---

### 2.4 Package Consistency Matrix

| Feature | `@cap/config` | `@cap/db` | `@cap/logger` |
|---------|--------------|-----------|---------------|
| `exports` field | ❌ | ❌ | ✅ |
| `lint` script | ❌ | ❌ | ✅ |
| `typecheck` script | ❌ | ❌ | ✅ |
| `test` script | ❌ | ❌ | ❌ |
| `dev` script | ❌ | ❌ | ✅ |

**All three packages are missing unit tests.** These shared packages underpin every app service — they should be the most-tested layer.

---

## 3. Database Layer

### 3.1 Migration System

**Files:** `db/migrations/*.sql`, `packages/db/scripts/migrate.mjs`, `docker/postgres/run-migrations.sh`

**What it does well:**
- `schema_migrations` table with idempotent apply — migrations are tracked by version string, not hash.
- Migrations wrapped in `BEGIN...COMMIT` with rollback on error.
- Idiomatic use of `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$` for enum idempotency.
- `processing_phase_rank` constraint ensuring monotonic state is enforced at DB level.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🟡 Medium | Two migration runners | `packages/db/scripts/migrate.mjs` (Node.js) and `docker/postgres/run-migrations.sh` (bash psql loop) are both present. They track migrations differently — the Node runner uses `schema_migrations` table; the bash runner appears to be a raw loop without tracking. Running both on the same database will cause issues. |
| 🟡 Medium | `0002_video_soft_delete.sql` is **not** wrapped in a transaction | `ALTER TABLE videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ` has no `BEGIN/COMMIT`. If interrupted, partial state is possible (unlikely here, but inconsistent with other migrations). |
| 🟡 Medium | `job_type` enum extended with `ADD VALUE` in `0003` | PostgreSQL `ALTER TYPE ... ADD VALUE` cannot be rolled back inside a transaction (it auto-commits). The migration wraps this in `BEGIN/COMMIT`, which doesn't help. This is a known PG limitation but the comment should document it. |
| 🟢 Low | No migration to drop `source_type` `hls` value | `source_type` enum includes `hls` which appears unused in application logic. Dead enum values accumulate confusion. |
| 🟢 Low | `progress_bucket` computed column is `STORED` | This is correct for a generated column, but a comment explaining why it's used for dedup (5% buckets) would help future engineers. |

**Verify there is one authoritative runner — recommendation:**

The Node.js runner (`packages/db/scripts/migrate.mjs`) is the authoritative tool (used by `pnpm db:migrate`). The bash runner (`docker/postgres/run-migrations.sh`) should be removed or consolidated to call the Node runner via `pnpm db:migrate` instead of a raw psql loop.

### 3.2 Schema Observations

- **`idempotency_keys.response_body` is `JSONB`** — this stores full API responses. For large payloads this can balloon. No size limit or TTL cleanup job exists in the codebase beyond `expires_at`. A periodic `DELETE FROM idempotency_keys WHERE expires_at < now()` job is absent.
- **`uploads.last_client_heartbeat_at`** — stale uploads (client abandoned mid-upload) are never cleaned up by any visible scheduled job. The `cleanup_artifacts` job type exists but it's unclear if it handles this case.
- **No `NOT NULL` on `uploads.raw_key`** — actually it has `NOT NULL`. ✅

---

## 4. Docker Compose

**File:** `docker-compose.yml`

### 4.1 What it does well
- Dependency ordering via `depends_on` with `condition: service_healthy` is correct.
- `migrate` as a one-shot service is elegant.
- `minio-setup` for bucket bootstrapping avoids manual setup steps.
- Resource limits on `web-builder` prevent runaway builds.
- MinIO console bound to `127.0.0.1` only — security win.
- No hardcoded credentials in the file — all via `${VAR}`.

### 4.2 Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | `web-builder` has no `depends_on` | `web-builder` copies built frontend from the image into `web_dist` volume. There's no dependency on any service being healthy first. If `web-builder` runs before the image is built, it fails silently. Add `depends_on: web-api: condition: service_started` or ensure build ordering. |
| 🔴 High | `media-server` depends on `web-api: condition: service_healthy` | `media-server` is an independent FFmpeg RPC service. It should not depend on `web-api` health — this creates a circular-ish startup delay. `media-server` should start independently (possibly after `migrate`). |
| 🟡 Medium | No `healthcheck` on `minio` | MinIO has a `/minio/health/live` endpoint. Without a healthcheck, `minio-setup` starts based only on container start, not MinIO readiness, making the `until mc alias set...` loop load-bearing for resilience. |
| 🟡 Medium | `container_name` is commented out | Commented-out `container_name` entries were clearly changed from `cap3-*` to `cap4-*` but left commented. Either use them (provides stable names for `docker exec`) or remove the comments. |
| 🟡 Medium | `web-internal` healthcheck absent | nginx has no healthcheck. Add a `curl -f http://localhost/health` or `wget` check. |
| 🟡 Medium | Resource limits only on `web-builder` | Only `web-builder` has resource limits. `worker` does FFmpeg processing and can consume significant CPU/memory. Add limits to `worker` and `media-server`. |
| 🟢 Low | `minio-setup` uses OR-true for all mc commands | `mc mb -p ... \|\| true`, `mc anonymous set ... \|\| true` — failures are silently swallowed. If MINIO_ROOT_USER is wrong, setup appears to succeed. |
| 🟢 Low | `postgres` healthcheck uses `${POSTGRES_USER:-app}` | The `:-app` fallback is inconsistent with `POSTGRES_USER` being declared required (no default) in `.env.example`. |

**Proposed `media-server` dependency fix:**
```yaml
media-server:
  depends_on:
    migrate:
      condition: service_completed_successfully
```

**Proposed MinIO healthcheck:**
```yaml
minio:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
    interval: 10s
    timeout: 5s
    retries: 10
```

**Proposed `minio-setup` update:**
```yaml
minio-setup:
  depends_on:
    minio:
      condition: service_healthy
```

---

## 5. Makefile & Scripts

### 5.1 Makefile

**File:** `Makefile`

**What it does well:**
- Clean, minimal — only 6 targets.
- `PROJECT` variable for multi-environment use.
- `.PHONY` declared.
- `smoke` uses real health check endpoints.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🟡 Medium | `smoke` target calls `make smoke` which runs `curl` but doesn't check HTTP status on `/health` and `/ready` — it uses `-fsS` (fail on HTTP error), which is correct. But `\nSmoke passed.` uses a literal `\n` instead of `echo ""` for a newline — cosmetic. | Cosmetic |
| 🟡 Medium | No `help` target | A project with 6 Makefile targets should have a `help` target documenting each. New contributors hit `make` with no guidance. |
| 🟡 Medium | No `dev` or `start` alias | Developers most commonly type `make up` but the target name isn't intuitive. A `make dev` alias to `make up` would reduce friction. |
| 🟢 Low | `prune` removes dangling build cache aggressively | `docker builder prune -f` removes ALL dangling build cache, not just this project's. This is destructive if other Docker projects share the host. |

**Recommended additions:**
```makefile
help:
	@echo "Targets:"
	@echo "  up        Build and start all services"
	@echo "  down      Stop services (data preserved)"
	@echo "  logs      Follow all logs"
	@echo "  migrate   Apply pending migrations"
	@echo "  reset-db  Wipe and restart (data destroyed)"
	@echo "  smoke     Run health checks"
	@echo "  prune     Remove containers, volumes, build cache"

dev: up
```

### 5.2 `scripts/dev-local.sh`

**File:** `scripts/dev-local.sh`

**What it does well:**
- Validates required env vars with user-friendly warnings.
- Handles both `concurrently` (if available) and fallback background processes.
- Supports single-service selective start.

**Issues:**

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | `concurrently` mode uses `declare -f` to serialize function bodies | `"$(declare -f start_api); start_api"` passes a bash function definition as a shell string to `concurrently`. This is fragile — it relies on `concurrently` spawning a `bash` subprocess that supports `declare -f` output format. On some shells (dash, sh) this breaks. |
| 🟡 Medium | `.env` loading via `xargs` is fragile for values with spaces or quotes | `export $(grep -v '^#' .env \| grep -v '^$' \| xargs)` fails if any value contains spaces or special characters (e.g., a webhook secret with `$` chars). |
| 🟡 Medium | `set -euo pipefail` but migration mode doesn't trap errors | The `run_migrations` function calls `pnpm db:migrate` — if this fails, the exit message is just the pnpm error with no script-level context message. |
| 🟢 Low | No `check_deps` function | Doesn't verify `node`, `pnpm`, `ffmpeg` are in PATH before starting. Failure messages from these missing deps are confusing. |

**Better `.env` loading:**
```bash
if [ -f .env ]; then
  set -a
  # shellcheck source=.env
  source .env
  set +a
fi
```

**Better `concurrently` invocation (avoid `declare -f`):**
```bash
concurrently \
  --names "web-api,worker,media-server,web" \
  "pnpm --filter @cap/web-api dev" \
  "pnpm --filter @cap/worker dev" \
  "pnpm --filter @cap/media-server dev" \
  "pnpm --filter @cap/web dev"
```

---

## 6. TypeScript Config

**File:** `tsconfig.json`

### 6.1 Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | `"noEmit": true` in root config | The root `tsconfig.json` sets `noEmit: true` globally. Individual packages (`@cap/config`, `@cap/db`, `@cap/logger`) extend their own `tsconfig.json` files for emit, but if any package inadvertently inherits from root, it will silently produce no output. |
| 🟡 Medium | `"jsx": "react-jsx"` in root config | The root config sets `jsx` but this is only relevant for `apps/web`. Backend packages inherit this unnecessarily. |
| 🟡 Medium | `"lib": ["ES2022", "DOM", "DOM.Iterable"]` in root | DOM lib is only needed for frontend. Backend services including `types: ["node"]` have no need for DOM. This could cause incorrect API suggestions in backend code. |
| 🟡 Medium | `"types": ["node", "vite/client"]` in root | `vite/client` augments `ImportMeta` with `env` etc. — these types should only be in `apps/web`. Backend services that inherit these types get misleading IDE suggestions. |
| 🟢 Low | Root `include` picks up all `apps/**` and `packages/**` | For the purposes of a composite project `tsconfig.json`, the root should ideally be a references-only file that doesn't include source directly. |

**Recommended root config:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "files": [],
  "references": [...]
}
```
Then push `jsx`, `DOM`, and `vite/client` into `apps/web/tsconfig.json` only.

### 6.2 Missing Per-Package Items

- `@cap/config`: `packages/config/tsconfig.json` exists but not audited. Verify it does NOT inherit `noEmit: true` from root.
- `@cap/db`: Same concern for `tsconfig.json` emit behavior.
- Apps: `apps/web` should have a separate `tsconfig.node.json` (for `vite.config.ts`) per Vite's recommendation.

---

## 7. ESLint Config

**File:** `eslint.config.js`

### 7.1 What it does well
- Flat config with ESLint 9 — modern.
- Separate blocks for TS, TSX, and plain JS.
- React and react-hooks plugins applied to TSX/JSX only.

### 7.2 Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🟡 Medium | `parserOptions.project: './tsconfig.json'` is a single path | In a monorepo, all packages need their own `tsconfig.json` path for type-aware rules. Using only the root `tsconfig.json` for `parserOptions.project` means type-aware rules (`@typescript-eslint/no-unsafe-*`, etc.) may not work correctly for packages with their own tsconfig. |
| 🟡 Medium | `@typescript-eslint/no-explicit-any: 'warn'` | This should be `'error'` in a strict TypeScript project. Warnings are easy to ignore and accumulate. |
| 🟡 Medium | Config files (`.config.js`, `.config.cjs`) are in `ignores` | ESLint correctly ignores them, but this means `vite.config.ts` and similar are also ignored. Consider ignoring by filename pattern rather than extension to avoid silently skipping typed config files. |
| 🟢 Low | No `import` order rules | No `eslint-plugin-import` or `eslint-plugin-simple-import-sort`. Import ordering is unenforced. |
| 🟢 Low | No `@typescript-eslint/consistent-type-imports` rule | `import type` is not enforced. This can cause circular dependency issues in large projects. |
| 🟢 Low | Globals: `...globals.node` AND `...globals.browser` in same block | Mixing Node and browser globals can mask incorrect API usage (e.g., `window` used in a backend file won't be caught). Split into frontend and backend blocks. |

**Quick win — add these rules:**
```javascript
'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
```

---

## 8. CI/CD Pipeline

**File:** `.github/workflows/test.yml`

### 8.1 What it does well
- Single authoritative workflow file — good consolidation.
- Concurrency group cancels stale runs.
- Build job gated on `lint` + `typecheck`.
- Docker build job with GHA layer caching.
- Playwright artifacts uploaded on failure.
- Separate PostgreSQL service for API E2E.

### 8.2 Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | `pnpm install --frozen-lockfile` runs in every job independently | 6 jobs × full `node_modules` install from cache = still slow. No shared node_modules artifact between jobs. Consider using a single `setup` job that uploads `node_modules` as an artifact or use `actions/cache` with a stable cache key shared across jobs. |
| 🔴 High | API E2E uses PostgreSQL 15 but production uses PostgreSQL 16 | `postgres:15-alpine` is the service image in `api-e2e`. The `docker-compose.yml` uses `postgres:16-alpine`. Test/prod mismatch could mask PG 16-specific behavior. |
| 🟡 Medium | Node version pinned to `20` not `20.x` | `node-version: 20` resolves to latest Node 20. Should be a specific LTS pin (e.g., `20.18.0`) for reproducibility, or at minimum `node-version: "20"` with `check-latest: false`. |
| 🟡 Medium | `web-e2e` and `api-e2e` jobs run in parallel with no dependencies | If `typecheck` or `lint` fails, the expensive E2E jobs still run, wasting minutes. Add `needs: [typecheck, lint]` to both E2E jobs. |
| 🟡 Medium | MinIO started via `docker run` in CI, not Compose | `api-e2e` starts MinIO via a raw `docker run`. This diverges from the Compose setup and could behave differently. Consider starting Compose services for API E2E instead. |
| 🟡 Medium | No `pnpm` version pinned in CI | `uses: pnpm/action-setup@v4` without specifying `version` relies on `packageManager` from `package.json`. This is actually correct (using `packageManager: "pnpm@9.12.3"`), but it should be documented. |
| 🟢 Low | No secrets scan or dependency audit step | No `pnpm audit` or `trufflesecurity/trufflehog` step. For a platform handling API keys, a secrets scan is worth adding. |
| 🟢 Low | No `format:check` step | Prettier is a dev dependency and `format:check` is a root script, but CI doesn't enforce formatting. |
| 🟢 Low | Docker build doesn't push to any registry | `push: false` is correct for CI validation. Document that image publishing is a manual step or add a release workflow stub. |

**Proposed job dependency fix:**
```yaml
web-e2e:
  needs: [typecheck, lint, test]

api-e2e:
  needs: [typecheck, lint, test]
```

**Proposed shared install job pattern:**
```yaml
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/cache/save@v4
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('pnpm-lock.yaml') }}
  
  typecheck:
    needs: install
    # ... restore cache ...
```

---

## 9. Environment Variables & Secrets

**Files:** `.env.example`, `packages/config/src/index.ts`

### 9.1 Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 High | `.env` file is committed to the repository | The repo root has both `.env` (committed with real or near-real values) and `.env.example`. The `.gitignore` should exclude `.env` (check `.gitignore` — if `.env` is not in `.gitignore`, this is a secrets exposure risk). |
| 🟡 Medium | `MEDIA_SERVER_WEBHOOK_SECRET` has insecure example value | `.env.example` has `MEDIA_SERVER_WEBHOOK_SECRET=change-this-to-a-secret-of-32-plus-chars` — this is a placeholder that satisfies the `min(32)` check. A first-time user copying `.env.example` and forgetting to change it will have a "valid" but publicly known secret. |
| 🟡 Medium | S3 credentials in `.env.example` are `minio` / `minio123` | These are widely known defaults. The example file should use `<CHANGE_ME>` placeholders with a generator command, same as the webhook secret. |
| 🟡 Medium | `LOG_PRETTY` env var not in `.env.example` | `@cap/logger` checks `process.env.LOG_PRETTY === 'true'` but this var is undocumented in `.env.example` and absent from the Zod schema. |
| 🟢 Low | No `VITE_APP_VERSION` or build metadata vars | The frontend has no way to display the current deployed version. Adding `VITE_APP_VERSION` baked at build time would help with debugging. |
| 🟢 Low | `WORKER_ID=worker-1` hardcoded default | In multi-worker deployments, workers would all use `worker-1` unless explicitly set. Should document that uniqueness is required when scaling. |

### 9.2 Env Validation Gap

The `@cap/config` package validates env at startup for the services that call `getEnv()`. But there is no validation that:
1. The S3 env vars are present (they're not in the schema — see §2.1)
2. `LOG_LEVEL` is a valid Pino level
3. `MEDIA_SERVER_WEBHOOK_SECRET` exactly matches between web-api and media-server

**Recommendation:** Add a startup log line in each service summarizing validated config (with secrets redacted). This dramatically speeds up debugging misconfigured environments.

---

## 10. DX Improvements

### 10.1 Missing `concurrently` in Root devDependencies

`scripts/dev-local.sh` recommends `npm install -g concurrently` globally. Instead, add it to root `devDependencies`:

```json
"concurrently": "^9.0.0"
```

Then the script can use `npx concurrently` or the pnpm bin directly without a global install.

### 10.2 Missing `dotenv-cli` or Similar for Local Script Loading

`dev-local.sh` loads `.env` with a fragile bash export trick. Consider adding:

```json
"dotenv-cli": "^7.0.0"
```

Then scripts become:
```bash
dotenv -- pnpm --filter @cap/web-api dev
```

### 10.3 `pnpm-workspace.yaml` is Minimal but Complete

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

This is correct. No issues.

### 10.4 Missing Turbo or Nx for Build Graph

With 7 packages, build ordering is managed manually via `build:internal` in `package.json`:

```json
"build:internal": "pnpm --filter @cap/config --filter @cap/db --filter @cap/logger build"
```

This is fine now but will break when a new shared package is added and someone forgets to add it to `build:internal`. Consider adding `turbo` with a minimal `turbo.json` for dependency-aware builds. This is a **Medium complexity** improvement that pays off past ~4 shared packages.

### 10.5 No `lint-staged` + Husky Pre-commit Hook

There's no pre-commit enforcement. Contributors can commit without running lint or typecheck. Adding `lint-staged` + `husky` would catch most issues before they hit CI.

```json
"lint-staged": {
  "**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "**/*.{js,json,md}": ["prettier --write"]
}
```

### 10.6 Root `.npmrc` Not Audited

`.npmrc` exists but was not provided in the audit scope. Verify it contains `shamefully-hoist=false` (default for pnpm strict mode) and no `node-linker=hoisted` setting, which would defeat pnpm's isolation benefits.

### 10.7 Missing VS Code Workspace Settings

No `.vscode/` directory. A `settings.json` recommending the ESLint and Prettier extensions, and `extensions.json` listing recommended extensions, would improve onboarding.

---

## 11. Complexity Estimates

All estimates use **T-shirt sizing**: S = < 2 hours, M = half-day, L = 1-2 days, XL = 3+ days.

| # | Item | Complexity | Risk |
|---|------|-----------|------|
| 1 | Add S3 + LOG_LEVEL to `@cap/config` Zod schema | S | Low |
| 2 | Add `exports` field to `@cap/config` and `@cap/db` | S | Low |
| 3 | Add `resetPool` / `disconnectPool` to `@cap/db` | S | Low |
| 4 | Move `pino-pretty` to devDependencies in `@cap/logger` | S | Low |
| 5 | Fix `scripts/dev-local.sh` concurrently invocation | S | Low |
| 6 | Fix `.env` loading in `dev-local.sh` (use `source`) | S | Low |
| 7 | Add `help` target to Makefile | S | Low |
| 8 | Fix `media-server` depends_on in docker-compose | S | Low |
| 9 | Add MinIO healthcheck to docker-compose | S | Low |
| 10 | Add resource limits to worker/media-server in compose | S | Low |
| 11 | Fix `tsconfig.json` root — remove DOM/jsx from root | M | Medium |
| 12 | Fix ESLint `parserOptions.project` for monorepo | M | Medium |
| 13 | Pin PostgreSQL version in CI to `16` | S | Low |
| 14 | Add `needs` dependency to E2E jobs in CI | S | Low |
| 15 | Add `format:check` to CI | S | Low |
| 16 | Add shared install job or better cache in CI | M | Low |
| 17 | Add `lint-staged` + `husky` pre-commit hooks | M | Low |
| 18 | Add unit tests for `@cap/config`, `@cap/db`, `@cap/logger` | L | Low |
| 19 | Consolidate migration runners (remove bash runner) | M | Medium |
| 20 | Add `concurrently` to root devDependencies | S | Low |
| 21 | Add Turbo build graph | L | Medium |
| 22 | Add `pnpm audit` to CI | S | Low |
| 23 | Verify and fix `.gitignore` re: `.env` file | S | **High** |
| 24 | Add idempotency key TTL cleanup job | M | Low |
| 25 | Fix `web-builder` depends_on in docker-compose | S | Low |

---

## 12. Recommended Migration Path

### Phase A — Security & Correctness (Do immediately)

1. **Verify `.gitignore` excludes `.env`** (item 23 above — potential secrets exposure)
2. **Fix docker-compose `media-server` depends_on** — remove the web-api dependency
3. **Fix docker-compose `web-builder` depends_on** — ensure correct startup ordering
4. **Add S3 vars to `@cap/config` Zod schema** — currently unvalidated at startup

### Phase B — Quick DX Wins (1–2 days)

5. Add MinIO healthcheck; update `minio-setup` to depend on `minio: service_healthy`
6. Fix `dev-local.sh` — source-based env loading, direct pnpm commands in concurrently
7. Add `help` target to Makefile
8. Add resource limits to `worker` and `media-server` in docker-compose
9. Pin PostgreSQL to `16-alpine` in CI
10. Add `needs` to web-e2e and api-e2e CI jobs

### Phase C — TypeScript & Lint Hardening (1 day)

11. Refactor root `tsconfig.json` — remove DOM, jsx, vite/client from root
12. Fix ESLint monorepo project references
13. Tighten `no-explicit-any` from warn to error
14. Add `consistent-type-imports` rule

### Phase D — Package Hygiene (1 day)

15. Add `exports` field to `@cap/config` and `@cap/db`
16. Add `resetPool` / `disconnectPool` to `@cap/db`
17. Move `pino-pretty` to devDependencies
18. Add `LOG_LEVEL` to `@cap/config` schema
19. Add `lint`/`typecheck` scripts to all three packages

### Phase E — CI/CD Improvements (1 day)

20. Add shared node_modules caching across CI jobs
21. Add `format:check` to CI
22. Add `pnpm audit` step

### Phase F — Test Coverage (2–3 days)

23. Unit tests for `@cap/config` (env schema edge cases)
24. Unit tests for `@cap/db` (pool management, transaction rollback)
25. Unit tests for `@cap/logger` (redaction, child context)

### Phase G — Optional Improvements (1+ week)

26. `lint-staged` + `husky` pre-commit hooks
27. `turbo` build graph for dependency-aware builds
28. Idempotency key TTL cleanup job
29. `.vscode/` workspace configuration

---

*Document generated by OpenClaw audit — 2026-03-27. All findings reference checked-in code at time of audit.*
