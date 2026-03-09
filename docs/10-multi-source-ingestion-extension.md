# 10. Multi-Source Ingestion Extension

This extension keeps the existing CPCB AQI collector intact and adds:

- Open-Meteo weather intelligence
- NASA Earth satellite metadata ingestion
- Nominatim reverse geocoding (location intelligence)

## Backend Folder Structure (new modules)

```text
backend/
  app/
    services/
      collectors/
        http_client.py
        weather_collector.py
        satellite_collector.py
        location_collector.py
      processing/
        environmental_processing.py
      environmental_ingestion_service.py
```

## Unified Pipeline Step

```text
CPCB AQI Stations
  -> Open-Meteo Weather
  -> NASA Satellite Metadata
  -> Nominatim Location Intelligence
  -> Unified Environmental Dataset
```

## New API Endpoints

- `POST /v1/environment/ingest?lat=<>&lon=<>`
- `GET /v1/environment/unified?lat=<>&lon=<>[&refresh=true]`

## Database Schema

Added SQLAlchemy entities and PostGIS schema for:

- `stations`
- `pollution_readings`
- `weather_data`
- `satellite_data`
- `location_metadata`

PostGIS DDL file:

- `backend/db/schema_postgis.sql`

## Error Handling and Retry

- External API calls use `get_json_with_retry` with exponential backoff.
- Collector failures degrade gracefully and return empty/default snapshots.
- Existing CPCB-to-AQI deterministic path remains unchanged.
