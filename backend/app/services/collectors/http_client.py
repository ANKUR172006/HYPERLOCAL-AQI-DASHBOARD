from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import settings

_API_CHECKS = deque(maxlen=500)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize_params(params: dict[str, Any] | None) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for k, v in (params or {}).items():
        key = str(k).lower()
        if "key" in key or "token" in key or "secret" in key:
            safe[k] = "***"
        else:
            safe[k] = v
    return safe


def _record_check(url: str, params: dict[str, Any] | None, success: bool, status_code: int | None, error: str | None):
    host = urlsplit(url).netloc
    _API_CHECKS.appendleft(
        {
            "timestamp": _utc_now_iso(),
            "host": host,
            "url": url,
            "params": _sanitize_params(params),
            "success": success,
            "status_code": status_code,
            "error": error,
        }
    )


def get_recent_api_checks(limit: int = 100) -> list[dict[str, Any]]:
    take = max(1, min(limit, len(_API_CHECKS)))
    return list(_API_CHECKS)[:take]


def get_json_with_retry(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
    if not settings.external_apis_enabled:
        _record_check(url, params, success=False, status_code=None, error="external_apis_disabled")
        return {}
    retries = max(1, settings.external_http_max_retries)
    backoff = 0.6
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            res = httpx.get(url, params=params, headers=headers, timeout=settings.external_http_timeout_sec)
            res.raise_for_status()
            _record_check(url, params, success=True, status_code=res.status_code, error=None)
            return res.json()
        except Exception as exc:  # pragma: no cover - network conditions vary
            last_error = exc
            status_code = None
            if isinstance(exc, httpx.HTTPStatusError):
                status_code = exc.response.status_code
            _record_check(url, params, success=False, status_code=status_code, error=str(exc))
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))
    if last_error:
        raise last_error
    return {}
