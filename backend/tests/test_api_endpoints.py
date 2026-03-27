import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models.entities import AqiSnapshot, City, ForecastSnapshot, Ward
from app.services.collectors.boundary_collector import BoundarySnapshot
from app.services.cpcb_source import StationObservation


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/v1/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert "timestamp" in body


def test_ward_map_data_endpoint():
    with TestClient(app) as client:
        response = client.get("/v1/ward-map-data", params={"city_id": "DELHI"})
        assert response.status_code == 200
        body = response.json()
        assert body["city_id"] == "DELHI"
        assert body["ward_count"] >= 1
        assert isinstance(body["data"], list)


def test_ward_aqi_and_forecast_endpoints():
    ward_id = "DEL_WARD_014"
    with TestClient(app) as client:
        aqi = client.get("/v1/ward-aqi", params={"ward_id": ward_id})
        assert aqi.status_code == 200
        aqi_body = aqi.json()
        assert aqi_body["ward_id"] == ward_id
        assert "aqi" in aqi_body["data"]
        assert "disaster_assessment" in aqi_body["data"]

        forecast = client.get("/v1/aqi-forecast", params={"ward_id": ward_id, "horizon": 3})
        assert forecast.status_code == 200
        forecast_body = forecast.json()
        assert forecast_body["ward_id"] == ward_id
        assert forecast_body["data"]["horizon_hour"] == 3


def test_aqi_forecast_works_with_only_stale_snapshot():
    city_id = "TESTCITY"
    ward_id = "TEST_WARD_001"

    db = SessionLocal()
    try:
        if db.get(City, city_id) is None:
            db.add(City(city_id=city_id, city_name="Test City", state_name="Test State", timezone="UTC"))
        if db.get(Ward, ward_id) is None:
            db.add(Ward(ward_id=ward_id, city_id=city_id, ward_name="Test Ward", population=1, sensitive_sites_count=0))
        db.commit()

        old_ts = datetime.now(timezone.utc) - timedelta(hours=12)
        db.add(
            AqiSnapshot(
                ts_utc=old_ts,
                ward_id=ward_id,
                aqi_value=150,
                aqi_category="Moderate",
                primary_pollutant="PM2.5",
                pmi_value=0.0,
                contribution_json={"raw": {"pm25": 65.0}},
                data_quality_score=0.5,
                data_quality_flag="STALE",
            )
        )
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        forecast = client.get("/v1/aqi-forecast", params={"ward_id": ward_id, "horizon": 3})
        assert forecast.status_code == 200
        body = forecast.json()
        assert body["ward_id"] == ward_id
        assert body["data"]["horizon_hour"] == 3


def test_aqi_forecast_sanitizes_unrealistic_stored_value():
    city_id = "TESTCITY_SANITIZE"
    ward_id = "TEST_WARD_SANITIZE_001"

    db = SessionLocal()
    try:
        if db.get(City, city_id) is None:
            db.add(City(city_id=city_id, city_name="Test City Sanitize", state_name="Test State", timezone="UTC"))
        if db.get(Ward, ward_id) is None:
            db.add(Ward(ward_id=ward_id, city_id=city_id, ward_name="Test Ward Sanitize", population=1, sensitive_sites_count=0))
        db.commit()

        db.query(ForecastSnapshot).filter(ForecastSnapshot.ward_id == ward_id).delete()
        db.query(AqiSnapshot).filter(AqiSnapshot.ward_id == ward_id).delete()
        db.commit()

        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        db.add(
            AqiSnapshot(
                ts_utc=now - timedelta(minutes=30),
                ward_id=ward_id,
                aqi_value=140,
                aqi_category="Moderate",
                primary_pollutant="PM2.5",
                pmi_value=0.0,
                contribution_json={"raw": {"pm25": 58.0}},
                data_quality_score=0.9,
                data_quality_flag="OK",
            )
        )
        db.add(
            ForecastSnapshot(
                ts_generated_utc=now,
                target_ts_utc=now + timedelta(hours=3),
                ward_id=ward_id,
                horizon_hour=3,
                aqi_pred=420,
                aqi_category_pred="Severe",
                model_name="manual-test",
                model_version="v1",
                data_quality_score=0.9,
                disaster_mode=True,
            )
        )
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        forecast = client.get("/v1/aqi-forecast", params={"ward_id": ward_id, "horizon": 3})
        assert forecast.status_code == 200
        body = forecast.json()
        assert body["data"]["aqi_pred"] <= 215
        assert body["data"]["model"]["name"].endswith(":sanitized")


def test_analytics_trends_endpoint():
    with TestClient(app) as client:
        response = client.get("/v1/analytics/trends", params={"ward_id": "DEL_WARD_014"})
        assert response.status_code == 200
        body = response.json()
        assert len(body["data"]["hourly"]) == 24
        assert len(body["data"]["weekly"]) == 7
        assert body["data"]["source"] == "database_history"


def test_alerts_feed_recommendations_and_complaints():
    with TestClient(app) as client:
        alerts = client.get("/v1/alerts/feed", params={"city_id": "DELHI", "limit": 5})
        assert alerts.status_code == 200
        assert "data" in alerts.json()

        rec = client.get("/v1/gov/recommendations", params={"city_id": "DELHI"})
        assert rec.status_code == 200
        assert "data" in rec.json()
        if rec.json()["data"]:
            assert "disaster_assessment" in rec.json()["data"][0]

        complaints = client.get("/v1/complaints", params={"city_id": "DELHI"})
        assert complaints.status_code == 200
        assert complaints.json()["count"] >= 1


def test_disaster_endpoints():
    with TestClient(app) as client:
        citizen = client.get("/v1/disaster/citizen-view", params={"ward_id": "DEL_WARD_014"})
        assert citizen.status_code == 200
        citizen_body = citizen.json()
        assert citizen_body["ward_id"] == "DEL_WARD_014"
        assert "risk_level" in citizen_body["data"]

        officer = client.get("/v1/disaster/officer-view", params={"city_id": "DELHI", "top_n": 5})
        assert officer.status_code == 200
        officer_body = officer.json()
        assert officer_body["city_id"] == "DELHI"
        assert "top_critical_wards" in officer_body

        status = client.get("/v1/disaster/status", params={"city_id": "DELHI"})
        assert status.status_code == 200
        assert "disaster_mode" in status.json()


def test_complaints_crud_and_report_summary():
    with TestClient(app) as client:
        created = client.post(
            "/v1/complaints",
            json={
                "city_id": "DELHI",
                "ward_id": "DEL_WARD_014",
                "text": "Smoke from garbage burning near main road.",
                "votes": 7,
            },
        )
        assert created.status_code == 200
        cid = created.json()["data"]["id"]

        updated = client.patch(f"/v1/complaints/{cid}", json={"status": "ASSIGNED", "votes": 9})
        assert updated.status_code == 200
        assert updated.json()["data"]["status"] == "ASSIGNED"
        assert updated.json()["data"]["votes"] == 9

        report = client.get("/v1/reports/ward-summary", params={"ward_id": "DEL_WARD_014", "days": 7})
        assert report.status_code == 200
        assert report.json()["data"]["source"] == "database_history"


def test_location_insights_endpoint():
    with TestClient(app) as client:
        response = client.get(
            "/v1/location-insights",
            params={"lat": 28.6139, "lon": 77.2090, "city_id": "DELHI", "top_n": 5},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["city_id"] == "DELHI"
        assert "nearest_ward" in body
        assert body["nearest_ward"]["ward_id"].startswith("DEL_WARD_")
        assert len(body["ranking"]) >= 1


def test_india_dynamic_map_endpoints_outside_delhi(monkeypatch):
    monkeypatch.setattr(
        "app.services.collectors.boundary_collector.BoundaryCollector.fetch_boundary",
        lambda self, query, limit=1: BoundarySnapshot(
            name=str(query),
            ts_utc=datetime.now(timezone.utc),
            geojson={"type": "FeatureCollection", "features": []},
        ),
    )
    params = {"lat": 28.875612143111184, "lon": 76.62348148871419}
    with TestClient(app) as client:
        boundary = client.get("/v1/geojson/location-boundary", params=params)
        assert boundary.status_code == 200
        boundary_body = boundary.json()
        assert boundary_body["mode"] in {"city", "district"}
        assert boundary_body["city_id"].startswith("HARYANA_")
        assert boundary_body["region"]["state"] == "Haryana"
        assert len(boundary_body["data"]["features"]) == 1

        grid = client.get("/v1/geojson/location-virtual-grid", params={**params, "grid_size": 25})
        assert grid.status_code == 200
        grid_body = grid.json()
        assert grid_body["mode"] in {"virtual", "city", "district"}
        assert len(grid_body["data"]["features"]) == 25
        first_grid_props = grid_body["data"]["features"][0]["properties"]
        assert first_grid_props["ward_id"].startswith(boundary_body["city_id"])

        insights = client.get("/v1/location-insights", params={**params, "city_id": "DELHI", "top_n": 8})
        assert insights.status_code == 200
        insights_body = insights.json()
        assert insights_body["mode"] in {"city", "district"}
        assert insights_body["city_id"] == boundary_body["city_id"]
        assert insights_body["nearest_ward"]["ward_id"].startswith(boundary_body["city_id"])
        assert len(insights_body["ranking"]) >= 1

        ward_map = client.get("/v1/ward-map-data", params={**params, "city_id": "DELHI"})
        assert ward_map.status_code == 200
        ward_map_body = ward_map.json()
        assert ward_map_body["mode"] in {"virtual", "city", "district"}
        assert ward_map_body["city_id"] == boundary_body["city_id"]
        assert ward_map_body["ward_count"] >= 1
        assert ward_map_body["data"][0]["ward_id"].startswith(boundary_body["city_id"])


def test_delhi_real_ward_geojson_is_normalized(monkeypatch):
    tmp_dir = Path(__file__).resolve().parent / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    geojson_path = tmp_dir / "Delhi_Wards.geojson"
    geojson_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"Ward_No": 7, "Ward_Name": "Karol Bagh"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[77.10, 28.64], [77.11, 28.64], [77.11, 28.65], [77.10, 28.65], [77.10, 28.64]]],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("app.api.v1.routes.settings.delhi_wards_geojson_path", str(geojson_path))
    from app.api.v1 import routes as routes_module

    routes_module._load_geojson_file.cache_clear()

    with TestClient(app) as client:
        response = client.get("/v1/geojson/delhi-wards-grid")
        assert response.status_code == 200
        body = response.json()
        feature = body["data"]["features"][0]
        assert feature["properties"]["ward_id"] == "DEL_WARD_007"
        assert feature["properties"]["ward_name"] == "Karol Bagh"
        assert body["note"].lower().startswith("real ward polygons loaded")


def test_environment_unified_endpoint_without_refresh():
    with TestClient(app) as client:
        response = client.get(
            "/v1/environment/unified",
            params={"lat": 28.6139, "lon": 77.2090, "refresh": False},
        )
        assert response.status_code == 200
        body = response.json()
        assert "data" in body
        assert "location" in body["data"]
        assert "pollution" in body["data"]
        assert "weather" in body["data"]
        assert "satellite" in body["data"]
        assert "city" in body["data"]["location"]


def test_environment_api_checks_endpoint():
    with TestClient(app) as client:
        response = client.get("/v1/environment/api-checks", params={"limit": 10})
        assert response.status_code == 200
        body = response.json()
        assert "data" in body
        assert isinstance(body["data"], list)


def test_location_search_endpoint(monkeypatch):
    monkeypatch.setattr(
        "app.services.collectors.location_collector.LocationCollector.search_places",
        lambda self, query, limit=5: [
            {
                "display_name": "Rohtak, Haryana, India",
                "lat": 28.8955,
                "lon": 76.6066,
                "city": "Rohtak",
                "district": "Rohtak",
                "state": "Haryana",
                "country": "India",
                "source": "TEST",
            }
        ],
    )
    with TestClient(app) as client:
        response = client.get("/v1/location/search", params={"q": "Rohtak, Haryana", "limit": 3})
        assert response.status_code == 200
        body = response.json()
        assert body["query"] == "Rohtak, Haryana"
        assert "data" in body
        assert isinstance(body["data"], list)
        assert body["data"][0]["state"] == "Haryana"


def test_firms_fires_endpoint_smoke():
    with TestClient(app) as client:
        response = client.get("/v1/fires/nearby", params={"lat": 28.6139, "lon": 77.2090, "days": 1})
        assert response.status_code == 200
        body = response.json()
        assert "fires" in body
        assert "fireNearby" in body


def test_stations_live_prefers_official_station_aqi(monkeypatch):
    observed_at = datetime(2026, 3, 27, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.api.v1.routes._load_live_stations_for_city",
        lambda city_id, lat=None, lon=None: [
            StationObservation(
                station_id="vivek_vihar",
                station_name="Vivek Vihar, Delhi - DPCC",
                latitude=28.67,
                longitude=77.31,
                pm25=94.0,
                pm10=136.0,
                no2=38.0,
                so2=14.0,
                o3=22.0,
                co=0.6,
                wind_speed=2.5,
                wind_direction=180.0,
                humidity=55.0,
                temperature=28.0,
                observed_at_utc=observed_at,
                source="cpcb_api",
                official_aqi=136.0,
                official_primary_pollutant="PM10",
            )
        ],
    )

    with TestClient(app) as client:
        response = client.get("/v1/stations/live", params={"lat": 28.67, "lon": 77.31, "radius_km": 20, "limit": 10})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        station = body["data"][0]
        assert station["aqi"] == 136
        assert station["aqi_mode"] == "official_cpcb_station_aqi"
        assert station["dominant_pollutant"] == "PM10"


def test_ward_map_discards_snapshot_that_drifted_above_live_station_anchor(monkeypatch):
    city_id = "DELHI"
    ward_id = "DEL_WARD_LIVE_ANCHOR"
    db = SessionLocal()
    try:
        if db.get(City, city_id) is None:
            db.add(City(city_id=city_id, city_name="Delhi", state_name="Delhi", timezone="Asia/Kolkata"))
        if db.get(Ward, ward_id) is None:
            db.add(
                Ward(
                    ward_id=ward_id,
                    city_id=city_id,
                    ward_name="Ashok Vihar",
                    population=1,
                    sensitive_sites_count=0,
                    centroid_lat=28.69,
                    centroid_lon=77.18,
                )
            )
        db.commit()
        db.add(
            AqiSnapshot(
                ts_utc=datetime.now(timezone.utc),
                ward_id=ward_id,
                aqi_value=345,
                aqi_category="Very Poor",
                primary_pollutant="PM2.5",
                pmi_value=0.0,
                contribution_json={"raw": {"pm25": 145.0}},
                data_quality_score=0.9,
                data_quality_flag="OK",
            )
        )
        db.commit()
    finally:
        db.close()

    observed_at = datetime(2026, 3, 27, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "app.api.v1.routes._load_live_stations_for_city",
        lambda city_id, lat=None, lon=None: [
            StationObservation(
                station_id="ashok_vihar",
                station_name="Ashok Vihar, Delhi - DPCC",
                latitude=28.69,
                longitude=77.18,
                pm25=113.0,
                pm10=141.0,
                no2=50.0,
                so2=29.0,
                o3=28.0,
                co=0.3,
                wind_speed=2.5,
                wind_direction=180.0,
                humidity=55.0,
                temperature=28.0,
                observed_at_utc=observed_at,
                source="cpcb_api",
                official_aqi=141.0,
                official_primary_pollutant="PM10",
            )
        ],
    )

    with TestClient(app) as client:
        response = client.get("/v1/ward-map-data", params={"city_id": "DELHI"})
        assert response.status_code == 200
        body = response.json()
        row = next(item for item in body["data"] if item["ward_id"] == ward_id)
        assert row["aqi"] != 345
        assert row["estimated"] is True
        assert row["aqi"] <= 153
        assert row["live_anchor"]["nearest_station_aqi"] == 141.0
