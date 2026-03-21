#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend_new"

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Backend folder not found: $BACKEND_DIR" >&2
  exit 1
fi
if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Frontend folder not found: $FRONTEND_DIR" >&2
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

echo "Starting backend..."
(
  cd "$BACKEND_DIR"
  ./run_backend_local.sh
) &
BACKEND_PID=$!

echo "Starting frontend..."
(
  cd "$FRONTEND_DIR"
  export VITE_API_TARGET="${VITE_API_TARGET:-http://127.0.0.1:8000}"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run dev -- --host 127.0.0.1 --port 5173
) &
FRONTEND_PID=$!

echo
echo "Backend:  http://127.0.0.1:8000/v1/health"
echo "Frontend: http://127.0.0.1:5173"
echo
echo "Press Ctrl+C to stop."

wait
