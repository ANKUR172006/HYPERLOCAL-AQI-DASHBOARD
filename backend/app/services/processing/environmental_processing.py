from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import median


def align_to_hour(ts: datetime) -> datetime:
    base = ts.astimezone(timezone.utc)
    return base.replace(minute=0, second=0, microsecond=0)


@dataclass
class PollutionVector:
    pm25: float | None
    pm10: float | None
    no2: float | None
    so2: float | None
    co: float | None
    o3: float | None
    nh3: float | None


def validate_pollution(vec: PollutionVector) -> PollutionVector:
    def clamp(value: float | None, lo: float, hi: float) -> float | None:
        if value is None:
            return None
        return max(lo, min(hi, float(value)))

    return PollutionVector(
        pm25=clamp(vec.pm25, 0.0, 500.0),
        pm10=clamp(vec.pm10, 0.0, 600.0),
        no2=clamp(vec.no2, 0.0, 1000.0),
        so2=clamp(vec.so2, 0.0, 2000.0),
        co=clamp(vec.co, 0.0, 50.0),
        o3=clamp(vec.o3, 0.0, 1000.0),
        nh3=clamp(vec.nh3, 0.0, 1000.0),
    )


def remove_outliers(values: list[float]) -> list[float]:
    if len(values) < 4:
        return values
    med = median(values)
    deviations = [abs(v - med) for v in values]
    mad = median(deviations) or 1.0
    low = med - 4 * mad
    high = med + 4 * mad
    return [v for v in values if low <= v <= high]


def fill_missing_with_median(values: list[float | None]) -> list[float]:
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return [0.0 for _ in values]
    med = median(clean)
    return [float(v) if v is not None else float(med) for v in values]
