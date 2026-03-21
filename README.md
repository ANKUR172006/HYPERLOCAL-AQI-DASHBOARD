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
$env:CPCB_API_URL="YOUR_CPCB_ENDPOINT"
$env:CPCB_API_KEY=""
```

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
