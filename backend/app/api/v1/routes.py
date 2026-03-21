from __future__ import annotations

import math
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import AqiSnapshot, City, Complaint, CrisisEvent, ForecastSnapshot, SatelliteData, Ward, WeatherData
from app.services.cpcb_source import CpcbSource
from app.services.cpcb_source import StationObservation
from app.services.collectors.http_client import get_recent_api_checks
from app.services.environmental_ingestion_service import EnvironmentalIngestionService
from app.services.pipeline import calc_sub_index, aqi_category
from app.services.source_detection import detect_pollution_sources

router = APIRouter()

def _latest_weather_dict(db: Session) -> dict[str, Any]:
    row = db.scalars(select(WeatherData).order_by(WeatherData.ts_utc.desc())).first()
    if row is None:
        return {}
    return {
        "temperature": row.temperature_2m,
        "wind_speed": row.wind_speed_10m,
        "humidity": row.relativehumidity_2m,
        "wind_direction": row.wind_direction_10m,
        "timestamp": row.ts_utc.isoformat() if row.ts_utc else None,
        "source": row.source,
    }


def _latest_satellite_dict(db: Session) -> dict[str, Any]:
    row = db.scalars(select(SatelliteData).order_by(SatelliteData.ts_utc.desc())).first()
    if row is None:
        return {}
    return {
        "aerosol_index": row.aerosol_index,
        "image_reference": row.image_reference,
        "timestamp": row.ts_utc.isoformat() if row.ts_utc else None,
        "metadata": row.imagery_metadata_json or {},
        "source": row.source,
    }


def _zone_num(ward_id: str) -> int:
    # e.g. DEL_WARD_018 -> 18
    try:
        tail = str(ward_id).split("_")[-1]
        return int(tail)
    except Exception:
        return 0


def _demo_sector(ward_id: str) -> str:
    sectors = ["North", "East", "Central", "West", "South"]
    n = _zone_num(ward_id)
    return sectors[(n - 1) % len(sectors)] if n else "Central"


def _demo_sensors_online(ward_id: str) -> int:
    # Demo-friendly, deterministic value (2..6)
    n = _zone_num(ward_id)
    base = 2 + ((n - 1) % 5) if n else 3
    return max(1, min(10, int(base)))


def _bbox_from_geojson(geo: dict[str, Any]) -> tuple[float, float, float, float] | None:
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    def walk(coords: Any) -> None:
        nonlocal min_lon, min_lat, max_lon, max_lat
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            lon, lat = float(coords[0]), float(coords[1])
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)
            return
        if isinstance(coords, (list, tuple)):
            for c in coords:
                walk(c)

    for feat in geo.get("features", []) or []:
        geom = (feat or {}).get("geometry") or {}
        walk(geom.get("coordinates"))

    if min_lon == float("inf"):
        return None
    return (min_lon, min_lat, max_lon, max_lat)

@lru_cache(maxsize=8)
def _load_geojson_file(path_str: str) -> dict:
    path = Path(path_str)
    if not path.is_file():
        raise FileNotFoundError(str(path))
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=2)
def _delhi_ward_grid_geojson() -> dict:
    """
    Prototype ward polygons (grid) for Delhi.
    This makes the frontend choropleth map understandable without needing a real ward-boundary dataset.
    """
    # Size polygons to cover the whole Delhi boundary bbox (then clip on the frontend to the real outline).
    bbox = None
    try:
        boundary = _load_geojson_file(settings.delhi_boundary_geojson_path)
        bbox = _bbox_from_geojson(boundary)
    except Exception:
        bbox = None

    if bbox:
        min_lon, min_lat, max_lon, max_lat = bbox
        lon_step = (max_lon - min_lon) / 5.0
        lat_step = (max_lat - min_lat) / 5.0
        lon_start = min_lon + lon_step / 2.0
        lat_start = min_lat + lat_step / 2.0
    else:
        # Fallback: use the legacy demo grid.
        lat_step, lon_step = 0.055, 0.07
        lat_start, lon_start = 28.45, 77.02

    half_lat, half_lon = lat_step / 2.0, lon_step / 2.0

    features: list[dict] = []
    for idx in range(1, 26):
        ward_id = f"DEL_WARD_{idx:03d}"
        r = (idx - 1) // 5
        c = (idx - 1) % 5
        lat = float(lat_start + r * lat_step)
        lon = float(lon_start + c * lon_step)
        # Rectangle around centroid (lon/lat order in GeoJSON)
        coords = [
            [lon - half_lon, lat - half_lat],
            [lon + half_lon, lat - half_lat],
            [lon + half_lon, lat + half_lat],
            [lon - half_lon, lat + half_lat],
            [lon - half_lon, lat - half_lat],
        ]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "ward_id": ward_id,
                    "ward_name": f"Ward {idx}",
                    "city_id": "DELHI",
                    "centroid_lat": lat,
                    "centroid_lon": lon,
                    "grid_row": r,
                    "grid_col": c,
                    "grid_step": {"lat_step": lat_step, "lon_step": lon_step},
                },
                "geometry": {"type": "Polygon", "coordinates": [coords]},
            }
        )
    return {"type": "FeatureCollection", "name": "DELHI_WARD_GRID", "features": features}


def _build_ward_centroids() -> dict[str, tuple[float, float]]:
    # Derive a 5x5 centroid grid from Delhi's boundary bbox so the ward grid spans the full outline.
    lat_start, lon_start = 28.45, 77.02
    lat_step, lon_step = 0.055, 0.07
    try:
        boundary = _load_geojson_file(settings.delhi_boundary_geojson_path)
        bbox = _bbox_from_geojson(boundary)
        if bbox:
            min_lon, min_lat, max_lon, max_lat = bbox
            lon_step = (max_lon - min_lon) / 5.0
            lat_step = (max_lat - min_lat) / 5.0
            lon_start = min_lon + lon_step / 2.0
            lat_start = min_lat + lat_step / 2.0
    except Exception:
        pass
    coords: dict[str, tuple[float, float]] = {}
    idx = 1
    for r in range(5):
        for c in range(5):
            coords[f"DEL_WARD_{idx:03d}"] = (lat_start + r * lat_step, lon_start + c * lon_step)
            idx += 1
    return coords


WARD_CENTROIDS = _build_ward_centroids()


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _sanitize_city_id(name: str) -> str:
    s = "".join(ch if ch.isalnum() else "_" for ch in (name or "").upper()).strip("_")
    return s or "LOCAL"


def _canonical_city_id(city_id: str) -> str:
    cid = _sanitize_city_id(city_id)
    aliases = {
        "NEW_DELHI": "DELHI",
        "NCT_OF_DELHI": "DELHI",
        "DELHI_NCR": "DELHI",
    }
    return aliases.get(cid, cid)


def _load_live_stations():
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
    return source.load()


def _load_live_stations_for_city(city_id: str) -> list[StationObservation]:
    # Stabilize Delhi demo: default filters + pagination when running in live CPCB mode.
    filter_state = settings.cpcb_filter_state
    filter_city = settings.cpcb_filter_city
    api_limit = settings.cpcb_api_limit
    api_max_pages = settings.cpcb_api_max_pages

    if _canonical_city_id(city_id) == "DELHI" and not filter_state and not filter_city:
        filter_state = "Delhi"
        filter_city = "Delhi"
        api_limit = max(int(api_limit or 0), 100)
        api_max_pages = max(int(api_max_pages or 0), 5)

    source = CpcbSource(
        mode=settings.cpcb_source_mode,
        file_path=settings.cpcb_file_path,
        api_url=settings.cpcb_api_url,
        api_key=settings.cpcb_api_key,
        api_format=settings.cpcb_api_format,
        api_offset=settings.cpcb_api_offset,
        api_limit=api_limit,
        api_max_pages=api_max_pages,
        api_timeout_sec=settings.cpcb_api_timeout_sec,
        filter_state=filter_state,
        filter_city=filter_city,
    )
    return source.load()


def _idw_weighted(target_lat: float, target_lon: float, stations, attr: str) -> float:
    power = float(getattr(settings, "idw_power", 2.0) or 2.0)
    nearest_n = int(getattr(settings, "idw_nearest_n", 0) or 0)
    radius_km = float(getattr(settings, "idw_radius_km", 0.0) or 0.0)

    items: list[tuple[float, object]] = []
    for station in stations:
        dist = _haversine_km(target_lat, target_lon, station.latitude, station.longitude)
        if radius_km > 0 and dist > radius_km:
            continue
        items.append((dist, station))
    if not items:
        return 0.0
    items.sort(key=lambda x: x[0])
    if nearest_n and nearest_n > 0:
        items = items[:nearest_n]

    if items[0][0] <= 1e-6:
        return float(getattr(items[0][1], attr))

    weighted_sum = 0.0
    total_weight = 0.0
    eps = 0.0001
    for dist, station in items:
        w = 1.0 / ((dist**power) + eps)
        weighted_sum += w * float(getattr(station, attr))
        total_weight += w
    return weighted_sum / total_weight if total_weight else 0.0


def _idw_rows_for_location(city_id: str, lat: float, lon: float, grid_size: int = 25) -> list[dict]:
    stations = _load_live_stations_for_city(city_id)
    if not stations:
        return []
    n = max(1, int(math.sqrt(grid_size)))
    lat_step = 0.015
    lon_step = 0.02
    start_lat = lat - (n - 1) * lat_step / 2
    start_lon = lon - (n - 1) * lon_step / 2
    rows: list[dict] = []
    idx = 1
    city_prefix = _sanitize_city_id(city_id)
    for r in range(n):
        for c in range(n):
            c_lat = start_lat + r * lat_step
            c_lon = start_lon + c * lon_step
            pm25 = _idw_weighted(c_lat, c_lon, stations, "pm25")
            pm10 = _idw_weighted(c_lat, c_lon, stations, "pm10")
            no2 = _idw_weighted(c_lat, c_lon, stations, "no2")
            so2 = _idw_weighted(c_lat, c_lon, stations, "so2")
            o3 = _idw_weighted(c_lat, c_lon, stations, "o3")
            co = _idw_weighted(c_lat, c_lon, stations, "co")
            sub = {
                "PM2.5": calc_sub_index(pm25, "pm25"),
                "PM10": calc_sub_index(pm10, "pm10"),
                "NO2": calc_sub_index(no2, "no2"),
                "SO2": calc_sub_index(so2, "so2"),
                "O3": calc_sub_index(o3, "o3"),
                "CO": calc_sub_index(co, "co"),
            }
            primary = max(sub, key=sub.get)
            aqi = int(sub[primary])
            ward_id = f"{city_prefix}_WARD_{idx:03d}"
            rows.append(
                {
                    "ward_id": ward_id,
                    "ward_name": f"Ward {idx}",
                    "aqi": aqi,
                    "aqi_category": aqi_category(aqi),
                    "category": aqi_category(aqi),
                    "primary_pollutant": primary,
                    "pm25": round(pm25, 1),
                    "pm10": round(pm10, 1),
                    "no2": round(no2, 1),
                    "so2": round(so2, 1),
                    "o3": round(o3, 1),
                    "co": round(co, 2),
                    "centroid_lat": c_lat,
                    "centroid_lon": c_lon,
                }
            )
            idx += 1
    return rows


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def envelope(ward_id: str | None, data: dict, disaster_mode: bool, quality_score: float = 0.9) -> dict:
    return {
        "timestamp": utc_now_iso(),
        "ward_id": ward_id,
        "disaster_mode": disaster_mode,
        "data_quality": {"score": quality_score, "flag": "OK" if quality_score >= 0.8 else "LOW"},
        "data": data,
    }


def _ensure_city(db: Session, city_id: str) -> str:
    cid = _sanitize_city_id(city_id)
    city = db.get(City, cid)
    if city is None:
        city = City(city_id=cid, city_name=cid.title(), state_name="Unknown", timezone="Asia/Kolkata")
        db.add(city)
        db.commit()
    return cid


def _persist_dynamic_grid(db: Session, city_id: str, rows: list[dict]) -> None:
    if not rows:
        return
    cid = _ensure_city(db, city_id)
    now = datetime.now(timezone.utc)
    quality = 0.83

    for row in rows:
        ward_id = str(row.get("ward_id") or "").strip()
        if not ward_id:
            continue
        ward_name = str(row.get("ward_name") or ward_id).strip()

        ward = db.get(Ward, ward_id)
        if ward is None:
            db.add(
                Ward(
                    ward_id=ward_id,
                    city_id=cid,
                    ward_name=ward_name,
                    population=50000,
                    sensitive_sites_count=3,
                    centroid_lat=float(row.get("centroid_lat") or 0.0) or None,
                    centroid_lon=float(row.get("centroid_lon") or 0.0) or None,
                )
            )
        else:
            # If the ward was created earlier without centroids, backfill them from the dynamic grid.
            if ward.city_id != cid:
                ward.city_id = cid
            if not ward.ward_name and ward_name:
                ward.ward_name = ward_name
            if ward.centroid_lat is None or ward.centroid_lon is None:
                c_lat = float(row.get("centroid_lat") or 0.0) or None
                c_lon = float(row.get("centroid_lon") or 0.0) or None
                if c_lat is not None and c_lon is not None:
                    ward.centroid_lat = c_lat
                    ward.centroid_lon = c_lon
            db.add(ward)

        pm25 = float(row.get("pm25") or 0.0)
        pm10 = float(row.get("pm10") or 0.0)
        no2 = float(row.get("no2") or 0.0)
        so2 = float(row.get("so2") or 0.0)
        o3 = float(row.get("o3") or 0.0)
        co = float(row.get("co") or 0.0)

        indices = {
            "PM2.5": calc_sub_index(pm25, "pm25"),
            "PM10": calc_sub_index(pm10, "pm10"),
            "NO2": calc_sub_index(no2, "no2"),
            "SO2": calc_sub_index(so2, "so2"),
            "O3": calc_sub_index(o3, "o3"),
            "CO": calc_sub_index(co, "co"),
        }
        denom = float(sum(indices.values()) or 1.0)
        contrib_pct = {k: round((v / denom) * 100.0, 1) for k, v in indices.items()}
        primary = str(row.get("primary_pollutant") or max(indices, key=indices.get))
        aqi = int(row.get("aqi") or indices.get(primary, 120))

        db.add(
            AqiSnapshot(
                ts_utc=now,
                ward_id=ward_id,
                aqi_value=aqi,
                aqi_category=aqi_category(aqi),
                primary_pollutant=primary,
                pmi_value=0.0,
                contribution_json={
                    **contrib_pct,
                    "raw": {"pm25": pm25, "pm10": pm10, "no2": no2, "so2": so2, "o3": o3, "co": co},
                    "centroid": {"lat": row.get("centroid_lat"), "lon": row.get("centroid_lon")},
                },
                calc_rule_version="dynamic-idw-v1",
                data_quality_score=quality,
                data_quality_flag="OK",
            )
        )

        momentum = round((pm25 / 4 + pm10 / 10 + no2 / 6) / 10)
        for horizon in (1, 2, 3):
            pred = max(0, min(500, aqi + horizon * momentum))
            db.add(
                ForecastSnapshot(
                    ward_id=ward_id,
                    horizon_hour=horizon,
                    target_ts_utc=now + timedelta(hours=horizon),
                    aqi_pred=int(pred),
                    aqi_category_pred=aqi_category(int(pred)),
                    model_name="dynamic-momentum",
                    model_version="v1",
                    data_quality_score=quality,
                    disaster_mode=int(pred) > 300,
                )
            )

    db.commit()


def severity_from_level(level: str) -> str:
    lvl = level.upper()
    if lvl == "SEVERE":
        return "critical"
    if lvl == "HIGH":
        return "severe"
    return "moderate"


class ComplaintCreate(BaseModel):
    city_id: str = "DELHI"
    ward_id: str = Field(min_length=1)
    text: str = Field(min_length=5, max_length=2000)
    votes: int = Field(default=0, ge=0, le=100000)


class ComplaintUpdate(BaseModel):
    status: str | None = None
    votes: int | None = Field(default=None, ge=0, le=100000)


def _seed_default_complaints(db: Session, city_id: str) -> None:
    existing = db.scalars(select(Complaint.complaint_id).where(Complaint.city_id == city_id).limit(1)).first()
    if existing is not None:
        return
    defaults = [
        Complaint(
            city_id=city_id,
            ward_id="DEL_WARD_013",
            text="Visible black smoke from industrial stack near NH corridor.",
            status="OPEN",
            votes=29,
        ),
        Complaint(
            city_id=city_id,
            ward_id="DEL_WARD_007",
            text="Long truck idling periods at major intersection.",
            status="ASSIGNED",
            votes=18,
        ),
        Complaint(
            city_id=city_id,
            ward_id="DEL_WARD_004",
            text="Construction dust not covered overnight.",
            status="RESOLVED",
            votes=11,
        ),
    ]
    db.add_all(defaults)
    db.commit()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "timestamp": utc_now_iso()}


@router.get("/readiness")
def readiness(db: Session = Depends(get_db)) -> dict:
    ward_count = len(db.scalars(select(Ward.ward_id)).all())
    return {"status": "ready", "ward_count": ward_count, "timestamp": utc_now_iso()}


@router.get("/ward-aqi")
@router.get("/aqi/current")
def ward_aqi(ward_id: str, db: Session = Depends(get_db)) -> dict:
    current = db.scalars(
        select(AqiSnapshot).where(AqiSnapshot.ward_id == ward_id).order_by(AqiSnapshot.ts_utc.desc())
    ).first()
    if current is None:
        raise AppError("DATA_NOT_READY", f"No AQI snapshot available for {ward_id}.", 404)

    raw = (current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}
    pollutants = {k: raw.get(k) for k in ("pm25", "pm10", "no2", "so2", "co", "o3")}
    weather = _latest_weather_dict(db)
    satellite = _latest_satellite_dict(db)
    hist_rows = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= datetime.now(timezone.utc) - timedelta(hours=6))
        .order_by(AqiSnapshot.ts_utc.asc())
    ).all()
    history: list[tuple[datetime, dict[str, Any]]] = []
    for r in hist_rows:
        rr = (r.contribution_json.get("raw", {}) or {}) if r.contribution_json else {}
        history.append((r.ts_utc, {k: rr.get(k) for k in ("pm25", "pm10", "no2", "so2", "co", "o3")}))
    det = detect_pollution_sources(
        pollutants=pollutants,
        weather=weather,
        ts_utc=current.ts_utc,
        satellite=satellite,
        history=history if len(history) >= 4 else None,
    )
    return envelope(
        ward_id=ward_id,
        disaster_mode=current.aqi_value > 300,
        quality_score=current.data_quality_score,
        data={
            "aqi": current.aqi_value,
            "category": current.aqi_category,
            "primary_pollutant": current.primary_pollutant,
            "pmi": current.pmi_value,
            "as_of_utc": current.ts_utc.isoformat(),
            "source_detection": {
                "primary": det.primary,
                "secondary": det.secondary,
                "reasons": det.reasons,
                "trend": det.trend,
            },
        },
    )


@router.get("/aqi-forecast")
@router.get("/aqi/forecast")
def aqi_forecast(ward_id: str, horizon: int = 1, db: Session = Depends(get_db)) -> dict:
    if horizon not in (1, 2, 3):
        raise AppError("BAD_REQUEST", "horizon must be one of 1, 2, 3.", 400)

    def _clamp_aqi(v: float | int) -> int:
        try:
            n = int(round(float(v)))
        except Exception:
            n = 0
        return max(0, min(500, n))

    now = datetime.now(timezone.utc)
    ts_slot = now.replace(minute=0, second=0, microsecond=0)
    forecast = db.scalars(
        select(ForecastSnapshot)
        .where(ForecastSnapshot.ward_id == ward_id, ForecastSnapshot.horizon_hour == horizon)
        .order_by(ForecastSnapshot.ts_generated_utc.desc())
    ).first()

    # On-demand forecast generation: keeps the citizen UI working even if the scheduler/pipeline isn't running.
    gen_ts = None
    if forecast is not None and forecast.ts_generated_utc is not None:
        gen_ts = forecast.ts_generated_utc
        if gen_ts.tzinfo is None:
            gen_ts = gen_ts.replace(tzinfo=timezone.utc)
    stale = forecast is None or (gen_ts is not None and (now - gen_ts) > timedelta(hours=2))
    if stale:
        recent = db.scalars(
            select(AqiSnapshot)
            .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= now - timedelta(hours=6))
            .order_by(AqiSnapshot.ts_utc.desc())
            .limit(4)
        ).all()
        if not recent:
            raise AppError("DATA_NOT_READY", f"No forecast available for {ward_id} (no recent AQI snapshot).", 404)
        latest = recent[0]

        aqi_pred = int(latest.aqi_value)
        model_name = "naive-live"
        model_version = "naive-v2"
        if len(recent) >= 2:
            oldest = recent[-1]
            dt_h = (latest.ts_utc - oldest.ts_utc).total_seconds() / 3600.0 if latest.ts_utc and oldest.ts_utc else 0.0
            if dt_h > 0.25:
                slope = (float(latest.aqi_value) - float(oldest.aqi_value)) / dt_h
                # Limit slope to avoid unrealistic jumps from sparse history.
                slope = max(-40.0, min(40.0, slope))
                aqi_pred = _clamp_aqi(float(latest.aqi_value) + slope * float(horizon))
                model_name = "local-trend"
                model_version = "trend-v1"

        # Upsert forecast for this hour slot so the UI stops "jumping" on refresh.
        slot_row = db.scalars(
            select(ForecastSnapshot).where(
                ForecastSnapshot.ts_generated_utc == ts_slot,
                ForecastSnapshot.ward_id == ward_id,
                ForecastSnapshot.horizon_hour == horizon,
            )
        ).first()
        if slot_row is None:
            slot_row = ForecastSnapshot(ts_generated_utc=ts_slot, ward_id=ward_id, horizon_hour=horizon)
            db.add(slot_row)

        slot_row.target_ts_utc = ts_slot + timedelta(hours=horizon)
        slot_row.aqi_pred = _clamp_aqi(aqi_pred)
        slot_row.aqi_category_pred = aqi_category(slot_row.aqi_pred)
        slot_row.model_name = model_name
        slot_row.model_version = model_version
        slot_row.data_quality_score = 0.86
        slot_row.disaster_mode = slot_row.aqi_pred > 300
        db.commit()
        forecast = slot_row

    if forecast is None:
        raise AppError("DATA_NOT_READY", f"No forecast available for {ward_id}.", 404)
    return envelope(
        ward_id=ward_id,
        disaster_mode=forecast.disaster_mode,
        quality_score=forecast.data_quality_score,
        data={
            "horizon_hour": horizon,
            "aqi_pred": forecast.aqi_pred,
            "category": forecast.aqi_category_pred,
            "target_ts_utc": forecast.target_ts_utc.isoformat(),
            "ts_generated_utc": forecast.ts_generated_utc.isoformat(),
            "model": {"name": forecast.model_name, "version": forecast.model_version},
        },
    )


@router.get("/pollutant-breakdown")
@router.get("/pollutant/contribution")
def pollutant_breakdown(ward_id: str, db: Session = Depends(get_db)) -> dict:
    current = db.scalars(
        select(AqiSnapshot).where(AqiSnapshot.ward_id == ward_id).order_by(AqiSnapshot.ts_utc.desc())
    ).first()
    if current is None:
        raise AppError("DATA_NOT_READY", f"No pollutant breakdown available for {ward_id}.", 404)
    payload = {k: v for k, v in current.contribution_json.items() if k != "raw"}
    raw = (current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}
    pollutants = {k: raw.get(k) for k in ("pm25", "pm10", "no2", "so2", "co", "o3")}
    weather = _latest_weather_dict(db)
    satellite = _latest_satellite_dict(db)
    hist_rows = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= datetime.now(timezone.utc) - timedelta(hours=6))
        .order_by(AqiSnapshot.ts_utc.asc())
    ).all()
    history: list[tuple[datetime, dict[str, Any]]] = []
    for r in hist_rows:
        rr = (r.contribution_json.get("raw", {}) or {}) if r.contribution_json else {}
        history.append((r.ts_utc, {k: rr.get(k) for k in ("pm25", "pm10", "no2", "so2", "co", "o3")}))
    det = detect_pollution_sources(
        pollutants=pollutants,
        weather=weather,
        ts_utc=current.ts_utc,
        satellite=satellite,
        history=history if len(history) >= 4 else None,
    )
    return envelope(
        ward_id=ward_id,
        disaster_mode=current.aqi_value > 300,
        quality_score=current.data_quality_score,
        data={
            "contribution_percent": payload,
            "raw_concentration": raw,
            "source_detection": {
                "primary": det.primary,
                "secondary": det.secondary,
                "reasons": det.reasons,
                "trend": det.trend,
            },
        },
    )


@router.get("/alerts")
def alerts(ward_id: str, db: Session = Depends(get_db)) -> dict:
    latest = db.scalars(
        select(CrisisEvent).where(CrisisEvent.ward_id == ward_id).order_by(CrisisEvent.started_at_utc.desc())
    ).first()
    if latest is None:
        return envelope(
            ward_id=ward_id,
            disaster_mode=False,
            data={"active": False, "message": "No active crisis alert", "level": "NORMAL"},
        )
    return envelope(
        ward_id=ward_id,
        disaster_mode=latest.disaster_mode,
        data={
            "active": latest.ended_at_utc is None,
            "level": latest.level,
            "reason": latest.trigger_reason,
            "started_at_utc": latest.started_at_utc.isoformat(),
            "health_advisory": "Avoid outdoor activity if sensitive or symptomatic.",
        },
    )


@router.get("/ward-map-data")
def ward_map_data(city_id: str = "DELHI", lat: float | None = None, lon: float | None = None, db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    rows = []
    # Load stations once (only if needed) so we can fill gaps for wards that have no snapshot yet.
    stations = None
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        raw = current.contribution_json.get("raw", {}) if current else {}
        centroid_lat: float | None = float(ward.centroid_lat) if ward.centroid_lat is not None else None
        centroid_lon: float | None = float(ward.centroid_lon) if ward.centroid_lon is not None else None
        if centroid_lat is None or centroid_lon is None:
            # Only fall back to the demo Delhi grid for Delhi wards; avoid plotting other cities on Delhi.
            if city_id == "DELHI" or str(ward.ward_id).startswith("DEL_WARD_"):
                c = WARD_CENTROIDS.get(ward.ward_id, (28.6139, 77.2090))
                centroid_lat, centroid_lon = float(c[0]), float(c[1])
        rows.append(
            {
                "ward_id": ward.ward_id,
                "ward_name": ward.ward_name,
                "aqi": current.aqi_value if current else None,
                "category": current.aqi_category if current else "Unknown",
                "primary_pollutant": current.primary_pollutant if current else "",
                "pm25": raw.get("pm25"),
                "pm10": raw.get("pm10"),
                "no2": raw.get("no2"),
                "so2": raw.get("so2"),
                "o3": raw.get("o3"),
                "co": raw.get("co"),
                "sector": _demo_sector(ward.ward_id),
                "sensors_online": _demo_sensors_online(ward.ward_id),
                "centroid_lat": centroid_lat,
                "centroid_lon": centroid_lon,
                "has_snapshot": current is not None,
                "as_of_utc": current.ts_utc.isoformat() if current else None,
            }
        )

    # Fill missing ward colors with an IDW estimate from the current CPCB station observations.
    # This keeps the choropleth map readable even when the snapshot pipeline hasn't populated all wards.
    missing = [r for r in rows if r.get("aqi") is None and r.get("centroid_lat") is not None and r.get("centroid_lon") is not None]
    if missing:
        try:
            stations = _load_live_stations_for_city(city_id)
        except Exception:
            stations = None
    if stations:
        for r in missing:
            c_lat = float(r["centroid_lat"])
            c_lon = float(r["centroid_lon"])
            pm25 = _idw_weighted(c_lat, c_lon, stations, "pm25")
            pm10 = _idw_weighted(c_lat, c_lon, stations, "pm10")
            no2 = _idw_weighted(c_lat, c_lon, stations, "no2")
            so2 = _idw_weighted(c_lat, c_lon, stations, "so2")
            o3 = _idw_weighted(c_lat, c_lon, stations, "o3")
            co = _idw_weighted(c_lat, c_lon, stations, "co")

            sub = {
                "PM2.5": calc_sub_index(pm25, "pm25"),
                "PM10": calc_sub_index(pm10, "pm10"),
                "NO2": calc_sub_index(no2, "no2"),
                "SO2": calc_sub_index(so2, "so2"),
                "O3": calc_sub_index(o3, "o3"),
                "CO": calc_sub_index(co, "co"),
            }
            primary = max(sub, key=sub.get)
            aqi = int(sub[primary])

            r["aqi"] = aqi
            r["category"] = aqi_category(aqi)
            r["primary_pollutant"] = primary
            r["pm25"] = round(pm25, 1)
            r["pm10"] = round(pm10, 1)
            r["no2"] = round(no2, 1)
            r["so2"] = round(so2, 1)
            r["o3"] = round(o3, 1)
            r["co"] = round(co, 2)
            r["estimated"] = True
            r["estimate_method"] = "idw"
            r["estimate_source"] = settings.cpcb_source_mode
    # If wards exist but don't have centroids (common when created before centroid columns existed),
    # prefer a dynamic grid centered on the query location and persist centroids into the DB.
    if rows and lat is not None and lon is not None:
        missing_centroids = all(r.get("centroid_lat") is None or r.get("centroid_lon") is None for r in rows)
        if missing_centroids:
            dyn = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
            if dyn:
                _persist_dynamic_grid(db, city_id=city_id, rows=dyn)
                rows = dyn
    # Dynamic, location-centered IDW wards for non-seeded cities.
    if not rows and lat is not None and lon is not None:
        rows = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
        _persist_dynamic_grid(db, city_id=city_id, rows=rows)

    # Attach lightweight source detection for UI (map click, officer view).
    weather = _latest_weather_dict(db)
    satellite = _latest_satellite_dict(db)
    now_ts = datetime.now(timezone.utc)
    for r in rows:
        # Ensure demo ops metadata exists for dynamic grids too.
        if r.get("sector") is None:
            r["sector"] = _demo_sector(str(r.get("ward_id") or ""))
        if r.get("sensors_online") is None:
            r["sensors_online"] = _demo_sensors_online(str(r.get("ward_id") or ""))
        try:
            ts_txt = r.get("as_of_utc") or None
            ts = now_ts
            if ts_txt:
                ts = datetime.fromisoformat(str(ts_txt).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            ts = now_ts
        pollutants = {k: r.get(k) for k in ("pm25", "pm10", "no2", "so2", "co", "o3")}
        det = detect_pollution_sources(pollutants=pollutants, weather=weather, ts_utc=ts, satellite=satellite)
        r["source_detection"] = {
            "primary": det.primary,
            "secondary": det.secondary,
            "reasons": det.reasons,
            "trend": det.trend,
        }
    return {
        "timestamp": utc_now_iso(),
        "city_id": city_id,
        "ward_count": len(rows),
        "data": rows,
    }


@router.get("/geojson/delhi-boundary")
def geojson_delhi_boundary() -> dict:
    try:
        geojson_data = _load_geojson_file(settings.delhi_boundary_geojson_path)
    except FileNotFoundError:
        raise AppError("NOT_FOUND", f"Delhi boundary GeoJSON not found at {settings.delhi_boundary_geojson_path}", 404)
    except Exception as exc:
        raise AppError("BAD_GEOJSON", f"Failed to load Delhi boundary GeoJSON: {exc}", 500)
    return {
        "timestamp": utc_now_iso(),
        "city_id": "DELHI",
        "path": settings.delhi_boundary_geojson_path,
        "data": geojson_data,
    }


@router.get("/geojson/delhi-wards-grid")
def geojson_delhi_wards_grid() -> dict:
    return {
        "timestamp": utc_now_iso(),
        "city_id": "DELHI",
        "data": _delhi_ward_grid_geojson(),
        "note": "Prototype ward polygons (grid) for choropleth rendering. Replace with real ward GeoJSON for production.",
    }


@router.get("/debug/data-status")
def debug_data_status(db: Session = Depends(get_db)) -> dict:
    # Helps diagnose "my location is X but data looks like Delhi" issues.
    ward_counts = db.execute(select(Ward.city_id, func.count(Ward.ward_id)).group_by(Ward.city_id)).all()
    with_centroid_counts = db.execute(
        select(Ward.city_id, func.count(Ward.ward_id)).where(Ward.centroid_lat.isnot(None), Ward.centroid_lon.isnot(None)).group_by(Ward.city_id)
    ).all()
    ward_counts_map = {str(city): int(count) for city, count in ward_counts}
    with_centroid_map = {str(city): int(count) for city, count in with_centroid_counts}
    cities = sorted(set(ward_counts_map) | set(with_centroid_map))
    per_city = []
    for cid in cities:
        total = ward_counts_map.get(cid, 0)
        with_centroid = with_centroid_map.get(cid, 0)
        per_city.append(
            {
                "city_id": cid,
                "wards_total": total,
                "wards_with_centroids": with_centroid,
                "centroid_coverage_pct": round((with_centroid / total) * 100.0, 1) if total else 0.0,
            }
        )
    return {
        "timestamp": utc_now_iso(),
        "settings": {
            "cpcb_source_mode": settings.cpcb_source_mode,
            "cpcb_file_path": settings.cpcb_file_path,
            "cpcb_filter_state": settings.cpcb_filter_state,
            "cpcb_filter_city": settings.cpcb_filter_city,
            "external_apis_enabled": settings.external_apis_enabled,
        },
        "db": {"wards_by_city": per_city},
    }


@router.get("/cpcb/nearest-stations")
def cpcb_nearest_stations(
    lat: float,
    lon: float,
    top_n: int = 5,
    city_id: str = "DELHI",
) -> dict:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise AppError("BAD_REQUEST", "lat/lon are out of range.", 400)

    stations: list[StationObservation] = _load_live_stations_for_city(city_id)
    if not stations:
        return {
            "timestamp": utc_now_iso(),
            "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "count": 0,
            "data": [],
            "source": settings.cpcb_source_mode,
        }

    ranked: list[dict] = []
    for st in stations:
        d = _haversine_km(lat, lon, float(st.latitude), float(st.longitude))
        ranked.append(
            {
                "station_id": st.station_id,
                "station_name": st.station_name,
                "lat": round(float(st.latitude), 6),
                "lon": round(float(st.longitude), 6),
                "distance_km": round(float(d), 3),
                "observed_at_utc": st.observed_at_utc.isoformat(),
                "source": st.source,
                "pollutants": {
                    "pm25": st.pm25,
                    "pm10": st.pm10,
                    "no2": st.no2,
                    "so2": st.so2,
                    "o3": st.o3,
                    "co": st.co,
                },
                "met": {
                    "wind_speed": st.wind_speed,
                    "wind_direction": st.wind_direction,
                    "humidity": st.humidity,
                    "temperature": st.temperature,
                },
            }
        )
    ranked.sort(key=lambda x: x["distance_km"])
    top_n = max(1, min(int(top_n), 30))
    return {
        "timestamp": utc_now_iso(),
        "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
        "count": min(top_n, len(ranked)),
        "data": ranked[:top_n],
        "source": settings.cpcb_source_mode,
    }


@router.get("/location-insights")
def location_insights(
    lat: float,
    lon: float,
    city_id: str = "DELHI",
    top_n: int = 5,
    db: Session = Depends(get_db),
) -> dict:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise AppError("BAD_REQUEST", "lat/lon are out of range.", 400)

    city_id = _canonical_city_id(city_id)
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    if not wards:
        dyn_rows = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
        resolved_city_id = city_id
        source = "dynamic_idw"
        if not dyn_rows and city_id != "DELHI":
            dyn_rows = _idw_rows_for_location(city_id="DELHI", lat=lat, lon=lon, grid_size=25)
            if dyn_rows:
                resolved_city_id = "DELHI"
                source = "dynamic_idw_city_fallback"
        if not dyn_rows:
            return {
                "timestamp": utc_now_iso(),
                "city_id": city_id,
                "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
                "nearest_ward": {},
                "nearby_wards": [],
                "ranking": [],
                "total_wards": 0,
                "source": "empty_fallback",
            }
        by_aqi = sorted(dyn_rows, key=lambda x: x["aqi"], reverse=True)
        rank_map = {row["ward_id"]: idx for idx, row in enumerate(by_aqi, start=1)}
        for row in dyn_rows:
            row["distance_km"] = round(_haversine_km(lat, lon, row["centroid_lat"], row["centroid_lon"]), 2)
        by_distance = sorted(dyn_rows, key=lambda x: x["distance_km"])
        nearest = dict(by_distance[0])
        nearest["city_rank"] = rank_map[nearest["ward_id"]]
        top_n = max(1, min(top_n, 25))
        _persist_dynamic_grid(db, city_id=resolved_city_id, rows=dyn_rows)
        return {
            "timestamp": utc_now_iso(),
            "city_id": _sanitize_city_id(resolved_city_id),
            "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "nearest_ward": nearest,
            "nearby_wards": by_distance[:top_n],
            "ranking": by_aqi[:top_n],
            "total_wards": len(dyn_rows),
            "source": source,
        }

    ward_rows: list[dict] = []
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        if current is None:
            continue
        centroid = (ward.centroid_lat, ward.centroid_lon) if (ward.centroid_lat is not None and ward.centroid_lon is not None) else WARD_CENTROIDS.get(ward.ward_id, (28.6139, 77.2090))
        distance = _haversine_km(lat, lon, float(centroid[0]), float(centroid[1]))
        ward_rows.append(
            {
                "ward_id": ward.ward_id,
                "ward_name": ward.ward_name,
                "aqi": current.aqi_value,
                "aqi_category": current.aqi_category,
                "centroid_lat": float(centroid[0]),
                "centroid_lon": float(centroid[1]),
                "distance_km": round(distance, 2),
            }
        )

    if not ward_rows:
        return {
            "timestamp": utc_now_iso(),
            "city_id": city_id,
            "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "nearest_ward": {},
            "nearby_wards": [],
            "ranking": [],
            "total_wards": 0,
            "source": "no_snapshot_fallback",
        }

    by_aqi = sorted(ward_rows, key=lambda x: x["aqi"], reverse=True)
    rank_map = {row["ward_id"]: idx for idx, row in enumerate(by_aqi, start=1)}
    by_distance = sorted(ward_rows, key=lambda x: x["distance_km"])
    nearest = dict(by_distance[0])

    # Prefer a true polygon match when running on Postgres/PostGIS and ward polygons are available.
    if settings.database_url.startswith("postgres"):
        try:
            pt_wkt = f"POINT({lon} {lat})"
            containing = db.scalars(
                select(Ward).where(
                    Ward.city_id == city_id,
                    Ward.geom_wkt != "",
                    func.ST_Contains(func.ST_GeomFromText(Ward.geom_wkt, 4326), func.ST_GeomFromText(pt_wkt, 4326)),
                )
            ).first()
            if containing is not None:
                match = next((r for r in ward_rows if r["ward_id"] == containing.ward_id), None)
                if match:
                    nearest = dict(match)
        except Exception:
            # If PostGIS isn't enabled or functions are unavailable, fall back to centroid distance.
            pass
    if nearest["distance_km"] > 35:
        dyn_rows = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
        if dyn_rows:
            by_aqi_dyn = sorted(dyn_rows, key=lambda x: x["aqi"], reverse=True)
            rank_map_dyn = {row["ward_id"]: idx for idx, row in enumerate(by_aqi_dyn, start=1)}
            for row in dyn_rows:
                row["distance_km"] = round(_haversine_km(lat, lon, row["centroid_lat"], row["centroid_lon"]), 2)
            by_distance_dyn = sorted(dyn_rows, key=lambda x: x["distance_km"])
            nearest_dyn = dict(by_distance_dyn[0])
            nearest_dyn["city_rank"] = rank_map_dyn[nearest_dyn["ward_id"]]
            top_n = max(1, min(top_n, 25))
            return {
                "timestamp": utc_now_iso(),
                "city_id": _sanitize_city_id(city_id),
                "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
                "nearest_ward": nearest_dyn,
                "nearby_wards": by_distance_dyn[:top_n],
                "ranking": by_aqi_dyn[:top_n],
                "total_wards": len(dyn_rows),
                "source": "dynamic_idw",
            }
    nearest["city_rank"] = rank_map[nearest["ward_id"]]

    top_n = max(1, min(top_n, 25))
    return {
        "timestamp": utc_now_iso(),
        "city_id": city_id,
        "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
        "nearest_ward": nearest,
        "nearby_wards": by_distance[:top_n],
        "ranking": by_aqi[:top_n],
        "total_wards": len(ward_rows),
    }


@router.get("/alerts/feed")
def alerts_feed(city_id: str = "DELHI", limit: int = 20, db: Session = Depends(get_db)) -> dict:
    ward_ids = db.scalars(select(Ward.ward_id).where(Ward.city_id == city_id)).all()
    if not ward_ids:
        return {"timestamp": utc_now_iso(), "city_id": city_id, "count": 0, "data": []}

    events = db.scalars(
        select(CrisisEvent)
        .where(CrisisEvent.ward_id.in_(ward_ids))
        .order_by(CrisisEvent.started_at_utc.desc())
        .limit(max(1, min(limit, 100)))
    ).all()

    payload = []
    for idx, ev in enumerate(events, start=1):
        payload.append(
            {
                "id": idx,
                "sev": severity_from_level(ev.level),
                "ward_id": ev.ward_id,
                "event": ev.trigger_reason,
                "time_utc": ev.started_at_utc.isoformat(),
                "action": "Issue advisory and trigger ward response protocol.",
                "active": ev.ended_at_utc is None,
            }
        )
    return {"timestamp": utc_now_iso(), "city_id": city_id, "count": len(payload), "data": payload}


@router.get("/analytics/trends")
def analytics_trends(ward_id: str, db: Session = Depends(get_db)) -> dict:
    current = db.scalars(
        select(AqiSnapshot).where(AqiSnapshot.ward_id == ward_id).order_by(AqiSnapshot.ts_utc.desc())
    ).first()
    if current is None:
        raise AppError("DATA_NOT_READY", f"No AQI snapshot available for {ward_id}.", 404)

    now = datetime.now(timezone.utc)
    last_24h = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= now - timedelta(hours=24))
        .order_by(AqiSnapshot.ts_utc.asc())
    ).all()

    by_hour: dict[str, dict[str, float | int]] = {}
    for row in last_24h:
        raw = (row.contribution_json.get("raw", {}) or {}) if row.contribution_json else {}
        by_hour[row.ts_utc.strftime("%Y-%m-%d %H")] = {
            "aqi": int(row.aqi_value),
            "pm25": float(raw.get("pm25", 0.0) or 0.0),
            "pm10": float(raw.get("pm10", 0.0) or 0.0),
            "no2": float(raw.get("no2", 0.0) or 0.0),
            "so2": float(raw.get("so2", 0.0) or 0.0),
            "o3": float(raw.get("o3", 0.0) or 0.0),
            "co": float(raw.get("co", 0.0) or 0.0),
        }

    hourly = []
    carry = {
        "aqi": int(current.aqi_value),
        "pm25": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("pm25", 0.0) or 0.0),
        "pm10": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("pm10", 0.0) or 0.0),
        "no2": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("no2", 0.0) or 0.0),
        "so2": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("so2", 0.0) or 0.0),
        "o3": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("o3", 0.0) or 0.0),
        "co": float(((current.contribution_json.get("raw", {}) or {}) if current.contribution_json else {}).get("co", 0.0) or 0.0),
    }
    for offset in range(23, -1, -1):
        t = now - timedelta(hours=offset)
        key = t.strftime("%Y-%m-%d %H")
        if key in by_hour:
            carry = by_hour[key]
        hourly.append(
            {
                "h": t.strftime("%H"),
                "aqi": int(carry.get("aqi", 0)),
                "pm25": round(float(carry.get("pm25", 0.0)), 1),
                "pm10": round(float(carry.get("pm10", 0.0)), 1),
                "no2": round(float(carry.get("no2", 0.0)), 1),
                "so2": round(float(carry.get("so2", 0.0)), 1),
                "o3": round(float(carry.get("o3", 0.0)), 1),
                "co": round(float(carry.get("co", 0.0)), 2),
            }
        )

    last_7d = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= now - timedelta(days=7))
        .order_by(AqiSnapshot.ts_utc.asc())
    ).all()

    by_day: dict[str, list[AqiSnapshot]] = {}
    for row in last_7d:
        by_day.setdefault(row.ts_utc.date().isoformat(), []).append(row)

    weekly = []
    for offset in range(6, -1, -1):
        day = (now - timedelta(days=offset)).date()
        rows = by_day.get(day.isoformat(), [])
        if rows:
            avg_aqi = round(sum(r.aqi_value for r in rows) / len(rows))
            pm25 = round(sum(float((r.contribution_json.get("raw", {}) or {}).get("pm25", 0.0) or 0.0) for r in rows) / len(rows), 1)
            pm10 = round(sum(float((r.contribution_json.get("raw", {}) or {}).get("pm10", 0.0) or 0.0) for r in rows) / len(rows), 1)
        else:
            avg_aqi = current.aqi_value
            raw = current.contribution_json.get("raw", {})
            pm25 = round(float(raw.get("pm25", 0.0) or 0.0), 1)
            pm10 = round(float(raw.get("pm10", 0.0) or 0.0), 1)
        weekly.append({"d": day.strftime("%a").upper()[:3], "aqi": int(avg_aqi), "pm25": pm25, "pm10": pm10, "date_utc": day.isoformat()})

    return envelope(
        ward_id=ward_id,
        disaster_mode=current.aqi_value > 300,
        quality_score=current.data_quality_score,
        data={"hourly": hourly, "weekly": weekly, "source": "database_history"},
    )


@router.get("/gov/recommendations")
def gov_recommendations(city_id: str = "DELHI", db: Session = Depends(get_db)) -> dict:
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    actions = []
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        if current is None:
            continue
        if current.aqi_value > 300:
            action = "Shut high-emission units for 6 hours and restrict heavy vehicles."
            priority = "P1"
            status = "PENDING"
        elif current.aqi_value > 200:
            action = "Deploy water sprinklers and enforce construction dust controls."
            priority = "P2"
            status = "ACTIVE"
        else:
            action = "Continue routine monitoring and public advisory updates."
            priority = "P3"
            status = "NORMAL"
        actions.append(
            {
                "ward_id": ward.ward_id,
                "ward_name": ward.ward_name,
                "aqi": current.aqi_value,
                "priority": priority,
                "action": action,
                "expected_impact": f"-{max(8, min(90, current.aqi_value // 5))}",
                "department": "District Pollution Control Cell",
                "status": status,
            }
        )

    actions.sort(key=lambda x: x["aqi"], reverse=True)
    return {"timestamp": utc_now_iso(), "city_id": city_id, "count": len(actions), "data": actions[:12]}


@router.get("/complaints")
def complaints(city_id: str = "DELHI", db: Session = Depends(get_db)) -> dict:
    _seed_default_complaints(db, city_id)
    rows = db.scalars(
        select(Complaint).where(Complaint.city_id == city_id).order_by(Complaint.updated_at_utc.desc(), Complaint.complaint_id.desc())
    ).all()
    feed = [
        {
            "id": row.complaint_id,
            "city_id": row.city_id,
            "ward_id": row.ward_id,
            "text": row.text,
            "status": row.status,
            "votes": row.votes,
            "time_utc": row.created_at_utc.isoformat(),
            "updated_at_utc": row.updated_at_utc.isoformat(),
        }
        for row in rows
    ]
    return {"timestamp": utc_now_iso(), "city_id": city_id, "count": len(feed), "data": feed}


@router.post("/complaints")
def complaints_create(payload: ComplaintCreate, db: Session = Depends(get_db)) -> dict:
    ward = db.get(Ward, payload.ward_id)
    if ward is None:
        raise AppError("BAD_REQUEST", f"Invalid ward_id: {payload.ward_id}", 400)
    row = Complaint(
        city_id=payload.city_id or ward.city_id,
        ward_id=payload.ward_id,
        text=payload.text.strip(),
        status="OPEN",
        votes=payload.votes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "timestamp": utc_now_iso(),
        "status": "created",
        "data": {
            "id": row.complaint_id,
            "city_id": row.city_id,
            "ward_id": row.ward_id,
            "text": row.text,
            "status": row.status,
            "votes": row.votes,
            "time_utc": row.created_at_utc.isoformat(),
        },
    }


@router.patch("/complaints/{complaint_id}")
def complaints_update(complaint_id: int, payload: ComplaintUpdate, db: Session = Depends(get_db)) -> dict:
    row = db.get(Complaint, complaint_id)
    if row is None:
        raise AppError("NOT_FOUND", f"Complaint {complaint_id} not found.", 404)
    allowed_status = {"OPEN", "ASSIGNED", "RESOLVED"}
    if payload.status is not None:
        status = payload.status.upper().strip()
        if status not in allowed_status:
            raise AppError("BAD_REQUEST", "status must be OPEN, ASSIGNED, or RESOLVED.", 400)
        row.status = status
    if payload.votes is not None:
        row.votes = payload.votes
    row.updated_at_utc = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "timestamp": utc_now_iso(),
        "status": "updated",
        "data": {
            "id": row.complaint_id,
            "city_id": row.city_id,
            "ward_id": row.ward_id,
            "text": row.text,
            "status": row.status,
            "votes": row.votes,
            "time_utc": row.created_at_utc.isoformat(),
            "updated_at_utc": row.updated_at_utc.isoformat(),
        },
    }


@router.get("/reports/ward-summary")
def reports_ward_summary(ward_id: str, days: int = 7, db: Session = Depends(get_db)) -> dict:
    if days < 1 or days > 30:
        raise AppError("BAD_REQUEST", "days must be between 1 and 30.", 400)

    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= now - timedelta(days=days))
        .order_by(AqiSnapshot.ts_utc.asc())
    ).all()
    if not rows:
        raise AppError("DATA_NOT_READY", f"No AQI history available for {ward_id}.", 404)

    aqi_values = [r.aqi_value for r in rows]
    pollutant_counts = Counter(r.primary_pollutant for r in rows)
    dominant = pollutant_counts.most_common(1)[0][0] if pollutant_counts else "PM2.5"

    forecast = db.scalars(
        select(ForecastSnapshot)
        .where(ForecastSnapshot.ward_id == ward_id, ForecastSnapshot.horizon_hour == 3)
        .order_by(ForecastSnapshot.ts_generated_utc.desc())
    ).first()
    crisis_count = len(
        db.scalars(
            select(CrisisEvent)
            .where(CrisisEvent.ward_id == ward_id, CrisisEvent.started_at_utc >= now - timedelta(days=days))
            .order_by(CrisisEvent.started_at_utc.desc())
        ).all()
    )

    return {
        "timestamp": utc_now_iso(),
        "ward_id": ward_id,
        "days": days,
        "data": {
            "avg_aqi": round(sum(aqi_values) / len(aqi_values), 2),
            "min_aqi": min(aqi_values),
            "max_aqi": max(aqi_values),
            "latest_aqi": rows[-1].aqi_value,
            "latest_category": rows[-1].aqi_category,
            "dominant_pollutant": dominant,
            "snapshot_count": len(rows),
            "crisis_events": crisis_count,
            "forecast_3h": {
                "aqi_pred": forecast.aqi_pred if forecast else None,
                "category": forecast.aqi_category_pred if forecast else None,
                "target_ts_utc": forecast.target_ts_utc.isoformat() if forecast else None,
                "model": {"name": forecast.model_name, "version": forecast.model_version} if forecast else None,
            },
            "source": "database_history",
        },
    }


@router.post("/environment/ingest")
def ingest_environment(lat: float, lon: float, db: Session = Depends(get_db)) -> dict:
    service = EnvironmentalIngestionService(db)
    unified = service.ingest_for_coordinates(lat=lat, lon=lon)
    return {
        "timestamp": utc_now_iso(),
        "status": "ingested",
        "api_checks": get_recent_api_checks(20),
        "data": {
            "location": unified.location,
            "pollution": unified.pollution,
            "weather": unified.weather,
            "satellite": unified.satellite,
        },
    }


@router.get("/environment/unified")
def environment_unified(lat: float, lon: float, refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    service = EnvironmentalIngestionService(db)
    unified = service.ingest_for_coordinates(lat=lat, lon=lon) if refresh else service.latest_for_coordinates(lat=lat, lon=lon)
    return {
        "timestamp": utc_now_iso(),
        "api_checks": get_recent_api_checks(20),
        "data": {
            "location": unified.location,
            "pollution": unified.pollution,
            "weather": unified.weather,
            "satellite": unified.satellite,
        },
    }


@router.get("/environment/api-checks")
def environment_api_checks(limit: int = 100) -> dict:
    return {
        "timestamp": utc_now_iso(),
        "count": len(get_recent_api_checks(limit)),
        "data": get_recent_api_checks(limit),
    }
