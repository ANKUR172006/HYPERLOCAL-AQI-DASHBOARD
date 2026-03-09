# 5. Crisis Detection and Forecasting

## 5.1 Hybrid Crisis Detection (Innovation Core)

Two-stage detection:

1. Rule-based triggers
   - AQI jump threshold across recent window (example: +40 in 30 min).
   - PM2.5 or PM10 surge above configured rate-of-change.
   - simultaneous rise across multiple pollutants.

2. Statistical anomaly triggers
   - rolling mean deviation
   - rolling variance spikes
   - z-score breach and EWMA drift

Decision layer combines both to assign:
- `NORMAL`
- `WORSENING`
- `EMERGENCY`

## 5.2 Disaster Mode Policy

- Disaster Mode set to `true` when:
  - ward reaches `EMERGENCY` for `N` consecutive windows, or
  - city-wide emergency crosses configured ward count threshold.
- Effects of Disaster Mode:
  - lower API cache TTL
  - higher alert frequency
  - stricter risk ranking and action recommendations

## 5.3 Crisis Configuration Registry

Maintain city-specific configuration in versioned registry:
- threshold values
- minimum persistence windows
- season-specific overrides
- suppression rules (avoid noisy flip-flops)

Every crisis output stores:
- `rule_version`
- `feature_window`
- `trigger_reason`

## 5.4 Forecasting Design (XGBoost)

### Target
- AQI prediction for +1h, +2h, +3h at ward level.

### Features
- last 24-48h AQI trend
- pollutant concentration history
- PMI
- weather (wind speed/direction, humidity, temperature)
- time features (hour, day, weekday/weekend)

### Model Strategy
- Option A: one model per horizon.
- Option B: multi-output approach.
- MVP recommendation: one model per horizon for clarity.

## 5.5 Training and Validation

- Train/validation split by time (not random).
- Minimum metrics:
  - MAE (primary)
  - RMSE
  - category hit rate
- Evaluate by:
  - city
  - ward type (high traffic, industrial, residential)
  - horizon

## 5.6 Model Lifecycle

- Retraining cadence: weekly in MVP.
- Drift checks: daily.
- Rollback:
  - if MAE degrades beyond threshold for 2 consecutive days.
- Version tags mandatory in every forecast API response.

