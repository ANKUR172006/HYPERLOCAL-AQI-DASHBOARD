# 8. MVP Scope and Delivery Plan

## 8.1 MVP Scope (Phase 1)

In-scope:
- Single-city deployment.
- Ward-level AQI snapshots.
- Hybrid crisis detection.
- 1-3 hour AQI forecasting.
- Citizen APIs and basic government dashboard APIs.
- Core logs/metrics and incident alerts.

Out-of-scope for MVP:
- Multi-city orchestration.
- Advanced satellite fusion models.
- Full automation of intervention execution.

## 8.2 Preconditions Before Build

1. Final ward boundary GeoJSON approval.
2. CPCB and weather source SLA and quota confirmation.
3. Frozen formula document for AQI and PMI.
4. City-specific threshold config baseline.
5. Success metrics agreement:
   - freshness lag
   - API SLO
   - forecast MAE target

## 8.3 Milestone Plan

1. Milestone A: Data foundation
   - ingestion + cleaning + canonical storage

2. Milestone B: AQI intelligence
   - interpolation + deterministic AQI + crisis detection

3. Milestone C: Prediction and explanations
   - forecasting + explainability text generation

4. Milestone D: Policy and APIs
   - gov ranking/recommendation + final API contract stabilization

5. Milestone E: Hardening
   - observability, security, runbooks, load checks

## 8.4 Acceptance Criteria

- Ward-level AQI updates available every <= 10 min.
- Crisis flags generated and queryable by API.
- Forecast API returns +1h/+2h/+3h with model version.
- Explanation API produces readable and factor-linked output.
- Monitoring dashboard shows freshness, failures, and API health.

## 8.5 Risk Register (Initial)

1. Data sparsity in low-sensor wards
   - Mitigation: stronger interpolation confidence scoring.

2. Source downtime
   - Mitigation: retries, fallback sources, quality downgrade logic.

3. Forecast drift in seasonal transitions
   - Mitigation: periodic retraining and seasonal feature flags.

4. Alert fatigue from noisy anomalies
   - Mitigation: persistence windows and suppression rules.

