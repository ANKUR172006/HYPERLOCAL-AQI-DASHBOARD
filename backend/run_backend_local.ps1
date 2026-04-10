$ErrorActionPreference = "Stop"

if (-not $env:ENABLE_EXTENDED_INGESTION) { $env:ENABLE_EXTENDED_INGESTION = "false" }
if (-not $env:CPCB_SOURCE_MODE) { $env:CPCB_SOURCE_MODE = "file" }
if (-not $env:ENABLE_SCHEDULER) { $env:ENABLE_SCHEDULER = "false" }
if (-not $env:EXTERNAL_APIS_ENABLED) { $env:EXTERNAL_APIS_ENABLED = "false" }
if (-not $env:DATABASE_URL) {
  $dbPath = (Join-Path $PSScriptRoot "aqi.db") -replace "\\", "/"
  $env:DATABASE_URL = "sqlite:///$dbPath"
}
if (-not $env:DELHI_WARDS_GEOJSON_PATH) {
  $delhiWards = Join-Path $PSScriptRoot "data\Delhi_Wards.geojson"
  if (Test-Path $delhiWards) {
    $env:DELHI_WARDS_GEOJSON_PATH = $delhiWards
  }
}
if (-not $env:GURUGRAM_WARDS_GEOJSON_PATH) {
  $gurugramWards = Join-Path $PSScriptRoot "data\Gurugram_Wards.geojson"
  if (Test-Path $gurugramWards) {
    $env:GURUGRAM_WARDS_GEOJSON_PATH = $gurugramWards
  }
}

Push-Location $PSScriptRoot
try {
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
  Pop-Location
}
