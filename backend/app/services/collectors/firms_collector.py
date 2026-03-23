from __future__ import annotations

import csv
import io
import math
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from app.core.config import settings
from app.services.collectors.http_client import get_text_with_retry

_CACHE: dict[str, tuple[datetime, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 900  # 10–15 minutes as requested


def _bbox_from_latlon(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    r = max(0.1, float(radius_km))
    lat = float(lat)
    lon = float(lon)
    dlat = r / 111.0
    denom = 111.0 * max(0.15, math.cos(math.radians(lat)))
    dlon = r / denom
    west = max(-180.0, lon - dlon)
    east = min(180.0, lon + dlon)
    south = max(-90.0, lat - dlat)
    north = min(90.0, lat + dlat)
    return (west, south, east, north)


def _to_float(v: Any) -> float | None:
    try:
        if v is None:
            return None
        s = str(v).strip()
        if s == "":
            return None
        return float(s)
    except Exception:
        return None


def _to_int(v: Any) -> int | None:
    try:
        if v is None:
            return None
        s = str(v).strip()
        if s == "":
            return None
        return int(float(s))
    except Exception:
        return None


@dataclass
class FirmsHotspot:
    latitude: float
    longitude: float
    brightness: float | None
    scan: float | None
    track: float | None
    acq_date: str | None
    acq_time: str | None
    satellite: str | None
    confidence: str | None
    version: str | None
    bright_t31: float | None
    frp: float | None
    daynight: str | None


class FirmsCollector:
    """
    NASA FIRMS hotspots (CSV).

    Docs (URL shape):
      /area/csv/{MAP_KEY}/{SOURCE}/{WEST,SOUTH,EAST,NORTH}/{DAY_RANGE}[/{YYYY-MM-DD}]
    """

    def fetch_nearby(
        self,
        lat: float,
        lon: float,
        radius_km: float = 10.0,
        days: int = 1,
        source: str = "VIIRS_SNPP_NRT",
        on_date: date | None = None,
    ) -> dict[str, Any]:
        # Never hit external APIs during tests even if the user has keys set.
        if os.getenv("PYTEST_CURRENT_TEST") is not None:
            return {"fires": [], "fireNearby": False, "enabled": False, "reason": "disabled_in_tests"}

        key = (settings.firms_map_key or "").strip()
        if not key:
            return {"fires": [], "fireNearby": False, "enabled": False, "reason": "missing_firms_map_key"}
        if not getattr(settings, "external_apis_enabled", True):
            return {"fires": [], "fireNearby": False, "enabled": False, "reason": "external_apis_disabled"}

        days = int(days)
        if days < 1 or days > 10:
            days = max(1, min(10, days))

        west, south, east, north = _bbox_from_latlon(lat, lon, radius_km)
        bbox = f"{west:.5f},{south:.5f},{east:.5f},{north:.5f}"
        src = (source or "VIIRS_SNPP_NRT").strip()
        base = (settings.firms_base_url or "").rstrip("/")
        url = f"{base}/area/csv/{key}/{src}/{bbox}/{days}"
        if on_date is not None:
            url = f"{url}/{on_date.isoformat()}"

        cached = _CACHE.get(url)
        if cached:
            ts, payload = cached
            if (datetime.now(timezone.utc) - ts).total_seconds() <= _CACHE_TTL_SEC:
                return payload

        try:
            text = get_text_with_retry(url)
        except Exception as exc:  # pragma: no cover
            payload = {"fires": [], "fireNearby": False, "error": str(exc)}
            _CACHE[url] = (datetime.now(timezone.utc), payload)
            return payload
        if not text.strip():
            payload = {"fires": [], "fireNearby": False}
            _CACHE[url] = (datetime.now(timezone.utc), payload)
            return payload

        # FIRMS returns CSV; parse defensively (field sets differ by product).
        reader = csv.DictReader(io.StringIO(text))
        fires: list[dict[str, Any]] = []
        for row in reader:
            lat_v = _to_float(row.get("latitude") or row.get("lat"))
            lon_v = _to_float(row.get("longitude") or row.get("lon") or row.get("lng"))
            if lat_v is None or lon_v is None:
                continue
            item = FirmsHotspot(
                latitude=float(lat_v),
                longitude=float(lon_v),
                brightness=_to_float(row.get("brightness")),
                scan=_to_float(row.get("scan")),
                track=_to_float(row.get("track")),
                acq_date=(row.get("acq_date") or row.get("acqdate") or None),
                acq_time=(row.get("acq_time") or row.get("acqtime") or None),
                satellite=(row.get("satellite") or None),
                confidence=(row.get("confidence") or None),
                version=(row.get("version") or None),
                bright_t31=_to_float(row.get("bright_t31")),
                frp=_to_float(row.get("frp")),
                daynight=(row.get("daynight") or row.get("day_night") or None),
            )
            fires.append({"lat": item.latitude, "lon": item.longitude, "confidence": item.confidence})

        # Detect fire within radius_km of the query point.
        fire_nearby = False
        try:
            r = max(0.1, float(radius_km))
            for f in fires:
                dlat = float(f["lat"]) - float(lat)
                dlon = float(f["lon"]) - float(lon)
                # quick reject (degree box) before haversine
                if abs(dlat) > (r / 111.0) or abs(dlon) > (r / 111.0):
                    continue
                # haversine
                phi1 = math.radians(float(lat))
                phi2 = math.radians(float(f["lat"]))
                dphi = math.radians(float(f["lat"]) - float(lat))
                dlambda = math.radians(float(f["lon"]) - float(lon))
                a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
                km = 2 * 6371.0 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                if km <= r:
                    fire_nearby = True
                    break
        except Exception:
            fire_nearby = False

        payload = {"fires": fires, "fireNearby": bool(fire_nearby)}
        _CACHE[url] = (datetime.now(timezone.utc), payload)
        return payload
