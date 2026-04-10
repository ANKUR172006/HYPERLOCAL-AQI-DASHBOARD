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
from app.models.entities import AqiSnapshot, City, CleanMeasurement, Complaint, CrisisEvent, DisasterAssessment, ForecastSnapshot, SatelliteData, Station, Ward, WeatherData
from app.services.cpcb_source import CpcbSource
from app.services.cpcb_source import StationObservation
from app.services.cpcb_station_counts import fetch_cpcb_station_counts
from app.services.collectors.http_client import get_recent_api_checks
from app.services.collectors.boundary_collector import BoundaryCollector
from app.services.environmental_ingestion_service import EnvironmentalIngestionService
from app.services.collectors.firms_collector import FirmsCollector
from app.services.collectors.location_collector import LocationCollector
from app.services.india_geo import district_feature_collection, district_virtual_grid, find_district_for_point
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


def _real_sector(ward_id: str, ward_name: str) -> str:
    """Derive sector from actual ward name or fall back to zone number."""
    name = (ward_name or "").upper()
    if any(k in name for k in ["NORTH", "NARELA", "ALIPUR", "BAWANA", "ROHINI", "BURARI"]):
        return "North"
    if any(k in name for k in ["EAST", "PATPARGANJ", "VIVEK", "ANAND VIHAR", "SHAHDARA", "DILSHAD"]):
        return "East"
    if any(k in name for k in ["CENTRAL", "CHANDNI", "KAROL", "CONNAUGHT", "NDMC", "ITO", "MANDIR"]):
        return "Central"
    if any(k in name for k in ["WEST", "DWARKA", "MUNDKA", "NAJAFGARH", "NSIT", "JANAKPURI"]):
        return "West"
    if any(k in name for k in ["SOUTH", "SAKET", "MEHRAULI", "OKHLA", "IGNOU", "JNU", "IIT"]):
        return "South"
    # fallback: deterministic from ward number
    sectors = ["North", "East", "Central", "West", "South"]
    n = _zone_num(ward_id)
    return sectors[(n - 1) % len(sectors)] if n else "Central"


def _real_sensors_online(ward_id: str, ward_name: str) -> int:
    """Estimate sensors from known CPCB station density per area."""
    name = (ward_name or "").upper()
    # Areas with multiple known CPCB stations
    if any(k in name for k in ["ANAND VIHAR", "ITO", "MANDIR MARG", "PUNJABI BAGH", "ROHINI"]):
        return 3
    if any(k in name for k in ["DWARKA", "BAWANA", "NARELA", "MUNDKA", "PATPARGANJ"]):
        return 2
    if any(k in name for k in ["NDMC", "LODHI", "TALKATORA", "CHANDNI", "CONNAUGHT"]):
        return 2
    return 1  # default: at least 1 nearby CPCB station


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


def _feature_prop(props: dict[str, Any], *keys: str) -> str:
    for key in keys:
        val = props.get(key)
        if val is None:
            continue
        txt = str(val).strip()
        if txt:
            return txt
    return ""


def _canonical_ward_id(raw_id: str, city_id: str, feature_index: int | None = None) -> str:
    raw = str(raw_id or "").strip()
    cid = _canonical_city_id(city_id)
    ward_prefix = "DEL" if cid == "DELHI" else cid
    if not raw:
        if feature_index is not None:
            return f"{ward_prefix}_WARD_{feature_index:03d}"
        return f"{ward_prefix}_WARD_001"
    upper = raw.upper().replace("-", "_").replace(" ", "_")
    if upper.startswith(f"{ward_prefix}_WARD_"):
        return upper
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits:
        return f"{ward_prefix}_WARD_{int(digits):03d}"
    safe = _sanitize_city_id(raw)
    if safe.startswith(f"{ward_prefix}_WARD_"):
        return safe
    return safe


def _ward_name_from_id(ward_id: str) -> str:
    digits = "".join(ch for ch in str(ward_id or "") if ch.isdigit())
    if digits:
        return f"Ward {int(digits)}"
    return str(ward_id or "Ward").replace("_", " ").title()


def _is_placeholder_ward_name(name: str | None) -> bool:
    txt = str(name or "").strip().lower()
    return not txt or txt.startswith("ward ") or txt.startswith("del ward ") or txt.startswith("delhi ward ")


def _locality_name_from_station(station_name: str) -> str:
    text = str(station_name or "").strip()
    if not text:
        return "Local Area"
    base = text.split(" - ")[0].strip()
    parts = [p.strip() for p in base.split(",") if p.strip()]
    if len(parts) >= 2:
        candidate = parts[0]
    else:
        candidate = base
    candidate = candidate.replace("_", " ").strip()
    return candidate or "Local Area"


def _virtual_ward_name(city_id: str, c_lat: float, c_lon: float, stations, idx: int) -> str:
    nearest = _select_nearby_stations(c_lat, c_lon, stations, limit=1, radius_km=30.0)
    city_name = "Delhi" if _canonical_city_id(city_id) == "DELHI" else str(city_id).replace("_", " ").title()
    if nearest:
        locality = _locality_name_from_station(nearest[0][1].station_name)
        return f"{locality} Area"
    return f"{city_name} Area {idx}"


def _normalize_ward_feature_collection(geo: dict[str, Any], city_id: str) -> dict[str, Any]:
    feats = []
    for idx, feature in enumerate(geo.get("features") or [], start=1):
        if not isinstance(feature, dict):
            continue
        props = dict(feature.get("properties") or {})
        ward_id = _canonical_ward_id(
            _feature_prop(
                props,
                "ward_id",
                "Ward_ID",
                "wardId",
                "WARD_ID",
                "Ward_No",
                "ward_no",
                "wardNo",
                "WARD_NO",
                "ward",
                "WARD",
                "code",
                "Code",
                "CODE",
                "id",
                "ID",
            ),
            city_id=city_id,
            feature_index=idx,
        )
        ward_name = _feature_prop(
            props,
            "ward_name",
            "Ward_Name",
            "wardName",
            "WARD_NAME",
            "name",
            "Name",
            "NAME",
        ) or _ward_name_from_id(ward_id)
        props["ward_id"] = ward_id
        props["ward_name"] = ward_name
        props.setdefault("city_id", _canonical_city_id(city_id))
        feats.append({**feature, "properties": props})
    return {**geo, "features": feats}


def _geojson_has_features(geo: dict[str, Any] | None) -> bool:
    return isinstance(geo, dict) and bool(geo.get("features"))


def _wkt_tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    buff = ""
    for ch in text:
        if ch in "(),":
            if buff.strip():
                tokens.append(buff.strip())
            tokens.append(ch)
            buff = ""
        else:
            buff += ch
    if buff.strip():
        tokens.append(buff.strip())
    return tokens


def _parse_wkt_ring(tokens: list[str], pos: int) -> tuple[list[list[float]], int]:
    if pos >= len(tokens) or tokens[pos] != "(":
        raise ValueError("Expected '(' for ring")
    pos += 1
    ring: list[list[float]] = []
    while pos < len(tokens):
        tok = tokens[pos]
        if tok == ")":
            return ring, pos + 1
        if tok == ",":
            pos += 1
            continue
        parts = tok.split()
        if len(parts) < 2:
            raise ValueError("Bad coordinate token")
        ring.append([float(parts[0]), float(parts[1])])
        pos += 1
    raise ValueError("Unterminated ring")


def _parse_wkt_polygon(tokens: list[str], pos: int) -> tuple[list[list[list[float]]], int]:
    if pos >= len(tokens) or tokens[pos] != "(":
        raise ValueError("Expected '(' for polygon")
    pos += 1
    rings: list[list[list[float]]] = []
    while pos < len(tokens):
        tok = tokens[pos]
        if tok == ")":
            return rings, pos + 1
        if tok == ",":
            pos += 1
            continue
        ring, pos = _parse_wkt_ring(tokens, pos)
        rings.append(ring)
    raise ValueError("Unterminated polygon")


def _geom_from_wkt(wkt: str) -> dict[str, Any] | None:
    txt = str(wkt or "").strip()
    if not txt:
        return None
    upper = txt.upper()
    if upper.startswith("POLYGON"):
        tokens = _wkt_tokenize(txt[len("POLYGON") :].strip())
        coords, _ = _parse_wkt_polygon(tokens, 0)
        return {"type": "Polygon", "coordinates": coords}
    if upper.startswith("MULTIPOLYGON"):
        tokens = _wkt_tokenize(txt[len("MULTIPOLYGON") :].strip())
        pos = 0
        if pos >= len(tokens) or tokens[pos] != "(":
            raise ValueError("Expected '(' for multipolygon")
        pos += 1
        polys: list[list[list[list[float]]]] = []
        while pos < len(tokens):
            tok = tokens[pos]
            if tok == ")":
                return {"type": "MultiPolygon", "coordinates": polys}
            if tok == ",":
                pos += 1
                continue
            poly, pos = _parse_wkt_polygon(tokens, pos)
            polys.append(poly)
        raise ValueError("Unterminated multipolygon")
    return None


def _ward_geojson_from_db(city_id: str, db: Session) -> dict[str, Any] | None:
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    if not wards:
        return None
    features: list[dict[str, Any]] = []
    for ward in wards:
        try:
            geom = _geom_from_wkt(ward.geom_wkt or "")
        except Exception:
            geom = None
        if not geom:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "ward_id": ward.ward_id,
                    "ward_name": ward.ward_name,
                    "city_id": ward.city_id,
                    "centroid_lat": float(ward.centroid_lat) if ward.centroid_lat is not None else None,
                    "centroid_lon": float(ward.centroid_lon) if ward.centroid_lon is not None else None,
                },
                "geometry": geom,
            }
        )
    if not features:
        return None
    return {"type": "FeatureCollection", "features": features}


def _city_real_wards_geojson_path(city_id: str) -> str | None:
    cid = _canonical_city_id(city_id)
    if cid == "DELHI":
        return settings.delhi_wards_geojson_path
    if cid == "HARYANA_GURUGRAM":
        return settings.gurugram_wards_geojson_path
    return None


def _ward_centroid(ward: Ward) -> tuple[float, float] | None:
    if ward.centroid_lat is not None and ward.centroid_lon is not None:
        return (float(ward.centroid_lat), float(ward.centroid_lon))
    try:
        geom = _geom_from_wkt(ward.geom_wkt or "")
    except Exception:
        geom = None
    if not geom:
        return None

    def walk(coords: Any) -> list[tuple[float, float]]:
        points: list[tuple[float, float]] = []
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            if len(coords) >= 2:
                points.append((float(coords[0]), float(coords[1])))
            return points
        if isinstance(coords, (list, tuple)):
            for c in coords:
                points.extend(walk(c))
        return points

    pts = walk(geom.get("coordinates"))
    if not pts:
        return None
    lon = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return (lat, lon)


def _feature_centroid(feature: dict[str, Any]) -> tuple[float, float] | None:
    props = dict(feature.get("properties") or {})
    try:
        lat = props.get("centroid_lat")
        lon = props.get("centroid_lon")
        if lat is not None and lon is not None:
            return (float(lat), float(lon))
    except Exception:
        pass

    geom = feature.get("geometry") or {}

    def walk(coords: Any) -> list[tuple[float, float]]:
        points: list[tuple[float, float]] = []
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            if len(coords) >= 2:
                points.append((float(coords[0]), float(coords[1])))
            return points
        if isinstance(coords, (list, tuple)):
            for c in coords:
                points.extend(walk(c))
        return points

    pts = walk(geom.get("coordinates"))
    if not pts:
        return None
    lon = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return (lat, lon)


def _delhi_real_ward_geojson(db: Session) -> dict[str, Any] | None:
    try:
        if settings.delhi_wards_geojson_path:
            wards_geo = _load_geojson_file(settings.delhi_wards_geojson_path)
            if _geojson_has_features(wards_geo):
                return _normalize_ward_feature_collection(wards_geo, city_id="DELHI")
    except Exception:
        pass
    db_geo = _ward_geojson_from_db("DELHI", db)
    if _geojson_has_features(db_geo):
        return db_geo
    return None


def _city_real_ward_geojson(city_id: str, db: Session) -> dict[str, Any] | None:
    cid = _canonical_city_id(city_id)
    if cid == "DELHI":
        return _delhi_real_ward_geojson(db)
    try:
        path = _city_real_wards_geojson_path(cid)
        if path:
            wards_geo = _load_geojson_file(path)
            if _geojson_has_features(wards_geo):
                return _normalize_ward_feature_collection(wards_geo, city_id=cid)
    except Exception:
        pass
    db_geo = _ward_geojson_from_db(cid, db)
    if _geojson_has_features(db_geo):
        return db_geo
    return None


def _has_real_delhi_wards(db: Session) -> bool:
    return _delhi_real_ward_geojson(db) is not None


def _has_real_city_wards(city_id: str, db: Session) -> bool:
    return _city_real_ward_geojson(city_id, db) is not None

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


def _ward_city_prefix(city_id: str) -> str:
    cid = _canonical_city_id(city_id)
    return "DEL" if cid == "DELHI" else _sanitize_city_id(cid)


def _canonical_city_id(city_id: str) -> str:
    cid = _sanitize_city_id(city_id)
    aliases = {
        "NEW_DELHI": "DELHI",
        "NCT_OF_DELHI": "DELHI",
        "DELHI_NCR": "DELHI",
    }
    return aliases.get(cid, cid)


def _resolve_map_context(city_id: str, lat: float | None, lon: float | None) -> dict[str, Any]:
    canonical = _canonical_city_id(city_id)
    if lat is None or lon is None:
        return {"city_id": canonical, "mode": "delhi" if canonical == "DELHI" else "city"}
    inside_delhi = False
    try:
        delhi_boundary = _load_geojson_file(settings.delhi_boundary_geojson_path)
        feature = (delhi_boundary.get("features") or [None])[0]
        geometry = (feature or {}).get("geometry") or {}
        if geometry:
            from app.services.india_geo import _point_in_geometry  # local import to avoid expanding public API

            if _point_in_geometry(lat, lon, geometry):
                inside_delhi = True
    except Exception:
        pass

    try:
        loc = LocationCollector().reverse_geocode(lat, lon)
        city_name = str(loc.city or "").strip()
        state_name = str(loc.state or "").strip()
        district_name = str(loc.district or "").strip()
        if inside_delhi:
            district_queries = []
            if district_name:
                district_queries.append(f"{district_name}, Delhi, India")
                district_queries.append(f"{district_name} district, Delhi, India")
            for query in district_queries:
                snap = BoundaryCollector().fetch_boundary(query, limit=1)
                features = (snap.geojson or {}).get("features") or []
                feature = features[0] if features else None
                if feature and (feature.get("geometry") or {}).get("type") in {"Polygon", "MultiPolygon"}:
                    return {
                        "city_id": "DELHI",
                        "mode": "delhi",
                        "boundary_feature": feature,
                        "city_name": "Delhi",
                        "district_name": district_name or "Delhi",
                        "state_name": state_name or "Delhi",
                        "boundary_source": "nominatim_delhi_district",
                    }
            return {
                "city_id": "DELHI",
                "mode": "delhi",
                "city_name": "Delhi",
                "district_name": district_name or "Delhi",
                "state_name": state_name or "Delhi",
            }
        search_queries = []
        if city_name and state_name:
            search_queries.append(f"{city_name}, {state_name}, India")
        if city_name and district_name and state_name and district_name.lower() != city_name.lower():
            search_queries.append(f"{city_name}, {district_name}, {state_name}, India")
        if district_name and state_name:
            search_queries.append(f"{district_name}, {state_name}, India")

        for query in search_queries:
            snap = BoundaryCollector().fetch_boundary(query, limit=1)
            features = (snap.geojson or {}).get("features") or []
            feature = features[0] if features else None
            if feature and (feature.get("geometry") or {}).get("type") in {"Polygon", "MultiPolygon"}:
                return {
                    "city_id": _sanitize_city_id(f"{state_name}_{city_name or district_name or canonical}"),
                    "mode": "city",
                    "boundary_feature": feature,
                    "city_name": city_name or district_name,
                    "district_name": district_name or city_name,
                    "state_name": state_name,
                    "boundary_source": "nominatim",
                }
    except Exception:
        pass

    if inside_delhi:
        return {"city_id": "DELHI", "mode": "delhi"}

    district = find_district_for_point(lat, lon)
    if district:
        props = district.get("properties") or {}
        district_name = str(props.get("district") or "district")
        state_name = str(props.get("state") or "state")
        return {
            "city_id": _sanitize_city_id(f"{state_name}_{district_name}"),
            "mode": "district",
            "district_feature": district,
            "boundary_feature": district,
            "district_name": district_name,
            "state_name": state_name,
            "boundary_source": "topojson_district",
        }
    return {"city_id": canonical, "mode": "city"}


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


def _is_near_delhi(lat: float | None, lon: float | None, buffer_km: float = 18.0) -> bool:
    if lat is None or lon is None:
        return False
    try:
        boundary = _load_geojson_file(settings.delhi_boundary_geojson_path)
        bbox = _bbox_from_geojson(boundary)
        if not bbox:
            return False
        min_lon, min_lat, max_lon, max_lat = bbox
        lat_pad = buffer_km / 111.0
        lon_pad = buffer_km / (111.0 * max(0.2, math.cos(math.radians((min_lat + max_lat) / 2.0))))
        return (
            (min_lat - lat_pad) <= float(lat) <= (max_lat + lat_pad)
            and (min_lon - lon_pad) <= float(lon) <= (max_lon + lon_pad)
        )
    except Exception:
        return False


def _load_live_stations_for_city(city_id: str, lat: float | None = None, lon: float | None = None) -> list[StationObservation]:
    # Stabilize Delhi demo: default filters + pagination when running in live CPCB mode.
    filter_state = settings.cpcb_filter_state
    filter_city = settings.cpcb_filter_city
    api_limit = settings.cpcb_api_limit
    api_max_pages = settings.cpcb_api_max_pages

    use_delhi_feed = _canonical_city_id(city_id) == "DELHI" or _is_near_delhi(lat, lon)
    if use_delhi_feed and not filter_state and not filter_city:
        filter_state = "Delhi"
        filter_city = "Delhi"
        api_limit = max(int(api_limit or 0), 100)
        api_max_pages = max(int(api_max_pages or 0), 5)
    elif not filter_state and not filter_city and lat is not None and lon is not None:
        try:
            loc = LocationCollector().reverse_geocode(float(lat), float(lon))
            state_name = str(loc.state or "").strip()
            city_name = str(loc.city or "").strip()
            district_name = str(loc.district or "").strip()
            if state_name:
                filter_state = state_name
            if city_name:
                filter_city = city_name
            elif district_name:
                filter_city = district_name
        except Exception:
            pass

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


def _station_aqi_from_observation(station: StationObservation) -> int:
    if getattr(station, "official_aqi", None) is not None:
        return int(max(0, min(500, round(float(station.official_aqi)))))
    sub = {
        "PM2.5": calc_sub_index(float(station.pm25), "pm25"),
        "PM10": calc_sub_index(float(station.pm10), "pm10"),
        "NO2": calc_sub_index(float(station.no2), "no2"),
        "SO2": calc_sub_index(float(station.so2), "so2"),
        "O3": calc_sub_index(float(station.o3), "o3"),
        "CO": calc_sub_index(float(station.co), "co"),
    }
    primary = max(sub, key=sub.get)
    return int(sub[primary])


def _select_nearby_stations(target_lat: float, target_lon: float, stations, limit: int = 4, radius_km: float | None = None) -> list[tuple[float, StationObservation]]:
    radius = float(radius_km if radius_km is not None else (getattr(settings, "idw_radius_km", 0.0) or 0.0))
    items: list[tuple[float, StationObservation]] = []
    for station in stations:
        dist = _haversine_km(target_lat, target_lon, station.latitude, station.longitude)
        if radius > 0 and dist > radius:
            continue
        items.append((dist, station))
    items.sort(key=lambda item: item[0])
    return items[: max(1, limit)]


def _weighted_station_aqi(target_lat: float, target_lon: float, stations) -> float | None:
    nearest = _select_nearby_stations(target_lat, target_lon, stations, limit=4, radius_km=25.0)
    if not nearest:
        return None
    if nearest[0][0] <= 1e-6:
        return float(_station_aqi_from_observation(nearest[0][1]))
    power = max(3.0, float(getattr(settings, "idw_power", 2.0) or 2.0))
    eps = 0.0001
    weighted = 0.0
    total_weight = 0.0
    for dist, station in nearest:
        weight = 1.0 / ((max(dist, 0.05) ** power) + eps)
        weighted += weight * _station_aqi_from_observation(station)
        total_weight += weight
    return (weighted / total_weight) if total_weight else None


def _stabilize_estimated_aqi(target_lat: float, target_lon: float, stations, estimated_aqi: int) -> int:
    if not stations:
        return int(max(0, min(500, estimated_aqi)))

    nearby = _select_nearby_stations(target_lat, target_lon, stations, limit=5, radius_km=25.0)
    if not nearby:
        return int(max(0, min(500, estimated_aqi)))

    aqis = [_station_aqi_from_observation(item[1]) for item in nearby]
    nearest_dist = float(nearby[0][0])
    nearest_aqi = float(aqis[0])
    weighted_avg = _weighted_station_aqi(target_lat, target_lon, stations)
    if weighted_avg is None:
        weighted_avg = nearest_aqi

    if nearest_dist <= 1.2:
        # Very close wards should track the nearest real sensor almost directly.
        return int(max(0, min(500, round(nearest_aqi))))

    slack = 6 if nearest_dist <= 2 else 10 if nearest_dist <= 5 else 15
    lower = max(0, min(aqis) - slack)
    upper = min(500, max(aqis) + slack)
    # Keep wards anchored to real station AQI first, and use pollutant interpolation
    # only as a light local correction so the map does not collapse into one 300+ blanket.
    if nearest_dist <= 3:
        blended = round((nearest_aqi * 0.78) + (float(weighted_avg) * 0.17) + (float(estimated_aqi) * 0.05))
    elif nearest_dist <= 8:
        blended = round((nearest_aqi * 0.62) + (float(weighted_avg) * 0.28) + (float(estimated_aqi) * 0.10))
    else:
        blended = round((nearest_aqi * 0.48) + (float(weighted_avg) * 0.40) + (float(estimated_aqi) * 0.12))
    return int(max(lower, min(upper, blended)))


def _live_station_anchor(target_lat: float, target_lon: float, stations) -> dict[str, float] | None:
    nearby = _select_nearby_stations(target_lat, target_lon, stations, limit=5, radius_km=25.0)
    if not nearby:
        return None
    aqis = [_station_aqi_from_observation(item[1]) for item in nearby]
    nearest_dist = float(nearby[0][0])
    nearest_aqi = float(aqis[0])
    weighted_aqi = _weighted_station_aqi(target_lat, target_lon, stations)
    if weighted_aqi is None:
        weighted_aqi = nearest_aqi
    return {
        "nearest_station_distance_km": nearest_dist,
        "nearest_station_aqi": nearest_aqi,
        "weighted_station_aqi": float(weighted_aqi),
        "min_station_aqi": float(min(aqis)),
        "max_station_aqi": float(max(aqis)),
    }


def _snapshot_drifted_from_live_anchor(snapshot_aqi: int | None, anchor: dict[str, float] | None) -> bool:
    if snapshot_aqi is None or not anchor:
        return False
    snapshot_val = float(snapshot_aqi)
    nearest_dist = float(anchor.get("nearest_station_distance_km") or 999.0)
    max_station = float(anchor.get("max_station_aqi") or snapshot_val)
    weighted = float(anchor.get("weighted_station_aqi") or snapshot_val)
    tolerance = 15 if nearest_dist <= 2 else 22 if nearest_dist <= 5 else 30
    severe_jump = snapshot_val >= max_station + tolerance
    weighted_jump = snapshot_val >= weighted + tolerance
    return severe_jump and weighted_jump


def _idw_rows_for_location(city_id: str, lat: float, lon: float, grid_size: int = 25) -> list[dict]:
    stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
    if not stations:
        return []
    n = max(1, int(math.sqrt(grid_size)))
    lat_step = 0.015
    lon_step = 0.02
    start_lat = lat - (n - 1) * lat_step / 2
    start_lon = lon - (n - 1) * lon_step / 2
    rows: list[dict] = []
    idx = 1
    city_prefix = _ward_city_prefix(city_id)
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
            aqi = _stabilize_estimated_aqi(c_lat, c_lon, stations, int(sub[primary]))
            ward_id = f"{city_prefix}_WARD_{idx:03d}"
            ward_name = _virtual_ward_name(city_id, c_lat, c_lon, stations, idx)
            rows.append(
                {
                    "ward_id": ward_id,
                    "ward_name": ward_name,
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


def _location_virtual_grid_geojson(city_id: str, lat: float, lon: float, grid_size: int = 25) -> dict[str, Any]:
    n = max(1, int(math.sqrt(grid_size)))
    lat_step = 0.015
    lon_step = 0.02
    start_lat = lat - (n - 1) * lat_step / 2
    start_lon = lon - (n - 1) * lon_step / 2
    city_prefix = _ward_city_prefix(city_id)
    stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
    features: list[dict[str, Any]] = []
    idx = 1
    for r in range(n):
        for c in range(n):
            c_lat = start_lat + r * lat_step
            c_lon = start_lon + c * lon_step
            south = c_lat - lat_step / 2
            north = c_lat + lat_step / 2
            west = c_lon - lon_step / 2
            east = c_lon + lon_step / 2
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "ward_id": f"{city_prefix}_WARD_{idx:03d}",
                        "ward_name": _virtual_ward_name(city_id, c_lat, c_lon, stations, idx),
                        "centroid_lat": round(c_lat, 6),
                        "centroid_lon": round(c_lon, 6),
                        "virtual": True,
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
                    },
                }
            )
            idx += 1
    return {
        "type": "FeatureCollection",
        "name": f"{city_prefix.lower()}_virtual_wards",
        "features": features,
    }


def _rows_from_real_geojson(city_id: str, geo: dict[str, Any], lat: float | None = None, lon: float | None = None) -> list[dict[str, Any]]:
    stations = None
    try:
        stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
    except Exception:
        stations = None

    rows: list[dict[str, Any]] = []
    for feature in geo.get("features") or []:
        if not isinstance(feature, dict):
            continue
        props = dict(feature.get("properties") or {})
        ward_id = str(props.get("ward_id") or "").strip()
        if not ward_id:
            continue
        ward_name = str(props.get("ward_name") or _ward_name_from_id(ward_id)).strip()
        centroid = _feature_centroid(feature)
        if centroid is None:
            continue
        centroid_lat, centroid_lon = centroid
        row = {
            "ward_id": ward_id,
            "ward_name": ward_name,
            "aqi": None,
            "category": "Unknown",
            "primary_pollutant": "",
            "pm25": None,
            "pm10": None,
            "no2": None,
            "so2": None,
            "o3": None,
            "co": None,
            "sector": _real_sector(ward_id, ward_name),
            "sensors_online": _real_sensors_online(ward_id, ward_name),
            "centroid_lat": float(centroid_lat),
            "centroid_lon": float(centroid_lon),
            "has_snapshot": False,
            "as_of_utc": None,
            "estimated": True,
            "estimate_method": "idw",
            "estimate_source": settings.cpcb_source_mode,
            "geom_feature": feature,
        }
        if stations:
            c_lat = float(centroid_lat)
            c_lon = float(centroid_lon)
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
            aqi = _stabilize_estimated_aqi(c_lat, c_lon, stations, int(sub[primary]))
            row.update(
                {
                    "aqi": aqi,
                    "category": aqi_category(aqi),
                    "primary_pollutant": primary,
                    "pm25": round(pm25, 1),
                    "pm10": round(pm10, 1),
                    "no2": round(no2, 1),
                    "so2": round(so2, 1),
                    "o3": round(o3, 1),
                    "co": round(co, 2),
                    "live_anchor": _live_station_anchor(c_lat, c_lon, stations),
                }
            )
        rows.append(row)
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
    normalized_rows: list[dict[str, Any]] = []

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
            if ward_name and _is_placeholder_ward_name(ward.ward_name):
                ward.ward_name = ward_name
            if ward.centroid_lat is None or ward.centroid_lon is None:
                c_lat = float(row.get("centroid_lat") or 0.0) or None
                c_lon = float(row.get("centroid_lon") or 0.0) or None
                if c_lat is not None and c_lon is not None:
                    ward.centroid_lat = c_lat
                    ward.centroid_lon = c_lon
            db.add(ward)

        normalized_rows.append({"ward_id": ward_id, "row": row})

    # Flush newly created cities/wards before inserting dependent snapshots/forecasts.
    # Postgres enforces FKs immediately, so dynamic India grids can fail unless the parent
    # ward rows are visible within the current transaction first.
    db.flush()

    for item in normalized_rows:
        ward_id = item["ward_id"]
        row = item["row"]
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


def _latest_disaster_assessment(db: Session, ward_id: str) -> DisasterAssessment | None:
    return db.scalars(
        select(DisasterAssessment).where(DisasterAssessment.ward_id == ward_id).order_by(DisasterAssessment.ts_utc.desc())
    ).first()


def _assessment_card(assessment: DisasterAssessment | None) -> dict | None:
    if assessment is None:
        return None
    return {
        "alert_level": assessment.alert_level,
        "status": assessment.status,
        "disaster_type": assessment.disaster_type,
        "disaster_mode": assessment.disaster_mode,
        "risk_score": assessment.risk_score,
        "exposure_risk": assessment.exposure_risk,
        "affected_population": assessment.affected_population,
        "confidence_score": assessment.confidence_score,
        "causes": assessment.probable_causes_json or [],
        "triggers": assessment.triggers_json or [],
        "actions": assessment.actions_json or [],
        "metrics": assessment.metrics_json or {},
        "summary": assessment.summary_json or {},
        "as_of_utc": assessment.ts_utc.isoformat() if assessment.ts_utc else None,
    }


def _snapshot_allowed_for_live_view(snapshot: AqiSnapshot | None) -> bool:
    if snapshot is None:
        return False
    ts = snapshot.ts_utc
    if ts is not None:
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        max_age_hours = max(2, int(settings.cpcb_db_cache_max_age_hours or 2))
        if datetime.now(timezone.utc) - ts > timedelta(hours=max_age_hours):
            return False
    if not settings.live_data_strict:
        return True
    raw = (snapshot.contribution_json or {}).get("raw", {}) if snapshot.contribution_json else {}
    source = str(raw.get("source") or "").strip().lower()
    return source.startswith("cpcb_api") or source.startswith("cpcb_db_cache")


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
    latest_snapshot = db.scalars(select(AqiSnapshot).order_by(AqiSnapshot.ts_utc.desc())).first()
    latest_forecast = db.scalars(select(ForecastSnapshot).order_by(ForecastSnapshot.ts_generated_utc.desc())).first()
    latest_clean = db.scalars(select(CleanMeasurement).order_by(CleanMeasurement.ts_slot_utc.desc())).first()
    ready = ward_count > 0 and latest_snapshot is not None and latest_clean is not None
    return {
        "status": "ready" if ready else "warming_up",
        "ward_count": ward_count,
        "latest_snapshot_utc": latest_snapshot.ts_utc.isoformat() if latest_snapshot and latest_snapshot.ts_utc else None,
        "latest_forecast_utc": latest_forecast.ts_generated_utc.isoformat() if latest_forecast and latest_forecast.ts_generated_utc else None,
        "latest_clean_utc": latest_clean.ts_slot_utc.isoformat() if latest_clean and latest_clean.ts_slot_utc else None,
        "timestamp": utc_now_iso(),
    }


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
    ward = db.get(Ward, ward_id)
    w_lat = float(ward.centroid_lat) if ward and ward.centroid_lat is not None else 28.6139
    w_lon = float(ward.centroid_lon) if ward and ward.centroid_lon is not None else 77.2090
    firms = FirmsCollector().fetch_nearby(lat=w_lat, lon=w_lon, radius_km=10.0, days=1, source="VIIRS_SNPP_NRT")
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
        fire_nearby=bool(firms.get("fireNearby")),
        history=history if len(history) >= 4 else None,
    )
    assessment = _latest_disaster_assessment(db, ward_id)
    return envelope(
        ward_id=ward_id,
        disaster_mode=bool(assessment.disaster_mode) if assessment else current.aqi_value > 300,
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
                "fires": firms.get("fires", []),
                "fireNearby": bool(firms.get("fireNearby")),
            },
            "disaster_assessment": _assessment_card(assessment),
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

    def _forecast_cap(latest_aqi: int, recent_rows: list[AqiSnapshot], horizon_hour: int) -> tuple[int, int]:
        base_delta = {1: 35, 2: 55, 3: 75}.get(int(horizon_hour), 55)
        recent_values = [int(row.aqi_value) for row in recent_rows if row is not None and row.aqi_value is not None]
        observed_span = (max(recent_values) - min(recent_values)) if len(recent_values) >= 2 else 0
        delta = max(base_delta, min(90, observed_span + 15))
        return (max(0, int(latest_aqi) - delta), min(500, int(latest_aqi) + delta))

    def _sanitize_forecast(candidate: float | int, latest_aqi: int, recent_rows: list[AqiSnapshot], horizon_hour: int) -> int:
        lower, upper = _forecast_cap(latest_aqi, recent_rows, horizon_hour)
        return _clamp_aqi(max(lower, min(upper, float(candidate))))

    now = datetime.now(timezone.utc)
    ts_slot = now.replace(minute=0, second=0, microsecond=0)
    recent = db.scalars(
        select(AqiSnapshot)
        .where(AqiSnapshot.ward_id == ward_id, AqiSnapshot.ts_utc >= now - timedelta(hours=6))
        .order_by(AqiSnapshot.ts_utc.desc())
        .limit(4)
    ).all()
    latest_snapshot = recent[0] if recent else db.scalars(
        select(AqiSnapshot).where(AqiSnapshot.ward_id == ward_id).order_by(AqiSnapshot.ts_utc.desc())
    ).first()
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
        # Prefer a small "recent" window (keeps the trend model meaningful), but don't fail hard during startup:
        # if a ward has any snapshot at all (even older), return a forecast with lower confidence instead of 404.
        fallback_note = None
        if not recent:
            latest = latest_snapshot
            if latest is None:
                # City-level fallback: use the newest snapshot from the same city (helps newly-added wards).
                ward = db.get(Ward, ward_id)
                if ward is not None:
                    latest = db.scalars(
                        select(AqiSnapshot)
                        .join(Ward, Ward.ward_id == AqiSnapshot.ward_id)
                        .where(Ward.city_id == ward.city_id)
                        .order_by(AqiSnapshot.ts_utc.desc())
                    ).first()
                    if latest is not None:
                        fallback_note = f"city_fallback:{ward.city_id}"
            if latest is None:
                raise AppError("DATA_NOT_READY", f"No forecast available for {ward_id} (no AQI snapshot).", 404)
            recent = [latest]
            fallback_note = fallback_note or "stale_snapshot"
        else:
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
                slope = max(-18.0, min(18.0, slope))
                aqi_pred = _sanitize_forecast(float(latest.aqi_value) + slope * float(horizon), int(latest.aqi_value), recent, horizon)
                model_name = "local-trend"
                model_version = "trend-v1"
        elif latest is not None:
            aqi_pred = _sanitize_forecast(aqi_pred, int(latest.aqi_value), recent, horizon)
        if fallback_note:
            model_name = f"{model_name}:{fallback_note}"

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
    elif latest_snapshot is not None:
        sanitized_pred = _sanitize_forecast(forecast.aqi_pred, int(latest_snapshot.aqi_value), recent, horizon)
        if sanitized_pred != int(forecast.aqi_pred):
            forecast.aqi_pred = sanitized_pred
            forecast.aqi_category_pred = aqi_category(forecast.aqi_pred)
            forecast.model_name = f"{forecast.model_name}:sanitized"
            forecast.model_version = forecast.model_version or "trend-v1"
            forecast.disaster_mode = forecast.aqi_pred > 300
            db.commit()

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
    ward = db.get(Ward, ward_id)
    w_lat = float(ward.centroid_lat) if ward and ward.centroid_lat is not None else 28.6139
    w_lon = float(ward.centroid_lon) if ward and ward.centroid_lon is not None else 77.2090
    firms = FirmsCollector().fetch_nearby(lat=w_lat, lon=w_lon, radius_km=10.0, days=1, source="VIIRS_SNPP_NRT")
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
        fire_nearby=bool(firms.get("fireNearby")),
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
                "fires": firms.get("fires", []),
                "fireNearby": bool(firms.get("fireNearby")),
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
    context = _resolve_map_context(city_id, lat, lon)
    city_id = str(context.get("city_id") or _canonical_city_id(city_id))
    real_geo = _city_real_ward_geojson(city_id, db)
    has_real_wards = _geojson_has_features(real_geo)
    use_virtual_wards = (
        lat is not None
        and lon is not None
        and (context.get("mode") in {"city", "district"} or city_id == "DELHI")
        and not has_real_wards
    )
    wards = [] if (use_virtual_wards or has_real_wards) else db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    rows = _rows_from_real_geojson(city_id, real_geo, lat=lat, lon=lon) if (has_real_wards and real_geo) else []
    # Load stations once (only if needed) so we can fill gaps for wards that have no snapshot yet.
    stations = None
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        if current is not None and not _snapshot_allowed_for_live_view(current):
            current = None
        assessment = _latest_disaster_assessment(db, ward.ward_id)
        raw = current.contribution_json.get("raw", {}) if current else {}
        centroid = _ward_centroid(ward)
        centroid_lat = centroid[0] if centroid else None
        centroid_lon = centroid[1] if centroid else None
        live_anchor = None
        if centroid_lat is not None and centroid_lon is not None:
            try:
                if stations is None:
                    stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
                if stations:
                    live_anchor = _live_station_anchor(float(centroid_lat), float(centroid_lon), stations)
            except Exception:
                live_anchor = None
        if current is not None and _snapshot_drifted_from_live_anchor(current.aqi_value, live_anchor):
            current = None
            raw = {}
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
                "sector": _real_sector(ward.ward_id, ward.ward_name or ""),
                "sensors_online": _real_sensors_online(ward.ward_id, ward.ward_name or ""),
                "centroid_lat": centroid_lat,
                "centroid_lon": centroid_lon,
                "has_snapshot": current is not None,
                "as_of_utc": current.ts_utc.isoformat() if current else None,
                "disaster_assessment": _assessment_card(assessment),
                "live_anchor": live_anchor,
            }
        )

    # Fill missing ward colors with an IDW estimate from the current CPCB station observations.
    # This keeps the choropleth map readable even when the snapshot pipeline hasn't populated all wards.
    missing = [r for r in rows if r.get("aqi") is None and r.get("centroid_lat") is not None and r.get("centroid_lon") is not None]
    if missing:
        try:
            stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
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
            aqi = _stabilize_estimated_aqi(c_lat, c_lon, stations, int(sub[primary]))

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
            anchor = _live_station_anchor(c_lat, c_lon, stations)
            if anchor:
                r["live_anchor"] = anchor
    # If wards exist but don't have centroids (common when created before centroid columns existed),
    # prefer a dynamic grid centered on the query location and persist centroids into the DB.
    if rows and lat is not None and lon is not None:
        missing_centroids = all(r.get("centroid_lat") is None or r.get("centroid_lon") is None for r in rows)
        if missing_centroids:
            dyn = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
            if dyn:
                _persist_dynamic_grid(db, city_id=city_id, rows=dyn)
                rows = dyn
    # Dynamic, location-centered IDW wards for non-Delhi locations.
    if (use_virtual_wards or not rows) and lat is not None and lon is not None:
        rows = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
        _persist_dynamic_grid(db, city_id=city_id, rows=rows)

    # Attach lightweight source detection for UI (map click, officer view).
    weather = _latest_weather_dict(db)
    satellite = _latest_satellite_dict(db)
    now_ts = datetime.now(timezone.utc)
    for r in rows:
        # Ensure ops metadata exists for dynamic grids too.
        if r.get("sector") is None:
            r["sector"] = _real_sector(str(r.get("ward_id") or ""), str(r.get("ward_name") or ""))
        if r.get("sensors_online") is None:
            r["sensors_online"] = _real_sensors_online(str(r.get("ward_id") or ""), str(r.get("ward_name") or ""))
        if r.get("live_anchor") is None:
            try:
                if stations is None:
                    stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
                if stations and r.get("centroid_lat") is not None and r.get("centroid_lon") is not None:
                    r["live_anchor"] = _live_station_anchor(float(r["centroid_lat"]), float(r["centroid_lon"]), stations)
            except Exception:
                pass
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
        try:
            if stations is None:
                stations = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
            if stations and r.get("centroid_lat") is not None and r.get("centroid_lon") is not None:
                c_lat = float(r["centroid_lat"])
                c_lon = float(r["centroid_lon"])
                nearest = sorted(stations, key=lambda st: _haversine_km(c_lat, c_lon, st.latitude, st.longitude))[:5]
                if nearest:
                    def _station_aqi(station: StationObservation) -> tuple[int, str]:
                        subs = {
                            "PM2.5": calc_sub_index(station.pm25, "pm25"),
                            "PM10": calc_sub_index(station.pm10, "pm10"),
                            "NO2": calc_sub_index(station.no2, "no2"),
                            "SO2": calc_sub_index(station.so2, "so2"),
                            "O3": calc_sub_index(station.o3, "o3"),
                            "CO": calc_sub_index(station.co, "co"),
                        }
                        primary = max(subs, key=subs.get)
                        return int(subs[primary]), primary

                    hotspot = max(nearest, key=lambda st: _station_aqi(st)[0])
                    hotspot_aqi, hotspot_primary = _station_aqi(hotspot)
                    r["hotspot_location"] = {
                        "place_name": hotspot.station_name,
                        "lat": round(float(hotspot.latitude), 6),
                        "lon": round(float(hotspot.longitude), 6),
                        "aqi": hotspot_aqi,
                        "primary_pollutant": hotspot_primary,
                        "pm25": round(float(hotspot.pm25), 2),
                        "pm10": round(float(hotspot.pm10), 2),
                        "source": hotspot.source,
                        "distance_km": round(_haversine_km(c_lat, c_lon, hotspot.latitude, hotspot.longitude), 2),
                        "reason": f"Nearest strong measured hotspot around {r.get('ward_name')}.",
                    }
        except Exception:
            pass
    return {
        "timestamp": utc_now_iso(),
        "city_id": city_id,
        "mode": "virtual" if use_virtual_wards else context.get("mode"),
        "region": {
            "city": context.get("city_name"),
            "district": context.get("district_name"),
            "state": context.get("state_name"),
        } if context.get("mode") in {"delhi", "city", "district"} else None,
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
def geojson_delhi_wards_grid(db: Session = Depends(get_db)) -> dict:
    real_geo = _delhi_real_ward_geojson(db)
    if real_geo:
        return {
            "timestamp": utc_now_iso(),
            "city_id": "DELHI",
            "path": settings.delhi_wards_geojson_path if Path(settings.delhi_wards_geojson_path).is_file() else None,
            "data": real_geo,
            "note": "Real ward polygons loaded.",
        }

    return {
        "timestamp": utc_now_iso(),
        "city_id": "DELHI",
        "data": None,
        "note": "No real Delhi ward polygons configured; use location-centered wards until Delhi_Wards.geojson is imported.",
    }


@router.get("/geojson/location-boundary")
def geojson_location_boundary(lat: float, lon: float) -> dict:
    context = _resolve_map_context("DELHI", lat, lon)
    if context.get("mode") in {"delhi", "city", "district"} and context.get("boundary_feature"):
        feature = context["boundary_feature"]
        return {
            "timestamp": utc_now_iso(),
            "city_id": context.get("city_id"),
            "mode": context.get("mode"),
            "region": {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            },
            "source": context.get("boundary_source"),
            "data": district_feature_collection(feature),
        }
    if context.get("mode") == "delhi":
        return geojson_delhi_boundary()
    return {
        "timestamp": utc_now_iso(),
        "city_id": context.get("city_id"),
        "mode": context.get("mode"),
        "region": {
            "city": context.get("city_name"),
            "district": context.get("district_name"),
            "state": context.get("state_name"),
        } if context.get("mode") in {"city", "district"} else None,
        "source": context.get("boundary_source"),
        "data": None,
    }


@router.get("/geojson/location-virtual-grid")
def geojson_location_virtual_grid(lat: float, lon: float, grid_size: int = 25, db: Session = Depends(get_db)) -> dict:
    context = _resolve_map_context("DELHI", lat, lon)
    resolved_city_id = str(context.get("city_id") or "LOCAL")
    real_geo = _city_real_ward_geojson(resolved_city_id, db)
    if _geojson_has_features(real_geo):
        return {
            "timestamp": utc_now_iso(),
            "city_id": resolved_city_id,
            "mode": "real",
            "region": {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            } if context.get("mode") in {"delhi", "city", "district"} else None,
            "source": _city_real_wards_geojson_path(resolved_city_id) or context.get("boundary_source"),
            "data": real_geo,
        }
    delhi_fallback = context.get("mode") == "delhi" and not _has_real_delhi_wards(db)
    if (context.get("mode") in {"city", "district"} or delhi_fallback) and (context.get("boundary_feature") or delhi_fallback):
        geo = _location_virtual_grid_geojson(str(context.get("city_id") or "LOCAL"), lat, lon, grid_size=max(4, min(grid_size, 100)))
        return {
            "timestamp": utc_now_iso(),
            "city_id": context.get("city_id"),
            "mode": "virtual",
            "region": {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            },
            "source": context.get("boundary_source"),
            "data": geo,
        }
    if context.get("mode") == "delhi":
        return geojson_delhi_wards_grid(db)
    geo = _location_virtual_grid_geojson(str(context.get("city_id") or "LOCAL"), lat, lon, grid_size=max(4, min(grid_size, 100)))
    return {
        "timestamp": utc_now_iso(),
        "city_id": context.get("city_id"),
        "mode": "virtual",
        "region": {
            "city": context.get("city_name"),
            "district": context.get("district_name"),
            "state": context.get("state_name"),
        } if context.get("mode") in {"city", "district"} else None,
        "source": context.get("boundary_source"),
        "data": geo,
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

    stations: list[StationObservation] = _load_live_stations_for_city(city_id, lat=lat, lon=lon)
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


@router.get("/cpcb/station-counts")
def cpcb_station_counts(
    state_union_territory: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """
    State/UT-level station-count metadata from api.data.gov.in (CAAQMS + NAMP counts).

    Note: this is not a live "per station pollutant" feed.
    """
    if not (settings.cpcb_api_key and str(settings.cpcb_api_key).strip()):
        raise AppError("BAD_REQUEST", "CPCB_API_KEY is required for api.data.gov.in requests.", 400)

    try:
        payload = fetch_cpcb_station_counts(state_union_territory=state_union_territory, limit=limit, offset=offset)
    except Exception as exc:
        raise AppError(
            "UPSTREAM_TIMEOUT",
            "api.data.gov.in timed out for CPCB station-counts. Try a smaller limit (e.g., 50) "
            "or increase EXTERNAL_HTTP_TIMEOUT_SEC (e.g., 25).",
            504,
            details={"error": str(exc)},
        )
    records = (payload or {}).get("records") or []
    return {
        "timestamp": utc_now_iso(),
        "query": {
            "state_union_territory": state_union_territory,
            "limit": int(limit),
            "offset": int(offset),
        },
        "source": "api.data.gov.in",
        "dataset": settings.cpcb_station_counts_api_url,
        "count": len(records),
        "total": (payload or {}).get("total"),
        "data": records,
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

    context = _resolve_map_context(city_id, lat, lon)
    city_id = str(context.get("city_id") or _canonical_city_id(city_id))
    real_geo = _city_real_ward_geojson(city_id, db)
    has_real_wards = _geojson_has_features(real_geo)
    if has_real_wards:
        wards = []
    elif city_id == "DELHI":
        wards = []
    else:
        wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    if has_real_wards and real_geo:
        ward_rows = []
        for row in _rows_from_real_geojson(city_id, real_geo, lat=lat, lon=lon):
            distance = _haversine_km(lat, lon, float(row["centroid_lat"]), float(row["centroid_lon"]))
            ward_rows.append(
                {
                    "ward_id": row["ward_id"],
                    "ward_name": row["ward_name"],
                    "aqi": row["aqi"],
                    "aqi_category": row["category"],
                    "centroid_lat": float(row["centroid_lat"]),
                    "centroid_lon": float(row["centroid_lon"]),
                    "distance_km": round(distance, 2),
                }
            )
        if ward_rows:
            by_aqi = sorted(ward_rows, key=lambda x: x["aqi"], reverse=True)
            rank_map = {row["ward_id"]: idx for idx, row in enumerate(by_aqi, start=1)}
            by_distance = sorted(ward_rows, key=lambda x: x["distance_km"])
            nearest = dict(by_distance[0])
            nearest["city_rank"] = rank_map[nearest["ward_id"]]
            top_n = max(1, min(top_n, 25))
            return {
                "timestamp": utc_now_iso(),
                "city_id": city_id,
                "mode": context.get("mode"),
                "region": {
                    "city": context.get("city_name"),
                    "district": context.get("district_name"),
                    "state": context.get("state_name"),
                } if context.get("mode") in {"delhi", "city", "district"} else None,
                "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
                "nearest_ward": nearest,
                "nearby_wards": by_distance[:top_n],
                "ranking": by_aqi[:top_n],
                "total_wards": len(ward_rows),
                "source": "real_ward_geojson",
            }
    if not wards:
        dyn_rows = _idw_rows_for_location(city_id=city_id, lat=lat, lon=lon, grid_size=25)
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
        _persist_dynamic_grid(db, city_id=city_id, rows=dyn_rows)
        return {
            "timestamp": utc_now_iso(),
            "city_id": _sanitize_city_id(city_id),
            "mode": context.get("mode"),
            "region": {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            } if context.get("mode") in {"delhi", "city", "district"} else None,
            "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "nearest_ward": nearest,
            "nearby_wards": by_distance[:top_n],
            "ranking": by_aqi[:top_n],
            "total_wards": len(dyn_rows),
            "source": "dynamic_idw",
        }

    ward_rows: list[dict] = []
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        if current is None:
            continue
        centroid = _ward_centroid(ward)
        if centroid is None:
            continue
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
            "mode": context.get("mode"),
            "region": {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            } if context.get("mode") in {"delhi", "city", "district"} else None,
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
        "mode": context.get("mode"),
        "region": {
            "city": context.get("city_name"),
            "district": context.get("district_name"),
            "state": context.get("state_name"),
        } if context.get("mode") in {"city", "district"} else None,
        "query_location": {"lat": round(lat, 6), "lon": round(lon, 6)},
        "nearest_ward": nearest,
        "nearby_wards": by_distance[:top_n],
        "ranking": by_aqi[:top_n],
        "total_wards": len(ward_rows),
    }


@router.get("/alerts/feed")
def alerts_feed(city_id: str = "DELHI", limit: int = 20, db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id)).all()
    if not wards:
        return {"timestamp": utc_now_iso(), "city_id": city_id, "count": 0, "data": []}
    ward_lookup = {ward.ward_id: (ward.ward_name or ward.ward_id) for ward in wards}
    ward_ids = list(ward_lookup.keys())

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
                "ward_name": ward_lookup.get(ev.ward_id, ev.ward_id),
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
    for offset in range(23, -1, -1):
        t = now - timedelta(hours=offset)
        key = t.strftime("%Y-%m-%d %H")
        slot = by_hour.get(key)
        hourly.append(
            {
                "h": t.strftime("%H"),
                "aqi": int(slot["aqi"]) if slot else None,
                "pm25": round(float(slot["pm25"]), 1) if slot else None,
                "pm10": round(float(slot["pm10"]), 1) if slot else None,
                "no2": round(float(slot["no2"]), 1) if slot else None,
                "so2": round(float(slot["so2"]), 1) if slot else None,
                "o3": round(float(slot["o3"]), 1) if slot else None,
                "co": round(float(slot["co"]), 2) if slot else None,
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
            weekly.append({"d": day.strftime("%a").upper()[:3], "aqi": int(avg_aqi), "pm25": pm25, "pm10": pm10, "date_utc": day.isoformat()})
        else:
            weekly.append({"d": day.strftime("%a").upper()[:3], "aqi": None, "pm25": None, "pm10": None, "date_utc": day.isoformat()})

    return envelope(
        ward_id=ward_id,
        disaster_mode=current.aqi_value > 300,
        quality_score=current.data_quality_score,
        data={"hourly": hourly, "weekly": weekly, "source": "database_history"},
    )


@router.get("/disaster/citizen-view")
def disaster_citizen_view(ward_id: str, db: Session = Depends(get_db)) -> dict:
    assessment = _latest_disaster_assessment(db, ward_id)
    if assessment is None:
        raise AppError("DATA_NOT_READY", f"No disaster assessment available for {ward_id}.", 404)
    summary = assessment.summary_json or {}
    citizen = summary.get("citizen", {}) if isinstance(summary, dict) else {}
    metrics = assessment.metrics_json or {}
    return {
        "timestamp": utc_now_iso(),
        "ward_id": ward_id,
        "disaster_mode": bool(assessment.disaster_mode),
        "data": {
            "risk_level": assessment.alert_level,
            "status": assessment.status,
            "trend_prediction": citizen.get("trend_prediction"),
            "probable_causes": assessment.probable_causes_json or [],
            "triggers": assessment.triggers_json or [],
            "aqi": metrics.get("aqi"),
            "aqi_category": metrics.get("aqi_category"),
            "temperature_c": metrics.get("temperature_c"),
            "safe_guidance": citizen.get("safe_guidance"),
            "recommended_actions": assessment.actions_json or [],
            "affected_population": assessment.affected_population,
        },
    }


@router.get("/disaster/officer-view")
def disaster_officer_view(city_id: str = "DELHI", top_n: int = 5, db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    rows: list[dict[str, Any]] = []
    for ward in wards:
        assessment = _latest_disaster_assessment(db, ward.ward_id)
        if assessment is None:
            continue
        metrics = assessment.metrics_json or {}
        rows.append(
            {
                "ward_id": ward.ward_id,
                "ward_name": ward.ward_name,
                "alert_level": assessment.alert_level,
                "status": assessment.status,
                "disaster_mode": assessment.disaster_mode,
                "disaster_type": assessment.disaster_type,
                "risk_score": assessment.risk_score,
                "exposure_risk": assessment.exposure_risk,
                "affected_population": assessment.affected_population,
                "source_panel": assessment.probable_causes_json or [],
                "triggers": assessment.triggers_json or [],
                "suggested_actions": assessment.actions_json or [],
                "metrics": metrics,
                "as_of_utc": assessment.ts_utc.isoformat() if assessment.ts_utc else None,
            }
        )
    rows.sort(key=lambda item: (float(item.get("risk_score") or 0.0), float(item.get("affected_population") or 0.0)), reverse=True)
    top_n = max(1, min(int(top_n), 25))
    top_rows = rows[:top_n]
    active_disaster = any(bool(item.get("disaster_mode")) for item in rows)
    history = db.scalars(
        select(CrisisEvent)
        .join(Ward, Ward.ward_id == CrisisEvent.ward_id)
        .where(Ward.city_id == city_id)
        .order_by(CrisisEvent.started_at_utc.desc())
        .limit(12)
    ).all()
    ward_name_lookup = {ward.ward_id: (ward.ward_name or ward.ward_id) for ward in wards}
    return {
        "timestamp": utc_now_iso(),
        "city_id": city_id,
        "disaster_mode": active_disaster,
        "recalc_minutes": int(settings.disaster_recalc_minutes),
        "top_critical_wards": top_rows,
        "event_history": [
            {
                "ward_id": item.ward_id,
                "ward_name": ward_name_lookup.get(item.ward_id, item.ward_id),
                "level": item.level,
                "reason": item.trigger_reason,
                "started_at_utc": item.started_at_utc.isoformat() if item.started_at_utc else None,
                "disaster_mode": item.disaster_mode,
            }
            for item in history
        ],
        "summary": {
            "total_assessed": len(rows),
            "critical_count": sum(1 for item in rows if item["alert_level"] == "Critical"),
            "high_count": sum(1 for item in rows if item["alert_level"] == "High"),
            "warning_count": sum(1 for item in rows if item["alert_level"] == "Medium"),
        },
    }


@router.get("/disaster/status")
def disaster_status(city_id: str = "DELHI", db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    latest = db.scalars(
        select(DisasterAssessment)
        .join(Ward, Ward.ward_id == DisasterAssessment.ward_id)
        .where(Ward.city_id == city_id)
        .order_by(DisasterAssessment.ts_utc.desc())
        .limit(100)
    ).all()
    disaster_mode = any(bool(item.disaster_mode) for item in latest)
    return {
        "timestamp": utc_now_iso(),
        "city_id": city_id,
        "disaster_mode": disaster_mode,
        "status": "DISASTER_MODE" if disaster_mode else "NORMAL_MODE",
        "critical_wards": [item.ward_id for item in latest if item.alert_level == "Critical"][:10],
        "recalc_minutes": int(settings.disaster_recalc_minutes),
    }


@router.get("/gov/recommendations")
def gov_recommendations(city_id: str = "DELHI", db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    wards = db.scalars(select(Ward).where(Ward.city_id == city_id).order_by(Ward.ward_id)).all()
    actions = []
    for ward in wards:
        current = db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ward_id == ward.ward_id).order_by(AqiSnapshot.ts_utc.desc())
        ).first()
        if current is None:
            continue
        assessment = _latest_disaster_assessment(db, ward.ward_id)
        action_list = (assessment.actions_json if assessment else None) or []
        action = action_list[0] if action_list else "Continue routine monitoring and public advisory updates."
        if assessment and assessment.alert_level == "Critical":
            priority = "P1"
            status = "EMERGENCY"
        elif assessment and assessment.alert_level == "High":
            priority = "P2"
            status = "ACTIVE"
        else:
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
                "disaster_assessment": _assessment_card(assessment),
            }
        )

    actions.sort(key=lambda x: x["aqi"], reverse=True)
    return {"timestamp": utc_now_iso(), "city_id": city_id, "count": len(actions), "data": actions[:12]}


@router.get("/complaints")
def complaints(city_id: str = "DELHI", db: Session = Depends(get_db)) -> dict:
    city_id = _canonical_city_id(city_id)
    _seed_default_complaints(db, city_id)
    rows = db.scalars(
        select(Complaint).where(Complaint.city_id == city_id).order_by(Complaint.updated_at_utc.desc(), Complaint.complaint_id.desc())
    ).all()
    ward_ids = {row.ward_id for row in rows if row.ward_id}
    ward_lookup = {
        ward.ward_id: (ward.ward_name or ward.ward_id)
        for ward in db.scalars(select(Ward).where(Ward.ward_id.in_(ward_ids))).all()
    } if ward_ids else {}
    feed = [
        {
            "id": row.complaint_id,
            "city_id": row.city_id,
            "ward_id": row.ward_id,
            "ward_name": ward_lookup.get(row.ward_id, row.ward_id),
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
            "ward_name": ward.ward_name or ward.ward_id,
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
    ward = db.get(Ward, row.ward_id)
    return {
        "timestamp": utc_now_iso(),
        "status": "updated",
        "data": {
            "id": row.complaint_id,
            "city_id": row.city_id,
            "ward_id": row.ward_id,
            "ward_name": (ward.ward_name if ward else None) or row.ward_id,
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
            "fires": unified.fires,
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
            "fires": unified.fires,
        },
    }


@router.get("/environment/api-checks")
def environment_api_checks(limit: int = 100) -> dict:
    return {
        "timestamp": utc_now_iso(),
        "count": len(get_recent_api_checks(limit)),
        "data": get_recent_api_checks(limit),
    }


@router.get("/location/search")
def location_search(q: str, limit: int = 5) -> dict:
    query = str(q or "").strip()
    if len(query) < 2:
        raise AppError("BAD_REQUEST", "q must contain at least 2 characters.", 400)
    results = LocationCollector().search_places(query, limit=limit)
    return {
        "timestamp": utc_now_iso(),
        "query": query,
        "count": len(results),
        "data": results,
    }


@router.get("/fires/nearby")
def fires_nearby(lat: float, lon: float, radius_km: float = 10.0, days: int = 1, source: str = "VIIRS_SNPP_NRT") -> dict:
    payload = FirmsCollector().fetch_nearby(lat=lat, lon=lon, radius_km=radius_km, days=days, source=source)
    return {"timestamp": utc_now_iso(), **payload}


@router.get("/geojson/new-delhi-boundary")
def geojson_new_delhi_boundary() -> dict:
    snap = BoundaryCollector().fetch_new_delhi_boundary()
    return {
        "timestamp": utc_now_iso(),
        "name": snap.name,
        "source": snap.source,
        "data": snap.geojson,
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/stations/live")
def stations_live(
    lat: float | None = None,
    lon: float | None = None,
    radius_km: float = 60.0,
    limit: int = 60,
    db: Session = Depends(get_db),
) -> dict:
    """
    Returns latest CPCB station vectors (pollutants) + derived AQI.

    Used by the Explore Map UI for a realistic sensor layer.
    """
    resolved_city_id = "DELHI"
    resolved_region = None
    if lat is not None and lon is not None:
        try:
            context = _resolve_map_context("DELHI", lat, lon)
            resolved_city_id = str(context.get("city_id") or "DELHI")
            resolved_region = {
                "city": context.get("city_name"),
                "district": context.get("district_name"),
                "state": context.get("state_name"),
            } if context.get("mode") in {"delhi", "city", "district"} else None
        except Exception:
            pass
    try:
        live_rows = _load_live_stations_for_city(resolved_city_id, lat=lat, lon=lon)
    except Exception:
        live_rows = []

    if live_rows:
        out: list[dict] = []
        source_counts: Counter[str] = Counter()
        for station in live_rows:
            dist_km = None
            if lat is not None and lon is not None:
                dist_km = _haversine_km(float(lat), float(lon), float(station.latitude), float(station.longitude))
                if dist_km > float(radius_km):
                    continue
            aqi = _station_aqi_from_observation(station)
            dominant = getattr(station, "official_primary_pollutant", None) or ""
            if not dominant:
                subs = {
                    "PM2.5": calc_sub_index(float(station.pm25), "pm25"),
                    "PM10": calc_sub_index(float(station.pm10), "pm10"),
                    "NO2": calc_sub_index(float(station.no2), "no2"),
                    "SO2": calc_sub_index(float(station.so2), "so2"),
                    "O3": calc_sub_index(float(station.o3), "o3"),
                    "CO": calc_sub_index(float(station.co), "co"),
                }
                dominant = max(subs, key=subs.get)

            out.append(
                {
                    "station_code": station.station_id,
                    "station_name": station.station_name,
                    "lat": float(station.latitude),
                    "lon": float(station.longitude),
                    "aqi": aqi,
                    "aqi_mode": "official_cpcb_station_aqi" if getattr(station, "official_aqi", None) is not None else "derived_from_cpcb_pollutants",
                    "aqi_note": "Official station AQI from CPCB dataset." if getattr(station, "official_aqi", None) is not None else "Derived in backend from CPCB pollutant values.",
                    "category": aqi_category(aqi),
                    "dominant_pollutant": dominant,
                    "distance_km": round(float(dist_km), 2) if dist_km is not None else None,
                    "pm25": round(float(station.pm25), 2),
                    "pm10": round(float(station.pm10), 2),
                    "no2": round(float(station.no2), 2),
                    "so2": round(float(station.so2), 2),
                    "o3": round(float(station.o3), 2),
                    "co": round(float(station.co), 3),
                    "pollutants": {
                        "pm25": round(float(station.pm25), 2),
                        "pm10": round(float(station.pm10), 2),
                        "no2": round(float(station.no2), 2),
                        "so2": round(float(station.so2), 2),
                        "o3": round(float(station.o3), 2),
                        "co": round(float(station.co), 3),
                    },
                    "data_source": "CPCB",
                    "source": station.source,
                    "observed_at_utc": station.observed_at_utc.isoformat() if station.observed_at_utc else None,
                }
            )
            source_counts[str(station.source or "cpcb_api")] += 1

        if lat is not None and lon is not None:
            out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 1e9))
        else:
            out.sort(key=lambda x: int(x.get("aqi") or 0), reverse=True)

        limit = max(1, min(int(limit), 250))
        out = out[:limit]
        latest_ts = max((station.observed_at_utc for station in live_rows if station.observed_at_utc), default=None)
        age_minutes = max(0, int(round((datetime.now(timezone.utc) - latest_ts).total_seconds() / 60.0))) if latest_ts else None
        freshness = "live" if age_minutes is not None and age_minutes <= 90 else "stale"
        return {
            "timestamp": utc_now_iso(),
            "city_id": resolved_city_id,
            "region": resolved_region,
            "ts_slot_utc": latest_ts.isoformat() if latest_ts else None,
            "age_minutes": age_minutes,
            "freshness": freshness,
            "source_summary": dict(source_counts),
            "count": len(out),
            "data": out,
        }

    accepted_sources = None
    if settings.live_data_strict:
        accepted_sources = ["cpcb_api", "cpcb_db_cache:cpcb_api"]
    ts_stmt = select(func.max(CleanMeasurement.ts_slot_utc)).where(CleanMeasurement.qa_status == "ACCEPTED")
    if accepted_sources:
        ts_stmt = ts_stmt.where(CleanMeasurement.source.in_(accepted_sources))
    ts_slot = db.execute(ts_stmt).scalar_one()
    if ts_slot is None:
        return {"timestamp": utc_now_iso(), "city_id": resolved_city_id, "region": resolved_region, "ts_slot_utc": None, "count": 0, "data": []}

    has_api = (
        db.execute(
            select(func.count())
            .select_from(CleanMeasurement)
            .where(
                CleanMeasurement.ts_slot_utc == ts_slot,
                CleanMeasurement.qa_status == "ACCEPTED",
                CleanMeasurement.source == "cpcb_api",
            )
        ).scalar_one()
        > 0
    )

    stmt = (
        select(
            CleanMeasurement.station_code,
            CleanMeasurement.pollutant_id,
            CleanMeasurement.clean_value,
            CleanMeasurement.source,
            Station.station_name,
            Station.latitude,
            Station.longitude,
        )
        .join(Station, Station.station_code == CleanMeasurement.station_code)
        .where(CleanMeasurement.ts_slot_utc == ts_slot, CleanMeasurement.qa_status == "ACCEPTED")
    )
    if accepted_sources:
        stmt = stmt.where(CleanMeasurement.source.in_(accepted_sources))
    if has_api:
        stmt = stmt.where(CleanMeasurement.source == "cpcb_api")
    rows = db.execute(stmt).all()

    by_station: dict[str, dict] = {}
    for code, pollutant_id, clean_value, source_name, name, s_lat, s_lon in rows:
        if clean_value is None:
            continue
        station = by_station.setdefault(
            str(code),
            {
                "station_code": str(code),
                "station_name": str(name or code),
                "lat": float(s_lat),
                "lon": float(s_lon),
                "pollutants": {},
                "source": str(source_name or ""),
            },
        )
        pol = str(pollutant_id or "").upper().strip()
        station["pollutants"][pol] = float(clean_value)

    out: list[dict] = []
    source_counts: Counter[str] = Counter()
    for station in by_station.values():
        pols = station["pollutants"]
        if not all(k in pols for k in ("PM25", "PM10", "NO2", "SO2", "O3", "CO")):
            continue
        pm25 = float(pols["PM25"])
        pm10 = float(pols["PM10"])
        no2 = float(pols["NO2"])
        so2 = float(pols["SO2"])
        o3 = float(pols["O3"])
        co = float(pols["CO"])

        indices = {
            "PM2.5": calc_sub_index(pm25, "pm25"),
            "PM10": calc_sub_index(pm10, "pm10"),
            "NO2": calc_sub_index(no2, "no2"),
            "SO2": calc_sub_index(so2, "so2"),
            "O3": calc_sub_index(o3, "o3"),
            "CO": calc_sub_index(co, "co"),
        }
        dominant = max(indices, key=indices.get)
        aqi = int(indices[dominant])
        dist_km = None
        if lat is not None and lon is not None:
            dist_km = _haversine_km(float(lat), float(lon), float(station["lat"]), float(station["lon"]))
            if dist_km > float(radius_km):
                continue

        out.append(
            {
                "station_code": station["station_code"],
                "station_name": station["station_name"],
                "lat": station["lat"],
                "lon": station["lon"],
                "aqi": aqi,
                "aqi_mode": "derived_from_cpcb_pollutants",
                "aqi_note": "Derived in backend from CPCB pollutant values; may differ from official CPCB station AQI shown on airquality.cpcb.gov.in.",
                "category": aqi_category(aqi),
                "dominant_pollutant": dominant,
                "distance_km": round(float(dist_km), 2) if dist_km is not None else None,
                "pm25": round(pm25, 2),
                "pm10": round(pm10, 2),
                "no2": round(no2, 2),
                "so2": round(so2, 2),
                "o3": round(o3, 2),
                "co": round(co, 3),
                "pollutants": {
                    "pm25": round(pm25, 2),
                    "pm10": round(pm10, 2),
                    "no2": round(no2, 2),
                    "so2": round(so2, 2),
                    "o3": round(o3, 2),
                    "co": round(co, 3),
                },
                "data_source": "CPCB",
                "source": station.get("source") or ("cpcb_api" if has_api else "unknown"),
            }
        )
        source_counts[str(station.get("source") or ("cpcb_api" if has_api else "unknown"))] += 1

    # Prefer nearest stations if a center point is provided; else prefer highest AQI (map readability).
    if lat is not None and lon is not None:
        out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 1e9))
    else:
        out.sort(key=lambda x: int(x.get("aqi") or 0), reverse=True)

    limit = max(1, min(int(limit), 250))
    out = out[:limit]
    age_minutes = max(0, int(round((datetime.now(timezone.utc) - ts_slot).total_seconds() / 60.0)))
    freshness = "live" if age_minutes <= 90 else "stale"
    return {
        "timestamp": utc_now_iso(),
        "city_id": resolved_city_id,
        "region": resolved_region,
        "ts_slot_utc": ts_slot.isoformat(),
        "age_minutes": age_minutes,
        "freshness": freshness,
        "source_summary": dict(source_counts),
        "count": len(out),
        "data": out,
    }
