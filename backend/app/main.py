from __future__ import annotations

from contextlib import asynccontextmanager
import asyncio
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import router as v1_router
from app.core.config import settings
from app.core.errors import AppError, app_error_handler
from app.core.logging import configure_logging
from app.db.session import SessionLocal, init_db
from app.jobs.pipeline_jobs import run_pipeline_cycle
from app.jobs.scheduler import maybe_start_scheduler, stop_scheduler
from app.services.pipeline import PipelineService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    in_pytest = os.getenv("PYTEST_CURRENT_TEST") is not None

    def _startup_work() -> None:
        db = SessionLocal()
        try:
            init_db()
            PipelineService(db).bootstrap_city_and_wards()
            run_pipeline_cycle(db)
        except Exception:
            logger.exception("Startup pipeline cycle failed; API will still serve requests")
        finally:
            db.close()

    if in_pytest:
        _startup_work()
    else:
        # Never block startup on DB init / pipeline work in app runtime.
        asyncio.create_task(asyncio.to_thread(_startup_work))
    try:
        if not in_pytest:
            maybe_start_scheduler()
    except Exception:
        logger.exception("Scheduler failed to start; continuing without scheduler")
    yield
    stop_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(v1_router, prefix=settings.api_prefix)

    # Serve `frontend_new` (Vite build) when present (Railway / Docker).
    static_dir = Path(__file__).resolve().parent / "static"
    index_html = static_dir / "index.html"
    assets_dir = static_dir / "assets"
    if index_html.exists():
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/{full_path:path}")
        def spa_fallback(full_path: str):  # type: ignore[valid-type]
            # API routes are served by the router above.
            if full_path.startswith(settings.api_prefix.strip("/") + "/"):
                raise HTTPException(status_code=404, detail="Not found")
            candidate = static_dir / full_path
            if candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(index_html), media_type="text/html")
    return app


app = create_app()
