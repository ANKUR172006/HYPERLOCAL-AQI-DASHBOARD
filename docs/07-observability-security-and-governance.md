# 7. Observability, Security, and Governance

## 7.1 Observability Pillars

1. Metrics
   - ingestion success rate
   - data freshness lag
   - AQI computation latency
   - forecast MAE/RMSE
   - API latency and error rate

2. Logs
   - structured JSON logs by service
   - correlation ID per request/job
   - crisis trigger and decision logs

3. Traces
   - distributed tracing for API to pipeline dependencies

## 7.2 Monitoring Dashboard Set

- `Pipeline Health`
- `Data Quality`
- `AQI and Crisis Map`
- `Forecast Performance`
- `API Reliability`

## 7.3 Alerting Baseline

- Critical alerts:
  - stale data > 15 min
  - crisis job failure
  - API 5xx > threshold
  - database saturation
- Warning alerts:
  - forecast MAE drift
  - quality score degradation trend

## 7.4 Security Controls

- API auth:
  - Citizen APIs: public + rate limiting.
  - Government APIs: JWT/OAuth + RBAC.
- Transport security: TLS enforced.
- Secret management: vault or managed secret store.
- Input hardening: strict schema validation and sanitization.

## 7.5 Compliance and Audit

- Immutable audit for:
  - crisis level transitions
  - policy recommendations and overrides
  - model version changes
- Governance records:
  - threshold config change logs
  - retraining and evaluation reports

## 7.6 Disaster Event Archive

Store for each event:
- timeline
- trigger details
- impacted wards
- actions issued
- post-event quality and forecast behavior

Purpose:
- policy review
- threshold tuning
- model and response improvement

