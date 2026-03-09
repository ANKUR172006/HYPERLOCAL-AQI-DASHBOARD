from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: list[Any] | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or []
        super().__init__(message)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    payload = {
        "timestamp": utc_now_iso(),
        "error": {"code": exc.code, "message": exc.message, "details": exc.details},
    }
    return JSONResponse(status_code=exc.status_code, content=payload)
