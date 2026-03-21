$ErrorActionPreference = "Stop"

if (-not $env:ENABLE_EXTENDED_INGESTION) { $env:ENABLE_EXTENDED_INGESTION = "false" }
# Live mode: keep pipeline refreshing and enable the ML forecaster by default.
if (-not $env:ENABLE_SCHEDULER) { $env:ENABLE_SCHEDULER = "true" }
if (-not $env:ENABLE_XGBOOST_FORECASTING) { $env:ENABLE_XGBOOST_FORECASTING = "true" }
if (-not $env:FORECAST_MODEL) { $env:FORECAST_MODEL = "xgboost" }

# Live CPCB via api.data.gov.in (real-time-ish)
if (-not $env:EXTERNAL_APIS_ENABLED) { $env:EXTERNAL_APIS_ENABLED = "true" }
if (-not $env:CPCB_SOURCE_MODE) { $env:CPCB_SOURCE_MODE = "api" }

# NASA "satellite signal" can be slow; use a higher default timeout for live demos.
if (-not $env:NASA_TIMEOUT_SEC) { $env:NASA_TIMEOUT_SEC = "25" }
if (-not $env:NASA_MAX_RETRIES) { $env:NASA_MAX_RETRIES = "3" }

# Optional: filter the CPCB API to Delhi (depends on upstream field values).
if (-not $env:CPCB_FILTER_CITY) { $env:CPCB_FILTER_CITY = "Delhi" }
if (-not $env:CPCB_FILTER_STATE) { $env:CPCB_FILTER_STATE = "Delhi" }

# Try to fetch enough rows to cover Delhi stations (Data.gov is paginated).
if (-not $env:CPCB_API_LIMIT) { $env:CPCB_API_LIMIT = "100" }
if (-not $env:CPCB_API_MAX_PAGES) { $env:CPCB_API_MAX_PAGES = "4" }

# Make the interpolation more "local" (closer to Pragati Maidan).
if (-not $env:IDW_NEAREST_N) { $env:IDW_NEAREST_N = "6" }
if (-not $env:IDW_RADIUS_KM) { $env:IDW_RADIUS_KM = "15" }
if (-not $env:IDW_POWER) { $env:IDW_POWER = "2.0" }

Push-Location $PSScriptRoot
try {
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
  Pop-Location
}
