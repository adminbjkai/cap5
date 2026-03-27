# Deployment

## What exists today

The repo contains a Docker Compose-based production-ish stack, not a full platform deployment system.

Main artifacts:

- `Dockerfile`
- `docker-compose.yml`
- nginx config under `docker/nginx`
- postgres migration runner under `docker/postgres/run-migrations.sh`

## Compose topology

Services:

- `postgres`
- `migrate`
- `minio`
- `minio-setup`
- `web-api`
- `worker`
- `media-server`
- `web-builder`
- `web-internal`

Published ports by default:

- `3000` — API
- `3100` — media server
- `8022` — web UI
- `8922` — MinIO API
- `8923` — MinIO console, loopback-only

## Operational assumptions

- single tenant
- trusted internal network between services
- MinIO/S3 and Postgres are directly reachable by application services
- outbound access to Deepgram and Groq is available
- FFmpeg is available in the media-server image

## Before deploying

Set real values for:

- database credentials and `DATABASE_URL`
- MinIO/S3 credentials
- `MEDIA_SERVER_WEBHOOK_SECRET`
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`

Also review:

- no auth model
- unsigned outbound webhooks
- public exposure of MinIO API if you keep the default port mapping

## Start/stop

```bash
make up
make down
make logs
```

## Migration behavior

The `migrate` service runs pending SQL migrations before `web-api` and `worker` start.

## Gaps to address before serious production use

- auth and tenant isolation
- secret management
- HTTPS termination and ingress story
- observability/metrics/tracing
- background worker autoscaling story
- signed outbound webhook delivery
- backup/restore and retention policies
