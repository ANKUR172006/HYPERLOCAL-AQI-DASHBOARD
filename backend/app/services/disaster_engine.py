from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AqiSnapshot, CrisisEvent, DisasterAssessment, ForecastSnapshot, Ward, WeatherData
from app.services.collectors.firms_collector import FirmsCollector
from app.services.source_detection import detect_pollution_sources

ENGINE_VERSION = "disaster-engine-v1"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _normalize(value: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 0.0
    return _clamp((float(value) - lo) / (hi - lo), 0.0, 1.0)


def _zone_num(ward_id: str) -> int:
    try:
        return int(str(ward_id).split("_")[-1])
    except Exception:
        return 0


def _distance_weather(lat: float, lon: float, row: WeatherData) -> float:
    try:
        return _distance_km(float(lat), float(lon), float(row.latitude), float(row.longitude))
    except Exception:
        return float("inf")


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _ward_profiles(ward: Ward) -> dict[str, float]:
    zone = _zone_num(ward.ward_id)
    col = (zone - 1) % 5 if zone else 2
    row = (zone - 1) // 5 if zone else 2
    road = 0.35 + (0.25 if col in {1, 2, 3} else 0.0) + (0.1 if row == 2 else 0.0)
    industrial = 0.2 + (0.35 if col in {3, 4} else 0.0) + (0.1 if row in {1, 2, 3} else 0.0)
    building = 0.35 + (0.2 if col in {1, 2, 3} else 0.0) + (0.15 if row in {1, 2, 3} else 0.0)
    return {
        "road_density": _clamp(road, 0.0, 1.0),
        "industrial_zone_score": _clamp(industrial, 0.0, 1.0),
        "building_density": _clamp(building, 0.0, 1.0),
    }


def _density_index(ward: Ward, profiles: dict[str, float]) -> float:
    pop = float(ward.population or 0)
    sensitive = float(ward.sensitive_sites_count or 0)
    raw = (pop / 1200.0) + (profiles["building_density"] * 18.0) + (sensitive * 3.5)
    return round(_clamp(raw, 10.0, 100.0), 2)


def _alert_level(risk_score: float) -> str:
    if risk_score >= 85:
        return "Critical"
    if risk_score >= 65:
        return "High"
    if risk_score >= 40:
        return "Medium"
    return "Low"


def _status_for_level(level: str) -> str:
    return {
        "Critical": "EMERGENCY",
        "High": "ACTION_NEEDED",
        "Medium": "WARNING",
        "Low": "SAFE",
    }.get(level, "SAFE")


def _sort_causes(causes: dict[str, float]) -> list[dict[str, Any]]:
    ranked = sorted(causes.items(), key=lambda item: item[1], reverse=True)
    if not ranked:
        return [{"label": "Mixed / Unknown", "confidence": 0.3}]
    top, second = ranked[0], ranked[1] if len(ranked) > 1 else ("Mixed / Unknown", 0.0)
    if abs(top[1] - second[1]) <= 0.08 and top[1] > 0.3 and second[1] > 0.3:
        return [
            {"label": "Mixed / Unknown", "confidence": round(_clamp((top[1] + second[1]) / 2.0, 0.0, 1.0), 2)},
            {"label": top[0], "confidence": round(_clamp(top[1], 0.0, 1.0), 2)},
            {"label": second[0], "confidence": round(_clamp(second[1], 0.0, 1.0), 2)},
        ]
    return [
        {"label": label, "confidence": round(_clamp(score, 0.0, 1.0), 2)}
        for label, score in ranked[:3]
        if score > 0.05
    ]


def _trigger(label: str, severity: str, metric: str, value: Any, threshold: Any, detail: str) -> dict[str, Any]:
    return {
        "type": label,
        "severity": severity,
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "detail": detail,
    }


def _actions_for(causes: list[dict[str, Any]], triggers: list[dict[str, Any]], disaster_mode: bool) -> list[str]:
    action_set: list[str] = []
    trigger_types = {str(t.get("type") or "") for t in triggers}
    cause_labels = [str(c.get("label") or "") for c in causes]
    if "Fire event" in trigger_types or "Fire / Stubble Burning" in cause_labels:
        action_set.append("Dispatch field teams to verify hotspot and issue smoke advisory.")
    if "Pollution spike" in trigger_types or "Traffic Congestion" in cause_labels:
        action_set.append("Apply traffic restriction near corridors and stagger freight movement.")
    if "Industrial hazard" in trigger_types or "Industrial Emissions" in cause_labels:
        action_set.append("Inspect nearby industrial stacks and pause high-emission operations.")
    if "Heatwave" in trigger_types:
        action_set.append("Open cooling support points and advise reduced outdoor exposure.")
    if "High-risk population" in trigger_types:
        action_set.append("Notify hospitals, schools, and ward officers for targeted protection.")
    if disaster_mode:
        action_set.append("Increase monitoring cadence and push officer and citizen alerts immediately.")
    if not action_set:
        action_set.append("Continue monitoring and keep advisory messaging active.")
    return action_set[:4]


class DisasterEngineService:
    def __init__(self, db: Session):
        self.db = db
        self._firms = FirmsCollector()
        self._fire_cache: dict[str, dict[str, Any]] = {}
        self._weather_cache: dict[str, WeatherData | None] = {}

    def assess_city(
        self,
        *,
        ts_slot: datetime,
        wards: list[Ward],
        rows_by_ward: dict[str, Any],
        snapshots: list[AqiSnapshot],
    ) -> list[DisasterAssessment]:
        if not wards or not snapshots:
            return []
        snapshot_by_ward = {s.ward_id: s for s in snapshots}
        forecast_rows = self.db.scalars(
            select(ForecastSnapshot).where(
                ForecastSnapshot.ts_generated_utc == ts_slot,
                ForecastSnapshot.ward_id.in_([w.ward_id for w in wards]),
                ForecastSnapshot.horizon_hour == 3,
            )
        ).all()
        forecast_by_ward = {f.ward_id: f for f in forecast_rows}
        existing = self.db.scalars(
            select(DisasterAssessment).where(
                DisasterAssessment.ts_utc == ts_slot,
                DisasterAssessment.ward_id.in_([w.ward_id for w in wards]),
            )
        ).all()
        existing_by_ward = {row.ward_id: row for row in existing}
        out: list[DisasterAssessment] = []
        for ward in wards:
            snapshot = snapshot_by_ward.get(ward.ward_id)
            row = rows_by_ward.get(ward.ward_id)
            if snapshot is None or row is None:
                continue
            assessment = self._build_assessment(
                ts_slot=ts_slot,
                ward=ward,
                snapshot=snapshot,
                row=row,
                forecast=forecast_by_ward.get(ward.ward_id),
                existing=existing_by_ward.get(ward.ward_id),
            )
            self._upsert_event(ts_slot=ts_slot, ward_id=ward.ward_id, assessment=assessment)
            out.append(assessment)
        return out

    def latest_assessment(self, ward_id: str) -> DisasterAssessment | None:
        return self.db.scalars(
            select(DisasterAssessment).where(DisasterAssessment.ward_id == ward_id).order_by(DisasterAssessment.ts_utc.desc())
        ).first()

    def _build_assessment(
        self,
        *,
        ts_slot: datetime,
        ward: Ward,
        snapshot: AqiSnapshot,
        row: Any,
        forecast: ForecastSnapshot | None,
        existing: DisasterAssessment | None,
    ) -> DisasterAssessment:
        previous = self.db.scalars(
            select(AqiSnapshot)
            .where(AqiSnapshot.ward_id == ward.ward_id, AqiSnapshot.ts_utc < ts_slot)
            .order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        raw = (snapshot.contribution_json or {}).get("raw", {}) if snapshot.contribution_json else {}
        # Prefer real Open-Meteo weather from DB; fall back to IDW-interpolated station values
        db_weather = self._weather_for_ward(ward)
        weather = {
            "wind_speed": (db_weather.wind_speed_10m if db_weather and db_weather.wind_speed_10m is not None
                           else raw.get("wind_speed", getattr(row, "wind_speed", None))),
            "humidity": (db_weather.relativehumidity_2m if db_weather and db_weather.relativehumidity_2m is not None
                         else raw.get("humidity", getattr(row, "humidity", None))),
            "temperature": (db_weather.temperature_2m if db_weather and db_weather.temperature_2m is not None
                            else raw.get("temperature", getattr(row, "temperature", None))),
        }
        fires = self._fires_for_ward(ward)
        det = detect_pollution_sources(
            pollutants={
                "pm25": raw.get("pm25", getattr(row, "pm25", None)),
                "pm10": raw.get("pm10", getattr(row, "pm10", None)),
                "no2": raw.get("no2", getattr(row, "no2", None)),
                "so2": raw.get("so2", getattr(row, "so2", None)),
                "o3": raw.get("o3", getattr(row, "o3", None)),
                "co": raw.get("co", getattr(row, "co", None)),
            },
            weather=weather,
            ts_utc=ts_slot,
            fire_nearby=bool(fires.get("fireNearby")),
            history=None,
        )

        profiles = _ward_profiles(ward)
        density_index = _density_index(ward, profiles)
        exposure_risk = round(float(snapshot.aqi_value) * density_index, 2)

        triggers: list[dict[str, Any]] = []
        pm25 = float(raw.get("pm25", 0.0) or 0.0)
        no2 = float(raw.get("no2", 0.0) or 0.0)
        so2 = float(raw.get("so2", 0.0) or 0.0)
        temperature = float(weather.get("temperature", 0.0) or 0.0)
        fire_count = len(fires.get("fires", []) or [])
        forecast_3h = int(forecast.aqi_pred) if forecast else int(snapshot.aqi_value)

        if bool(fires.get("fireNearby")):
            triggers.append(
                _trigger(
                    "Fire event",
                    "critical" if fire_count >= 2 else "high",
                    "hotspots",
                    fire_count,
                    f"within {settings.disaster_fire_radius_km} km",
                    "NASA FIRMS hotspot detected near ward boundary.",
                )
            )

        if snapshot.aqi_value > int(settings.disaster_extreme_aqi_threshold):
            triggers.append(
                _trigger(
                    "Extreme AQI",
                    "critical",
                    "aqi",
                    snapshot.aqi_value,
                    int(settings.disaster_extreme_aqi_threshold),
                    "AQI crossed severe emergency threshold.",
                )
            )

        if previous is not None:
            prev_aqi = float(previous.aqi_value)
            delta = float(snapshot.aqi_value) - prev_aqi
            rise_pct = (delta / max(prev_aqi, 1.0)) * 100.0
            if delta >= float(settings.disaster_pollution_spike_aqi_delta) or rise_pct >= float(settings.disaster_pollution_spike_pct):
                triggers.append(
                    _trigger(
                        "Pollution spike",
                        "high",
                        "aqi_delta",
                        round(delta, 1),
                        {
                            "aqi_delta": float(settings.disaster_pollution_spike_aqi_delta),
                            "percent": float(settings.disaster_pollution_spike_pct),
                        },
                        f"AQI rose sharply from {int(prev_aqi)} to {snapshot.aqi_value}.",
                    )
                )

        if temperature >= float(settings.disaster_heatwave_temp_c):
            triggers.append(
                _trigger(
                    "Heatwave",
                    "high" if temperature < float(settings.disaster_heatwave_temp_c) + 3 else "critical",
                    "temperature_c",
                    round(temperature, 1),
                    float(settings.disaster_heatwave_temp_c),
                    "Temperature crossed heatwave trigger threshold.",
                )
            )

        if (
            snapshot.aqi_value >= int(settings.disaster_industrial_hazard_aqi_threshold)
            and profiles["industrial_zone_score"] >= 0.45
            and (so2 >= 40.0 or no2 >= 70.0)
        ):
            triggers.append(
                _trigger(
                    "Industrial hazard",
                    "high",
                    "industrial_score",
                    round(profiles["industrial_zone_score"], 2),
                    0.45,
                    "Elevated AQI with industrial corridor signature.",
                )
            )

        if density_index >= 65.0 and int(ward.sensitive_sites_count or 0) >= 3 and (snapshot.aqi_value >= 180 or temperature >= float(settings.disaster_heatwave_temp_c)):
            triggers.append(
                _trigger(
                    "High-risk population",
                    "high",
                    "density_index",
                    round(density_index, 2),
                    65,
                    "Dense built-up ward with multiple sensitive sites.",
                )
            )

        traffic_score = _clamp((profiles["road_density"] * 0.35) + _normalize(no2, 30, 120) * 0.45 + _normalize(snapshot.aqi_value, 120, 320) * 0.2, 0.0, 1.0)
        industrial_score = _clamp((profiles["industrial_zone_score"] * 0.4) + _normalize(so2, 20, 100) * 0.4 + _normalize(no2, 30, 120) * 0.2, 0.0, 1.0)
        fire_score = _clamp((1.0 if fires.get("fireNearby") else 0.0) * 0.7 + (1.0 if "Biomass" in str(det.primary.get("label") or "") else 0.0) * 0.3, 0.0, 1.0)
        causes = {
            "Fire / Stubble Burning": fire_score,
            "Traffic Congestion": traffic_score,
            "Industrial Emissions": industrial_score,
        }
        probable_causes = _sort_causes(causes)

        multi_trigger_bonus = 12.0 if len(triggers) >= 2 else 0.0
        risk_score = (
            _normalize(snapshot.aqi_value, 50, 400) * 45.0
            + _normalize(exposure_risk, 1200, 32000) * 20.0
            + (12.0 if any(t["type"] == "Fire event" for t in triggers) else 0.0)
            + (10.0 if any(t["type"] == "Industrial hazard" for t in triggers) else 0.0)
            + (8.0 if any(t["type"] == "Heatwave" for t in triggers) else 0.0)
            + (6.0 if any(t["type"] == "High-risk population" for t in triggers) else 0.0)
            + multi_trigger_bonus
        )
        if forecast_3h >= snapshot.aqi_value + 25:
            risk_score += 6.0
        risk_score = round(_clamp(risk_score, 0.0, 100.0), 2)

        alert_level = _alert_level(risk_score)
        disaster_mode = alert_level == "Critical" or any(t["severity"] == "critical" for t in triggers)
        disaster_type = "multi-hazard" if len(triggers) >= 2 else (
            "fire" if any(t["type"] == "Fire event" for t in triggers)
            else "heatwave" if any(t["type"] == "Heatwave" for t in triggers)
            else "industrial_hazard" if any(t["type"] == "Industrial hazard" for t in triggers)
            else "air_quality"
        )
        status = _status_for_level(alert_level)
        confidence = round(
            _clamp(
                0.45
                + (0.2 if fires.get("fireNearby") else 0.0)
                + (0.15 if len(triggers) >= 2 else 0.0)
                + (float(snapshot.data_quality_score or 0.0) * 0.2),
                0.0,
                1.0,
            ),
            2,
        )
        affected_population = int(round((float(ward.population or 0)) * _clamp(risk_score / 100.0, 0.05, 1.0)))
        actions = _actions_for(probable_causes, triggers, disaster_mode)
        trend = "worsening" if forecast_3h > snapshot.aqi_value + 15 else "improving" if forecast_3h < snapshot.aqi_value - 15 else "stable"

        summary = {
            "citizen": {
                "risk_level": alert_level,
                "trend_prediction": trend,
                "probable_causes": probable_causes,
                "safe_guidance": (
                    "Move sensitive groups indoors and avoid heavy-traffic routes."
                    if alert_level in {"High", "Critical"}
                    else "Use routine precautions and monitor updates."
                ),
            },
            "officer": {
                "status": status,
                "disaster_type": disaster_type,
                "source_panel": probable_causes,
                "affected_population": affected_population,
                "recommended_actions": actions,
            },
        }

        assessment = existing or DisasterAssessment(ts_utc=ts_slot, ward_id=ward.ward_id)
        assessment.ts_utc = ts_slot
        assessment.ward_id = ward.ward_id
        assessment.alert_level = alert_level
        assessment.disaster_type = disaster_type
        assessment.status = status
        assessment.disaster_mode = disaster_mode
        assessment.risk_score = risk_score
        assessment.exposure_risk = exposure_risk
        assessment.population_density_index = density_index
        assessment.affected_population = affected_population
        assessment.confidence_score = confidence
        assessment.probable_causes_json = probable_causes
        assessment.triggers_json = triggers
        assessment.actions_json = actions
        assessment.metrics_json = {
            "aqi": snapshot.aqi_value,
            "aqi_category": snapshot.aqi_category,
            "primary_pollutant": snapshot.primary_pollutant,
            "pm25": pm25,
            "no2": no2,
            "so2": so2,
            "temperature_c": round(temperature, 1),
            "forecast_3h_aqi": forecast_3h,
            "fire_hotspots": fire_count,
            "profiles": profiles,
        }
        assessment.summary_json = summary
        assessment.engine_version = ENGINE_VERSION
        self.db.add(assessment)
        return assessment

    def _fires_for_ward(self, ward: Ward) -> dict[str, Any]:
        lat = ward.centroid_lat
        lon = ward.centroid_lon
        if lat is None or lon is None:
            return {"fires": [], "fireNearby": False, "enabled": False, "reason": "missing_centroid"}
        cache_key = f"{round(float(lat), 3)}:{round(float(lon), 3)}"
        cached = self._fire_cache.get(cache_key)
        if cached is not None:
            return cached
        if os.getenv("PYTEST_CURRENT_TEST") is not None:
            payload = {"fires": [], "fireNearby": False, "enabled": False, "reason": "disabled_in_tests"}
        elif not getattr(settings, "external_apis_enabled", True):
            payload = {"fires": [], "fireNearby": False, "enabled": False, "reason": "external_apis_disabled"}
        elif not (settings.firms_map_key or "").strip():
            payload = {"fires": [], "fireNearby": False, "enabled": False, "reason": "missing_firms_map_key"}
        else:
            try:
                payload = self._firms.fetch_nearby(
                    lat=float(lat),
                    lon=float(lon),
                    radius_km=float(settings.disaster_fire_radius_km),
                    days=1,
                )
            except Exception:
                payload = {"fires": [], "fireNearby": False, "enabled": False, "reason": "firms_fetch_failed"}
        self._fire_cache[cache_key] = payload
        return payload

    def _weather_for_ward(self, ward: Ward) -> WeatherData | None:
        lat = ward.centroid_lat
        lon = ward.centroid_lon
        if lat is None or lon is None:
            return self.db.scalars(select(WeatherData).order_by(WeatherData.ts_utc.desc())).first()
        cache_key = f"{round(float(lat), 3)}:{round(float(lon), 3)}"
        if cache_key in self._weather_cache:
            return self._weather_cache[cache_key]
        rows = self.db.scalars(select(WeatherData).order_by(WeatherData.ts_utc.desc()).limit(40)).all()
        if not rows:
            self._weather_cache[cache_key] = None
            return None
        item = min(rows, key=lambda row: _distance_weather(lat, lon, row))
        self._weather_cache[cache_key] = item
        return item

    def _upsert_event(self, *, ts_slot: datetime, ward_id: str, assessment: DisasterAssessment) -> None:
        if assessment.alert_level not in {"High", "Critical"}:
            return
        level = "SEVERE" if assessment.alert_level == "Critical" else "HIGH"
        existing = self.db.scalars(
            select(CrisisEvent).where(
                CrisisEvent.ward_id == ward_id,
                CrisisEvent.started_at_utc == ts_slot,
                CrisisEvent.rule_version == ENGINE_VERSION,
            )
        ).first()
        summary = ", ".join(str(t.get("type") or "") for t in (assessment.triggers_json or [])) or assessment.disaster_type
        if existing is None:
            existing = CrisisEvent(ward_id=ward_id, started_at_utc=ts_slot, rule_version=ENGINE_VERSION)
        existing.level = level
        existing.trigger_reason = f"{assessment.disaster_type}: {summary}"
        existing.anomaly_score = round(_clamp(float(assessment.risk_score or 0.0) / 100.0, 0.0, 1.0), 3)
        existing.disaster_mode = bool(assessment.disaster_mode)
        self.db.add(existing)
