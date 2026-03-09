from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class LocationSnapshot:
    latitude: float
    longitude: float
    city: str
    district: str
    locality: str
    ward: str
    sublocality: str
    state: str
    country: str
    raw: dict
    ts_utc: datetime
    source: str = "NOMINATIM"


class LocationCollector:
    def reverse_geocode(self, lat: float, lon: float) -> LocationSnapshot:
        params = {"lat": lat, "lon": lon, "format": "jsonv2", "addressdetails": 1}
        headers = {"User-Agent": "HyperlocalWardPollutionIntel/1.0"}
        try:
            payload = get_json_with_retry(settings.nominatim_base_url, params=params, headers=headers)
            addr = payload.get("address", {}) if isinstance(payload, dict) else {}
            city = str(addr.get("city") or addr.get("town") or addr.get("municipality") or "")
            district = str(addr.get("state_district") or addr.get("county") or "")
            locality = str(addr.get("suburb") or addr.get("neighbourhood") or "")
            ward = str(addr.get("city_district") or addr.get("ward") or "")
            sublocality = str(addr.get("quarter") or addr.get("hamlet") or "")
            state = str(addr.get("state") or "")
            country = str(addr.get("country") or "")
            return LocationSnapshot(
                latitude=lat,
                longitude=lon,
                city=city,
                district=district,
                locality=locality,
                ward=ward,
                sublocality=sublocality,
                state=state,
                country=country,
                raw=payload if isinstance(payload, dict) else {},
                ts_utc=_utcnow(),
            )
        except Exception:
            return LocationSnapshot(
                latitude=lat,
                longitude=lon,
                city="",
                district="",
                locality="",
                ward="",
                sublocality="",
                state="",
                country="",
                raw={},
                ts_utc=_utcnow(),
            )
