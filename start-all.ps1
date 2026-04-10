$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend_new"

if (-not (Test-Path $backend)) {
  throw "Backend folder not found: $backend"
}
if (-not (Test-Path $frontend)) {
  throw "Frontend folder not found: $frontend"
}

$backendCmd = "cd `"$backend`"; .\\run_backend_live_delhi.ps1"
$frontendCmd = "cd `"$frontend`"; if (!(Test-Path node_modules)) { npm.cmd install }; npm.cmd run dev -- --host 0.0.0.0 --port 5173"

if (-not $env:VITE_API_TARGET) {
  $env:VITE_API_TARGET = "http://127.0.0.1:8000"
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Started backend and frontend in separate windows."
Write-Host "Backend:  http://127.0.0.1:8000/v1/health"
Write-Host "Frontend: http://127.0.0.1:5173"
Write-Host "Share on same Wi-Fi/LAN: http://10.132.129.147:5173"
