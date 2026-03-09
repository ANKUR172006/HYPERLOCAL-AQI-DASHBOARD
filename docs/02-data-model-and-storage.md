# 2. Data Model and Storage

## 2.1 Design Principles

- Raw data never overwritten; cleaning is append-only with lineage.
- Spatial entities are first-class (ward geometry in PostGIS).
- Time-series queries optimized with partitioning and indexes.
- Derived outputs are versioned by model and rule configuration.

## 2.2 Core Entities

1. `cities`
   - `city_id` (PK)
   - `city_name`
   - `state_name`
   - `timezone`

2. `wards`
   - `ward_id` (PK)
   - `city_id` (FK)
   - `ward_name`
   - `geom` (MULTIPOLYGON, SRID 4326)
   - `population`
   - `sensitive_sites_count`

3. `stations`
   - `station_id` (PK)
   - `source` (CPCB, SENSOR, SATELLITE_PROXY)
   - `lat`, `lon`
   - `ward_id` (nullable FK)
   - `is_active`

4. `raw_observations`
   - `obs_id` (PK)
   - `ts_utc`
   - `station_id` (FK)
   - `pollutant_code`
   - `value`
   - `unit`
   - `source_payload_ref`
   - `ingested_at`

5. `clean_observations`
   - `clean_id` (PK)
   - `obs_id` (FK raw)
   - `ts_utc`
   - `station_id`
   - `pollutant_code`
   - `value_std`
   - `quality_flag` (OK, MISSING, OUTLIER, IMPUTED)
   - `cleaning_rule_version`

6. `ward_pollutant_snapshot`
   - `snapshot_id` (PK)
   - `ts_utc`
   - `ward_id`
   - pollutant columns (`pm25`, `pm10`, `no2`, `so2`, `co`, `o3`, `nh3`, `pb`)
   - `interpolation_method`
   - `data_quality_score`

7. `aqi_snapshot`
   - `aqi_id` (PK)
   - `ts_utc`
   - `ward_id`
   - `aqi_value`
   - `aqi_category`
   - `primary_pollutant`
   - `pmi_value`
   - `contribution_json`
   - `calc_rule_version`

8. `forecast_snapshot`
   - `forecast_id` (PK)
   - `ts_generated_utc`
   - `target_ts_utc`
   - `ward_id`
   - `horizon_hour`
   - `aqi_pred`
   - `aqi_category_pred`
   - `model_name`
   - `model_version`

9. `crisis_events`
   - `event_id` (PK)
   - `ward_id`
   - `level` (NORMAL, WORSENING, EMERGENCY)
   - `trigger_reason`
   - `anomaly_score`
   - `started_at_utc`
   - `ended_at_utc` (nullable)
   - `disaster_mode`

10. `policy_recommendations`
    - `recommendation_id` (PK)
    - `ts_utc`
    - `ward_id`
    - `risk_rank_city`
    - `actions_json`
    - `confidence_score`

11. `explanations`
    - `explain_id` (PK)
    - `ts_utc`
    - `ward_id`
    - `citizen_text`
    - `gov_text`
    - `factors_json`
    - `explain_version`

## 2.3 Storage and Partitioning

- Partition high-volume tables by day or month:
  - `raw_observations`
  - `clean_observations`
  - `ward_pollutant_snapshot`
  - `aqi_snapshot`
  - `forecast_snapshot`
- Mandatory indexes:
  - `(ward_id, ts_utc DESC)` for snapshot tables
  - `(station_id, ts_utc DESC)` for observations
  - GIST index on `wards.geom`

## 2.4 Retention Policy

- Raw observations: 24 months.
- Clean observations: 24 months.
- Aggregated snapshots: 36 months.
- Crisis events: permanent archive.
- Logs:
  - Operational logs: 90 days hot, then cold archive.
  - Security/audit logs: minimum 365 days.

## 2.5 Data Quality Controls

- Required checks:
  - timestamp validity and monotonicity
  - unit normalization
  - range checks by pollutant
  - duplicate suppression window
- Quality outputs:
  - per-record `quality_flag`
  - per-snapshot `data_quality_score` (0-1)

