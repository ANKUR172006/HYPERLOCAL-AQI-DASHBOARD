from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class City(Base):
    __tablename__ = "cities"
    city_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    city_name: Mapped[str] = mapped_column(String(100), nullable=False)
    state_name: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[str] = mapped_column(String(50), nullable=False)


class Ward(Base):
    __tablename__ = "wards"
    ward_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    city_id: Mapped[str] = mapped_column(ForeignKey("cities.city_id"), index=True)
    ward_name: Mapped[str] = mapped_column(String(120), nullable=False)
    population: Mapped[int] = mapped_column(Integer, default=0)
    sensitive_sites_count: Mapped[int] = mapped_column(Integer, default=0)


class AqiSnapshot(Base):
    __tablename__ = "aqi_snapshot"
    aqi_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.ward_id"), index=True)
    aqi_value: Mapped[int] = mapped_column(Integer, nullable=False)
    aqi_category: Mapped[str] = mapped_column(String(30), nullable=False)
    primary_pollutant: Mapped[str] = mapped_column(String(20), nullable=False)
    pmi_value: Mapped[float] = mapped_column(Float, default=0.0)
    contribution_json: Mapped[dict] = mapped_column(JSON, default=dict)
    calc_rule_version: Mapped[str] = mapped_column(String(32), default="cpcb-v1")
    data_quality_score: Mapped[float] = mapped_column(Float, default=0.9)
    data_quality_flag: Mapped[str] = mapped_column(String(20), default="OK")


class ForecastSnapshot(Base):
    __tablename__ = "forecast_snapshot"
    forecast_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts_generated_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    target_ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.ward_id"), index=True)
    horizon_hour: Mapped[int] = mapped_column(Integer, index=True)
    aqi_pred: Mapped[int] = mapped_column(Integer, nullable=False)
    aqi_category_pred: Mapped[str] = mapped_column(String(30), nullable=False)
    model_name: Mapped[str] = mapped_column(String(64), default="xgboost")
    model_version: Mapped[str] = mapped_column(String(32), default="xgb-h-v1")
    data_quality_score: Mapped[float] = mapped_column(Float, default=0.9)
    disaster_mode: Mapped[bool] = mapped_column(Boolean, default=False)


class CrisisEvent(Base):
    __tablename__ = "crisis_events"
    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.ward_id"), index=True)
    level: Mapped[str] = mapped_column(String(20), index=True)
    trigger_reason: Mapped[str] = mapped_column(Text)
    anomaly_score: Mapped[float] = mapped_column(Float, default=0.0)
    started_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    ended_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disaster_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    rule_version: Mapped[str] = mapped_column(String(32), default="crisis-v1")


class PolicyRecommendation(Base):
    __tablename__ = "policy_recommendations"
    recommendation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.ward_id"), index=True)
    risk_rank_city: Mapped[int] = mapped_column(Integer, index=True)
    actions_json: Mapped[list] = mapped_column(JSON, default=list)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.8)


class Explanation(Base):
    __tablename__ = "explanations"
    explain_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    ward_id: Mapped[str] = mapped_column(ForeignKey("wards.ward_id"), index=True)
    citizen_text: Mapped[str] = mapped_column(Text)
    gov_text: Mapped[str] = mapped_column(Text)
    factors_json: Mapped[dict] = mapped_column(JSON, default=dict)
    explain_version: Mapped[str] = mapped_column(String(32), default="explain-v1")


class Station(Base):
    __tablename__ = "stations"
    station_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_code: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    station_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom_wkt: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(50), default="CPCB")
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class PollutionReading(Base):
    __tablename__ = "pollution_readings"
    reading_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.station_id"), index=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    pm25: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm10: Mapped[float | None] = mapped_column(Float, nullable=True)
    no2: Mapped[float | None] = mapped_column(Float, nullable=True)
    so2: Mapped[float | None] = mapped_column(Float, nullable=True)
    co: Mapped[float | None] = mapped_column(Float, nullable=True)
    o3: Mapped[float | None] = mapped_column(Float, nullable=True)
    nh3: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict)
    data_quality_score: Mapped[float] = mapped_column(Float, default=0.9)
    source: Mapped[str] = mapped_column(String(50), default="CPCB")


class WeatherData(Base):
    __tablename__ = "weather_data"
    weather_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.station_id"), nullable=True, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    temperature_2m: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_10m: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_direction_10m: Mapped[float | None] = mapped_column(Float, nullable=True)
    relativehumidity_2m: Mapped[float | None] = mapped_column(Float, nullable=True)
    surface_pressure: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(50), default="OPEN_METEO")


class SatelliteData(Base):
    __tablename__ = "satellite_data"
    satellite_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    date_utc: Mapped[str] = mapped_column(String(32), index=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    image_reference: Mapped[str] = mapped_column(Text, default="")
    aerosol_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    imagery_metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(50), default="NASA")


class LocationMetadata(Base):
    __tablename__ = "location_metadata"
    location_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    city: Mapped[str] = mapped_column(String(120), default="")
    district: Mapped[str] = mapped_column(String(120), default="")
    locality: Mapped[str] = mapped_column(String(120), default="")
    ward: Mapped[str] = mapped_column(String(120), default="")
    sublocality: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    country: Mapped[str] = mapped_column(String(120), default="")
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(50), default="NOMINATIM")
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)


class Complaint(Base):
    __tablename__ = "complaints"
    complaint_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    city_id: Mapped[str] = mapped_column(String(64), index=True, default="DELHI")
    ward_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), index=True, default="OPEN")
    votes: Mapped[int] = mapped_column(Integer, default=0)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
    updated_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=now_utc)
