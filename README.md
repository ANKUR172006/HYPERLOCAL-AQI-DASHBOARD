# Hyperlocal AQI System

## Share And Run

This folder is prepared for direct sharing.

Keep these main items:

- `backend/`
- `frontend_new/`
- `install.sh`
- `run.sh`
- `start-all.ps1`
- `README.md`

Important:

- Keep `backend/aqi.db` if you want the same local data/demo state.
- The receiver should have `python3`, `pip`, `node`, and `npm` installed.
- Docker is not required in this shared copy.

## Linux Setup

Install everything:

```bash
bash ./install.sh
```

Run the prototype:

```bash
bash ./run.sh
```

URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend health: `http://127.0.0.1:8000/v1/health`

## Windows Setup

From project root:

```powershell
.\start-all.ps1
```

## Manual Backend Run

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Manual Frontend Run

```powershell
cd frontend_new
npm install
npm run dev
```

## Data Sharing

SQLite database sharing is the easiest for this project.

To share current app data, include:

- `backend/aqi.db`

To replace the database on another device:

1. Stop the app.
2. Overwrite `backend/aqi.db`.
3. Start the app again.

## Notes

- Default CPCB source mode is the bundled sample file.
- Live API mode can still be enabled later through environment variables if needed.
- This copy is intentionally lightweight for easy handoff.
