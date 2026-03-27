from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry

_CACHE: dict[str, tuple[datetime, dict[str, Any]]] = {}
_TTL = timedelta(hours=24)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_feature_collection(geo: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(geo, dict):
        return {"type": "FeatureCollection", "features": []}
    if geo.get("type") == "FeatureCollection":
        return geo
    if geo.get("type") == "Feature":
        return {"type": "FeatureCollection", "features": [geo]}
    if geo.get("type") in {"Polygon", "MultiPolygon"}:
        return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": geo}]}
    return {"type": "FeatureCollection", "features": []}


@dataclass
class BoundarySnapshot:
    name: str
    ts_utc: datetime
    geojson: dict[str, Any]
    source: str = "NOMINATIM"


class BoundaryCollector:
    def fetch_boundary(self, query: str, limit: int = 1) -> BoundarySnapshot:
        name = str(query or "").strip() or "boundary"
        cache_key = f"boundary::{name.lower()}"
        cached = _CACHE.get(cache_key)
        if cached and (_utcnow() - cached[0]) <= _TTL:
            return BoundarySnapshot(name=name, ts_utc=cached[0], geojson=cached[1])

        params = {
            "format": "jsonv2",
            "q": name,
            "polygon_geojson": 1,
            "addressdetails": 1,
            "limit": max(1, min(int(limit), 5)),
            "countrycodes": "in",
        }
        headers = {"User-Agent": "HyperlocalWardPollutionIntel/1.0"}
        try:
            payload = get_json_with_retry(settings.nominatim_search_url, params=params, headers=headers)
        except Exception:
            payload = []
        if not isinstance(payload, list) or not payload:
            geo = {"type": "FeatureCollection", "features": []}
            _CACHE[cache_key] = (_utcnow(), geo)
            return BoundarySnapshot(name=name, ts_utc=_utcnow(), geojson=geo)

        item = next((row for row in payload if isinstance(row, dict) and row.get("geojson")), payload[0] if payload else {})
        item = item if isinstance(item, dict) else {}
        feature = {
            "type": "Feature",
            "properties": {
                "display_name": item.get("display_name"),
                "place_id": item.get("place_id"),
                "type": item.get("type"),
                "class": item.get("class"),
            },
            "geometry": item.get("geojson"),
        }
        geo = _as_feature_collection(feature)
        ts = _utcnow()
        _CACHE[cache_key] = (ts, geo)
        return BoundarySnapshot(name=name, ts_utc=ts, geojson=geo)

    def fetch_new_delhi_boundary(self) -> BoundarySnapshot:
        """
        Fetch an administrative boundary for "New Delhi" via Nominatim search (GeoJSON polygon).

        Cached for 24 hours to avoid repeated calls.
        """
        cache_key = "new_delhi_boundary"
        cached = _CACHE.get(cache_key)
        if cached and (_utcnow() - cached[0]) <= _TTL:
            return BoundarySnapshot(name="New Delhi", ts_utc=cached[0], geojson=cached[1])

        snap = self.fetch_boundary("New Delhi, Delhi, India", limit=1)
        _CACHE[cache_key] = (snap.ts_utc, snap.geojson)
        return BoundarySnapshot(name="New Delhi", ts_utc=snap.ts_utc, geojson=snap.geojson)
