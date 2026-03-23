from __future__ import annotations

import urllib.parse
from typing import Any

from app.core.config import settings
from app.services.collectors.http_client import get_json_with_retry


def fetch_cpcb_station_counts(
    *,
    state_union_territory: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    """
    Fetch state/UT-level station-count metadata from api.data.gov.in.

    This dataset is *not* a live per-station pollutant feed. It returns aggregated counts like
    "Real-time under CAAQMS - No. of stations" by State/Union Territory.
    """
    url = (settings.cpcb_station_counts_api_url or "").strip()
    if not url:
        return {}

    if url.startswith("/resource/"):
        url = f"https://api.data.gov.in{url}"

    safe_limit = max(1, min(int(limit), 2000))
    safe_offset = max(0, int(offset))

    params: dict[str, Any] = {
        "format": "json",
        "limit": str(safe_limit),
        "offset": str(safe_offset),
    }

    if state_union_territory:
        params["filters[state___union_territory]"] = state_union_territory

    api_key = (settings.cpcb_api_key or "").strip()
    if api_key:
        params["api-key"] = api_key

    parsed = urllib.parse.urlsplit(url)
    existing = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    merged = {**existing, **params}
    clean_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
    return get_json_with_retry(clean_url, params=merged)

