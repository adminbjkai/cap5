# Local development

## Option 1: Docker Compose

```bash
cp .env.example .env
make up
make smoke
```

What starts:

- postgres
- migrate job
- minio
- minio setup job
- web-api
- worker
- media-server
- web-builder
- web-internal (nginx on `:8022`)

## Option 2: no Docker

Prereqs:

- Node 20+
- pnpm
- PostgreSQL
- MinIO or S3-compatible storage
- FFmpeg/ffprobe

Recommended steps:

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
bash scripts/dev-local.sh
```

That script:

- loads `.env` if present
- overrides service URLs for localhost defaults
- can start all services or individual ones

Modes:

```bash
bash scripts/dev-local.sh all
bash scripts/dev-local.sh api
bash scripts/dev-local.sh worker
bash scripts/dev-local.sh media-server
bash scripts/dev-local.sh web
bash scripts/dev-local.sh migrate
```

## Web app URLs

- Docker/nginx flow: `http://localhost:8022`
- Vite dev flow: `http://localhost:5173`

## Useful checks

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
curl -fsS http://localhost:3100/health
```

## Tests

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @cap/web test:e2e
pnpm --filter @cap/web-api test:e2e
pnpm --filter @cap/web-api test:integration
```
