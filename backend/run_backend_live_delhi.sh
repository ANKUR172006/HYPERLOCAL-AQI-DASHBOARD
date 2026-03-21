#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Live CPCB via api.data.gov.in (real-time-ish), tuned for Pragati Maidan / central Delhi.
export ENABLE_EXTENDED_INGESTION="${ENABLE_EXTENDED_INGESTION:-false}"
export ENABLE_SCHEDULER="${ENABLE_SCHEDULER:-true}"
export ENABLE_XGBOOST_FORECASTING="${ENABLE_XGBOOST_FORECASTING:-true}"
export FORECAST_MODEL="${FORECAST_MODEL:-xgboost}"

export EXTERNAL_APIS_ENABLED="${EXTERNAL_APIS_ENABLED:-true}"
export CPCB_SOURCE_MODE="${CPCB_SOURCE_MODE:-api}"

# NASA "satellite signal" can be slow; use a higher default timeout for live demos.
export NASA_TIMEOUT_SEC="${NASA_TIMEOUT_SEC:-25}"
export NASA_MAX_RETRIES="${NASA_MAX_RETRIES:-3}"

# Optional: filter the CPCB API to Delhi (depends on upstream field values).
export CPCB_FILTER_CITY="${CPCB_FILTER_CITY:-Delhi}"
export CPCB_FILTER_STATE="${CPCB_FILTER_STATE:-Delhi}"

# Try to fetch enough rows to cover Delhi stations (Data.gov is paginated).
export CPCB_API_LIMIT="${CPCB_API_LIMIT:-100}"
export CPCB_API_MAX_PAGES="${CPCB_API_MAX_PAGES:-4}"

# Make the interpolation more "local" (closer to Pragati Maidan).
export IDW_NEAREST_N="${IDW_NEAREST_N:-6}"
export IDW_RADIUS_KM="${IDW_RADIUS_KM:-15}"
export IDW_POWER="${IDW_POWER:-2.0}"

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
