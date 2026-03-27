from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SatelliteSnapshot:
    latitude: float
    longitude: float
    date_utc: str
    ts_utc: datetime
    image_reference: str
    aerosol_index: float | None
    imagery_metadata: dict
    source: str = "NASA"


_SAT_CACHE: dict[tuple[float, float, str], tuple[datetime, SatelliteSnapshot]] = {}
_SAT_FAIL_TS: dict[tuple[float, float, str], datetime] = {}

_SAT_FRESH_TTL = timedelta(minutes=60)
_SAT_STALE_TTL = timedelta(hours=12)
_SAT_FAIL_COOLDOWN = timedelta(minutes=20)


class SatelliteCollector:
    def fetch(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot:
        key = (round(lat, 3), round(lon, 3), date_utc)
        now = _utcnow()
        cached_item = _SAT_CACHE.get(key)
        cached = cached_item[1] if cached_item else None
        cache_age = (now - cached_item[0]) if cached_item else None

        if cached and cache_age is not None and cache_age <= _SAT_FRESH_TTL:
            return cached

        fail_ts = _SAT_FAIL_TS.get(key)
        if fail_ts and (now - fail_ts) <= _SAT_FAIL_COOLDOWN:
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "satellite_call_in_cooldown_after_failure")

        if not settings.external_apis_enabled:
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "external_apis_disabled")

        try:
            if (settings.nasa_api_key or "").strip():
                snap = self._nasa_satellite(lat, lon, date_utc)
            elif (settings.firms_map_key or "").strip():
                snap = self._firms_satellite(lat, lon, date_utc)
            else:
                snap = self._degraded(lat, lon, date_utc, "missing_nasa_and_firms_keys")
            _SAT_CACHE[key] = (now, snap)
            return snap
        except Exception as exc:
            _SAT_FAIL_TS[key] = now
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, f"satellite_fetch_failed:{type(exc).__name__}")

    def _nasa_satellite(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot:
        base = str(settings.nasa_earth_base_url or "").rstrip("/")
        if base.endswith("/imagery"):
            base = f"{base.rsplit('/', 1)[0]}/assets"
        params = {
            "lat": float(lat),
            "lon": float(lon),
            "date": date_utc,
            "dim": 0.15,
            "api_key": settings.nasa_api_key,
        }
        payload = get_json_with_retry(base, params=params)
        if not isinstance(payload, dict):
            raise ValueError("NASA assets payload is not a JSON object")

        image_reference = str(payload.get("url") or payload.get("image") or "")
        timestamp_text = str(payload.get("date") or payload.get("timestamp") or date_utc)
        try:
            ts = datetime.fromisoformat(timestamp_text.replace("Z", "+00:00"))
        except ValueError:
            ts = _utcnow()

        cloud_score = payload.get("cloud_score")
        aerosol_index = None
        try:
            if cloud_score is not None:
                aerosol_index = float(cloud_score)
        except (TypeError, ValueError):
            aerosol_index = None

        return SatelliteSnapshot(
            latitude=lat,
            longitude=lon,
            date_utc=date_utc,
            ts_utc=ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc),
            image_reference=image_reference,
            aerosol_index=aerosol_index,
            imagery_metadata=payload,
            source="NASA_EARTH",
        )

    def _firms_satellite(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot:
        from app.services.collectors.firms_collector import FirmsCollector

        firms = FirmsCollector().fetch_nearby(lat=lat, lon=lon, radius_km=10.0, days=1, source="VIIRS_SNPP_NRT")
        fires = firms.get("fires") or []
        fire_nearby = bool(firms.get("fireNearby"))
        try:
            proxy_index = float(min(10, len(fires)))
        except Exception:
            proxy_index = None
        return SatelliteSnapshot(
            latitude=lat,
            longitude=lon,
            date_utc=date_utc,
            ts_utc=_utcnow(),
            image_reference="",
            aerosol_index=proxy_index,
            imagery_metadata={
                "provider": "FIRMS",
                "note": "live_firms_hotspots_proxy",
                "fireNearby": fire_nearby,
                "hotspot_count": len(fires),
            },
            source="FIRMS",
        )

    def _degraded(self, lat: float, lon: float, date_utc: str, note: str) -> SatelliteSnapshot:
        return SatelliteSnapshot(
            latitude=lat,
            longitude=lon,
            date_utc=date_utc,
            ts_utc=_utcnow(),
            image_reference="",
            aerosol_index=None,
            imagery_metadata={"note": note},
            source="SATELLITE_DISABLED",
        )
