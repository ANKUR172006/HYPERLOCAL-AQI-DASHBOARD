from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("HOST", "0.0.0.0")
    log_level = os.getenv("LOG_LEVEL", "info")
    port_raw = os.getenv("PORT", "8000")
    try:
        port = int(port_raw)
    except Exception:
        port = 8000

    uvicorn.run("app.main:app", host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()

