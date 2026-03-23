$ErrorActionPreference = "Stop"

# Live mode: force settings that should always be ON for the demo.
$env:ENABLE_EXTENDED_INGESTION = "false"
$env:ENABLE_SCHEDULER = "true"
$env:ENABLE_XGBOOST_FORECASTING = "true"
$env:FORECAST_MODEL = "xgboost"

# Live CPCB via api.data.gov.in (real-time-ish)
$env:EXTERNAL_APIS_ENABLED = "true"

$key = $env:CPCB_API_KEY
if (-not $key) {
  $envPath = Join-Path $PSScriptRoot ".env"
  if (Test-Path $envPath) {
    $line = Get-Content $envPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*CPCB_API_KEY\s*=' } | Select-Object -Last 1
    if ($line) {
      $key = ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
    }
  }
}
if ($key) {
  $env:CPCB_SOURCE_MODE = "api"
} else {
  # Without CPCB_API_KEY, api.data.gov.in responds with 400; use hybrid to fall back to bundled sample data.
  $env:CPCB_SOURCE_MODE = "hybrid"
  Write-Host "CPCB_API_KEY not set; using CPCB_SOURCE_MODE=hybrid (falls back to sample data). Set CPCB_API_KEY for live pulls." -ForegroundColor Yellow
}

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

function Test-PortFree([int]$Port) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

function Get-ListenerPid([int]$Port) {
  try {
    return (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess
  } catch {
    return $null
  }
}

$requestedPort = 8000
if ($env:PORT) {
  try { $requestedPort = [int]$env:PORT } catch { $requestedPort = 8000 }
}

$port = $null
foreach ($candidate in $requestedPort..($requestedPort + 20)) {
  if (Test-PortFree $candidate) { $port = $candidate; break }
}
if (-not $port) {
  throw "No free port found in range $requestedPort..$($requestedPort + 20)."
}
if ($port -ne $requestedPort) {
  $pid = Get-ListenerPid $requestedPort
  $pidHint = if ($pid) { " (PID $pid)" } else { "" }
  Write-Host "Port $requestedPort is already in use$pidHint; starting on port $port instead." -ForegroundColor Yellow
}

Push-Location $PSScriptRoot
try {
  python -m uvicorn app.main:app --host 0.0.0.0 --port $port
} finally {
  Pop-Location
}
