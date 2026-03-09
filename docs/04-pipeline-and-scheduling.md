# 4. Pipeline and Scheduling

## 4.1 Orchestration Pattern

- Scheduler triggers independent jobs with dependency graph.
- Jobs write intermediate outputs to canonical tables.
- Downstream jobs execute only if quality gates pass.

## 4.2 Job Cadence (MVP)

1. Ingestion Jobs (every 5 min)
   - `job_ingest_cpcb`
   - `job_ingest_weather`
   - `job_ingest_local_sensors` (optional)

2. Data Quality Job (every 5 min, after ingestion)
   - `job_validate_and_clean`

3. Spatial Job (every 5 min)
   - `job_ward_interpolation_idw`

4. Deterministic AQI Job (every 5 min)
   - `job_compute_aqi_and_contributions`

5. Crisis Detection Job (every 5 min)
   - `job_detect_crisis_state`

6. Forecast Job (every 15 min)
   - `job_forecast_h1_h2_h3`

7. Explainability Job (every 15 min or on AQI update)
   - `job_generate_explanations`

8. Policy Job (every 15 min or on crisis escalation)
   - `job_generate_policy_actions`

9. Cache Refresh Job (every 1-2 min)
   - `job_publish_api_snapshots`

## 4.3 Dependency Chain

`ingestion -> cleaning -> interpolation -> AQI -> crisis -> forecast -> explain/policy -> API publish`

Parallelizable:
- Forecast can run in parallel for multiple horizons.
- Explainability and policy can run in parallel after AQI/crisis are ready.

## 4.4 Backfill Strategy

- Backfill scope:
  - single ward
  - full city
  - date range
- Backfill steps:
  1. Re-ingest raw for target window.
  2. Re-run cleaning and interpolation.
  3. Recompute AQI/crisis/forecast snapshots.
  4. Rebuild explanation and recommendation records.
  5. Mark records with `backfill_run_id`.

## 4.5 Failure Handling

- Retry policy:
  - transient source failures: 3 retries with exponential backoff.
- Dead-letter handling:
  - store payload + reason in `ingestion_failures`.
- Partial source outage policy:
  - continue with available sources.
  - mark lowered `data_quality_score`.

## 4.6 Runbook Triggers

- Trigger incident if:
  - no fresh AQI snapshot for > 15 min.
  - forecast pipeline failure for > 2 cycles.
  - data quality score < 0.6 in > 30% wards.

