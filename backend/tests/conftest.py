from __future__ import annotations

import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PYTEST_TMP_ROOT = BACKEND_ROOT / ".pytest_tmp_system"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

PYTEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)

# Keep tests deterministic and isolated from the live demo runtime.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(BACKEND_ROOT / 'aqi_pytest.db').as_posix()}")
os.environ.setdefault("EXTERNAL_APIS_ENABLED", "false")
os.environ.setdefault("ENABLE_EXTENDED_INGESTION", "false")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("ENABLE_XGBOOST_FORECASTING", "false")
os.environ.setdefault("FORECAST_MODEL", "momentum")
os.environ.setdefault("CPCB_SOURCE_MODE", "file")
os.environ.setdefault("TMPDIR", str(PYTEST_TMP_ROOT))
os.environ.setdefault("TEMP", str(PYTEST_TMP_ROOT))
os.environ.setdefault("TMP", str(PYTEST_TMP_ROOT))
