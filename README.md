# Hyperlocal AQI System

## Run Backend

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### CPCB-backed pipeline (now default)

Backend pipeline now follows:
`Data Sources -> Ingestion -> Cleaning/Validation -> IDW -> CPCB AQI -> AI Forecasting -> Hybrid Crisis Detection -> Early Warning -> DB -> API`.

Default source mode is the bundled sample file (`file`). Switch to CPCB API (`api`) for live pulls (or `hybrid` for best-effort API with file fallback).

Optional environment variables for live feed wiring:

```powershell
$env:CPCB_SOURCE_MODE="api"    # api | file | hybrid
$env:CPCB_FILE_PATH="data/cpcb_delhi_sample.csv"
$env:CPCB_API_URL="/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"
$env:CPCB_API_KEY=""
```

State/UT station-count metadata (CAAQMS + NAMP counts) uses a separate dataset and the same key:

```powershell
$env:CPCB_STATION_COUNTS_API_URL="/resource/4933f0fd-158e-4098-ac0a-dfe69d5ff8c3"
```

API: `GET /v1/cpcb/station-counts`

Install `xgboost` to enable true XGBoost forecasts; without it, backend uses a momentum fallback model.

Optional environment toggles:

```powershell
$env:ENABLE_EXTENDED_INGESTION="false"   # default: false (avoids external API calls on startup)
$env:ENABLE_XGBOOST_FORECASTING="true"   # default: false (XGBoost training can be slow)
```

Backend base URL: `http://127.0.0.1:8000/v1`

Run backend tests:

```powershell
cd backend
python -m pytest -q
```

## Run Frontend

```powershell
cd frontend_new
npm install
npm run dev
```

Frontend URL: `http://127.0.0.1:5173`

## Deploy on Render (single service)

This repo is Render-ready as a single Docker web service.

- Render should use the root `Dockerfile`.
- The Docker build compiles `frontend_new` and copies the built files into `backend/app/static`.
- FastAPI serves both the API and the frontend from the same service.
- Use a persistent disk and set `RENDER_DISK_PATH=/var/data` so SQLite survives redeploys and restarts.
- Recommended health check: `/v1/health`

Recommended Render env vars:

```text
EXTERNAL_APIS_ENABLED=true
ENABLE_EXTENDED_INGESTION=true
ENABLE_SCHEDULER=false
ENABLE_XGBOOST_FORECASTING=true
FORECAST_MODEL=auto
LIVE_DATA_STRICT=false
RENDER_DISK_PATH=/var/data
```

Required secrets:

```text
CPCB_API_KEY=...
FIRMS_MAP_KEY=...
NASA_API_KEY=...   # optional but recommended
```

The repo-level `render.yaml` is configured for this setup.

## Deploy on Railway (single service)

This repo ships a root `Dockerfile` that builds `frontend_new` and serves it via the FastAPI backend.

- **Recommended:** don’t set any Railway “Start Command” (let Docker run the image default).
- If Railway requires a start command, set it to: `python -m app.entrypoint`

## Start Both (Windows PowerShell)

From project root:

```powershell
.\start-all.ps1
```

## Integrated APIs Used by Frontend

- `/v1/ward-map-data`
- `/v1/location-insights?lat=<>&lon=<>`
- `/v1/ward-aqi`
- `/v1/aqi-forecast`
- `/v1/pollutant-breakdown`
- `/v1/alerts`
- `/v1/alerts/feed`
- `/v1/analytics/trends`
- `/v1/gov/recommendations`
- `/v1/complaints`

## Extended Environmental Ingestion APIs

- `POST /v1/environment/ingest?lat=<>&lon=<>`
- `GET /v1/environment/unified?lat=<>&lon=<>[&refresh=true]`

These enrich CPCB ingestion with:
- Open-Meteo weather fields
- NASA Earth satellite metadata
- Nominatim location intelligence

`ENABLE_EXTENDED_INGESTION=true` is enabled by default for continuous multi-source ingestion.
`ENABLE_EXTENDED_INGESTION` is off by default; enable it only when you want live external enrichment.
