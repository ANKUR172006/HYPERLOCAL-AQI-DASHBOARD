# 3. API Contracts

## 3.1 API Principles

- Versioned routes: `/v1/...`
- JSON response envelope across all endpoints.
- UTC timestamps in ISO-8601.
- Every response includes `data_quality` and `disaster_mode`.

## 3.2 Standard Response Envelope

```json
{
  "timestamp": "2026-03-05T06:30:00Z",
  "ward_id": "DEL_WARD_021",
  "disaster_mode": false,
  "data_quality": {
    "score": 0.93,
    "flag": "OK"
  },
  "data": {}
}
```

## 3.3 Citizen Endpoints

1. `GET /v1/aqi/current?ward_id={id}`
   - Returns current AQI, category, primary pollutant, PMI.

2. `GET /v1/aqi/forecast?ward_id={id}&horizon=1|2|3`
   - Returns forecasted AQI for selected horizon.

3. `GET /v1/pollutant/contribution?ward_id={id}`
   - Returns pollutant contribution percentages.

4. `GET /v1/cause/hint?ward_id={id}`
   - Returns explainable text for current trend and near-term outlook.

5. `GET /v1/crisis/status?ward_id={id}`
   - Returns ward crisis level and trigger reason.

## 3.4 Government Endpoints

1. `GET /v1/gov/wards/risk-ranking?city_id={id}`
   - Sorted ward-level risk list.

2. `GET /v1/gov/recommendations?ward_id={id}`
   - Intervention suggestions with confidence score.

3. `GET /v1/gov/crisis/events?from={iso}&to={iso}`
   - Crisis event history and resolution timeline.

## 3.5 Health and Operations Endpoints

1. `GET /v1/health`
2. `GET /v1/readiness`
3. `GET /v1/metrics` (Prometheus format, internal only)

## 3.6 Error Contract

```json
{
  "timestamp": "2026-03-05T06:30:00Z",
  "error": {
    "code": "WARD_NOT_FOUND",
    "message": "Ward ID is invalid for the selected city.",
    "details": []
  }
}
```

Standard error codes:
- `BAD_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `WARD_NOT_FOUND`
- `DATA_NOT_READY`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## 3.7 Caching and SLA Notes

- Suggested cache TTL:
  - current AQI: 60 seconds
  - forecast: 180 seconds
  - contribution and explanation: 120 seconds
- Under Disaster Mode:
  - current AQI and crisis status TTL drops to 30 seconds.

