# Environment

The source of truth for runtime parsing is `packages/config/src/index.ts`. Example values live in `.env.example`.

## Required

These must be set to valid values:

- `DATABASE_URL`
- `MEDIA_SERVER_WEBHOOK_SECRET` (min 32 chars)
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

## Core runtime

- `NODE_ENV` — default `development`
- `LOG_LEVEL` — `trace|debug|info|warn|error`, default `info`
- `LOG_PRETTY` — optional

## API/media ports and URLs

- `WEB_API_PORT` — default `3000`
- `MEDIA_SERVER_PORT` — default `3100`
- `MEDIA_SERVER_BASE_URL` — default `http://media-server:3100`

## Webhook security

- `MEDIA_SERVER_WEBHOOK_SECRET`
- `WEBHOOK_MAX_SKEW_SECONDS` — default `300`

## Providers

### Deepgram

- `DEEPGRAM_API_KEY`
- `DEEPGRAM_MODEL` — default `nova-2`
- `DEEPGRAM_BASE_URL` — default `https://api.deepgram.com`

### Groq

- `GROQ_API_KEY`
- `GROQ_MODEL` — default `llama-3.3-70b-versatile`
- `GROQ_BASE_URL` — default `https://api.groq.com/openai/v1`

### Shared provider timeout

- `PROVIDER_TIMEOUT_MS` — default `45000`

## Worker tuning

- `WORKER_ID` — default `worker-1`
- `WORKER_CLAIM_BATCH_SIZE` — default `5`
- `WORKER_LEASE_SECONDS` — default `60`
- `WORKER_MAX_ATTEMPTS` — default `6`
- `WORKER_POLL_MS` — default `2000`
- `WORKER_HEARTBEAT_MS` — default `15000`
- `WORKER_RECLAIM_MS` — default `10000`

## S3 / MinIO

- `S3_ENDPOINT` — internal server-to-storage URL, default `http://minio:9000`
- `S3_PUBLIC_ENDPOINT` — browser-visible/public base, default `http://localhost:8922`
- `S3_REGION` — default `us-east-1`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET` — default `cap4`
- `S3_FORCE_PATH_STYLE` — default `true`

## Docker compose convenience vars

These are used by the compose stack and `.env.example`:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_PORT`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_PORT`
- `MINIO_CONSOLE_PORT`

## Frontend build-time vars

The frontend also references optional Vite vars in `.env.example`:

- `VITE_S3_PUBLIC_ENDPOINT`
- `VITE_S3_BUCKET`

Those are not parsed by `@cap/config`; they are consumed by the web build/runtime.
