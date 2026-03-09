from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.db.session import SessionLocal
from app.jobs.pipeline_jobs import run_pipeline_cycle

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


def _job_run_pipeline() -> None:
    db = SessionLocal()
    try:
        run_pipeline_cycle(db)
    except Exception:
        logger.exception("Scheduled pipeline cycle failed")
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        _job_run_pipeline,
        trigger="interval",
        minutes=5,
        id="pipeline_every_5m",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def maybe_start_scheduler() -> None:
    if settings.enable_scheduler:
        start_scheduler()
