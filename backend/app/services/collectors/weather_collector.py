from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class WeatherSnapshot:
    latitude: float
    longitude: float
    ts_utc: datetime
    temperature_2m: float | None
    wind_speed_10m: float | None
    wind_direction_10m: float | None
    relativehumidity_2m: float | None
    surface_pressure: float | None
    source: str = "OPEN_METEO"


class WeatherCollector:
    def fetch(self, lat: float, lon: float) -> WeatherSnapshot:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m,relativehumidity_2m,surface_pressure",
            "forecast_days": 1,
            "timezone": "UTC",
        }
        try:
            payload = get_json_with_retry(settings.open_meteo_base_url, params=params)
            hourly = payload.get("hourly", {})
            times = hourly.get("time") or []
            ts = _utcnow()
            idx = 0
            if times:
                try:
                    parsed = []
                    now = _utcnow()
                    for i, item in enumerate(times):
                        try:
                            dt = datetime.fromisoformat(str(item)).replace(tzinfo=timezone.utc)
                            parsed.append((i, dt))
                        except ValueError:
                            continue
                    if parsed:
                        idx, ts = min(parsed, key=lambda item: abs((item[1] - now).total_seconds()))
                except ValueError:
                    ts = _utcnow()

            def pick(key: str) -> float | None:
                arr = hourly.get(key) or []
                if len(arr) > idx:
                    try:
                        return float(arr[idx])
                    except (TypeError, ValueError):
                        return None
                return None

            return WeatherSnapshot(
                latitude=lat,
                longitude=lon,
                ts_utc=ts,
                temperature_2m=pick("temperature_2m"),
                wind_speed_10m=pick("wind_speed_10m"),
                wind_direction_10m=pick("wind_direction_10m"),
                relativehumidity_2m=pick("relativehumidity_2m"),
                surface_pressure=pick("surface_pressure"),
            )
        except Exception:
            return WeatherSnapshot(
                latitude=lat,
                longitude=lon,
                ts_utc=_utcnow(),
                temperature_2m=None,
                wind_speed_10m=None,
                wind_direction_10m=None,
                relativehumidity_2m=None,
                surface_pressure=None,
            )
