from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


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

        # Backfill demo centroids for the seeded Delhi wards if they were created before the columns existed.
        # This keeps maps stable and prevents "everything plots in Delhi default" confusion.
        with engine.begin() as conn:
            try:
                rows = conn.exec_driver_sql(
                    "SELECT ward_id FROM wards WHERE ward_id LIKE 'DEL_WARD_%' AND (centroid_lat IS NULL OR centroid_lon IS NULL)"
                ).all()
            except Exception:
                rows = []
            if rows:
                lat_start, lon_start = 28.45, 77.02
                lat_step, lon_step = 0.055, 0.07
                for (ward_id,) in rows:
                    try:
                        idx = int(str(ward_id).split("_")[-1])
                    except Exception:
                        continue
                    idx0 = idx - 1
                    r = idx0 // 5
                    c = idx0 % 5
                    centroid_lat = lat_start + r * lat_step
                    centroid_lon = lon_start + c * lon_step
                    conn.exec_driver_sql(
                        "UPDATE wards SET centroid_lat = ?, centroid_lon = ? WHERE ward_id = ?",
                        (float(centroid_lat), float(centroid_lon), str(ward_id)),
                    )
