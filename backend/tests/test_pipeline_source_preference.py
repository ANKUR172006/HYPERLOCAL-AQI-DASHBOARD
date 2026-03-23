from datetime import datetime, timezone

from sqlalchemy import delete

from app.db.session import SessionLocal, init_db
from app.models.entities import CleanMeasurement, Station
from app.services.pipeline import PipelineService


def test_pipeline_prefers_cpcb_api_clean_measurements_when_present():
    init_db()
    ts_slot = datetime(2000, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    station_api = "ST_API_001"
    station_file = "ST_FILE_001"
    pollutants = ["PM25", "PM10", "NO2", "SO2", "O3", "CO"]

    db = SessionLocal()
    try:
        # Make the test idempotent even with a persistent SQLite DB file.
        db.execute(
            delete(CleanMeasurement).where(
                CleanMeasurement.ts_slot_utc == ts_slot,
                CleanMeasurement.station_code.in_([station_api, station_file]),
            )
        )
        db.commit()

        for code in (station_api, station_file):
            if db.query(Station).filter(Station.station_code == code).first() is None:
                db.add(
                    Station(
                        station_code=code,
                        station_name=code,
                        city="",
                        state="",
                        latitude=28.6,
                        longitude=77.2,
                        geom_wkt="POINT(77.2 28.6)",
                        source="CPCB",
                    )
                )
        db.commit()

        for pol in pollutants:
            db.add(
                CleanMeasurement(
                    station_code=station_file,
                    ts_slot_utc=ts_slot,
                    pollutant_id=pol,
                    raw_value=10.0,
                    clean_value=10.0,
                    unit="ug/m3",
                    qa_status="ACCEPTED",
                    qa_flags={},
                    source="cpcb_file",
                )
            )
            db.add(
                CleanMeasurement(
                    station_code=station_api,
                    ts_slot_utc=ts_slot,
                    pollutant_id=pol,
                    raw_value=20.0,
                    clean_value=20.0,
                    unit="ug/m3",
                    qa_status="ACCEPTED",
                    qa_flags={},
                    source="cpcb_api",
                )
            )
        db.commit()

        svc = PipelineService(db)
        vectors = svc.load_clean_station_vectors(ts_slot)
        assert vectors, "Expected at least one station vector from CPCB API rows"
        assert all(v.station_id == station_api for v in vectors)
        assert all((v.source or "").startswith("qa_clean:cpcb_api") for v in vectors)
    finally:
        db.close()
