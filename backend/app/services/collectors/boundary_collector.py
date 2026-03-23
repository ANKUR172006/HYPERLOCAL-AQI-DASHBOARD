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
    def fetch_new_delhi_boundary(self) -> BoundarySnapshot:
        """
        Fetch an administrative boundary for "New Delhi" via Nominatim search (GeoJSON polygon).

        Cached for 24 hours to avoid repeated calls.
        """
        cache_key = "new_delhi_boundary"
        cached = _CACHE.get(cache_key)
        if cached and (_utcnow() - cached[0]) <= _TTL:
            return BoundarySnapshot(name="New Delhi", ts_utc=cached[0], geojson=cached[1])

        params = {
            "format": "jsonv2",
            "q": "New Delhi, Delhi, India",
            "polygon_geojson": 1,
            "addressdetails": 1,
            "limit": 1,
        }
        headers = {"User-Agent": "HyperlocalWardPollutionIntel/1.0"}
        payload = get_json_with_retry(settings.nominatim_search_url, params=params, headers=headers)
        if not isinstance(payload, list) or not payload:
            geo = {"type": "FeatureCollection", "features": []}
            _CACHE[cache_key] = (_utcnow(), geo)
            return BoundarySnapshot(name="New Delhi", ts_utc=_utcnow(), geojson=geo)

        item = payload[0] if isinstance(payload[0], dict) else {}
        geo_raw = item.get("geojson") if isinstance(item, dict) else None
        feature = {"type": "Feature", "properties": {"display_name": item.get("display_name")}, "geometry": geo_raw}
        geo = _as_feature_collection(feature)
        ts = _utcnow()
        _CACHE[cache_key] = (ts, geo)
        return BoundarySnapshot(name="New Delhi", ts_utc=ts, geojson=geo)

