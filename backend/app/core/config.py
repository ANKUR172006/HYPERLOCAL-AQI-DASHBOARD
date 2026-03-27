import os
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _backend_dir() -> Path:
    # backend/app/core/config.py -> backend/
    return Path(__file__).resolve().parents[2]


def _default_sqlite_db_url() -> str:
    render_disk = os.getenv("RENDER_DISK_PATH")
    if render_disk:
        db_path = Path(render_disk) / "aqi.db"
    # On Railway/Docker, writing into the image layer path can be restricted; prefer `/tmp`.
    elif os.getenv("RUNNING_IN_DOCKER") == "1":
        db_path = Path("/tmp/aqi.db")
    elif os.getenv("PYTEST_CURRENT_TEST") is not None:
        db_path = (_backend_dir() / "aqi_pytest.db").resolve()
    else:
        db_path = (_backend_dir() / "aqi.db").resolve()
    # SQLAlchemy expects forward slashes in SQLite file URLs on Windows.
    return f"sqlite:///{db_path.as_posix()}"


def _default_cpcb_file_path() -> str:
    return str((_backend_dir() / "data" / "cpcb_delhi_sample.csv").resolve())


def _default_delhi_boundary_geojson_path() -> str:
    return str((_backend_dir() / "data" / "Delhi_Boundary.geojson").resolve())

def _default_delhi_wards_geojson_path() -> str:
    return str((_backend_dir() / "data" / "Delhi_Wards.geojson").resolve())


def _default_india_districts_topojson_path() -> str:
    preferred = Path.home() / "Downloads" / "india-districts-2019-734.json"
    if preferred.exists():
        return str(preferred.resolve())
    return str((_backend_dir() / "data" / "india-districts-2019-734.json").resolve())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Hyperlocal AQI Intelligence System"
    app_env: str = "dev"
    app_version: str = "1.0.0"
    api_prefix: str = "/v1"

    database_url: str = Field(default_factory=_default_sqlite_db_url)
    postgres_postgis_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/aqi_postgis"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    enable_scheduler: bool = True
    # Default off: keeps startup fast and avoids flaky network calls.
    enable_extended_ingestion: bool = False
    # Default off: XGBoost training on every pipeline cycle can be slow on laptops.
    enable_xgboost_forecasting: bool = False
    # Default to bundled sample CSV to keep the prototype fast and deterministic.
    # Set `CPCB_SOURCE_MODE=api` (or `hybrid`) to enable live pulls.
    # `DATA_SOURCE_MODE` is accepted as an alias.
    cpcb_source_mode: str = Field(default="file", validation_alias=AliasChoices("CPCB_SOURCE_MODE", "DATA_SOURCE_MODE"))
    cpcb_file_path: str = Field(default_factory=_default_cpcb_file_path)
    cpcb_api_url: str = "/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"
    # Optional. If unset, live CPCB pulls may fail; the app will still work in `file` mode.
    cpcb_api_key: str | None = Field(default=None, validation_alias=AliasChoices("CPCB_API_KEY"))
    # CPCB "station counts" metadata (state/UT-level counts). Uses the same CPCB_API_KEY.
    cpcb_station_counts_api_url: str = "/resource/4933f0fd-158e-4098-ac0a-dfe69d5ff8c3"
    cpcb_api_format: str = "json"
    cpcb_api_offset: int = 0
    cpcb_api_limit: int = 10
    cpcb_api_max_pages: int = 2
    cpcb_api_timeout_sec: float = 5.0
    cpcb_filter_state: str = ""
    cpcb_filter_city: str = ""
    open_meteo_base_url: str = "https://api.open-meteo.com/v1/forecast"
    # Prefer the imagery endpoint (supports `cloud_score=true` JSON responses) for demo-friendly "satellite signal".
    nasa_earth_base_url: str = "https://api.nasa.gov/planetary/earth/imagery"
    nominatim_base_url: str = "https://nominatim.openstreetmap.org/reverse"
    nominatim_search_url: str = "https://nominatim.openstreetmap.org/search"
    # Optional. If unset, satellite data will be disabled (graceful fallback).
    nasa_api_key: str | None = Field(default=None, validation_alias=AliasChoices("NASA_API_KEY"))
    # NASA FIRMS (Fire Information for Resource Management System) map key.
    # Used to fetch fire hotspots (CSV) for a bounding box via the FIRMS API.
    firms_map_key: str | None = Field(default=None, validation_alias=AliasChoices("FIRMS_MAP_KEY", "NASA_FIRMS_MAP_KEY"))
    # Use the global FIRMS API base by default (works outside US/Canada).
    firms_base_url: str = "https://firms.modaps.eosdis.nasa.gov/api"
    # NASA can be slow intermittently; keep a slightly higher default timeout + retry.
    nasa_timeout_sec: float = 12.0
    nasa_max_retries: int = 2
    external_http_timeout_sec: float = 10.0
    external_http_max_retries: int = 3
    # Global kill-switch for all network calls (CPCB API, Open-Meteo, NASA, Nominatim).
    # Useful for safe offline demos.
    external_apis_enabled: bool = Field(default=True, validation_alias=AliasChoices("EXTERNAL_APIS_ENABLED"))
    # When enabled, "live" workflows should fail loudly instead of silently falling back to demo/file data.
    live_data_strict: bool = Field(default=False, validation_alias=AliasChoices("LIVE_DATA_STRICT"))

    citizen_rate_limit_per_minute: int = 120
    gov_jwt_secret: str = "change-me"
    gov_jwt_algorithm: str = "HS256"
    gov_token_exp_minutes: int = 60

    cache_ttl_current_sec: int = 60
    cache_ttl_forecast_sec: int = 180
    cache_ttl_explain_sec: int = 120
    cache_ttl_disaster_sec: int = 30
    pipeline_interval_minutes: int = Field(default=5, validation_alias=AliasChoices("PIPELINE_INTERVAL_MINUTES"))
    cpcb_db_cache_max_age_hours: int = Field(default=2, validation_alias=AliasChoices("CPCB_DB_CACHE_MAX_AGE_HOURS"))

    # Pipeline behavior switches
    spatial_method: str = Field(default="idw", validation_alias=AliasChoices("SPATIAL_METHOD"))
    idw_nearest_n: int = Field(default=0, validation_alias=AliasChoices("IDW_NEAREST_N"))
    idw_radius_km: float = Field(default=0.0, validation_alias=AliasChoices("IDW_RADIUS_KM"))
    idw_power: float = Field(default=2.0, validation_alias=AliasChoices("IDW_POWER"))
    forecast_model: str = Field(default="auto", validation_alias=AliasChoices("FORECAST_MODEL"))

    # Disaster engine thresholds
    disaster_recalc_minutes: int = Field(default=15, validation_alias=AliasChoices("DISASTER_RECALC_MINUTES"))
    disaster_fire_radius_km: float = Field(default=5.0, validation_alias=AliasChoices("DISASTER_FIRE_RADIUS_KM"))
    disaster_pollution_spike_pct: float = Field(default=25.0, validation_alias=AliasChoices("DISASTER_POLLUTION_SPIKE_PCT"))
    disaster_pollution_spike_aqi_delta: float = Field(default=35.0, validation_alias=AliasChoices("DISASTER_POLLUTION_SPIKE_AQI_DELTA"))
    disaster_extreme_aqi_threshold: int = Field(default=300, validation_alias=AliasChoices("DISASTER_EXTREME_AQI_THRESHOLD"))
    disaster_heatwave_temp_c: float = Field(default=40.0, validation_alias=AliasChoices("DISASTER_HEATWAVE_TEMP_C"))
    disaster_industrial_hazard_aqi_threshold: int = Field(default=220, validation_alias=AliasChoices("DISASTER_INDUSTRIAL_HAZARD_AQI_THRESHOLD"))

    # Optional GeoJSON overlays (for offline/demo use)
    delhi_boundary_geojson_path: str = Field(default_factory=_default_delhi_boundary_geojson_path)
    delhi_wards_geojson_path: str = Field(
        default_factory=_default_delhi_wards_geojson_path,
        validation_alias=AliasChoices("DELHI_WARDS_GEOJSON_PATH"),
    )
    india_districts_topojson_path: str = Field(
        default_factory=_default_india_districts_topojson_path,
        validation_alias=AliasChoices("INDIA_DISTRICTS_TOPOJSON_PATH"),
    )


settings = Settings()
