$ErrorActionPreference = "Stop"

# Live mode: force settings that should always be ON for the demo.
$env:ENABLE_EXTENDED_INGESTION = "true"
$env:ENABLE_SCHEDULER = "true"
$env:ENABLE_XGBOOST_FORECASTING = "true"
$env:FORECAST_MODEL = "auto"
$env:LIVE_DATA_STRICT = "true"

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
  throw "CPCB_API_KEY not set. Live mode refuses fallback/sample data."
}

# NASA "satellite signal" can be slow; use a higher default timeout for live demos.
if (-not $env:NASA_TIMEOUT_SEC) { $env:NASA_TIMEOUT_SEC = "25" }
if (-not $env:NASA_MAX_RETRIES) { $env:NASA_MAX_RETRIES = "3" }

# Leave CPCB filters open by default so the backend can resolve live data for
# the active location (for example WCTM College, Gurugram) instead of forcing
# the old Delhi-only demo feed.
if (-not $env:CPCB_FILTER_CITY) { $env:CPCB_FILTER_CITY = "" }
if (-not $env:CPCB_FILTER_STATE) { $env:CPCB_FILTER_STATE = "" }

# Pull enough rows/pages for non-Delhi searches too.
if (-not $env:CPCB_API_LIMIT) { $env:CPCB_API_LIMIT = "100" }
if (-not $env:CPCB_API_MAX_PAGES) { $env:CPCB_API_MAX_PAGES = "6" }

if (-not $env:FIRMS_MAP_KEY) {
  $envPath = Join-Path $PSScriptRoot ".env"
  if (Test-Path $envPath) {
    $line = Get-Content $envPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*FIRMS_MAP_KEY\s*=' } | Select-Object -Last 1
    if ($line) {
      $env:FIRMS_MAP_KEY = ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
    }
  }
}
if (-not $env:FIRMS_MAP_KEY) {
  throw "FIRMS_MAP_KEY not set. Live mode refuses disabled fire data."
}

if (-not $env:NASA_API_KEY) {
  Write-Host "NASA_API_KEY not set; satellite layer will use live FIRMS proxy instead of NASA Earth imagery." -ForegroundColor Yellow
}

# IDW: use all stations within 80km, pick 3 nearest, high power so closer stations dominate.
if (-not $env:IDW_NEAREST_N) { $env:IDW_NEAREST_N = "3" }
if (-not $env:IDW_RADIUS_KM) { $env:IDW_RADIUS_KM = "80" }
if (-not $env:IDW_POWER) { $env:IDW_POWER = "3.0" }

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

function Stop-PythonListenerIfSafe([int]$Port) {
  $pid = Get-ListenerPid $Port
  if (-not $pid) { return $false }
  try {
    $proc = Get-Process -Id $pid -ErrorAction Stop
    $name = ($proc.ProcessName | Out-String).Trim()
    if ($name -notmatch '^(python|python3|py|uvicorn)$') {
      return $false
    }
    Write-Host "Stopping existing Python listener on port $Port (PID $pid) so the updated backend can reuse that port." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 800
    return (Test-PortFree $Port)
  } catch {
    return $false
  }
}

$requestedPort = 8000
if ($env:PORT) {
  try { $requestedPort = [int]$env:PORT } catch { $requestedPort = 8000 }
}

$reusedRequestedPort = $false
if (-not (Test-PortFree $requestedPort)) {
  $reusedRequestedPort = Stop-PythonListenerIfSafe $requestedPort
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
  Write-Host "Starting backend on http://127.0.0.1:$port (reload enabled for local changes)." -ForegroundColor Green
  if ($reusedRequestedPort) {
    Write-Host "Reused port $requestedPort after stopping an older Python backend process." -ForegroundColor Green
  }
  $env:PORT = [string]$port
  python -m uvicorn app.main:app --host 0.0.0.0 --port $port --reload
} finally {
  Pop-Location
}
http://127.0.0.1:5173/
