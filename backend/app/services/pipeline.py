from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from random import Random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AqiSnapshot, City, CrisisEvent, ForecastSnapshot, Ward
from app.services.cpcb_source import CpcbSource, StationObservation
from app.services.environmental_ingestion_service import EnvironmentalIngestionService

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


AQI_BREAKPOINTS = {
    "pm25": [(0, 30, 0, 50), (31, 60, 51, 100), (61, 90, 101, 200), (91, 120, 201, 300), (121, 250, 301, 400), (251, 350, 401, 500)],
    "pm10": [(0, 50, 0, 50), (51, 100, 51, 100), (101, 250, 101, 200), (251, 350, 201, 300), (351, 430, 301, 400), (431, 500, 401, 500)],
    "no2": [(0, 40, 0, 50), (41, 80, 51, 100), (81, 180, 101, 200), (181, 280, 201, 300), (281, 400, 301, 400), (401, 1000, 401, 500)],
    "so2": [(0, 40, 0, 50), (41, 80, 51, 100), (81, 380, 101, 200), (381, 800, 201, 300), (801, 1600, 301, 400), (1601, 2000, 401, 500)],
    "o3": [(0, 50, 0, 50), (51, 100, 51, 100), (101, 168, 101, 200), (169, 208, 201, 300), (209, 748, 301, 400), (749, 1000, 401, 500)],
    "co": [(0, 1.0, 0, 50), (1.1, 2.0, 51, 100), (2.1, 10, 101, 200), (10.1, 17, 201, 300), (17.1, 34, 301, 400), (34.1, 50, 401, 500)],
}


def calc_sub_index(concentration: float, pollutant: str) -> int:
    for bp_lo, bp_hi, i_lo, i_hi in AQI_BREAKPOINTS[pollutant]:
        if bp_lo <= concentration <= bp_hi:
            idx = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (concentration - bp_lo) + i_lo
            return max(0, min(500, round(idx)))
    return 500


def aqi_category(aqi_value: int) -> str:
    if aqi_value <= 50:
        return "Good"
    if aqi_value <= 100:
        return "Satisfactory"
    if aqi_value <= 200:
        return "Moderate"
    if aqi_value <= 300:
        return "Poor"
    if aqi_value <= 400:
        return "Very Poor"
    return "Severe"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _build_ward_centroids() -> dict[str, tuple[float, float]]:
    # 5x5 grid across Delhi-like lat/lon envelope for ward-level interpolation.
    lat_start, lon_start = 28.45, 77.02
    lat_step, lon_step = 0.055, 0.07
    coords: dict[str, tuple[float, float]] = {}
    idx = 1
    for r in range(5):
        for c in range(5):
            coords[f"DEL_WARD_{idx:03d}"] = (lat_start + r * lat_step, lon_start + c * lon_step)
            idx += 1
    return coords


WARD_CENTROIDS = _build_ward_centroids()


@dataclass
class WardObservation:
    ward_id: str
    pm25: float
    pm10: float
    no2: float
    so2: float
    o3: float
    co: float
    wind_speed: float
    wind_direction: float
    humidity: float
    temperature: float
    source: str


class PipelineService:
    def __init__(self, db: Session):
        self.db = db

    def bootstrap_city_and_wards(self) -> None:
        city = self.db.get(City, "DELHI")
        if city is None:
            city = City(city_id="DELHI", city_name="Delhi", state_name="Delhi", timezone="Asia/Kolkata")
            self.db.add(city)
            for idx in range(1, 26):
                ward_id = f"DEL_WARD_{idx:03d}"
                self.db.add(
                    Ward(
                        ward_id=ward_id,
                        city_id="DELHI",
                        ward_name=f"Ward {idx}",
                        population=50000 + idx * 250,
                        sensitive_sites_count=2 + (idx % 4),
                    )
                )
            self.db.commit()

    def run_full_pipeline(self) -> None:
        wards = self.db.scalars(select(Ward).order_by(Ward.ward_id)).all()
        if not wards:
            self.bootstrap_city_and_wards()
            wards = self.db.scalars(select(Ward).order_by(Ward.ward_id)).all()

        stations = self._data_ingestion_layer()
        cleaned = self._cleaning_validation_layer(stations)
        interpolated = self._spatial_interpolation_idw_layer(cleaned, wards)
        snapshots = self._aqi_calculation_layer(interpolated)
        self._ai_forecasting_xgboost_layer(interpolated, snapshots)
        crisis = self._hybrid_crisis_detection_layer(interpolated, snapshots)
        self._early_warning_layer(crisis)
        in_pytest = os.getenv("PYTEST_CURRENT_TEST") is not None
        if settings.enable_extended_ingestion and stations and not in_pytest:
            nearest = stations[0]
            try:
                EnvironmentalIngestionService(self.db).ingest_for_coordinates(nearest.latitude, nearest.longitude)
            except Exception:
                # Never break core AQI pipeline when auxiliary external feeds fail.
                logger.exception("Extended environmental ingestion failed; core pipeline will continue")
        self.db.commit()

    def _data_ingestion_layer(self) -> list[StationObservation]:
        source = CpcbSource(
            mode=settings.cpcb_source_mode,
            file_path=settings.cpcb_file_path,
            api_url=settings.cpcb_api_url,
            api_key=settings.cpcb_api_key,
            api_format=settings.cpcb_api_format,
            api_offset=settings.cpcb_api_offset,
            api_limit=settings.cpcb_api_limit,
            api_max_pages=settings.cpcb_api_max_pages,
            api_timeout_sec=settings.cpcb_api_timeout_sec,
            filter_state=settings.cpcb_filter_state,
            filter_city=settings.cpcb_filter_city,
        )
        rows = source.load()
        if rows:
            return rows
        return self._synthetic_cpcb_fallback()

    def _cleaning_validation_layer(self, rows: list[StationObservation]) -> list[StationObservation]:
        cleaned: list[StationObservation] = []
        for row in rows:
            row.pm25 = max(0.0, min(500.0, row.pm25))
            row.pm10 = max(0.0, min(600.0, row.pm10))
            row.no2 = max(0.0, min(1000.0, row.no2))
            row.so2 = max(0.0, min(2000.0, row.so2))
            row.o3 = max(0.0, min(1000.0, row.o3))
            row.co = max(0.0, min(50.0, row.co))
            row.wind_speed = max(0.0, min(30.0, row.wind_speed))
            row.wind_direction = row.wind_direction % 360
            row.humidity = max(5.0, min(100.0, row.humidity))
            row.temperature = max(-10.0, min(55.0, row.temperature))
            cleaned.append(row)
        return cleaned

    def _spatial_interpolation_idw_layer(self, rows: list[StationObservation], wards: list[Ward]) -> list[WardObservation]:
        if not rows:
            return []

        def weighted_mean(target_lat: float, target_lon: float, attr: str) -> float:
            weighted_sum = 0.0
            total_weight = 0.0
            for station in rows:
                dist = _haversine_km(target_lat, target_lon, station.latitude, station.longitude)
                w = 1.0 / ((dist**2) + 0.0001)
                weighted_sum += w * float(getattr(station, attr))
                total_weight += w
            return weighted_sum / total_weight if total_weight else 0.0

        observations: list[WardObservation] = []
        for ward in wards:
            lat, lon = WARD_CENTROIDS.get(ward.ward_id, (28.6139, 77.2090))
            observations.append(
                WardObservation(
                    ward_id=ward.ward_id,
                    pm25=weighted_mean(lat, lon, "pm25"),
                    pm10=weighted_mean(lat, lon, "pm10"),
                    no2=weighted_mean(lat, lon, "no2"),
                    so2=weighted_mean(lat, lon, "so2"),
                    o3=weighted_mean(lat, lon, "o3"),
                    co=weighted_mean(lat, lon, "co"),
                    wind_speed=weighted_mean(lat, lon, "wind_speed"),
                    wind_direction=weighted_mean(lat, lon, "wind_direction"),
                    humidity=weighted_mean(lat, lon, "humidity"),
                    temperature=weighted_mean(lat, lon, "temperature"),
                    source=rows[0].source,
                )
            )
        return observations

    def _aqi_calculation_layer(self, rows: list[WardObservation]) -> list[AqiSnapshot]:
        snapshots: list[AqiSnapshot] = []
        for row in rows:
            pollutant_indices = {
                "PM2.5": calc_sub_index(row.pm25, "pm25"),
                "PM10": calc_sub_index(row.pm10, "pm10"),
                "NO2": calc_sub_index(row.no2, "no2"),
                "SO2": calc_sub_index(row.so2, "so2"),
                "O3": calc_sub_index(row.o3, "o3"),
                "CO": calc_sub_index(row.co, "co"),
            }
            primary_pollutant = max(pollutant_indices, key=pollutant_indices.get)
            aqi_value = pollutant_indices[primary_pollutant]
            total = sum(pollutant_indices.values()) or 1
            contribution = {key: round((value / total) * 100, 2) for key, value in pollutant_indices.items()}
            contribution["raw"] = {
                "pm25": round(row.pm25, 2),
                "pm10": round(row.pm10, 2),
                "no2": round(row.no2, 2),
                "so2": round(row.so2, 2),
                "o3": round(row.o3, 2),
                "co": round(row.co, 2),
                "source": row.source,
            }
            quality_score = 0.93 if row.source.startswith("cpcb") else 0.72
            snapshot = AqiSnapshot(
                ward_id=row.ward_id,
                aqi_value=aqi_value,
                aqi_category=aqi_category(aqi_value),
                primary_pollutant=primary_pollutant,
                pmi_value=round(aqi_value * 0.95, 2),
                contribution_json=contribution,
                data_quality_score=quality_score,
                data_quality_flag="OK" if quality_score >= 0.9 else "DEGRADED",
            )
            self.db.add(snapshot)
            snapshots.append(snapshot)
        return snapshots

    def _ai_forecasting_xgboost_layer(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> None:
        model_name = "xgboost"
        model_version = "xgb-h-v2"
        predictions = self._xgboost_predict(rows, snapshots)
        if predictions is None:
            model_name = "xgboost-fallback"
            model_version = "fallback-v1"
            predictions = self._momentum_fallback(rows)

        for ward_id, horizon_map in predictions.items():
            for horizon, aqi_pred in horizon_map.items():
                self.db.add(
                    ForecastSnapshot(
                        ward_id=ward_id,
                        horizon_hour=horizon,
                        target_ts_utc=now_utc() + timedelta(hours=horizon),
                        aqi_pred=aqi_pred,
                        aqi_category_pred=aqi_category(aqi_pred),
                        model_name=model_name,
                        model_version=model_version,
                        data_quality_score=0.94 if model_name == "xgboost" else 0.78,
                        disaster_mode=aqi_pred > 300,
                    )
                )

    def _hybrid_crisis_detection_layer(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> list[CrisisEvent]:
        events: list[CrisisEvent] = []
        snapshot_by_ward = {s.ward_id: s for s in snapshots}
        for row in rows:
            current = snapshot_by_ward.get(row.ward_id)
            if current is None:
                continue
            previous = self.db.scalars(
                select(AqiSnapshot).where(AqiSnapshot.ward_id == row.ward_id).order_by(AqiSnapshot.ts_utc.desc()).offset(1)
            ).first()

            reasons: list[str] = []
            anomaly_score = min(1.0, current.aqi_value / 500)
            raw = current.contribution_json.get("raw", {})
            if current.aqi_value > 300:
                reasons.append("AQI > 300")
            if previous:
                prev_raw = previous.contribution_json.get("raw", {})
                prev_pm25 = float(prev_raw.get("pm25", raw.get("pm25", 0.0)) or 0.0)
                if prev_pm25 > 0:
                    spike_pct = ((float(raw.get("pm25", 0.0)) - prev_pm25) / prev_pm25) * 100
                    if spike_pct > 40:
                        reasons.append(f"PM2.5 spike {spike_pct:.1f}%")
                        anomaly_score = max(anomaly_score, min(1.0, abs(spike_pct) / 100))
                if current.aqi_value - previous.aqi_value > 40:
                    reasons.append("Rapid AQI increase")

            if reasons:
                level = "SEVERE" if current.aqi_value > 350 else "HIGH"
                event = CrisisEvent(
                    ward_id=row.ward_id,
                    level=level,
                    trigger_reason="; ".join(reasons),
                    anomaly_score=anomaly_score,
                    disaster_mode=current.aqi_value > 300,
                )
                events.append(event)
                self.db.add(event)
        return events

    def _early_warning_layer(self, events: list[CrisisEvent]) -> None:
        for event in events:
            if event.level == "SEVERE" and not event.trigger_reason.startswith("EarlyWarning:"):
                event.trigger_reason = f"EarlyWarning: {event.trigger_reason}"

    def _xgboost_predict(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> dict[str, dict[int, int]] | None:
        try:
            from xgboost import XGBRegressor  # type: ignore
        except Exception:
            return None

        history = self.db.scalars(select(AqiSnapshot).order_by(AqiSnapshot.ts_utc.desc()).limit(1200)).all()
        by_ward: dict[str, list[AqiSnapshot]] = {}
        for item in history[::-1]:
            by_ward.setdefault(item.ward_id, []).append(item)

        train_x: list[list[float]] = []
        train_y: dict[int, list[float]] = {1: [], 2: [], 3: []}
        for ward_history in by_ward.values():
            if len(ward_history) < 8:
                continue
            for idx in range(3, len(ward_history) - 3):
                current = ward_history[idx]
                lag1 = ward_history[idx - 1]
                lag2 = ward_history[idx - 2]
                lag3 = ward_history[idx - 3]
                raw = current.contribution_json.get("raw", {})
                ts = current.ts_utc or now_utc()
                hour = float(ts.hour)
                dow = float(ts.weekday())
                train_x.append(
                    [
                        float(current.aqi_value),
                        float(lag1.aqi_value),
                        float(lag2.aqi_value),
                        float(lag3.aqi_value),
                        float(current.aqi_value - lag1.aqi_value),
                        float(lag1.aqi_value - lag2.aqi_value),
                        float(raw.get("pm25", 0.0)),
                        float(raw.get("pm10", 0.0)),
                        float(raw.get("no2", 0.0)),
                        float(raw.get("so2", 0.0)),
                        float(raw.get("o3", 0.0)),
                        float(raw.get("co", 0.0)),
                        math.sin((hour / 24.0) * 2 * math.pi),
                        math.cos((hour / 24.0) * 2 * math.pi),
                        math.sin((dow / 7.0) * 2 * math.pi),
                        math.cos((dow / 7.0) * 2 * math.pi),
                    ]
                )
                train_y[1].append(float(ward_history[idx + 1].aqi_value))
                train_y[2].append(float(ward_history[idx + 2].aqi_value))
                train_y[3].append(float(ward_history[idx + 3].aqi_value))

        # Warm start with synthetic labels if history is still sparse.
        if len(train_x) < 40 and rows:
            rng = Random(42)
            snap_by_ward = {s.ward_id: s for s in snapshots}
            for _ in range(25):
                for row in rows:
                    current = snap_by_ward.get(row.ward_id)
                    base = float(current.aqi_value if current else 120)
                    momentum = (row.pm25 / 4 + row.pm10 / 10 + row.no2 / 6) / 10
                    vec = [
                        base,
                        base - rng.uniform(2, 12),
                        base - rng.uniform(4, 16),
                        base - rng.uniform(6, 20),
                        rng.uniform(-8, 8),
                        rng.uniform(-8, 8),
                        row.pm25,
                        row.pm10,
                        row.no2,
                        row.so2,
                        row.o3,
                        row.co,
                        0.0,
                        1.0,
                        0.0,
                        1.0,
                    ]
                    train_x.append(vec)
                    train_y[1].append(max(0.0, min(500.0, base + momentum + rng.uniform(-8, 8))))
                    train_y[2].append(max(0.0, min(500.0, base + 2 * momentum + rng.uniform(-10, 10))))
                    train_y[3].append(max(0.0, min(500.0, base + 3 * momentum + rng.uniform(-12, 12))))

        if len(train_x) < 25:
            return None

        models: dict[int, XGBRegressor] = {}
        for horizon in (1, 2, 3):
            model = XGBRegressor(
                n_estimators=260,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.85,
                colsample_bytree=0.85,
                min_child_weight=2,
                reg_alpha=0.1,
                reg_lambda=1.2,
                objective="reg:squarederror",
                random_state=42 + horizon,
                n_jobs=1,
            )
            model.fit(train_x, train_y[horizon])
            models[horizon] = model

        output: dict[str, dict[int, int]] = {}
        snap_by_ward = {s.ward_id: s for s in snapshots}
        for row in rows:
            current_snapshot = snap_by_ward.get(row.ward_id)
            hist = by_ward.get(row.ward_id, [])
            lag1 = float(hist[-1].aqi_value) if len(hist) >= 1 else float(current_snapshot.aqi_value if current_snapshot else 120.0)
            lag2 = float(hist[-2].aqi_value) if len(hist) >= 2 else lag1
            lag3 = float(hist[-3].aqi_value) if len(hist) >= 3 else lag2
            current_aqi = float(current_snapshot.aqi_value if current_snapshot else lag1)
            ts = current_snapshot.ts_utc if current_snapshot and current_snapshot.ts_utc else now_utc()
            hour = float(ts.hour)
            dow = float(ts.weekday())
            vec = [[
                current_aqi,
                lag1,
                lag2,
                lag3,
                current_aqi - lag1,
                lag1 - lag2,
                row.pm25,
                row.pm10,
                row.no2,
                row.so2,
                row.o3,
                row.co,
                math.sin((hour / 24.0) * 2 * math.pi),
                math.cos((hour / 24.0) * 2 * math.pi),
                math.sin((dow / 7.0) * 2 * math.pi),
                math.cos((dow / 7.0) * 2 * math.pi),
            ]]
            output[row.ward_id] = {
                1: max(0, min(500, round(float(models[1].predict(vec)[0])))),
                2: max(0, min(500, round(float(models[2].predict(vec)[0])))),
                3: max(0, min(500, round(float(models[3].predict(vec)[0])))),
            }
        return output

    def _momentum_fallback(self, rows: list[WardObservation]) -> dict[str, dict[int, int]]:
        output: dict[str, dict[int, int]] = {}
        for row in rows:
            current = self.db.scalars(
                select(AqiSnapshot).where(AqiSnapshot.ward_id == row.ward_id).order_by(AqiSnapshot.ts_utc.desc())
            ).first()
            baseline = current.aqi_value if current else 120
            momentum = round((row.pm25 / 4 + row.pm10 / 10 + row.no2 / 6) / 10)
            output[row.ward_id] = {
                1: max(0, min(500, baseline + momentum)),
                2: max(0, min(500, baseline + 2 * momentum)),
                3: max(0, min(500, baseline + 3 * momentum)),
            }
        return output

    def _synthetic_cpcb_fallback(self) -> list[StationObservation]:
        seed = int(now_utc().strftime("%Y%m%d%H%M"))
        rng = Random(seed)
        rows: list[StationObservation] = []
        for idx in range(1, 9):
            lat = 28.45 + (idx % 4) * 0.07 + rng.uniform(-0.01, 0.01)
            lon = 77.02 + (idx // 4) * 0.14 + rng.uniform(-0.01, 0.01)
            rows.append(
                StationObservation(
                    station_id=f"CPCB_SYN_{idx:02d}",
                    station_name=f"Synthetic Station {idx}",
                    latitude=lat,
                    longitude=lon,
                    pm25=max(5.0, rng.uniform(40.0, 210.0)),
                    pm10=max(10.0, rng.uniform(70.0, 300.0)),
                    no2=max(5.0, rng.uniform(20.0, 190.0)),
                    so2=max(3.0, rng.uniform(8.0, 100.0)),
                    o3=max(5.0, rng.uniform(30.0, 220.0)),
                    co=max(0.2, rng.uniform(0.8, 6.5)),
                    wind_speed=rng.uniform(0.8, 6.5),
                    wind_direction=rng.uniform(0, 360),
                    humidity=rng.uniform(25, 90),
                    temperature=rng.uniform(15, 42),
                    observed_at_utc=now_utc(),
                    source="cpcb_synthetic_fallback",
                )
            )
        return rows
