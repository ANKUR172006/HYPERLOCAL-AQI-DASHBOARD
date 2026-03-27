#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Live CPCB via api.data.gov.in (real-time-ish), tuned for Pragati Maidan / central Delhi.
# Force demo-friendly settings (avoid inheriting stale env vars from the caller shell).
export ENABLE_EXTENDED_INGESTION="false"
export ENABLE_SCHEDULER="true"
export ENABLE_XGBOOST_FORECASTING="true"
export FORECAST_MODEL="xgboost"
export LIVE_DATA_STRICT="true"

export EXTERNAL_APIS_ENABLED="true"

key="${CPCB_API_KEY:-}"
if [[ -z "$key" && -f ".env" ]]; then
  key="$(grep -E '^[[:space:]]*CPCB_API_KEY[[:space:]]*=' .env | tail -n 1 | sed 's/^[^=]*=//')"
  key="${key%$'\r'}"
  key="${key%\"}"; key="${key#\"}"
  key="${key%\'}"; key="${key#\'}"
  key="$(echo -n "$key" | xargs)"
fi

if [[ -n "$key" ]]; then
  export CPCB_SOURCE_MODE="api"
else
  echo "CPCB_API_KEY not set. Live mode refuses fallback/sample data." >&2
  exit 1
fi

# NASA "satellite signal" can be slow; use a higher default timeout for live demos.
export NASA_TIMEOUT_SEC="${NASA_TIMEOUT_SEC:-25}"
export NASA_MAX_RETRIES="${NASA_MAX_RETRIES:-3}"

# Optional: filter the CPCB API to Delhi (depends on upstream field values).
export CPCB_FILTER_CITY="${CPCB_FILTER_CITY:-Delhi}"
export CPCB_FILTER_STATE="${CPCB_FILTER_STATE:-Delhi}"

# Try to fetch enough rows to cover Delhi stations (Data.gov is paginated).
export CPCB_API_LIMIT="${CPCB_API_LIMIT:-100}"
export CPCB_API_MAX_PAGES="${CPCB_API_MAX_PAGES:-4}"

if [[ -z "${FIRMS_MAP_KEY:-}" && -f ".env" ]]; then
  firms_key="$(grep -E '^[[:space:]]*FIRMS_MAP_KEY[[:space:]]*=' .env | tail -n 1 | sed 's/^[^=]*=//')"
  firms_key="${firms_key%$'\r'}"
  firms_key="${firms_key%\"}"; firms_key="${firms_key#\"}"
  firms_key="${firms_key%\'}"; firms_key="${firms_key#\'}"
  firms_key="$(echo -n "$firms_key" | xargs)"
  export FIRMS_MAP_KEY="${firms_key:-}"
fi

if [[ -z "${FIRMS_MAP_KEY:-}" ]]; then
  echo "FIRMS_MAP_KEY not set. Live mode refuses disabled fire data." >&2
  exit 1
fi

if [[ -z "${NASA_API_KEY:-}" ]]; then
  echo "NASA_API_KEY not set; satellite layer will use live FIRMS proxy instead of NASA Earth imagery." >&2
fi

# Make the interpolation more "local" (closer to Pragati Maidan).
export IDW_NEAREST_N="${IDW_NEAREST_N:-6}"
export IDW_RADIUS_KM="${IDW_RADIUS_KM:-15}"
export IDW_POWER="${IDW_POWER:-2.0}"

export REQUESTED_PORT="${PORT:-8000}"
PORT="$(python - <<'PY'\nimport os, socket\nstart = int(os.environ.get('REQUESTED_PORT', '8000'))\nfor port in range(start, start + 21):\n    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n    try:\n        s.bind(('127.0.0.1', port))\n        print(port)\n        break\n    except OSError:\n        pass\n    finally:\n        s.close()\nelse:\n    raise SystemExit(1)\nPY\n)"
export PORT
if [[ "$PORT" != "$REQUESTED_PORT" ]]; then
  echo "Port $REQUESTED_PORT is already in use; starting on port $PORT instead." >&2
fi

python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
