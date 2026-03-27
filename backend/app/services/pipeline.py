from __future__ import annotations

import logging
import math
import os
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import (
    AqiSnapshot,
    City,
    CleanMeasurement,
    CrisisEvent,
    ForecastSnapshot,
    PollutionReading,
    RawMeasurement,
    Station,
    Ward,
)
from app.services.cpcb_source import CpcbSource, StationObservation
from app.services.disaster_engine import DisasterEngineService
from app.services.environmental_ingestion_service import EnvironmentalIngestionService
from app.services.processing.environmental_processing import align_to_hour

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


AQI_BREAKPOINTS = {
    # Use continuous float ranges (no gaps) to avoid "fall through -> 500" for non-integer concentrations.
    # Units: PM/NO2/SO2/O3 in ug/m3, CO in mg/m3.
    "pm25": [(0, 30, 0, 50), (30, 60, 51, 100), (60, 90, 101, 200), (90, 120, 201, 300), (120, 250, 301, 400), (250, 350, 401, 500)],
    "pm10": [(0, 50, 0, 50), (50, 100, 51, 100), (100, 250, 101, 200), (250, 350, 201, 300), (350, 430, 301, 400), (430, 500, 401, 500)],
    "no2": [(0, 40, 0, 50), (40, 80, 51, 100), (80, 180, 101, 200), (180, 280, 201, 300), (280, 400, 301, 400), (400, 1000, 401, 500)],
    "so2": [(0, 40, 0, 50), (40, 80, 51, 100), (80, 380, 101, 200), (380, 800, 201, 300), (800, 1600, 301, 400), (1600, 2000, 401, 500)],
    "o3": [(0, 50, 0, 50), (50, 100, 51, 100), (100, 168, 101, 200), (168, 208, 201, 300), (208, 748, 301, 400), (748, 1000, 401, 500)],
    "co": [(0, 1.0, 0, 50), (1.0, 2.0, 51, 100), (2.0, 10, 101, 200), (10, 17, 201, 300), (17, 34, 301, 400), (34, 50, 401, 500)],
}


def calc_sub_index(concentration: float, pollutant: str) -> int:
    # Breakpoints are monotonic and continuous, so use inclusive upper bound and
    # inclusive lower bound only for the first segment.
    for idx, (bp_lo, bp_hi, i_lo, i_hi) in enumerate(AQI_BREAKPOINTS[pollutant]):
        lo_ok = concentration >= bp_lo if idx == 0 else concentration > bp_lo
        if lo_ok and concentration <= bp_hi:
            idx = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (concentration - bp_lo) + i_lo
            return max(0, min(500, round(idx)))
    return 500


def aqi_category(aqi_value: int) -> str:
    if aqi_value <= 50:
        return "Good"
    if aqi_value <= 100:
        return "Satisfactory"
    if aqi_value <= 200:
        return "Moderate"
    if aqi_value <= 300:
        return "Poor"
    if aqi_value <= 400:
        return "Very Poor"
    return "Severe"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _station_aqi_from_observation(station: StationObservation) -> int:
    if getattr(station, "official_aqi", None) is not None:
        return int(max(0, min(500, round(float(station.official_aqi)))))
    pollutant_indices = {
        "PM2.5": calc_sub_index(float(station.pm25), "pm25"),
        "PM10": calc_sub_index(float(station.pm10), "pm10"),
        "NO2": calc_sub_index(float(station.no2), "no2"),
        "SO2": calc_sub_index(float(station.so2), "so2"),
        "O3": calc_sub_index(float(station.o3), "o3"),
        "CO": calc_sub_index(float(station.co), "co"),
    }
    primary = max(pollutant_indices, key=pollutant_indices.get)
    return int(pollutant_indices[primary])


def _select_station_items(
    target_lat: float,
    target_lon: float,
    stations: list[StationObservation],
    limit: int = 5,
    radius_km: float | None = None,
) -> list[tuple[float, StationObservation]]:
    radius = float(radius_km if radius_km is not None else (getattr(settings, "idw_radius_km", 0.0) or 0.0))
    items: list[tuple[float, StationObservation]] = []
    for station in stations:
        dist = _haversine_km(target_lat, target_lon, station.latitude, station.longitude)
        if radius > 0 and dist > radius:
            continue
        items.append((dist, station))
    items.sort(key=lambda x: x[0])
    return items[: max(1, limit)]


def _weighted_station_aqi(target_lat: float, target_lon: float, stations: list[StationObservation]) -> float | None:
    items = _select_station_items(target_lat, target_lon, stations, limit=4, radius_km=25.0)
    if not items:
        return None
    if items[0][0] <= 1e-6:
        return float(_station_aqi_from_observation(items[0][1]))
    power = max(3.0, float(getattr(settings, "idw_power", 2.0) or 2.0))
    weighted_sum = 0.0
    total_weight = 0.0
    for dist, station in items:
        weight = 1.0 / ((max(dist, 0.05) ** power) + 0.0001)
        weighted_sum += weight * _station_aqi_from_observation(station)
        total_weight += weight
    return (weighted_sum / total_weight) if total_weight else None


def _stabilize_aqi_against_stations(
    estimated_aqi: int,
    nearest_station_aqi: float | None,
    weighted_station_aqi: float | None,
    nearest_station_distance_km: float | None,
) -> int:
    estimated = int(max(0, min(500, estimated_aqi)))
    if nearest_station_aqi is None:
        return estimated
    nearest = float(nearest_station_aqi)
    weighted = float(weighted_station_aqi if weighted_station_aqi is not None else nearest)
    nearest_dist = float(nearest_station_distance_km if nearest_station_distance_km is not None else 999.0)

    if nearest_dist <= 1.2:
        return int(round(nearest))

    if nearest_dist <= 3:
        slack = 12
        blended = round((nearest * 0.82) + (weighted * 0.15) + (estimated * 0.03))
    elif nearest_dist <= 8:
        slack = 18
        blended = round((nearest * 0.70) + (weighted * 0.22) + (estimated * 0.08))
    else:
        slack = 25
        blended = round((nearest * 0.58) + (weighted * 0.30) + (estimated * 0.12))

    lower = max(0, math.floor(min(nearest, weighted) - slack))
    upper = min(500, math.ceil(max(nearest, weighted) + slack))
    return int(max(lower, min(upper, blended)))


def _build_ward_centroids() -> dict[str, tuple[float, float]]:
    # 5x5 grid across the Delhi boundary bbox so interpolation spans the full city outline.
    lat_start, lon_start = 28.45, 77.02
    lat_step, lon_step = 0.055, 0.07
    try:
        boundary = json.loads(Path(settings.delhi_boundary_geojson_path).read_text(encoding="utf-8"))
        min_lon = min_lat = float("inf")
        max_lon = max_lat = float("-inf")

        def walk(coords):
            nonlocal min_lon, min_lat, max_lon, max_lat
            if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
                lon, lat = float(coords[0]), float(coords[1])
                min_lon = min(min_lon, lon)
                min_lat = min(min_lat, lat)
                max_lon = max(max_lon, lon)
                max_lat = max(max_lat, lat)
                return
            if isinstance(coords, (list, tuple)):
                for c in coords:
                    walk(c)

        for feat in boundary.get("features", []) or []:
            geom = (feat or {}).get("geometry") or {}
            walk(geom.get("coordinates"))

        if min_lon != float("inf"):
            lon_step = (max_lon - min_lon) / 5.0
            lat_step = (max_lat - min_lat) / 5.0
            lon_start = min_lon + lon_step / 2.0
            lat_start = min_lat + lat_step / 2.0
    except Exception:
        pass
    coords: dict[str, tuple[float, float]] = {}
    idx = 1
    for r in range(5):
        for c in range(5):
            coords[f"DEL_WARD_{idx:03d}"] = (lat_start + r * lat_step, lon_start + c * lon_step)
            idx += 1
    return coords


WARD_CENTROIDS = _build_ward_centroids()

_POLLUTANT_ALIASES: dict[str, str] = {
    "PM25": "PM25",
    "PM2_5": "PM25",
    "PM2.5": "PM25",
    "PM_25": "PM25",
    "PM10": "PM10",
    "PM_10": "PM10",
    "NO2": "NO2",
    "SO2": "SO2",
    "O3": "O3",
    "OZONE": "O3",
    "CO": "CO",
}

_POLLUTANT_BOUNDS: dict[str, tuple[float, float]] = {
    "PM25": (0.0, 1000.0),
    "PM10": (0.0, 2000.0),
    "NO2": (0.0, 2000.0),
    "SO2": (0.0, 4000.0),
    "O3": (0.0, 2000.0),
    "CO": (0.0, 100.0),  # mg/m3
}


@dataclass
class WardObservation:
    ward_id: str
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
    source: str
    nearest_station_aqi: float | None = None
    weighted_station_aqi: float | None = None
    nearest_station_distance_km: float | None = None


class PipelineService:
    def __init__(self, db: Session):
        self.db = db

    def _dialect_name(self) -> str:
        return str(self.db.get_bind().dialect.name)

    def _insert(self, table):
        if self._dialect_name() == "postgresql":
            return pg_insert(table)
        return sqlite_insert(table)

    def _norm_pollutant_id(self, pollutant_id: str) -> str:
        key = str(pollutant_id or "").strip().upper().replace(" ", "").replace("-", "_")
        return _POLLUTANT_ALIASES.get(key, key)

    def _qa_clean_one(self, raw: RawMeasurement) -> tuple[str, float | None, dict]:
        pollutant = self._norm_pollutant_id(raw.pollutant_id)
        flags: dict[str, object] = {}
        value = float(raw.value)
        unit = (raw.unit or "").strip().lower()

        if unit in {"µg/m3", "ug/m3", "ug/m^3", "µg/m^3"} and pollutant == "CO":
            flags["unit_converted"] = "ugm3_to_mgm3"
            value = value / 1000.0
            unit = "mg/m3"
        elif unit in {"mg/m3", "mg/m^3"} and pollutant in {"PM25", "PM10", "NO2", "SO2", "O3"}:
            flags["unit_converted"] = "mgm3_to_ugm3"
            value = value * 1000.0
            unit = "ug/m3"

        lo, hi = _POLLUTANT_BOUNDS.get(pollutant, (0.0, float("inf")))
        if value < lo or value > hi:
            return "REJECTED", None, {"reason": "out_of_bounds", "pollutant": pollutant, "bounds": [lo, hi], "unit": unit}

        return "ACCEPTED", value, {"pollutant": pollutant, "unit": unit, **flags}

    def _bulk_insert_ignore(self, model, values: list[dict]) -> None:
        if not values:
            return
        stmt = self._insert(model.__table__).values(values)
        if self._dialect_name() == "postgresql":
            stmt = stmt.on_conflict_do_nothing()
        else:
            stmt = stmt.prefix_with("OR IGNORE")
        self.db.execute(stmt)

    def _bulk_upsert_measurements(self, model, values: list[dict]) -> None:
        if not values:
            return
        stmt = self._insert(model.__table__).values(values)
        conflict = ["station_code", "ts_slot_utc", "pollutant_id"]

        if model.__tablename__ == "raw_measurements":
            update_cols = ["value", "unit", "source", "raw_json", "created_at_utc"]
        elif model.__tablename__ == "clean_measurements":
            update_cols = ["raw_value", "clean_value", "unit", "qa_status", "qa_flags", "source", "created_at_utc"]
        else:
            self._bulk_insert_ignore(model, values)
            return

        stmt = stmt.on_conflict_do_update(
            index_elements=conflict,
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        self.db.execute(stmt)

    def bootstrap_city_and_wards(self) -> None:
        city = self.db.get(City, "DELHI")
        if city is None:
            city = City(city_id="DELHI", city_name="Delhi", state_name="Delhi", timezone="Asia/Kolkata")
            self.db.add(city)
            for idx in range(1, 26):
                ward_id = f"DEL_WARD_{idx:03d}"
                centroid = WARD_CENTROIDS.get(ward_id, (28.6139, 77.2090))
                self.db.add(
                    Ward(
                        ward_id=ward_id,
                        city_id="DELHI",
                        ward_name=f"Ward {idx}",
                        population=50000 + idx * 250,
                        sensitive_sites_count=2 + (idx % 4),
                        centroid_lat=float(centroid[0]),
                        centroid_lon=float(centroid[1]),
                    )
                )
            self.db.commit()

    def run_full_pipeline(self) -> None:
        ts_slot = align_to_hour(now_utc())
        wards = self.db.scalars(select(Ward).order_by(Ward.ward_id)).all()
        if not wards:
            self.bootstrap_city_and_wards()
            wards = self.db.scalars(select(Ward).order_by(Ward.ward_id)).all()

        stations = self.ingest(ts_slot)
        self.qa_clean(ts_slot)
        clean_vectors = self.load_clean_station_vectors(ts_slot)
        cleaned = self._cleaning_validation_layer(clean_vectors) if clean_vectors else self._cleaning_validation_layer(stations)
        interpolated = self.interpolate_wards(ts_slot, cleaned, wards)
        snapshots = self.compute_aqi(ts_slot, interpolated)
        self.forecast(ts_slot, interpolated, snapshots)
        crisis = self.detect_crises(ts_slot, interpolated, snapshots)
        DisasterEngineService(self.db).assess_city(
            ts_slot=ts_slot,
            wards=wards,
            rows_by_ward={row.ward_id: row for row in interpolated},
            snapshots=snapshots,
        )
        self._early_warning_layer(crisis)
        in_pytest = os.getenv("PYTEST_CURRENT_TEST") is not None
        if settings.enable_extended_ingestion and settings.external_apis_enabled and stations and not in_pytest:
            nearest = stations[0]
            try:
                EnvironmentalIngestionService(self.db).ingest_for_coordinates(nearest.latitude, nearest.longitude)
            except Exception:
                # Never break core AQI pipeline when auxiliary external feeds fail.
                logger.exception("Extended environmental ingestion failed; core pipeline will continue")
        self.db.commit()

    def ingest(self, ts_slot: datetime) -> list[StationObservation]:
        rows = self._data_ingestion_layer()
        raw_values: list[dict] = []

        authoritative = any((r.source or "").strip().lower() == "cpcb_api" for r in rows)
        cached = any((r.source or "").startswith("cpcb_db_cache") for r in rows)
        for row in rows:
            code = (row.station_id or row.station_name or "").strip() or "unknown"
            station = self.db.scalars(select(Station).where(Station.station_code == code)).first()
            if station is None:
                station = Station(
                    station_code=code,
                    station_name=row.station_name or code,
                    city="",
                    state="",
                    latitude=row.latitude,
                    longitude=row.longitude,
                    geom_wkt=f"POINT({row.longitude} {row.latitude})",
                    source="CPCB",
                )
                self.db.add(station)
            else:
                station.station_name = row.station_name or station.station_name
                station.latitude = row.latitude
                station.longitude = row.longitude
                station.geom_wkt = f"POINT({row.longitude} {row.latitude})"
                station.updated_at_utc = now_utc()
                self.db.add(station)

            source = row.source or "CPCB"
            raw_values.extend(
                [
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "PM25",
                        "value": float(row.pm25),
                        "unit": "ug/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "PM10",
                        "value": float(row.pm10),
                        "unit": "ug/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "NO2",
                        "value": float(row.no2),
                        "unit": "ug/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "SO2",
                        "value": float(row.so2),
                        "unit": "ug/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "O3",
                        "value": float(row.o3),
                        "unit": "ug/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                    {
                        "station_code": code,
                        "ts_slot_utc": ts_slot,
                        "pollutant_id": "CO",
                        "value": float(row.co),
                        "unit": "mg/m3",
                        "source": source,
                        "raw_json": {"station_name": row.station_name, "source": source},
                    },
                ]
            )

        # If we have live API rows, drop fallback rows for this ts_slot so we don't "mix" file/synthetic
        # with real-time data within the same hour (this was a major source of sudden city-wide jumps).
        try:
            station_count = len({(r.station_id or "").strip() for r in rows if (r.station_id or "").strip()})
        except Exception:
            station_count = 0

        if authoritative and station_count >= 3:
            self.db.execute(
                delete(RawMeasurement).where(
                    RawMeasurement.ts_slot_utc == ts_slot,
                    RawMeasurement.source != "cpcb_api",
                )
            )
        elif cached and station_count >= 3:
            # Cache-based fallback should still be preferred over the bundled sample file/synthetic
            # within the same hour slot.
            self.db.execute(
                delete(RawMeasurement).where(
                    RawMeasurement.ts_slot_utc == ts_slot,
                    RawMeasurement.source.in_(["cpcb_file", "cpcb_synthetic_fallback"]),
                )
            )

        # Upsert so repeated cycles within the same ts_slot refresh values.
        self._bulk_upsert_measurements(RawMeasurement, raw_values)
        return rows

    def qa_clean(self, ts_slot: datetime) -> None:
        raw_rows = self.db.scalars(select(RawMeasurement).where(RawMeasurement.ts_slot_utc == ts_slot)).all()
        if not raw_rows:
            return
        rejected_reasons: Counter[str] = Counter()
        clean_values: list[dict] = []
        for raw in raw_rows:
            status, cleaned_value, flags = self._qa_clean_one(raw)
            if status != "ACCEPTED":
                rejected_reasons[str(flags.get("reason") or "unknown")] += 1
            clean_values.append(
                {
                    "station_code": raw.station_code,
                    "ts_slot_utc": ts_slot,
                    "pollutant_id": self._norm_pollutant_id(raw.pollutant_id),
                    "raw_value": float(raw.value),
                    "clean_value": float(cleaned_value) if cleaned_value is not None else None,
                    "unit": str(flags.get("unit") or raw.unit or ""),
                    "qa_status": status,
                    "qa_flags": flags,
                    "source": raw.source,
                }
            )
        # Upsert so QA results can be refreshed when raw values change.
        self._bulk_upsert_measurements(CleanMeasurement, clean_values)
        accepted = sum(1 for v in clean_values if v["qa_status"] == "ACCEPTED")
        logger.info(
            "QA batch ts_slot=%s raw=%s clean=%s rejected=%s reasons=%s",
            ts_slot.isoformat(),
            len(raw_rows),
            accepted,
            len(raw_rows) - accepted,
            dict(rejected_reasons),
        )

    def load_clean_station_vectors(self, ts_slot: datetime) -> list[StationObservation]:
        base_stmt = select(CleanMeasurement).where(
            CleanMeasurement.ts_slot_utc == ts_slot,
            CleanMeasurement.qa_status == "ACCEPTED",
        )

        # Live runs can accumulate mixed sources inside the same hour slot:
        # e.g. a first run falls back to bundled `cpcb_file` stations, then a later run succeeds with `cpcb_api`.
        # For "live Delhi" demos we prefer the real CPCB API feed when it's present.
        has_api = (
            self.db.execute(
                select(func.count())
                .select_from(CleanMeasurement)
                .where(
                    CleanMeasurement.ts_slot_utc == ts_slot,
                    CleanMeasurement.qa_status == "ACCEPTED",
                    CleanMeasurement.source == "cpcb_api",
                )
            ).scalar_one()
            > 0
        )

        preferred_sources: set[str] | None = {"cpcb_api"} if has_api else None
        accepted = self.db.scalars(
            base_stmt.where(CleanMeasurement.source.in_(preferred_sources)) if preferred_sources else base_stmt
        ).all()

        by_station: dict[str, dict[str, float]] = defaultdict(dict)
        for row in accepted:
            if row.clean_value is None:
                continue
            by_station[row.station_code][self._norm_pollutant_id(row.pollutant_id)] = float(row.clean_value)

        station_rows = self.db.scalars(select(Station).where(Station.station_code.in_(list(by_station.keys())))).all()
        station_meta = {s.station_code: s for s in station_rows}

        out: list[StationObservation] = []
        for code, pols in by_station.items():
            if not all(k in pols for k in ("PM25", "PM10", "NO2", "SO2", "O3", "CO")):
                continue
            meta = station_meta.get(code)
            if meta is None:
                continue
            out.append(
                StationObservation(
                    station_id=code,
                    station_name=meta.station_name,
                    latitude=float(meta.latitude),
                    longitude=float(meta.longitude),
                    pm25=float(pols["PM25"]),
                    pm10=float(pols["PM10"]),
                    no2=float(pols["NO2"]),
                    so2=float(pols["SO2"]),
                    o3=float(pols["O3"]),
                    co=float(pols["CO"]),
                    wind_speed=2.5,
                    wind_direction=180.0,
                    humidity=55.0,
                    temperature=28.0,
                    observed_at_utc=ts_slot,
                    source="qa_clean:cpcb_api" if has_api else "qa_clean",
                )
            )
        if preferred_sources and not out:
            # If API rows exist but don't produce any complete station vectors, fall back to any accepted source.
            accepted = self.db.scalars(base_stmt).all()
            by_station = defaultdict(dict)
            for row in accepted:
                if row.clean_value is None:
                    continue
                by_station[row.station_code][self._norm_pollutant_id(row.pollutant_id)] = float(row.clean_value)
            station_rows = self.db.scalars(select(Station).where(Station.station_code.in_(list(by_station.keys())))).all()
            station_meta = {s.station_code: s for s in station_rows}
            out = []
            for code, pols in by_station.items():
                if not all(k in pols for k in ("PM25", "PM10", "NO2", "SO2", "O3", "CO")):
                    continue
                meta = station_meta.get(code)
                if meta is None:
                    continue
                out.append(
                    StationObservation(
                        station_id=code,
                        station_name=meta.station_name,
                        latitude=float(meta.latitude),
                        longitude=float(meta.longitude),
                        pm25=float(pols["PM25"]),
                        pm10=float(pols["PM10"]),
                        no2=float(pols["NO2"]),
                        so2=float(pols["SO2"]),
                        o3=float(pols["O3"]),
                        co=float(pols["CO"]),
                        wind_speed=2.5,
                        wind_direction=180.0,
                        humidity=55.0,
                        temperature=28.0,
                        observed_at_utc=ts_slot,
                        source="qa_clean",
                    )
                )
        return out

    def interpolate_wards(self, ts_slot: datetime, stations: list[StationObservation], wards: list[Ward]) -> list[WardObservation]:
        _ = ts_slot
        return self._spatial_interpolation_idw_layer(stations, wards)

    def compute_aqi(self, ts_slot: datetime, rows: list[WardObservation]) -> list[AqiSnapshot]:
        if not rows:
            return []
        ward_ids = [r.ward_id for r in rows]
        existing_rows = self.db.scalars(
            select(AqiSnapshot).where(AqiSnapshot.ts_utc == ts_slot, AqiSnapshot.ward_id.in_(ward_ids))
        ).all()
        existing_by_ward = {s.ward_id: s for s in existing_rows}
        snapshots: list[AqiSnapshot] = []
        for row in rows:
            snapshot = existing_by_ward.get(row.ward_id)
            pollutant_indices = {
                "PM2.5": calc_sub_index(row.pm25, "pm25"),
                "PM10": calc_sub_index(row.pm10, "pm10"),
                "NO2": calc_sub_index(row.no2, "no2"),
                "SO2": calc_sub_index(row.so2, "so2"),
                "O3": calc_sub_index(row.o3, "o3"),
                "CO": calc_sub_index(row.co, "co"),
            }
            primary_pollutant = max(pollutant_indices, key=pollutant_indices.get)
            aqi_value = pollutant_indices[primary_pollutant]
            total = sum(pollutant_indices.values()) or 1
            contribution = {key: round((value / total) * 100, 2) for key, value in pollutant_indices.items()}
            contribution["raw"] = {
                "pm25": round(row.pm25, 2),
                "pm10": round(row.pm10, 2),
                "no2": round(row.no2, 2),
                "so2": round(row.so2, 2),
                "o3": round(row.o3, 2),
                "co": round(row.co, 2),
                "wind_speed": round(row.wind_speed, 3),
                "wind_direction": round(row.wind_direction, 3),
                "humidity": round(row.humidity, 3),
                "temperature": round(row.temperature, 3),
                "source": row.source,
                "ts_slot_utc": ts_slot.isoformat(),
            }
            quality_score = 0.93 if row.source.startswith("cpcb") or row.source.startswith("qa_") else 0.72
            if snapshot is None:
                snapshot = AqiSnapshot(ts_utc=ts_slot, ward_id=row.ward_id)
                self.db.add(snapshot)
            snapshot.aqi_value = aqi_value
            snapshot.aqi_category = aqi_category(aqi_value)
            snapshot.primary_pollutant = primary_pollutant
            snapshot.pmi_value = round(aqi_value * 0.95, 2)
            snapshot.contribution_json = contribution
            snapshot.data_quality_score = quality_score
            snapshot.data_quality_flag = "OK" if quality_score >= 0.9 else "DEGRADED"
            snapshots.append(snapshot)
        return snapshots

    def forecast(self, ts_slot: datetime, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> None:
        if not rows or not snapshots:
            return
        mode = (settings.forecast_model or "auto").strip().lower()

        predictions: dict[str, dict[int, int]] | None = None
        model_name = "naive"
        model_version = "naive-v1"

        if mode in {"xgb", "xgboost"} or (mode == "auto" and settings.enable_xgboost_forecasting):
            model_name = "xgboost"
            model_version = "xgb-h-v4"
            predictions = self._xgboost_predict(rows, snapshots)

        if predictions is None and model_name == "xgboost":
            model_name = "momentum-fallback"
            model_version = "fallback-v2"
            predictions = self._momentum_fallback(rows)

        if predictions is None and mode in {"seasonal_naive"}:
            model_name = "seasonal-naive"
            model_version = "snaive-v1"
            predictions = {}
            for s in snapshots:
                base = self.db.scalars(
                    select(AqiSnapshot).where(AqiSnapshot.ward_id == s.ward_id, AqiSnapshot.ts_utc == ts_slot - timedelta(hours=24))
                ).first()
                val = int(base.aqi_value) if base else int(s.aqi_value)
                predictions[s.ward_id] = {1: val, 2: val, 3: val}

        if predictions is None and mode in {"momentum"}:
            model_name = "momentum-fallback"
            model_version = "fallback-v1"
            predictions = self._momentum_fallback(rows)

        if predictions is None:
            predictions = {s.ward_id: {1: int(s.aqi_value), 2: int(s.aqi_value), 3: int(s.aqi_value)} for s in snapshots}
        else:
            momentum_reference = self._momentum_fallback(rows)
            baseline_by_ward = {s.ward_id: int(s.aqi_value) for s in snapshots}
            stabilized: dict[str, dict[int, int]] = {}
            for ward_id, horizon_map in predictions.items():
                baseline = int(baseline_by_ward.get(ward_id, 0))
                stabilized[ward_id] = {}
                for horizon, pred in horizon_map.items():
                    raw_pred = int(round(float(pred)))
                    if model_name == "xgboost":
                        momentum_pred = int(momentum_reference.get(ward_id, {}).get(int(horizon), raw_pred))
                        blended = int(round((0.45 * raw_pred) + (0.55 * momentum_pred)))
                    else:
                        blended = raw_pred
                    max_delta = 28 * int(horizon)
                    lower = max(0, baseline - max_delta)
                    upper = min(500, baseline + max_delta)
                    stabilized_value = max(lower, min(upper, blended))
                    prev_horizon = stabilized[ward_id].get(int(horizon) - 1, baseline)
                    step_limit = 22
                    step_lower = max(0, prev_horizon - step_limit)
                    step_upper = min(500, prev_horizon + step_limit)
                    stabilized[ward_id][int(horizon)] = max(step_lower, min(step_upper, stabilized_value))
            predictions = stabilized

        ward_ids = list(predictions.keys())
        existing = self.db.scalars(
            select(ForecastSnapshot).where(ForecastSnapshot.ts_generated_utc == ts_slot, ForecastSnapshot.ward_id.in_(ward_ids))
        ).all()
        by_key = {(f.ward_id, int(f.horizon_hour)): f for f in existing}

        for ward_id, horizon_map in predictions.items():
            for horizon, aqi_pred in horizon_map.items():
                key = (ward_id, int(horizon))
                f = by_key.get(key)
                if f is None:
                    f = ForecastSnapshot(ts_generated_utc=ts_slot, ward_id=ward_id, horizon_hour=int(horizon))
                    self.db.add(f)
                    by_key[key] = f
                aqi_pred = max(0, min(500, int(round(float(aqi_pred)))))
                f.target_ts_utc = ts_slot + timedelta(hours=int(horizon))
                f.aqi_pred = int(aqi_pred)
                f.aqi_category_pred = aqi_category(int(aqi_pred))
                f.model_name = model_name
                f.model_version = model_version
                f.data_quality_score = 0.94 if model_name == "xgboost" else 0.78
                f.disaster_mode = int(aqi_pred) > 300

    def detect_crises(self, ts_slot: datetime, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> list[CrisisEvent]:
        events = self._hybrid_crisis_detection_layer(rows, snapshots)
        if not events:
            return []
        ward_ids = [e.ward_id for e in events]
        existing_rows = self.db.execute(
            select(CrisisEvent.ward_id, CrisisEvent.level).where(
                CrisisEvent.started_at_utc == ts_slot, CrisisEvent.ward_id.in_(ward_ids)
            )
        ).all()
        existing = {(str(wid), str(level)) for wid, level in existing_rows}
        out: list[CrisisEvent] = []
        for e in events:
            if (e.ward_id, e.level) in existing:
                continue
            e.started_at_utc = ts_slot
            self.db.add(e)
            out.append(e)
        return out

    def _data_ingestion_layer(self) -> list[StationObservation]:
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
        rows = source.load()
        if rows:
            return rows

        # If live CPCB fetch fails (timeouts / intermittent outages), avoid generating unstable random data.
        # Prefer a "stale but real" fallback from the DB, then the bundled sample file, and only then synthetic.
        db_cached = self._load_recent_station_cache(
            max_age_hours=max(1, int(settings.cpcb_db_cache_max_age_hours)),
            max_stations=30,
            require_live_api=bool(settings.live_data_strict),
        )
        if db_cached:
            return db_cached

        if settings.live_data_strict and (settings.cpcb_source_mode or "").strip().lower() in {"api", "hybrid"}:
            logger.warning("Live strict mode enabled and CPCB API unavailable; refusing file/synthetic fallback rows")
            return []

        if (settings.cpcb_source_mode or "").strip().lower() in {"api", "hybrid"} and settings.cpcb_file_path:
            file_source = CpcbSource(
                mode="file",
                file_path=settings.cpcb_file_path,
                api_url="",
                api_key=None,
            )
            file_rows = file_source.load()
            if file_rows:
                return file_rows

        return self._synthetic_cpcb_fallback()

    def _load_recent_station_cache(
        self,
        max_age_hours: int = 6,
        max_stations: int = 30,
        require_live_api: bool = False,
    ) -> list[StationObservation]:
        """
        "Stale but real" fallback when live CPCB fetch fails.

        We intentionally cache from `clean_measurements` (not `pollution_readings`) because the
        pipeline always populates QA-cleaned station pollutant rows, and older prototypes didn't
        persist `pollution_readings` consistently. This prevents sudden jumps to the bundled
        sample CSV (or synthetic data) during intermittent API outages or when the backend restarts.
        """

        cutoff = now_utc() - timedelta(hours=int(max_age_hours))
        required = {"PM25", "PM10", "NO2", "SO2", "O3", "CO"}

        def _collect(measure_rows) -> dict[str, dict[str, object]]:
            by_station: dict[str, dict[str, object]] = {}
            for station_code, ts_slot, pollutant_id, clean_value, raw_value, src, station_name, lat, lon in measure_rows:
                code = str(station_code or "").strip()
                if not code:
                    continue
                pol = self._norm_pollutant_id(str(pollutant_id or ""))
                if pol not in required:
                    continue
                value = clean_value if clean_value is not None else raw_value
                if value is None:
                    continue

                entry = by_station.setdefault(
                    code,
                    {
                        "station_name": str(station_name or code),
                        "lat": float(lat),
                        "lon": float(lon),
                        "ts": ts_slot,
                        "src": str(src or ""),
                        "pols": {},
                    },
                )

                # First-seen rows are newest due to ORDER BY desc.
                pols: dict[str, float] = entry["pols"]  # type: ignore[assignment]
                if pol in pols:
                    continue
                try:
                    pols[pol] = float(value)
                except Exception:
                    continue

                if len(pols) == len(required) and len(by_station) >= max_stations:
                    break
            return by_station

        base_stmt = (
            select(
                CleanMeasurement.station_code,
                CleanMeasurement.ts_slot_utc,
                CleanMeasurement.pollutant_id,
                CleanMeasurement.clean_value,
                CleanMeasurement.raw_value,
                CleanMeasurement.source,
                Station.station_name,
                Station.latitude,
                Station.longitude,
            )
            .join(Station, Station.station_code == CleanMeasurement.station_code)
            .where(CleanMeasurement.ts_slot_utc >= cutoff, CleanMeasurement.qa_status == "ACCEPTED")
            .order_by(CleanMeasurement.ts_slot_utc.desc())
            .limit(max_stations * 80)
        )

        # Prefer cached values that originated from live CPCB API to avoid jumps to the bundled sample file
        # after transient outages. If we don't have enough "api-ish" stations, fall back to any accepted rows.
        prefer_api = self.db.execute(base_stmt.where(CleanMeasurement.source.like("%api%"))).all()
        by_station = _collect(prefer_api)
        if not require_live_api and len(by_station) < max(3, min(max_stations, 8)):
            all_rows = self.db.execute(base_stmt).all()
            by_station = _collect(all_rows)

        out: list[StationObservation] = []
        for code, entry in by_station.items():
            pols = entry.get("pols") or {}
            if not all(k in pols for k in required):
                continue
            ts = entry.get("ts") or now_utc()
            if isinstance(ts, datetime) and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            source_suffix = str(entry.get("src") or "").strip() or "unknown"
            while source_suffix.startswith("cpcb_db_cache:"):
                source_suffix = source_suffix[len("cpcb_db_cache:") :]
            out.append(
                StationObservation(
                    station_id=code,
                    station_name=str(entry.get("station_name") or code),
                    latitude=float(entry.get("lat") or 0.0),
                    longitude=float(entry.get("lon") or 0.0),
                    pm25=float(pols["PM25"]),
                    pm10=float(pols["PM10"]),
                    no2=float(pols["NO2"]),
                    so2=float(pols["SO2"]),
                    o3=float(pols["O3"]),
                    co=float(pols["CO"]),
                    wind_speed=2.5,
                    wind_direction=180.0,
                    humidity=55.0,
                    temperature=28.0,
                    observed_at_utc=ts if isinstance(ts, datetime) else now_utc(),
                    source=f"cpcb_db_cache:{source_suffix}",
                )
            )

        # Prefer the most recent stations first (already in insertion order by newest rows),
        # but keep the list bounded.
        return out[:max_stations]

    def _cleaning_validation_layer(self, rows: list[StationObservation]) -> list[StationObservation]:
        cleaned: list[StationObservation] = []
        for row in rows:
            row.pm25 = max(0.0, min(500.0, row.pm25))
            row.pm10 = max(0.0, min(600.0, row.pm10))
            row.no2 = max(0.0, min(1000.0, row.no2))
            row.so2 = max(0.0, min(2000.0, row.so2))
            row.o3 = max(0.0, min(1000.0, row.o3))
            row.co = max(0.0, min(50.0, row.co))
            row.wind_speed = max(0.0, min(30.0, row.wind_speed))
            row.wind_direction = row.wind_direction % 360
            row.humidity = max(5.0, min(100.0, row.humidity))
            row.temperature = max(-10.0, min(55.0, row.temperature))
            cleaned.append(row)
        return cleaned

    def _spatial_interpolation_idw_layer(self, rows: list[StationObservation], wards: list[Ward]) -> list[WardObservation]:
        if not rows:
            return []

        idw_power = float(settings.idw_power or 2.0)
        nearest_n = int(settings.idw_nearest_n or 0)
        radius_km = float(settings.idw_radius_km or 0.0)

        def _select_stations(target_lat: float, target_lon: float) -> list[tuple[float, StationObservation]]:
            items: list[tuple[float, StationObservation]] = []
            for station in rows:
                dist = _haversine_km(target_lat, target_lon, station.latitude, station.longitude)
                if radius_km > 0 and dist > radius_km:
                    continue
                items.append((dist, station))
            items.sort(key=lambda x: x[0])
            if nearest_n and nearest_n > 0:
                items = items[:nearest_n]
            return items

        def _idw_value(target_lat: float, target_lon: float, attr: str, p: float) -> float:
            items = _select_stations(target_lat, target_lon)
            if not items:
                return 0.0
            if items[0][0] <= 1e-6:
                return float(getattr(items[0][1], attr))
            weighted_sum = 0.0
            total_weight = 0.0
            eps = 0.0001
            for dist, station in items:
                w = 1.0 / ((dist**p) + eps)
                weighted_sum += w * float(getattr(station, attr))
                total_weight += w
            return weighted_sum / total_weight if total_weight else 0.0

        if (settings.spatial_method or "idw").strip().lower() == "idw_cv" and len(rows) >= 5:
            candidate_p = [1.0, 1.5, 2.0, 2.5, 3.0]
            candidate_n = [n for n in (3, 5, 7) if n < len(rows)]

            best_p = idw_power
            best_n = nearest_n if nearest_n else min(5, len(rows) - 1)
            best_rmse = float("inf")
            for p in candidate_p:
                for n in candidate_n:
                    prev_n = nearest_n
                    try:
                        # Temporarily override for scoring.
                        nearest_n = n
                        se = 0.0
                        for i, target in enumerate(rows):
                            others = rows[:i] + rows[i + 1 :]
                            # Use a local selection with others only.
                            items = []
                            for s in others:
                                dist = _haversine_km(target.latitude, target.longitude, s.latitude, s.longitude)
                                if radius_km > 0 and dist > radius_km:
                                    continue
                                items.append((dist, s))
                            items.sort(key=lambda x: x[0])
                            items = items[:n]
                            if not items:
                                pred = 0.0
                            elif items[0][0] <= 1e-6:
                                pred = float(getattr(items[0][1], "pm25"))
                            else:
                                wsum = 0.0
                                wtot = 0.0
                                eps = 0.0001
                                for dist, s in items:
                                    w = 1.0 / ((dist**p) + eps)
                                    wsum += w * float(getattr(s, "pm25"))
                                    wtot += w
                                pred = wsum / wtot if wtot else 0.0
                            se += (pred - float(target.pm25)) ** 2
                        rmse = math.sqrt(se / max(1, len(rows)))
                        if rmse < best_rmse:
                            best_rmse = rmse
                            best_p = p
                            best_n = n
                    finally:
                        nearest_n = prev_n

            idw_power = best_p
            nearest_n = best_n
            logger.info("IDW CV selected power=%s nearest_n=%s rmse_pm25=%s", idw_power, nearest_n, round(best_rmse, 3))

        # Clamp IDW output to observed station range — prevents interpolation from
        # producing values higher than any real station (avoids false "Severe" upgrades).
        max_pm25 = max((s.pm25 for s in rows), default=500.0)
        max_pm10 = max((s.pm10 for s in rows), default=500.0)
        max_no2  = max((s.no2  for s in rows), default=500.0)
        max_so2  = max((s.so2  for s in rows), default=500.0)
        max_o3   = max((s.o3   for s in rows), default=500.0)
        max_co   = max((s.co   for s in rows), default=50.0)

        observations: list[WardObservation] = []
        for ward in wards:
            if ward.centroid_lat is not None and ward.centroid_lon is not None:
                lat, lon = (float(ward.centroid_lat), float(ward.centroid_lon))
            else:
                # Only use the demo Delhi grid for the seeded DEL_WARD_* wards.
                # For other cities, missing centroids should be resolved by GeoJSON import or dynamic grid persistence.
                if str(ward.ward_id).startswith("DEL_WARD_"):
                    lat, lon = WARD_CENTROIDS.get(ward.ward_id, (28.6139, 77.2090))
                else:
                    continue
            nearest_items = _select_station_items(lat, lon, rows, limit=5, radius_km=25.0)
            nearest_station_distance_km = float(nearest_items[0][0]) if nearest_items else None
            nearest_station_aqi = float(_station_aqi_from_observation(nearest_items[0][1])) if nearest_items else None
            weighted_station_aqi = _weighted_station_aqi(lat, lon, rows)
            observations.append(
                WardObservation(
                    ward_id=ward.ward_id,
                    pm25=min(_idw_value(lat, lon, "pm25", idw_power), max_pm25),
                    pm10=min(_idw_value(lat, lon, "pm10", idw_power), max_pm10),
                    no2=min(_idw_value(lat, lon, "no2",  idw_power), max_no2),
                    so2=min(_idw_value(lat, lon, "so2",  idw_power), max_so2),
                    o3=min(_idw_value(lat, lon, "o3",   idw_power), max_o3),
                    co=min(_idw_value(lat, lon, "co",   idw_power), max_co),
                    wind_speed=_idw_value(lat, lon, "wind_speed", idw_power),
                    wind_direction=_idw_value(lat, lon, "wind_direction", idw_power),
                    humidity=_idw_value(lat, lon, "humidity", idw_power),
                    temperature=_idw_value(lat, lon, "temperature", idw_power),
                    source=rows[0].source,
                    nearest_station_aqi=nearest_station_aqi,
                    weighted_station_aqi=weighted_station_aqi,
                    nearest_station_distance_km=nearest_station_distance_km,
                )
            )
        return observations

    def _aqi_calculation_layer(self, rows: list[WardObservation]) -> list[AqiSnapshot]:
        snapshots: list[AqiSnapshot] = []
        for row in rows:
            pollutant_indices = {
                "PM2.5": calc_sub_index(row.pm25, "pm25"),
                "PM10": calc_sub_index(row.pm10, "pm10"),
                "NO2": calc_sub_index(row.no2, "no2"),
                "SO2": calc_sub_index(row.so2, "so2"),
                "O3": calc_sub_index(row.o3, "o3"),
                "CO": calc_sub_index(row.co, "co"),
            }
            primary_pollutant = max(pollutant_indices, key=pollutant_indices.get)
            estimated_aqi = pollutant_indices[primary_pollutant]
            aqi_value = _stabilize_aqi_against_stations(
                estimated_aqi=estimated_aqi,
                nearest_station_aqi=row.nearest_station_aqi,
                weighted_station_aqi=row.weighted_station_aqi,
                nearest_station_distance_km=row.nearest_station_distance_km,
            )
            total = sum(pollutant_indices.values()) or 1
            contribution = {key: round((value / total) * 100, 2) for key, value in pollutant_indices.items()}
            contribution["raw"] = {
                "pm25": round(row.pm25, 2),
                "pm10": round(row.pm10, 2),
                "no2": round(row.no2, 2),
                "so2": round(row.so2, 2),
                "o3": round(row.o3, 2),
                "co": round(row.co, 2),
                "source": row.source,
                "estimated_aqi_pre_anchor": int(estimated_aqi),
                "nearest_station_aqi": round(float(row.nearest_station_aqi), 2) if row.nearest_station_aqi is not None else None,
                "weighted_station_aqi": round(float(row.weighted_station_aqi), 2) if row.weighted_station_aqi is not None else None,
                "nearest_station_distance_km": round(float(row.nearest_station_distance_km), 2) if row.nearest_station_distance_km is not None else None,
            }
            quality_score = 0.93 if row.source.startswith("cpcb") else 0.72
            snapshot = AqiSnapshot(
                ward_id=row.ward_id,
                aqi_value=aqi_value,
                aqi_category=aqi_category(aqi_value),
                primary_pollutant=primary_pollutant,
                pmi_value=round(aqi_value * 0.95, 2),
                contribution_json=contribution,
                data_quality_score=quality_score,
                data_quality_flag="OK" if quality_score >= 0.9 else "DEGRADED",
            )
            self.db.add(snapshot)
            snapshots.append(snapshot)
        return snapshots

    def _ai_forecasting_xgboost_layer(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> None:
        if not settings.enable_xgboost_forecasting:
            model_name = "momentum-fallback"
            model_version = "fallback-v1"
            predictions = self._momentum_fallback(rows)
        else:
            model_name = "xgboost"
            model_version = "xgb-h-v2"
            predictions = self._xgboost_predict(rows, snapshots)
            if predictions is None:
                model_name = "xgboost-fallback"
                model_version = "fallback-v1"
                predictions = self._momentum_fallback(rows)

        for ward_id, horizon_map in predictions.items():
            for horizon, aqi_pred in horizon_map.items():
                self.db.add(
                    ForecastSnapshot(
                        ward_id=ward_id,
                        horizon_hour=horizon,
                        target_ts_utc=now_utc() + timedelta(hours=horizon),
                        aqi_pred=aqi_pred,
                        aqi_category_pred=aqi_category(aqi_pred),
                        model_name=model_name,
                        model_version=model_version,
                        data_quality_score=0.94 if model_name == "xgboost" else 0.78,
                        disaster_mode=aqi_pred > 300,
                    )
                )

    def _hybrid_crisis_detection_layer(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> list[CrisisEvent]:
        events: list[CrisisEvent] = []
        snapshot_by_ward = {s.ward_id: s for s in snapshots}
        for row in rows:
            current = snapshot_by_ward.get(row.ward_id)
            if current is None:
                continue
            previous = self.db.scalars(
                select(AqiSnapshot).where(AqiSnapshot.ward_id == row.ward_id).order_by(AqiSnapshot.ts_utc.desc()).offset(1)
            ).first()

            reasons: list[str] = []
            anomaly_score = min(1.0, current.aqi_value / 500)
            raw = current.contribution_json.get("raw", {})
            if current.aqi_value > 300:
                reasons.append("AQI > 300")
            if previous:
                prev_raw = previous.contribution_json.get("raw", {})
                prev_pm25 = float(prev_raw.get("pm25", raw.get("pm25", 0.0)) or 0.0)
                if prev_pm25 > 0:
                    spike_pct = ((float(raw.get("pm25", 0.0)) - prev_pm25) / prev_pm25) * 100
                    if spike_pct > 40:
                        reasons.append(f"PM2.5 spike {spike_pct:.1f}%")
                        anomaly_score = max(anomaly_score, min(1.0, abs(spike_pct) / 100))
                if current.aqi_value - previous.aqi_value > 40:
                    reasons.append("Rapid AQI increase")

            if reasons:
                level = "SEVERE" if current.aqi_value > 350 else "HIGH"
                event = CrisisEvent(
                    ward_id=row.ward_id,
                    level=level,
                    trigger_reason="; ".join(reasons),
                    anomaly_score=anomaly_score,
                    disaster_mode=current.aqi_value > 300,
                )
                events.append(event)
        return events

    def _early_warning_layer(self, events: list[CrisisEvent]) -> None:
        for event in events:
            if event.level == "SEVERE" and not event.trigger_reason.startswith("EarlyWarning:"):
                event.trigger_reason = f"EarlyWarning: {event.trigger_reason}"

    def _xgboost_predict(self, rows: list[WardObservation], snapshots: list[AqiSnapshot]) -> dict[str, dict[int, int]] | None:
        try:
            from xgboost import XGBRegressor  # type: ignore
        except Exception:
            return None

        history = self.db.scalars(select(AqiSnapshot).order_by(AqiSnapshot.ts_utc.desc()).limit(1200)).all()
        by_ward: dict[str, list[AqiSnapshot]] = {}
        for item in history[::-1]:
            by_ward.setdefault(item.ward_id, []).append(item)

        train_x: list[list[float]] = []
        train_y: dict[int, list[float]] = {1: [], 2: [], 3: []}
        eligible_wards = 0
        strongest_history = 0
        for ward_history in by_ward.values():
            if len(ward_history) < 8:
                continue
            eligible_wards += 1
            strongest_history = max(strongest_history, len(ward_history))
            for idx in range(3, len(ward_history) - 3):
                current = ward_history[idx]
                lag1 = ward_history[idx - 1]
                lag2 = ward_history[idx - 2]
                lag3 = ward_history[idx - 3]
                raw = current.contribution_json.get("raw", {})
                ts = current.ts_utc or now_utc()
                hour = float(ts.hour)
                dow = float(ts.weekday())
                train_x.append(
                    [
                        float(current.aqi_value),
                        float(lag1.aqi_value),
                        float(lag2.aqi_value),
                        float(lag3.aqi_value),
                        float(current.aqi_value - lag1.aqi_value),
                        float(lag1.aqi_value - lag2.aqi_value),
                        float(raw.get("pm25", 0.0)),
                        float(raw.get("pm10", 0.0)),
                        float(raw.get("no2", 0.0)),
                        float(raw.get("so2", 0.0)),
                        float(raw.get("o3", 0.0)),
                        float(raw.get("co", 0.0)),
                        float(raw.get("wind_speed", 2.5) or 2.5),
                        float(raw.get("wind_direction", 180.0) or 180.0),
                        float(raw.get("humidity", 55.0) or 55.0),
                        float(raw.get("temperature", 28.0) or 28.0),
                        math.sin((hour / 24.0) * 2 * math.pi),
                        math.cos((hour / 24.0) * 2 * math.pi),
                        math.sin((dow / 7.0) * 2 * math.pi),
                        math.cos((dow / 7.0) * 2 * math.pi),
                    ]
                )
                train_y[1].append(float(ward_history[idx + 1].aqi_value))
                train_y[2].append(float(ward_history[idx + 2].aqi_value))
                train_y[3].append(float(ward_history[idx + 3].aqi_value))

        if eligible_wards < 5 or strongest_history < 16 or len(train_x) < 120:
            return None

        models: dict[int, XGBRegressor] = {}
        for horizon in (1, 2, 3):
            model = XGBRegressor(
                n_estimators=180,
                max_depth=4,
                learning_rate=0.04,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=4,
                reg_alpha=0.35,
                reg_lambda=1.8,
                objective="reg:squarederror",
                random_state=42 + horizon,
                n_jobs=1,
            )
            model.fit(train_x, train_y[horizon])
            models[horizon] = model

        output: dict[str, dict[int, int]] = {}
        snap_by_ward = {s.ward_id: s for s in snapshots}
        for row in rows:
            current_snapshot = snap_by_ward.get(row.ward_id)
            hist = by_ward.get(row.ward_id, [])
            lag1 = float(hist[-1].aqi_value) if len(hist) >= 1 else float(current_snapshot.aqi_value if current_snapshot else 120.0)
            lag2 = float(hist[-2].aqi_value) if len(hist) >= 2 else lag1
            lag3 = float(hist[-3].aqi_value) if len(hist) >= 3 else lag2
            current_aqi = float(current_snapshot.aqi_value if current_snapshot else lag1)
            ts = current_snapshot.ts_utc if current_snapshot and current_snapshot.ts_utc else now_utc()
            hour = float(ts.hour)
            dow = float(ts.weekday())
            vec = [[
                current_aqi,
                lag1,
                lag2,
                lag3,
                current_aqi - lag1,
                lag1 - lag2,
                row.pm25,
                row.pm10,
                row.no2,
                row.so2,
                row.o3,
                row.co,
                row.wind_speed,
                row.wind_direction,
                row.humidity,
                row.temperature,
                math.sin((hour / 24.0) * 2 * math.pi),
                math.cos((hour / 24.0) * 2 * math.pi),
                math.sin((dow / 7.0) * 2 * math.pi),
                math.cos((dow / 7.0) * 2 * math.pi),
            ]]
            output[row.ward_id] = {
                1: max(0, min(500, round(float(models[1].predict(vec)[0])))),
                2: max(0, min(500, round(float(models[2].predict(vec)[0])))),
                3: max(0, min(500, round(float(models[3].predict(vec)[0])))),
            }
        return output

    def _momentum_fallback(self, rows: list[WardObservation]) -> dict[str, dict[int, int]]:
        output: dict[str, dict[int, int]] = {}
        for row in rows:
            current = self.db.scalars(
                select(AqiSnapshot).where(AqiSnapshot.ward_id == row.ward_id).order_by(AqiSnapshot.ts_utc.desc())
            ).first()
            baseline = current.aqi_value if current else 120
            momentum = round((row.pm25 / 4 + row.pm10 / 10 + row.no2 / 6) / 10)
            output[row.ward_id] = {
                1: max(0, min(500, baseline + momentum)),
                2: max(0, min(500, baseline + 2 * momentum)),
                3: max(0, min(500, baseline + 3 * momentum)),
            }
        return output

    def _synthetic_cpcb_fallback(self) -> list[StationObservation]:
        # Keep synthetic fallback stable within the same hour (avoid wild changes on refresh).
        seed = int(now_utc().strftime("%Y%m%d%H"))
        rng = Random(seed)
        rows: list[StationObservation] = []
        for idx in range(1, 9):
            lat = 28.45 + (idx % 4) * 0.07 + rng.uniform(-0.01, 0.01)
            lon = 77.02 + (idx // 4) * 0.14 + rng.uniform(-0.01, 0.01)
            rows.append(
                StationObservation(
                    station_id=f"CPCB_SYN_{idx:02d}",
                    station_name=f"Synthetic Station {idx}",
                    latitude=lat,
                    longitude=lon,
                    pm25=max(5.0, rng.uniform(40.0, 210.0)),
                    pm10=max(10.0, rng.uniform(70.0, 300.0)),
                    no2=max(5.0, rng.uniform(20.0, 190.0)),
                    so2=max(3.0, rng.uniform(8.0, 100.0)),
                    o3=max(5.0, rng.uniform(30.0, 220.0)),
                    co=max(0.2, rng.uniform(0.8, 6.5)),
                    wind_speed=rng.uniform(0.8, 6.5),
                    wind_direction=rng.uniform(0, 360),
                    humidity=rng.uniform(25, 90),
                    temperature=rng.uniform(15, 42),
                    observed_at_utc=now_utc(),
                    source="cpcb_synthetic_fallback",
                )
            )
        return rows
