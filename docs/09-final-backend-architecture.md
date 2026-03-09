# 9. Final Backend Architecture

This document captures the finalized backend architecture baseline.

## 9.1 Data Ingestion Layer

Purpose: collect real-time environmental data.

Sources:
- AQI and pollutant data from Central Pollution Control Board (CPCB)
- Weather data (wind speed, wind direction, humidity, temperature)
- Optional local IoT sensors (future expansion)

Modules:
- API data collector
- Data validation
- Missing value handling
- Outlier removal
- Data cleaning

Output:
- Clean real-time pollution dataset

## 9.2 Spatial Interpolation Layer

Method:
- Inverse Distance Weighting (IDW)

Purpose:
- Convert limited monitoring station data into ward-level AQI estimation.

Result:
- Every ward receives estimated AQI values, including non-instrumented wards.

## 9.3 AQI Calculation Layer

Design rule:
- AQI calculation is deterministic (no AI model in current AQI computation).

Method:
- Official CPCB AQI formula applied to pollutant concentrations.

Typical pollutants:
- PM2.5
- PM10
- NO2
- SO2
- O3
- CO

Output:
- Current AQI per ward

## 9.4 Forecasting Layer (AI Prediction)

Model:
- XGBoost

Purpose:
- Predict AQI for the next 1-3 hours.

Inputs:
- Historical AQI values
- Pollutant levels
- Weather conditions
- Wind direction
- Humidity

Output:
- Ward-level AQI forecast horizons (+1h, +2h, +3h)

## 9.5 Hybrid Crisis Detection System

Purpose:
- Detect pollution spikes and environmental emergencies.

Components:
1. Rule-based triggers
   - AQI > 300
   - PM2.5 spike > 40%
   - Rapid AQI increase
2. Statistical anomaly detection
   - Detect unusual behavior (for example, PM2.5 jump of 65% in 30 minutes)

## 9.6 Early Warning and Alert Engine

When crisis is detected, trigger:
- Pollution spike alerts
- Health advisories
- Disaster mode activation

## 9.7 Data Storage Layer

Stores:
- Historical AQI data
- Pollutant data
- Forecast data
- Alerts and incidents

Database options:
- PostgreSQL
- MongoDB

## 9.8 API Service Layer

Purpose:
- Expose backend data to frontend clients.

Representative APIs:
- `/ward-aqi`
- `/aqi-forecast`
- `/pollutant-breakdown`
- `/alerts`
- `/ward-map-data`

## 9.9 Visualization and Dashboard Layer

Consumers:
- Citizen mobile app
- Officer command dashboard

Supported features:
- Hyperlocal AQI
- Pollution momentum
- Forecast
- Pollutant contribution graph
- Alerts

## 9.10 Final Architecture Flow

`Data Sources -> Data Ingestion -> Data Cleaning and Validation -> Spatial Interpolation (IDW) -> AQI Calculation (CPCB Deterministic Formula) -> AI Forecasting (XGBoost) -> Hybrid Crisis Detection -> Early Warning System -> Database Storage -> API Layer -> Citizen App and Officer Dashboard`
