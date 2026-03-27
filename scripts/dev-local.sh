#!/usr/bin/env bash
# dev-local.sh — Start cap5 services locally without Docker.
#
# Prerequisites:
#   - Node 20+ and pnpm installed
#   - PostgreSQL running on localhost:5432 (local install or Homebrew)
#   - MinIO running on localhost:9000 (see notes below)
#   - ffmpeg installed (brew install ffmpeg / apt install ffmpeg)
#
# Quick MinIO setup (one-time):
#   brew install minio/stable/minio        # macOS
#   apt-get install minio                  # Ubuntu (or download binary)
#   minio server ~/minio-data &            # start in background (port 9000)
#
# Quick PostgreSQL setup (one-time):
#   createdb cap4
#   createuser app --pwprompt              # set password to "app" or update DATABASE_URL
#
# Then apply migrations once:
#   DATABASE_URL=postgres://app:app@localhost:5432/cap4 pnpm db:migrate
#
# Usage:
#   ./scripts/dev-local.sh           # start all 4 services concurrently
#   ./scripts/dev-local.sh api       # start only web-api
#   ./scripts/dev-local.sh worker    # start only worker
#   ./scripts/dev-local.sh migrate   # apply pending SQL migrations locally

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Load .env if present.
# Using `set -a; source .env; set +a` instead of the fragile xargs approach:
#   - Correctly handles values with spaces
#   - Correctly handles quoted values
#   - Skips blank lines and comments automatically (via bash sourcing)
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
  echo "Loaded .env"
fi

# Override service URLs for local (no Docker) operation
export DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:5432/cap4}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
export S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-http://localhost:9000}"
export MEDIA_SERVER_BASE_URL="${MEDIA_SERVER_BASE_URL:-http://localhost:3100}"
export WEB_API_PORT="${WEB_API_PORT:-3000}"
export MEDIA_SERVER_PORT="${MEDIA_SERVER_PORT:-3100}"

# Verify critical env vars (warn but don't abort — developer may still be setting up)
if [ -z "${DEEPGRAM_API_KEY:-}" ] || [ "${DEEPGRAM_API_KEY}" = "your_deepgram_api_key_here" ]; then
  echo "WARNING: DEEPGRAM_API_KEY is not set — transcription will fail."
fi
if [ -z "${GROQ_API_KEY:-}" ] || [ "${GROQ_API_KEY}" = "your_groq_api_key_here" ]; then
  echo "WARNING: GROQ_API_KEY is not set — AI pipeline will fail."
fi

# ---------------------------------------------------------------------------
# Signal handling — clean up child processes on SIGINT / SIGTERM
# Stores PIDs as services start so we can kill them all on exit.
# ---------------------------------------------------------------------------
CHILD_PIDS=()

cleanup() {
  echo ""
  echo "[dev-local] Caught signal — stopping all services..."
  for pid in "${CHILD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "[dev-local] All services stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM

# ---------------------------------------------------------------------------
# Per-service start functions
# ---------------------------------------------------------------------------

start_api() {
  echo "[web-api] Starting on :${WEB_API_PORT}"
  pnpm --filter @cap/web-api dev
}

start_worker() {
  echo "[worker] Starting"
  pnpm --filter @cap/worker dev
}

start_media_server() {
  echo "[media-server] Starting on :${MEDIA_SERVER_PORT}"
  pnpm --filter @cap/media-server dev
}

start_web() {
  echo "[web] Starting Vite dev server on :5173"
  pnpm --filter @cap/web dev
}

run_migrations() {
  echo "[db] Applying pending migrations via pnpm db:migrate"
  pnpm db:migrate
}

# ---------------------------------------------------------------------------
# Mode dispatch
# ---------------------------------------------------------------------------

MODE="${1:-all}"

case "$MODE" in
  api)          start_api ;;
  worker)       start_worker ;;
  media-server) start_media_server ;;
  web)          start_web ;;
  migrate)      run_migrations ;;
  all)
    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║  cap5 — local dev stack starting         ║"
    echo "║  Services: web-api · worker · media-server · web  ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""

    # Prefer 'concurrently' for nicely interleaved, coloured output.
    # Fall back to plain backgrounded processes with signal forwarding.
    if command -v concurrently &>/dev/null; then
      concurrently \
        --names "web-api,worker,media-server,web" \
        --prefix-colors "blue,green,yellow,cyan" \
        "pnpm --filter @cap/web-api dev" \
        "pnpm --filter @cap/worker dev" \
        "pnpm --filter @cap/media-server dev" \
        "pnpm --filter @cap/web dev"
    else
      echo "Tip: install 'concurrently' for nicely interleaved output:"
      echo "  npm install -g concurrently"
      echo ""
      echo "Starting all services in background (logs mixed to stdout)..."

      start_api &
      CHILD_PIDS+=($!)
      start_worker &
      CHILD_PIDS+=($!)
      start_media_server &
      CHILD_PIDS+=($!)
      start_web &
      CHILD_PIDS+=($!)

      echo ""
      echo "[dev-local] All services started. Press Ctrl+C to stop."
      wait
    fi
    ;;
  *)
    echo "Usage: $0 [all|api|worker|media-server|web|migrate]"
    exit 1
    ;;
esac
