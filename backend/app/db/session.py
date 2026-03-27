from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base


is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite else {}
engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


if is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:  # type: ignore[no-redef]
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so SQLAlchemy registers metadata before create_all.
    from app.models import entities  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Lightweight SQLite "migration" for prototype iterations.
    # SQLite doesn't support ALTER TABLE ... DROP/ADD constraints easily, but it can add columns.
    if settings.database_url.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA synchronous=NORMAL")
            try:
                cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(wards)").all()]
            except Exception:
                cols = []
            if cols:
                if "centroid_lat" not in cols:
                    conn.exec_driver_sql("ALTER TABLE wards ADD COLUMN centroid_lat FLOAT")
                if "centroid_lon" not in cols:
                    conn.exec_driver_sql("ALTER TABLE wards ADD COLUMN centroid_lon FLOAT")
                if "geom_wkt" not in cols:
                    conn.exec_driver_sql("ALTER TABLE wards ADD COLUMN geom_wkt TEXT DEFAULT ''")

        # Clear legacy demo centroids for seeded Delhi wards when no real ward geometry exists.
        # Delhi searches should fall back to dynamic location-centered wards instead of the old 5x5 demo grid.
        with engine.begin() as conn:
            try:
                rows = conn.exec_driver_sql(
                    "SELECT ward_id, centroid_lat, centroid_lon FROM wards WHERE ward_id LIKE 'DEL_WARD_%' AND COALESCE(geom_wkt, '') = ''"
                ).all()
            except Exception:
                rows = []
            if rows:
                lat_start, lon_start = 28.45, 77.02
                lat_step, lon_step = 0.055, 0.07
                for ward_id, centroid_lat, centroid_lon in rows:
                    try:
                        idx = int(str(ward_id).split("_")[-1])
                    except Exception:
                        continue
                    idx0 = idx - 1
                    r = idx0 // 5
                    c = idx0 % 5
                    expected_lat = lat_start + r * lat_step
                    expected_lon = lon_start + c * lon_step
                    if centroid_lat is None or centroid_lon is None:
                        continue
                    if abs(float(centroid_lat) - float(expected_lat)) < 1e-6 and abs(float(centroid_lon) - float(expected_lon)) < 1e-6:
                        conn.exec_driver_sql(
                            "UPDATE wards SET centroid_lat = NULL, centroid_lon = NULL WHERE ward_id = ?",
                            (str(ward_id),),
                        )
