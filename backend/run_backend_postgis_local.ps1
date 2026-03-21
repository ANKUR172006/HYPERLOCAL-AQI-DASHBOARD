# Postgres/PostGIS local run helper.
# Start DB first:
#   docker compose -f ..\docker-compose.postgis.yml up -d

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/aqi_postgis" }
if (-not $env:ENABLE_EXTENDED_INGESTION) { $env:ENABLE_EXTENDED_INGESTION = "false" }
if (-not $env:EXTERNAL_APIS_ENABLED) { $env:EXTERNAL_APIS_ENABLED = "true" }
if (-not $env:ENABLE_SCHEDULER) { $env:ENABLE_SCHEDULER = "false" }

Push-Location $PSScriptRoot
try {
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
  Pop-Location
}
