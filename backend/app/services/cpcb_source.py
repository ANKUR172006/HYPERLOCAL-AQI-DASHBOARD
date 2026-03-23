from __future__ import annotations

import csv
import json
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

_API_CACHE: dict[str, tuple[datetime, Any]] = {}
_API_CACHE_TTL_SEC = 120
_WARNED_MISSING_DATA_GOV_KEY = False

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class StationObservation:
    station_id: str
    station_name: str
    latitude: float
    longitude: float
    pm25: float
    pm10: float
    no2: float
    so2: float
    o3: float
    co: float
    wind_speed: float
    wind_direction: float
    humidity: float
    temperature: float
    observed_at_utc: datetime
    source: str


def _first_of(payload: dict[str, Any], keys: tuple[str, ...], default: Any = None) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_dt(value: Any) -> datetime:
    if not value:
        return utc_now()
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    try:
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return utc_now()


def _norm_key(key: Any) -> str:
    text = str(key).strip().lower()
    text = text.replace(" ", "_").replace("-", "_").replace("/", "_").replace(".", "")
    return text


def _normalize_record(row: dict[str, Any], source: str) -> StationObservation | None:
    lat = _to_float(_first_of(row, ("latitude", "lat", "station_latitude")), default=0.0)
    lon = _to_float(_first_of(row, ("longitude", "lon", "lng", "station_longitude")), default=0.0)
    if lat == 0.0 and lon == 0.0:
        return None

    station_id = str(_first_of(row, ("station_id", "station_code", "id", "station"), "unknown")).strip()
    station_name = str(_first_of(row, ("station_name", "location", "name", "city"), station_id)).strip()

    pm25 = _to_float(_first_of(row, ("pm25", "pm_25", "pm2_5", "pm2.5")), default=-1.0)
    pm10 = _to_float(_first_of(row, ("pm10", "pm_10")), default=-1.0)
    no2 = _to_float(_first_of(row, ("no2",)), default=-1.0)
    so2 = _to_float(_first_of(row, ("so2",)), default=-1.0)
    o3 = _to_float(_first_of(row, ("o3", "ozone")), default=-1.0)
    co = _to_float(_first_of(row, ("co",)), default=-1.0)
    if min(pm25, pm10, no2, so2, o3, co) < 0:
        return None

    wind_speed = _to_float(_first_of(row, ("wind_speed", "ws")), default=2.5)
    wind_direction = _to_float(_first_of(row, ("wind_direction", "wd")), default=180.0)
    humidity = _to_float(_first_of(row, ("humidity", "rh")), default=55.0)
    temperature = _to_float(_first_of(row, ("temperature", "temp")), default=28.0)
    observed_at_utc = _to_dt(_first_of(row, ("timestamp", "observed_at", "last_update", "time")))

    return StationObservation(
        station_id=station_id or "unknown",
        station_name=station_name or station_id or "unknown",
        latitude=lat,
        longitude=lon,
        pm25=pm25,
        pm10=pm10,
        no2=no2,
        so2=so2,
        o3=o3,
        co=co,
        wind_speed=wind_speed,
        wind_direction=wind_direction,
        humidity=humidity,
        temperature=temperature,
        observed_at_utc=observed_at_utc,
        source=source,
    )


class CpcbSource:
    def __init__(
        self,
        mode: str,
        file_path: str,
        api_url: str,
        api_key: str | None,
        api_format: str = "json",
        api_offset: int = 0,
        api_limit: int = 10,
        api_max_pages: int = 25,
        api_timeout_sec: float = 5.0,
        filter_state: str = "",
        filter_city: str = "",
    ):
        self.mode = mode
        self.file_path = file_path
        self.api_url = api_url
        self.api_key = api_key
        self.api_format = api_format
        self.api_offset = api_offset
        self.api_limit = api_limit
        self.api_max_pages = api_max_pages
        self.api_timeout_sec = api_timeout_sec
        self.filter_state = filter_state
        self.filter_city = filter_city

    def load(self) -> list[StationObservation]:
        if self.mode == "api":
            return self._load_from_api()
        if self.mode == "file":
            return self._load_from_file()
        if self.mode == "hybrid":
            rows = self._load_from_api()
            if rows:
                return rows
            return self._load_from_file()
        return []

    def _warn_missing_data_gov_key_once(self) -> None:
        global _WARNED_MISSING_DATA_GOV_KEY
        if _WARNED_MISSING_DATA_GOV_KEY:
            return
        _WARNED_MISSING_DATA_GOV_KEY = True
        logger.warning(
            "CPCB_API_KEY is not set; api.data.gov.in requests will return 400. "
            "Set CPCB_API_KEY (env/.env) or use CPCB_SOURCE_MODE=file (or hybrid)."
        )

    def _load_from_file(self) -> list[StationObservation]:
        path = Path(self.file_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if not path.exists():
            return []
        rows: list[StationObservation] = []
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            for record in reader:
                row = {_norm_key(k): v for k, v in record.items()}
                normalized = _normalize_record(row, source="cpcb_file")
                if normalized:
                    rows.append(normalized)
        return rows

    def _load_from_api(self) -> list[StationObservation]:
        if not self.api_url:
            return []
        url = self.api_url.strip()
        params: dict[str, str] = {}

        if url.startswith("/resource/"):
            url = f"https://api.data.gov.in{url}"
        if "api.data.gov.in/resource/" in url:
            if not (self.api_key and str(self.api_key).strip()):
                self._warn_missing_data_gov_key_once()
                return []
            parsed = urllib.parse.urlsplit(url)
            existing = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
            params.update(existing)
            params.setdefault("format", self.api_format)
            params.setdefault("offset", str(self.api_offset))
            params.setdefault("limit", str(self.api_limit))
            if self.filter_state:
                params.setdefault("filters[state]", self.filter_state)
            if self.filter_city:
                params.setdefault("filters[city]", self.filter_city)
            if self.api_key:
                params["api-key"] = self.api_key
            url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
            records = self._fetch_data_gov_pollutants(url, params)
        else:
            payload = self._safe_get_json(url, params)
            records = self._extract_records(payload)

        if not records:
            return []
        if "pollutant_id" in {_norm_key(k) for k in records[0].keys()}:
            return self._aggregate_data_gov_records(records)

        rows: list[StationObservation] = []
        for record in records:
            row = {_norm_key(k): v for k, v in record.items()}
            normalized = _normalize_record(row, source="cpcb_api")
            if normalized:
                rows.append(normalized)
        return rows

    def _fetch_data_gov_pages(self, url: str, params: dict[str, str]) -> list[dict[str, Any]]:
        limit = max(1, int(params.get("limit", str(self.api_limit))))
        offset = int(params.get("offset", str(self.api_offset)))
        all_records: list[dict[str, Any]] = []
        for page in range(max(1, self.api_max_pages)):
            page_params = dict(params)
            page_params["offset"] = str(offset + page * limit)
            page_params["limit"] = str(limit)
            payload = self._safe_get_json(url, page_params)
            records = self._extract_records(payload)
            if not records:
                break
            all_records.extend(records)
            if len(records) < limit:
                break
        return all_records

    def _fetch_data_gov_pollutants(self, url: str, params: dict[str, str]) -> list[dict[str, Any]]:
        # Data.gov sample keys are heavily paginated; pulling each pollutant separately yields fuller station records.
        pollutants = ["PM2.5", "PM10", "NO2", "SO2", "OZONE", "CO"]
        all_records: list[dict[str, Any]] = []
        for pollutant in pollutants:
            p = dict(params)
            p["filters[pollutant_id]"] = pollutant
            all_records.extend(self._fetch_data_gov_pages(url, p))
        return all_records

    def _safe_get_json(self, url: str, params: dict[str, str] | None) -> Any:
        if not getattr(settings, "external_apis_enabled", True):
            return {}
        cache_key = f"{url}|{json.dumps(params or {}, sort_keys=True)}"
        cached = _API_CACHE.get(cache_key)
        if cached:
            ts, payload = cached
            age = (utc_now() - ts).total_seconds()
            if age <= _API_CACHE_TTL_SEC:
                return payload
        try:
            response = httpx.get(url, params=params or None, timeout=self.api_timeout_sec)
            response.raise_for_status()
            payload = response.json()
            _API_CACHE[cache_key] = (utc_now(), payload)
            return payload
        except Exception:
            # If the network call fails, prefer returning a stale cached payload (stale-if-error)
            # to avoid "data jumps" between refreshes during intermittent API outages.
            if cached:
                return cached[1]
            return {}

    def _extract_records(self, payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            data_field = payload.get("data")
            if isinstance(data_field, list):
                return [item for item in data_field if isinstance(item, dict)]
            records_field = payload.get("records")
            if isinstance(records_field, list):
                return [item for item in records_field if isinstance(item, dict)]
        return []

    def _aggregate_data_gov_records(self, records: list[dict[str, Any]]) -> list[StationObservation]:
        groups: dict[str, dict[str, Any]] = {}
        pol_map = {
            "PM2.5": "pm25",
            "PM10": "pm10",
            "NO2": "no2",
            "SO2": "so2",
            "OZONE": "o3",
            "CO": "co",
        }
        for rec in records:
            row = {_norm_key(k): v for k, v in rec.items()}
            station = str(_first_of(row, ("station", "station_name", "station_id"), "unknown")).strip()
            ts = str(_first_of(row, ("last_update", "timestamp", "observed_at"), "")).strip()
            key = station
            if key not in groups:
                groups[key] = {
                    "station_id": station,
                    "station_name": station,
                    "latitude": _to_float(_first_of(row, ("latitude", "lat")), 0.0),
                    "longitude": _to_float(_first_of(row, ("longitude", "lon")), 0.0),
                    "pm25": None,
                    "pm10": None,
                    "no2": None,
                    "so2": None,
                    "o3": None,
                    "co": None,
                    "timestamp": ts,
                    "humidity": 55.0,
                    "temperature": 28.0,
                    "wind_speed": 2.5,
                    "wind_direction": 180.0,
                }
            if ts and (not groups[key]["timestamp"] or ts > str(groups[key]["timestamp"])):
                groups[key]["timestamp"] = ts
            pol_id = str(_first_of(row, ("pollutant_id",), "")).upper().strip()
            pol_avg = _to_float(_first_of(row, ("pollutant_avg", "avg_value", "avg")), default=-1.0)
            normalized_pol = pol_map.get(pol_id)
            if normalized_pol and pol_avg >= 0:
                # Data.gov CPCB datasets sometimes report CO on a different scale than mg/m3 (e.g., ug/m3-like).
                # Heuristic: values >10 are unlikely to be mg/m3 in ambient air; downscale to mg/m3.
                if normalized_pol == "co" and pol_avg > 10:
                    pol_avg = pol_avg / 1000.0
                groups[key][normalized_pol] = pol_avg

        out: list[StationObservation] = []
        for group in groups.values():
            present = [float(group[p]) for p in ("pm25", "pm10", "no2", "so2", "o3", "co") if group[p] is not None]
            if not present:
                continue
            base = sum(present) / len(present)
            defaults = {
                "pm25": max(20.0, min(300.0, base)),
                "pm10": max(30.0, min(400.0, base * 1.5)),
                "no2": max(10.0, min(200.0, base * 0.5)),
                "so2": max(5.0, min(120.0, base * 0.3)),
                "o3": max(10.0, min(180.0, base * 0.6)),
                "co": max(0.5, min(6.0, base / 100)),
            }
            for pollutant in ("pm25", "pm10", "no2", "so2", "o3", "co"):
                if group[pollutant] is None:
                    group[pollutant] = defaults[pollutant]
            normalized = _normalize_record(group, source="cpcb_api")
            if normalized:
                out.append(normalized)
        return out
