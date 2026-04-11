from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_place_name(value: str) -> str:
    text = str(value or "").strip()
    upper = text.upper()
    if upper in {"GURGAON", "GURUGRAM"}:
        return "Gurugram"
    if upper in {"DELHI NCT", "NCT OF DELHI", "NEW DELHI"}:
        return "Delhi"
    return text


def _normalized_location_fields(addr: dict) -> tuple[str, str, str, str, str, str, str]:
    city = _normalize_place_name(str(addr.get("city") or addr.get("town") or addr.get("municipality") or ""))
    district = _normalize_place_name(str(addr.get("state_district") or addr.get("county") or ""))
    locality = str(addr.get("suburb") or addr.get("neighbourhood") or "")
    ward = str(addr.get("city_district") or addr.get("ward") or "")
    sublocality = str(addr.get("quarter") or addr.get("hamlet") or "")
    state = _normalize_place_name(str(addr.get("state") or ""))
    country = str(addr.get("country") or "")

    if not city and district.upper() in {"GURGAON", "GURUGRAM"}:
        city = "Gurugram"
    if not district and city.upper() == "GURUGRAM":
        district = "Gurugram"
    if not state and (city.upper() == "GURUGRAM" or district.upper() == "GURUGRAM"):
        state = "Haryana"
    return city, district, locality, ward, sublocality, state, country


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
            city, district, locality, ward, sublocality, state, country = _normalized_location_fields(addr)
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

    def search_places(self, query: str, limit: int = 5) -> list[dict]:
        text = str(query or "").strip()
        if not text:
            return []

        coord_match = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", text)
        if coord_match:
            lat = float(coord_match.group(1))
            lon = float(coord_match.group(2))
            snap = self.reverse_geocode(lat, lon)
            label_parts = [snap.locality, snap.city, snap.district, snap.state, snap.country]
            label = ", ".join(part for part in label_parts if part) or f"{lat:.6f}, {lon:.6f}"
            return [
                {
                    "display_name": label,
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "city": snap.city,
                    "district": snap.district,
                    "state": snap.state,
                    "country": snap.country,
                    "source": "COORDINATE_INPUT",
                }
            ]

        params = {
            "format": "jsonv2",
            "q": text,
            "addressdetails": 1,
            "limit": max(1, min(int(limit), 10)),
            "countrycodes": "in",
        }
        headers = {"User-Agent": "HyperlocalWardPollutionIntel/1.0"}
        try:
            payload = get_json_with_retry(settings.nominatim_search_url, params=params, headers=headers)
        except Exception:
            return []
        if not isinstance(payload, list):
            return []

        results: list[dict] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            try:
                lat = float(item.get("lat"))
                lon = float(item.get("lon"))
            except Exception:
                continue
            addr = item.get("address", {}) if isinstance(item.get("address"), dict) else {}
            city, district, _, _, _, state, country = _normalized_location_fields(addr)
            results.append(
                {
                    "display_name": str(item.get("display_name") or f"{lat:.6f}, {lon:.6f}"),
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "city": city,
                    "district": district,
                    "state": state,
                    "country": country,
                    "source": "NOMINATIM_SEARCH",
                }
            )
        return results
