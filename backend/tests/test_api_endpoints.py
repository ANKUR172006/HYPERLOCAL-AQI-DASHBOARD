from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models.entities import AqiSnapshot, City, Ward


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

        complaints = client.get("/v1/complaints", params={"city_id": "DELHI"})
        assert complaints.status_code == 200
        assert complaints.json()["count"] >= 1


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


def test_firms_fires_endpoint_smoke():
    with TestClient(app) as client:
        response = client.get("/v1/fires/nearby", params={"lat": 28.6139, "lon": 77.2090, "days": 1})
        assert response.status_code == 200
        body = response.json()
        assert "fires" in body
        assert "fireNearby" in body
