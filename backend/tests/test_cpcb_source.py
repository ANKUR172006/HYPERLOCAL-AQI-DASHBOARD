from app.services.cpcb_source import CpcbSource


def test_cpcb_source_retries_with_looser_filters_when_strict_delhi_filters_return_no_rows(monkeypatch):
    source = CpcbSource(
        mode="api",
        file_path="",
        api_url="/resource/test",
        api_key="demo-key",
        filter_state="Delhi",
        filter_city="Delhi",
        api_limit=10,
        api_max_pages=1,
    )

    calls: list[dict[str, str]] = []

    def fake_fetch(url: str, params: dict[str, str]):
        calls.append(dict(params))
        if params.get("filters[state]") == "Delhi" and params.get("filters[city]") == "Delhi":
            return []
        return [
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "PM2.5",
                "avg_value": "87",
                "last_update": "26-03-2026 13:00:00",
            },
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "PM10",
                "avg_value": "154",
                "last_update": "26-03-2026 13:00:00",
            },
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "NO2",
                "avg_value": "31",
                "last_update": "26-03-2026 13:00:00",
            },
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "SO2",
                "avg_value": "12",
                "last_update": "26-03-2026 13:00:00",
            },
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "OZONE",
                "avg_value": "19",
                "last_update": "26-03-2026 13:00:00",
            },
            {
                "station": "Ashok Vihar, Delhi - DPCC",
                "latitude": "28.695381",
                "longitude": "77.181665",
                "pollutant_id": "CO",
                "avg_value": "640",
                "last_update": "26-03-2026 13:00:00",
            },
        ]

    monkeypatch.setattr(source, "_fetch_data_gov_pollutants", fake_fetch)

    rows = source._load_from_api()

    assert len(rows) == 1
    assert rows[0].station_name == "Ashok Vihar, Delhi - DPCC"
    assert rows[0].source == "cpcb_api"
    assert calls[0].get("filters[state]") == "Delhi"
    assert calls[0].get("filters[city]") == "Delhi"
    assert any(call.get("filters[state]") == "Delhi" and "filters[city]" not in call for call in calls[1:])


def test_cpcb_source_filter_variants_do_not_duplicate_empty_variants():
    source = CpcbSource(
        mode="api",
        file_path="",
        api_url="/resource/test",
        api_key="demo-key",
        filter_state="",
        filter_city="Delhi",
    )

    variants = source._iter_filter_variants()

    assert variants == [{"filters[city]": "Delhi"}, {}]
