from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import LocationMetadata, PollutionReading, SatelliteData, Station, WeatherData
from app.services.collectors.location_collector import LocationCollector
from app.services.collectors.satellite_collector import SatelliteCollector
from app.services.collectors.weather_collector import WeatherCollector
from app.services.cpcb_source import CpcbSource, StationObservation
from app.services.processing.environmental_processing import PollutionVector, align_to_hour, validate_pollution
from app.services.source_detection import detect_pollution_sources


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _preferred_city_name(*candidates: str) -> str:
    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text:
            continue
        if text.lower() in {"unknown city", "unknown", "na", "n/a"}:
            continue
        return text
    return "WCTM College, Gurugram"


def _preferred_ward_name(*candidates: str) -> str:
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text:
            return text
    return "WCTM College campus"


@dataclass
class UnifiedEnvironmentalRecord:
    location: dict[str, Any]
    pollution: dict[str, Any]
    weather: dict[str, Any]
    satellite: dict[str, Any]
    fires: dict[str, Any]


class EnvironmentalIngestionService:
    def __init__(self, db: Session):
        self.db = db
        self.weather = WeatherCollector()
        self.satellite = SatelliteCollector()
        self.location = LocationCollector()
        from app.services.collectors.firms_collector import FirmsCollector

        self.firms = FirmsCollector()

    def ingest_for_coordinates(self, lat: float, lon: float) -> UnifiedEnvironmentalRecord:
        stations = self._load_cpcb()
        nearest = self._nearest_station(stations, lat, lon)
        weather = self.weather.fetch(lat, lon)
        sat = self.satellite.fetch(lat, lon, _utc_now().date().isoformat())
        fires = self.firms.fetch_nearby(lat=lat, lon=lon, radius_km=10.0, days=1)
        loc = self.location.reverse_geocode(lat, lon)
        pollution_vec = validate_pollution(
            PollutionVector(
                pm25=nearest.pm25 if nearest else None,
                pm10=nearest.pm10 if nearest else None,
                no2=nearest.no2 if nearest else None,
                so2=nearest.so2 if nearest else None,
                co=nearest.co if nearest else None,
                o3=nearest.o3 if nearest else None,
                nh3=None,
            )
        )

        station_row = self._upsert_station(nearest, loc)
        city_name = _preferred_city_name(
            loc.city,
            loc.district,
            (nearest.station_name.split(",")[1].strip() if nearest and "," in nearest.station_name else ""),
        )
        reading_ts = align_to_hour(nearest.observed_at_utc if nearest else _utc_now())
        if station_row:
            self._insert_pollution_reading(station_row.station_id, pollution_vec, reading_ts, nearest)
            self._insert_weather(station_row.station_id, weather)
        else:
            self._insert_weather(None, weather)
        self._insert_satellite(sat)
        self._insert_location(loc)
        self.db.commit()

        ward_name = _preferred_ward_name(loc.ward, loc.sublocality, loc.locality)
        det = detect_pollution_sources(
            pollutants={
                "pm25": pollution_vec.pm25,
                "pm10": pollution_vec.pm10,
                "no2": pollution_vec.no2,
                "so2": pollution_vec.so2,
                "o3": pollution_vec.o3,
                "co": pollution_vec.co,
            },
            weather={
                "wind_speed": weather.wind_speed_10m,
                "humidity": weather.relativehumidity_2m,
                "temperature": weather.temperature_2m,
            },
            ts_utc=reading_ts,
            satellite=None,
            fire_nearby=bool(fires.get("fireNearby")),
            history=None,
        )
        return UnifiedEnvironmentalRecord(
            location={
                "city": city_name,
                "state": loc.state,
                "district": loc.district,
                "locality": loc.locality,
                "ward": ward_name,
                "coordinates": {"lat": round(lat, 6), "lon": round(lon, 6)},
            },
            pollution={
                "PM25": pollution_vec.pm25,
                "PM10": pollution_vec.pm10,
                "NO2": pollution_vec.no2,
                "SO2": pollution_vec.so2,
                "CO": pollution_vec.co,
                "O3": pollution_vec.o3,
                "NH3": pollution_vec.nh3,
                "station_name": nearest.station_name if nearest else "",
                "timestamp": reading_ts.isoformat(),
                "source_detection": {
                    "primary": det.primary,
                    "secondary": det.secondary,
                    "reasons": det.reasons,
                    "trend": det.trend,
                    "fires": fires.get("fires", []),
                    "fireNearby": bool(fires.get("fireNearby")),
                },
            },
            weather={
                "temperature": weather.temperature_2m,
                "wind_speed": weather.wind_speed_10m,
                "humidity": weather.relativehumidity_2m,
                "wind_direction": weather.wind_direction_10m,
                "surface_pressure": weather.surface_pressure,
                "timestamp": weather.ts_utc.isoformat(),
                "source": weather.source,
            },
            satellite={
                "aerosol_index": sat.aerosol_index,
                "image_reference": sat.image_reference,
                "timestamp": sat.ts_utc.isoformat(),
                "metadata": sat.imagery_metadata,
                "source": sat.source,
            },
            fires=fires,
        )

    def latest_for_coordinates(self, lat: float, lon: float) -> UnifiedEnvironmentalRecord:
        recent_loc = self._nearest_recent_location(lat, lon)
        recent_sat = self._nearest_recent_satellite(lat, lon)
        recent_weather = self._nearest_recent_weather(lat, lon)
        recent_pollution = self._nearest_recent_pollution(lat, lon)
        if self._should_refresh(lat, lon, recent_loc, recent_weather, recent_sat):
            return self.ingest_for_coordinates(lat, lon)
        station_name = ""
        if recent_pollution:
            station = self.db.get(Station, recent_pollution.station_id)
            station_name = station.station_name if station else ""
        city_name = _preferred_city_name(
            recent_loc.city if recent_loc else "",
            recent_loc.district if recent_loc else "",
            recent_loc.locality if recent_loc else "",
        )
        fires = self.firms.fetch_nearby(lat=lat, lon=lon, radius_km=10.0, days=1)
        return UnifiedEnvironmentalRecord(
            location={
                "city": city_name,
                "state": recent_loc.state if recent_loc else "",
                "district": recent_loc.district if recent_loc else "",
                "locality": recent_loc.locality if recent_loc else "",
                "ward": _preferred_ward_name(
                    recent_loc.ward if recent_loc else "",
                    recent_loc.sublocality if recent_loc else "",
                    recent_loc.locality if recent_loc else "",
                ),
                "coordinates": {"lat": round(lat, 6), "lon": round(lon, 6)},
            },
            pollution={
                "PM25": recent_pollution.pm25 if recent_pollution else None,
                "PM10": recent_pollution.pm10 if recent_pollution else None,
                "NO2": recent_pollution.no2 if recent_pollution else None,
                "SO2": recent_pollution.so2 if recent_pollution else None,
                "CO": recent_pollution.co if recent_pollution else None,
                "O3": recent_pollution.o3 if recent_pollution else None,
                "NH3": recent_pollution.nh3 if recent_pollution else None,
                "station_name": station_name,
                "timestamp": recent_pollution.ts_utc.isoformat() if recent_pollution else None,
            },
            weather={
                "temperature": recent_weather.temperature_2m if recent_weather else None,
                "wind_speed": recent_weather.wind_speed_10m if recent_weather else None,
                "humidity": recent_weather.relativehumidity_2m if recent_weather else None,
                "wind_direction": recent_weather.wind_direction_10m if recent_weather else None,
                "surface_pressure": recent_weather.surface_pressure if recent_weather else None,
                "timestamp": recent_weather.ts_utc.isoformat() if recent_weather else None,
                "source": recent_weather.source if recent_weather else None,
            },
            satellite={
                "aerosol_index": recent_sat.aerosol_index if recent_sat else None,
                "image_reference": recent_sat.image_reference if recent_sat else "",
                "timestamp": recent_sat.ts_utc.isoformat() if recent_sat else None,
                "metadata": recent_sat.imagery_metadata_json if recent_sat else {},
                "source": recent_sat.source if recent_sat else None,
            },
            fires=fires,
        )

    def _nearest_recent_location(self, lat: float, lon: float) -> LocationMetadata | None:
        rows = self.db.scalars(select(LocationMetadata).order_by(LocationMetadata.ts_utc.desc()).limit(25)).all()
        if not rows:
            return None
        return min(rows, key=lambda row: _haversine_km(lat, lon, float(row.latitude), float(row.longitude)))

    def _nearest_recent_weather(self, lat: float, lon: float) -> WeatherData | None:
        rows = self.db.scalars(select(WeatherData).order_by(WeatherData.ts_utc.desc()).limit(25)).all()
        if not rows:
            return None
        return min(rows, key=lambda row: _haversine_km(lat, lon, float(row.latitude), float(row.longitude)))

    def _nearest_recent_satellite(self, lat: float, lon: float) -> SatelliteData | None:
        rows = self.db.scalars(select(SatelliteData).order_by(SatelliteData.ts_utc.desc()).limit(25)).all()
        if not rows:
            return None
        return min(rows, key=lambda row: _haversine_km(lat, lon, float(row.latitude), float(row.longitude)))

    def _nearest_recent_pollution(self, lat: float, lon: float) -> PollutionReading | None:
        rows = self.db.execute(
            select(PollutionReading, Station)
            .join(Station, Station.station_id == PollutionReading.station_id)
            .order_by(PollutionReading.ts_utc.desc())
            .limit(50)
        ).all()
        if not rows:
            return None
        best_reading, _ = min(
            rows,
            key=lambda item: _haversine_km(lat, lon, float(item[1].latitude), float(item[1].longitude)),
        )
        return best_reading

    def _should_refresh(
        self,
        lat: float,
        lon: float,
        loc: LocationMetadata | None,
        weather: WeatherData | None,
        sat: SatelliteData | None,
    ) -> bool:
        now = _utc_now()
        max_age = timedelta(hours=2)
        max_distance_km = 25.0

        if weather is None or sat is None or loc is None:
            return True
        weather_ts = _as_aware_utc(weather.ts_utc)
        sat_ts = _as_aware_utc(sat.ts_utc)
        loc_ts = _as_aware_utc(loc.ts_utc)
        if not weather_ts or not sat_ts or not loc_ts:
            return True
        if now - weather_ts > max_age or now - sat_ts > max_age or now - loc_ts > max_age:
            return True
        if _haversine_km(lat, lon, float(loc.latitude), float(loc.longitude)) > max_distance_km:
            return True
        if _haversine_km(lat, lon, float(weather.latitude), float(weather.longitude)) > max_distance_km:
            return True
        if _haversine_km(lat, lon, float(sat.latitude), float(sat.longitude)) > max_distance_km:
            return True
        return False

    def _load_cpcb(self) -> list[StationObservation]:
        source = CpcbSource(
            mode=settings.cpcb_source_mode,
            file_path=settings.cpcb_file_path,
            api_url=settings.cpcb_api_url,
            api_key=settings.cpcb_api_key,
            api_format=settings.cpcb_api_format,
            api_offset=settings.cpcb_api_offset,
            api_limit=settings.cpcb_api_limit,
            api_max_pages=settings.cpcb_api_max_pages,
            api_timeout_sec=settings.cpcb_api_timeout_sec,
            filter_state=settings.cpcb_filter_state,
            filter_city=settings.cpcb_filter_city,
        )
        return source.load()

    def _nearest_station(self, rows: list[StationObservation], lat: float, lon: float) -> StationObservation | None:
        if not rows:
            return None
        return min(rows, key=lambda r: _haversine_km(lat, lon, r.latitude, r.longitude))

    def _upsert_station(self, row: StationObservation | None, loc) -> Station | None:
        if row is None:
            return None
        code = row.station_id or row.station_name
        station = self.db.scalars(select(Station).where(Station.station_code == code)).first()
        if station is None:
            station = Station(
                station_code=code,
                station_name=row.station_name,
                city=loc.city,
                state=loc.state,
                latitude=row.latitude,
                longitude=row.longitude,
                geom_wkt=f"POINT({row.longitude} {row.latitude})",
                source="CPCB",
            )
            self.db.add(station)
            self.db.flush()
            return station
        changed = False
        if station.station_name != row.station_name:
            station.station_name = row.station_name
            changed = True
        if (loc.city or station.city) != station.city:
            station.city = loc.city or station.city
            changed = True
        if (loc.state or station.state) != station.state:
            station.state = loc.state or station.state
            changed = True
        if float(station.latitude) != float(row.latitude):
            station.latitude = row.latitude
            changed = True
        if float(station.longitude) != float(row.longitude):
            station.longitude = row.longitude
            changed = True
        geom_wkt = f"POINT({row.longitude} {row.latitude})"
        if station.geom_wkt != geom_wkt:
            station.geom_wkt = geom_wkt
            changed = True
        if changed:
            station.updated_at_utc = _utc_now()
            self.db.add(station)
        return station

    def _insert_pollution_reading(
        self, station_id: int, vec: PollutionVector, ts_utc: datetime, source_row: StationObservation | None
    ) -> None:
        reading = PollutionReading(
            station_id=station_id,
            ts_utc=ts_utc,
            pm25=vec.pm25,
            pm10=vec.pm10,
            no2=vec.no2,
            so2=vec.so2,
            co=vec.co,
            o3=vec.o3,
            nh3=vec.nh3,
            raw_json={
                "station_name": source_row.station_name if source_row else "",
                "timestamp": source_row.observed_at_utc.isoformat() if source_row else "",
                "source": source_row.source if source_row else "CPCB",
            },
            source="CPCB",
        )
        self.db.add(reading)

    def _insert_weather(self, station_id: int | None, weather) -> None:
        self.db.add(
            WeatherData(
                station_id=station_id,
                latitude=weather.latitude,
                longitude=weather.longitude,
                ts_utc=align_to_hour(weather.ts_utc),
                temperature_2m=weather.temperature_2m,
                wind_speed_10m=weather.wind_speed_10m,
                wind_direction_10m=weather.wind_direction_10m,
                relativehumidity_2m=weather.relativehumidity_2m,
                surface_pressure=weather.surface_pressure,
                source=weather.source,
            )
        )

    def _insert_satellite(self, sat) -> None:
        self.db.add(
            SatelliteData(
                latitude=sat.latitude,
                longitude=sat.longitude,
                date_utc=sat.date_utc,
                ts_utc=align_to_hour(sat.ts_utc),
                image_reference=sat.image_reference,
                aerosol_index=sat.aerosol_index,
                imagery_metadata_json=sat.imagery_metadata,
                source=sat.source,
            )
        )

    def _insert_location(self, loc) -> None:
        self.db.add(
            LocationMetadata(
                latitude=loc.latitude,
                longitude=loc.longitude,
                city=loc.city,
                district=loc.district,
                locality=loc.locality,
                ward=loc.ward,
                sublocality=loc.sublocality,
                state=loc.state,
                country=loc.country,
                raw_json=loc.raw,
                ts_utc=align_to_hour(loc.ts_utc),
                source=loc.source,
            )
        )
