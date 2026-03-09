from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Hyperlocal AQI Intelligence System"
    app_env: str = "dev"
    app_version: str = "1.0.0"
    api_prefix: str = "/v1"

    database_url: str = "sqlite:///./aqi.db"
    postgres_postgis_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/aqi_postgis"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    enable_scheduler: bool = True
    enable_extended_ingestion: bool = True
    cpcb_source_mode: str = "api"
    cpcb_file_path: str = "data/cpcb_delhi_sample.csv"
    cpcb_api_url: str = "/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"
    cpcb_api_key: str | None = "579b464db66ec23bdd00000198e9d1e526964f3a6cb6537f1dd9756d"
    cpcb_api_format: str = "json"
    cpcb_api_offset: int = 0
    cpcb_api_limit: int = 10
    cpcb_api_max_pages: int = 2
    cpcb_api_timeout_sec: float = 5.0
    cpcb_filter_state: str = ""
    cpcb_filter_city: str = ""
    open_meteo_base_url: str = "https://api.open-meteo.com/v1/forecast"
    nasa_earth_base_url: str = "https://api.nasa.gov/planetary/earth/assets"
    nominatim_base_url: str = "https://nominatim.openstreetmap.org/reverse"
    nasa_api_key: str = "AEkpxqbBv09sgAGmHn38BqeTWM8BYpHaCnvn6DJI"
    nasa_timeout_sec: float = 6.0
    nasa_max_retries: int = 1
    external_http_timeout_sec: float = 10.0
    external_http_max_retries: int = 3

    citizen_rate_limit_per_minute: int = 120
    gov_jwt_secret: str = "change-me"
    gov_jwt_algorithm: str = "HS256"
    gov_token_exp_minutes: int = 60

    cache_ttl_current_sec: int = 60
    cache_ttl_forecast_sec: int = 180
    cache_ttl_explain_sec: int = 120
    cache_ttl_disaster_sec: int = 30


settings = Settings()
