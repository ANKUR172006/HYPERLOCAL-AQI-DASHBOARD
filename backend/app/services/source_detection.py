from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore


def _clamp01(x: float) -> float:
    return 0.0 if x <= 0.0 else 1.0 if x >= 1.0 else x


def _scale(value: float | None, lo: float, hi: float) -> float:
    if value is None:
        return 0.0
    try:
        v = float(value)
    except Exception:
        return 0.0
    if hi <= lo:
        return 0.0
    return _clamp01((v - lo) / (hi - lo))


def _scale_inv(value: float | None, lo: float, hi: float) -> float:
    return 1.0 - _scale(value, lo, hi)


def _local_hour(ts_utc: datetime, tz_name: str) -> int:
    if ts_utc.tzinfo is None:
        ts_utc = ts_utc.replace(tzinfo=timezone.utc)
    if ZoneInfo is None:
        return int(ts_utc.hour)
    try:
        return int(ts_utc.astimezone(ZoneInfo(tz_name)).hour)
    except Exception:
        return int(ts_utc.hour)


def _source_icon(source: str) -> str:
    s = (source or "").lower()
    if "traffic" in s:
        return "car"
    if "dust" in s:
        return "layers"
    if "biomass" in s or "burn" in s:
        return "flame"
    if "industrial" in s or "factory" in s:
        return "building"
    return "info"


@dataclass
class SourceDetectionResult:
    primary: dict[str, Any]
    secondary: dict[str, Any]
    reasons: list[str]
    trend: dict[str, Any]
    debug: dict[str, Any]


def detect_pollution_sources(
    *,
    pollutants: dict[str, Any],
    weather: dict[str, Any] | None,
    ts_utc: datetime,
    tz_name: str = "Asia/Kolkata",
    satellite: dict[str, Any] | None = None,
    fire_nearby: bool = False,
    history: list[tuple[datetime, dict[str, Any]]] | None = None,
) -> SourceDetectionResult:
    """
    Lightweight, explainable, rule-based "source detection" for hack/demo UX.

    Inputs:
      - pollutants: expects keys like pm25/pm10/no2/so2 (µg/m³), optional co (mg/m³)
      - weather: expects wind_speed (km/h preferred), humidity (%), temperature (°C)
      - satellite: optional fire/aerosol signals (if present)
      - history: optional list of (ts_utc, pollutants) for trend estimation
    """
    pm25 = pollutants.get("pm25") if "pm25" in pollutants else pollutants.get("PM25")
    pm10 = pollutants.get("pm10") if "pm10" in pollutants else pollutants.get("PM10")
    no2 = pollutants.get("no2") if "no2" in pollutants else pollutants.get("NO2")
    so2 = pollutants.get("so2") if "so2" in pollutants else pollutants.get("SO2")
    co = pollutants.get("co") if "co" in pollutants else pollutants.get("CO")

    w = weather or {}
    wind = w.get("wind_speed")
    rh = w.get("humidity")
    temp = w.get("temperature")

    hour = _local_hour(ts_utc, tz_name)
    is_peak = (7 <= hour <= 11) or (17 <= hour <= 21)
    is_night = (hour >= 20) or (hour <= 5)
    is_day = 8 <= hour <= 18

    # Base pollutant intensity signals (0..1)
    s_pm25 = _scale(pm25, 30, 160)
    s_pm10 = _scale(pm10, 50, 280)
    s_no2 = _scale(no2, 20, 120)
    s_so2 = _scale(so2, 10, 80)
    s_co = _scale(co, 0.4, 2.0)  # mg/m³ (very rough)

    # Weather modulation
    s_wind_low = _scale_inv(wind, 6, 18)  # lower wind -> higher stagnation
    s_humid = _scale(rh, 55, 90)
    s_cool_night = _scale_inv(temp, 12, 26) if is_night else 0.0

    # Dust proxy: PM10/PM2.5 ratio
    ratio = None
    try:
        if pm25 is not None and float(pm25) > 1:
            ratio = float(pm10 or 0.0) / float(pm25)
    except Exception:
        ratio = None
    s_ratio_dust = _scale(ratio, 1.2, 3.0)

    # Optional satellite fire hotspot hint (if caller provides)
    fire_hotspots = 0.0
    if satellite:
        try:
            fire_hotspots = float(satellite.get("fire_hotspots") or 0.0)
        except Exception:
            fire_hotspots = 0.0
    s_fire = _scale(fire_hotspots, 1.0, 10.0)
    s_firms = 1.0 if fire_nearby else 0.0

    # Source scores (0..1, later normalized)
    traffic = 0.50 * s_no2 + 0.15 * s_co + 0.20 * (1.0 if is_peak else 0.0) + 0.15 * s_wind_low
    dust = 0.55 * s_pm10 + 0.15 * s_ratio_dust + 0.20 * s_wind_low + 0.10 * (1.0 if is_day else 0.0)
    # If a FIRMS hotspot is nearby, strongly bias towards Biomass Burning (explicit override signal).
    biomass = (
        0.55 * s_pm25
        + 0.15 * (1.0 if is_night else 0.0)
        + 0.15 * s_humid
        + 0.10 * s_wind_low
        + 0.05 * s_fire
        + 0.80 * s_firms
    )
    industrial = 0.65 * s_so2 + 0.15 * s_no2 + 0.10 * s_wind_low + 0.10 * (1.0 if is_night else 0.0)

    scores = {
        "Traffic Emissions": float(traffic),
        "Dust / Construction": float(dust),
        "Biomass Burning": float(biomass),
        "Industrial Emissions": float(industrial),
    }
    # Explicit rule: if FIRMS reports a hotspot nearby, treat biomass burning as the primary source.
    if fire_nearby:
        scores["Biomass Burning"] = float(scores["Biomass Burning"]) + 10.0

    total = sum(scores.values())
    if total <= 1e-9:
        primary = {"label": "Mixed / Unknown", "confidence": 40, "icon": "info"}
        secondary = {"label": "—", "confidence": 0, "icon": "info"}
        return SourceDetectionResult(
            primary=primary,
            secondary=secondary,
            reasons=["Insufficient signals; showing a safe fallback."],
            trend={"direction": "steady", "delta_pct": 0, "note": "No trend available"},
            debug={"scores": scores, "hour_local": hour},
        )

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    p_label, p_score = ranked[0]
    s_label, s_score = ranked[1]

    p_conf = int(round((p_score / total) * 100))
    s_conf = max(0, min(100, 100 - p_conf))

    # Explanation bullets (2–3)
    reasons: list[str] = []
    if p_label.startswith("Traffic"):
        if s_no2 >= 0.45:
            reasons.append("High NO₂ suggests traffic/combustion")
        if is_peak:
            reasons.append("Peak commute hours")
        if s_wind_low >= 0.5:
            reasons.append("Low wind reduces dispersion")
    elif p_label.startswith("Dust"):
        if s_pm10 >= 0.45:
            reasons.append("High PM10 suggests dust/construction")
        if s_ratio_dust >= 0.5:
            reasons.append("PM10/PM2.5 ratio supports coarse dust")
        if s_wind_low >= 0.5:
            reasons.append("Low wind keeps dust suspended")
    elif p_label.startswith("Biomass"):
        if s_pm25 >= 0.45:
            reasons.append("High PM2.5 suggests smoke/fine particles")
        if is_night:
            reasons.append("Nighttime accumulation / burning risk")
        if s_humid >= 0.5:
            reasons.append("High humidity increases particle persistence")
        if s_fire >= 0.5:
            reasons.append("Satellite fire hotspot signal (optional)")
        if s_firms >= 0.5:
            reasons.append("FIRMS hotspot detected nearby (satellite)")
    elif p_label.startswith("Industrial"):
        if s_so2 >= 0.35:
            reasons.append("Elevated SO₂ suggests industrial sources")
        if s_wind_low >= 0.5:
            reasons.append("Low wind reduces dispersion")
        if is_night and s_cool_night >= 0.4:
            reasons.append("Stable night layer can trap emissions")

    if not reasons:
        reasons = ["Multi-signal inference from pollutants + weather + time patterns."]
    reasons = reasons[:3]

    # Trend estimation: compute primary score now vs recent history
    trend = {"direction": "steady", "delta_pct": 0, "note": "No history"}
    if history and len(history) >= 4:
        def score_for(ts: datetime, pol: dict[str, Any]) -> float:
            r = detect_pollution_sources(
                pollutants=pol,
                weather=weather,
                ts_utc=ts,
                tz_name=tz_name,
                satellite=satellite,
                history=None,
            )
            return float(r.debug.get("scores", {}).get(p_label, 0.0))

        try:
            hist_scores = [score_for(ts, pol) for ts, pol in history[-6:]]
            recent = sum(hist_scores[-3:]) / 3.0
            prev = sum(hist_scores[:3]) / 3.0
            d = recent - prev
            delta_pct = int(round(d * 100))
            direction = "increasing" if d > 0.08 else "decreasing" if d < -0.08 else "steady"
            trend = {"direction": direction, "delta_pct": delta_pct, "note": f"{p_label} trend over last hours"}
        except Exception:
            trend = {"direction": "steady", "delta_pct": 0, "note": "Trend calc failed"}

    primary = {"label": p_label, "confidence": p_conf, "icon": _source_icon(p_label)}
    secondary = {"label": s_label, "confidence": s_conf, "icon": _source_icon(s_label)}

    return SourceDetectionResult(
        primary=primary,
        secondary=secondary,
        reasons=reasons,
        trend=trend,
        debug={
            "scores": scores,
            "hour_local": hour,
            "signals": {
                "pm25": pm25,
                "pm10": pm10,
                "no2": no2,
                "so2": so2,
                "wind_speed": wind,
                "humidity": rh,
                "temperature": temp,
                "ratio_pm10_pm25": ratio,
                "fire_hotspots": fire_hotspots,
            },
        },
    )
