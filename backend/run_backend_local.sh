#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export ENABLE_EXTENDED_INGESTION="${ENABLE_EXTENDED_INGESTION:-false}"
export CPCB_SOURCE_MODE="${CPCB_SOURCE_MODE:-file}"
export ENABLE_SCHEDULER="${ENABLE_SCHEDULER:-false}"
export EXTERNAL_APIS_ENABLED="${EXTERNAL_APIS_ENABLED:-false}"

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
