# 1. System Architecture

## 1.1 Objective

Build a ward-level, near-real-time AQI intelligence backend that:
- Ingests multi-source air and weather data.
- Estimates AQI even in wards without sensors.
- Detects crisis conditions early.
- Forecasts 1-3 hour AQI.
- Serves citizen and policy dashboards with explainable outputs.

## 1.2 Architecture Style

- Pattern: modular service-oriented backend with scheduled pipelines.
- Data flow: source -> raw -> cleaned -> derived -> serving APIs.
- Computation split:
  - Deterministic AQI engine for current AQI.
  - ML forecasting engine for future AQI.
- Reliability model: graceful degradation when source feeds fail.

## 1.3 Logical Layers

1. Data Ingestion Layer
   - CPCB collector
   - Weather and wind collector
   - Optional ward sensor collector
   - Validation and cleaning module

2. Spatial Interpolation Layer
   - IDW and/or KNN interpolation for ward AQI estimation
   - Sensor-gap fill for non-instrumented wards

3. AQI Calculation Layer
   - CPCB deterministic AQI computation
   - Primary pollutant detection
   - Pollutant contribution ratio computation

4. Hybrid Crisis Detection Layer
   - Rule-based spikes and threshold logic
   - Statistical anomaly detectors (rolling mean, z-score, variance)
   - Disaster Mode auto-switch

5. Forecasting Layer
   - XGBoost models for +1h, +2h, +3h horizons
   - Uses historical AQI, PMI, and weather context

6. AI Explainability Layer
   - Citizen-friendly natural language summary generation
   - Factor attribution from pollutant, weather, and trend signals

7. Policy Recommendation Layer
   - Ward risk ranking
   - Intervention suggestions for authorities

8. Citizen API Layer
   - Real-time and forecast endpoints
   - Consistent contract + quality flags + Disaster Mode state

9. Logging and Monitoring Layer
   - Pipeline health
   - Data quality and anomaly audit trail
   - Forecast accuracy tracking

## 1.4 Deployment Blueprint

- API runtime: FastAPI service containers.
- Storage:
  - PostgreSQL + PostGIS for canonical records and spatial operations.
  - Redis for low-latency cache.
- Scheduling: Celery beat / cron / Prefect for periodic jobs.
- Optional event bus: Kafka or RabbitMQ for scale.
- Observability: Prometheus, Grafana, centralized logs.

## 1.5 End-to-End Data Flow

1. Pull source feeds.
2. Validate, normalize units, and quality-tag records.
3. Map station points to ward geometry.
4. Interpolate missing ward pollutant values.
5. Compute AQI and pollutant contributions.
6. Run anomaly checks and set crisis level.
7. Run forecast jobs for next 1-3 hours.
8. Generate explanations and policy suggestions.
9. Publish API-ready snapshots and update cache.
10. Emit logs/metrics and archive crisis events.

## 1.6 Non-Functional Requirements

- Data freshness target: <= 10 minutes lag.
- Availability target (MVP): 99.5% monthly for read APIs.
- API latency target: p95 <= 500 ms for cached routes.
- Traceability: every output linked to source timestamps and version tags.
- Auditability: crisis decisions and policy recommendations must be reproducible.

