#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend_new"

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Missing backend folder: $BACKEND_DIR" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Missing frontend folder: $FRONTEND_DIR" >&2
  exit 1
fi

cleanup() {
  set +e
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

export VITE_API_TARGET="${VITE_API_TARGET:-http://127.0.0.1:8000}"
export ENABLE_EXTENDED_INGESTION="${ENABLE_EXTENDED_INGESTION:-false}"
export CPCB_SOURCE_MODE="${CPCB_SOURCE_MODE:-file}"
export ENABLE_SCHEDULER="${ENABLE_SCHEDULER:-false}"
export EXTERNAL_APIS_ENABLED="${EXTERNAL_APIS_ENABLED:-false}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="sqlite:///$BACKEND_DIR/aqi.db"
fi

echo "Starting backend..."
(
  cd "$BACKEND_DIR"
  python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
BACKEND_PID=$!

sleep 2

echo "Starting frontend..."
(
  cd "$FRONTEND_DIR"
  npm run dev -- --host 127.0.0.1 --port 5173
) &
FRONTEND_PID=$!

echo
echo "Backend:  http://127.0.0.1:8000/v1/health"
echo "Frontend: http://127.0.0.1:5173"
echo
echo "Press Ctrl+C to stop both."

wait
