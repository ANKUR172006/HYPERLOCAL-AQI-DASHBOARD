CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS stations (
  station_id BIGSERIAL PRIMARY KEY,
  station_code VARCHAR(128) UNIQUE NOT NULL,
  station_name VARCHAR(160) NOT NULL,
  city VARCHAR(120) DEFAULT '',
  state VARCHAR(120) DEFAULT '',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  -- Keep WKT TEXT for compatibility with the ORM (SQLite + PostGIS).
  geom_wkt TEXT DEFAULT '',
  geom GEOGRAPHY(POINT, 4326),
  source VARCHAR(50) DEFAULT 'CPCB',
  created_at_utc TIMESTAMPTZ DEFAULT NOW(),
  updated_at_utc TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stations_geom ON stations USING GIST (geom);

CREATE TABLE IF NOT EXISTS pollution_readings (
  reading_id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(station_id),
  ts_utc TIMESTAMPTZ DEFAULT NOW(),
  pm25 DOUBLE PRECISION,
  pm10 DOUBLE PRECISION,
  no2 DOUBLE PRECISION,
  so2 DOUBLE PRECISION,
  co DOUBLE PRECISION,
  o3 DOUBLE PRECISION,
  nh3 DOUBLE PRECISION,
  raw_json JSONB DEFAULT '{}'::jsonb,
  data_quality_score DOUBLE PRECISION DEFAULT 0.9,
  source VARCHAR(50) DEFAULT 'CPCB'
);

CREATE TABLE IF NOT EXISTS weather_data (
  weather_id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(station_id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  ts_utc TIMESTAMPTZ DEFAULT NOW(),
  temperature_2m DOUBLE PRECISION,
  wind_speed_10m DOUBLE PRECISION,
  wind_direction_10m DOUBLE PRECISION,
  relativehumidity_2m DOUBLE PRECISION,
  surface_pressure DOUBLE PRECISION,
  source VARCHAR(50) DEFAULT 'OPEN_METEO'
);

CREATE TABLE IF NOT EXISTS satellite_data (
  satellite_id BIGSERIAL PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  date_utc VARCHAR(32) NOT NULL,
  ts_utc TIMESTAMPTZ DEFAULT NOW(),
  image_reference TEXT DEFAULT '',
  aerosol_index DOUBLE PRECISION,
  imagery_metadata_json JSONB DEFAULT '{}'::jsonb,
  source VARCHAR(50) DEFAULT 'NASA'
);

CREATE TABLE IF NOT EXISTS location_metadata (
  location_id BIGSERIAL PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  city VARCHAR(120) DEFAULT '',
  district VARCHAR(120) DEFAULT '',
  locality VARCHAR(120) DEFAULT '',
  ward VARCHAR(120) DEFAULT '',
  sublocality VARCHAR(120) DEFAULT '',
  state VARCHAR(120) DEFAULT '',
  country VARCHAR(120) DEFAULT '',
  raw_json JSONB DEFAULT '{}'::jsonb,
  source VARCHAR(50) DEFAULT 'NOMINATIM',
  ts_utc TIMESTAMPTZ DEFAULT NOW()
);
