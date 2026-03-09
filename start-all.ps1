$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

if (-not (Test-Path $backend)) {
  throw "Backend folder not found: $backend"
}
if (-not (Test-Path $frontend)) {
  throw "Frontend folder not found: $frontend"
}

$backendCmd = "cd `"$backend`"; python -m pip install -r requirements.txt; uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
$frontendCmd = "cd `"$frontend`"; if (!(Test-Path node_modules)) { npm install }; npm run dev -- --host 127.0.0.1 --port 5173"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Started backend and frontend in separate windows."
Write-Host "Backend:  http://127.0.0.1:8000/v1/health"
Write-Host "Frontend: http://127.0.0.1:5173"
