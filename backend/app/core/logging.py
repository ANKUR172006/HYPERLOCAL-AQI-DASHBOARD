import logging
import os


def configure_logging() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    if log_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
        log_level = "INFO"
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Prevent leaking querystring secrets (e.g., api-key) via httpx's request logging.
    # If you explicitly want httpx request logs, set `HTTPX_LOG_LEVEL=INFO` (or DEBUG).
    httpx_level = os.getenv("HTTPX_LOG_LEVEL", "WARNING").upper()
    if httpx_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
        httpx_level = "WARNING"
    logging.getLogger("httpx").setLevel(getattr(logging, httpx_level, logging.WARNING))
    logging.getLogger("httpcore").setLevel(getattr(logging, httpx_level, logging.WARNING))
