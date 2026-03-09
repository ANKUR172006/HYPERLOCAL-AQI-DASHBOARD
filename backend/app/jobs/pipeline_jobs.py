from sqlalchemy.orm import Session

from app.services.pipeline import PipelineService


def run_pipeline_cycle(db: Session) -> None:
    service = PipelineService(db)
    service.run_full_pipeline()
