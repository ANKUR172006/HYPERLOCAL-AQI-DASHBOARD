from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import time

import httpx

from app.core.config import settings
from app.services.collectors.http_client import _record_check


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

        # Attempt live NASA refresh only when needed.
        if not settings.external_apis_enabled:
            _record_check(settings.nasa_earth_base_url, {"lat": lat, "lon": lon, "date": date_utc}, success=False, status_code=None, error="external_apis_disabled")
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "external_apis_disabled")
        if not settings.nasa_api_key:
            _record_check(settings.nasa_earth_base_url, {"lat": lat, "lon": lon, "date": date_utc}, success=False, status_code=None, error="nasa_api_key_missing")
            if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
                return cached
            return self._degraded(lat, lon, date_utc, "nasa_api_key_missing")
        snap = self._fetch_from_nasa(lat, lon, date_utc)
        if snap:
            _SAT_CACHE[key] = (now, snap)
            return snap

        _SAT_FAIL_TS[key] = now
        # On failure, prefer stale data over null.
        if cached and cache_age is not None and cache_age <= _SAT_STALE_TTL:
            return cached
        return self._degraded(lat, lon, date_utc, "nasa_request_failed")

    def _fetch_from_nasa(self, lat: float, lon: float, date_utc: str) -> SatelliteSnapshot | None:
        params = {
            "lat": lat,
            "lon": lon,
            "date": date_utc,
            "api_key": settings.nasa_api_key,
            "dim": 0.1,
            # When using the imagery endpoint, this makes the API return JSON with `cloud_score` + `url`.
            # This gives us a stable "satellite signal" for the UI even when aerosol products aren't available.
            "cloud_score": "true",
        }
        retries = max(1, int(settings.nasa_max_retries))
        for _ in range(retries):
            try:
                timeout = httpx.Timeout(
                    connect=5.0,
                    read=float(settings.nasa_timeout_sec),
                    write=5.0,
                    pool=5.0,
                )
                response = httpx.get(settings.nasa_earth_base_url, params=params, timeout=timeout)
                response.raise_for_status()
                try:
                    payload = response.json()
                except Exception:
                    _record_check(
                        settings.nasa_earth_base_url,
                        params,
                        success=False,
                        status_code=response.status_code,
                        error=f"Non-JSON response (content-type={response.headers.get('content-type')})",
                    )
                    return None
                _record_check(settings.nasa_earth_base_url, params, success=True, status_code=response.status_code, error=None)

                ts_txt = str(payload.get("date") or date_utc)
                try:
                    ts = datetime.fromisoformat(ts_txt.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    ts = _utcnow()

                # The NASA Earth imagery API doesn't provide aerosol index; for demo UX, use cloud_score as a proxy signal.
                aerosol = payload.get("aerosol_index")
                if aerosol is None:
                    aerosol = payload.get("cloud_score")
                try:
                    aerosol_val = float(aerosol) if aerosol is not None else None
                except (TypeError, ValueError):
                    aerosol_val = None

                return SatelliteSnapshot(
                    latitude=lat,
                    longitude=lon,
                    date_utc=date_utc,
                    ts_utc=ts,
                    image_reference=str(payload.get("url") or ""),
                    aerosol_index=aerosol_val,
                    imagery_metadata=payload if isinstance(payload, dict) else {},
                    source="NASA",
                )
            except Exception as exc:
                status_code = None
                if isinstance(exc, httpx.HTTPStatusError):
                    status_code = exc.response.status_code
                _record_check(settings.nasa_earth_base_url, params, success=False, status_code=status_code, error=str(exc))
                # Small backoff for transient timeouts.
                time.sleep(0.4)
        return None

    def _degraded(self, lat: float, lon: float, date_utc: str, note: str) -> SatelliteSnapshot:
        return SatelliteSnapshot(
            latitude=lat,
            longitude=lon,
            date_utc=date_utc,
            ts_utc=_utcnow(),
            image_reference="",
            aerosol_index=None,
            imagery_metadata={"note": note},
            source="NASA_DEGRADED",
        )
