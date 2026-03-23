from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.config import settings


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

# Fresh cache: return instantly with no network.
_SAT_FRESH_TTL = timedelta(minutes=60)
# Stale cache: still return to user if NASA is flaky.
_SAT_STALE_TTL = timedelta(hours=12)
# After failure, avoid immediate repeated retries.
_SAT_FAIL_COOLDOWN = timedelta(minutes=20)


class SatelliteCollector:
    def fetch(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot:
        key = (round(lat, 3), round(lon, 3), date_utc)
        now = _utcnow()
        cached_item = _SAT_CACHE.get(key)
        cached = cached_item[1] if cached_item else None
        cache_age = (now - cached_item[0]) if cached_item else None

        # Best UX path: fresh cache is always instant.
        if cached and cache_age is not None and cache_age <= _SAT_FRESH_TTL:
            return cached

        # If NASA recently failed, serve cache/degraded immediately.
        fail_ts = _SAT_FAIL_TS.get(key)
        if fail_ts and (now - fail_ts) <= _SAT_FAIL_COOLDOWN:
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "nasa_call_in_cooldown_after_failure")

        # FIRMS-only mode: never call `api.nasa.gov`. Use FIRMS hotspots as the "satellite" signal.
        # This keeps the UI satellite panel active without requiring a NASA API key.
        if "api.nasa.gov" in str(getattr(settings, "nasa_earth_base_url", "") or ""):
            snap = self._firms_satellite(lat, lon, date_utc)
            _SAT_CACHE[key] = (now, snap)
            return snap

        # Attempt live refresh only when needed.
        if not settings.external_apis_enabled:
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "external_apis_disabled")
        if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
            return cached
        snap = self._firms_satellite(lat, lon, date_utc)
        _SAT_CACHE[key] = (now, snap)
        return snap

    def _firms_satellite(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot:
        from app.services.collectors.firms_collector import FirmsCollector

        firms = FirmsCollector().fetch_nearby(lat=lat, lon=lon, radius_km=10.0, days=1, source="VIIRS_SNPP_NRT")
        fires = firms.get("fires") or []
        fire_nearby = bool(firms.get("fireNearby"))
        # Use a simple "satellite index" proxy so the UI has a numeric signal to plot if needed.
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
                "note": "firms_hotspots_proxy",
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
