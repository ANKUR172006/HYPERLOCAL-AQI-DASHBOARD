$env:ENABLE_EXTENDED_INGESTION = "false"
$env:CPCB_SOURCE_MODE = "file"
$env:ENABLE_SCHEDULER = "false"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
