"""
Verify Open-Meteo and NASA FIRMS are returning real live data.
Run from backend/ directory.
"""
import json, urllib.request, urllib.parse, os, sys
from datetime import datetime, timezone

LAT, LON = 28.6129, 77.2295  # Delhi centre
FIRMS_KEY = "02869280d4bf106226248fb0b9bc8498"

# ── 1. Open-Meteo ──────────────────────────────────────────────────────────────
print("=" * 60)
print("1. OPEN-METEO (weather)")
print("=" * 60)
params = urllib.parse.urlencode({
    "latitude": LAT, "longitude": LON,
    "current": "temperature_2m,wind_speed_10m,wind_direction_10m,relativehumidity_2m",
    "timezone": "Asia/Kolkata",
})
try:
    with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{params}", timeout=10) as r:
        data = json.load(r)
    cur = data.get("current", {})
    print(f"  Status        : LIVE DATA ✓")
    print(f"  Time          : {cur.get('time')}")
    print(f"  Temperature   : {cur.get('temperature_2m')} °C")
    print(f"  Wind Speed    : {cur.get('wind_speed_10m')} km/h")
    print(f"  Wind Dir      : {cur.get('wind_direction_10m')} °")
    print(f"  Humidity      : {cur.get('relativehumidity_2m')} %")
except Exception as e:
    print(f"  ERROR: {e}")

# ── 2. NASA FIRMS ──────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("2. NASA FIRMS (fire hotspots)")
print("=" * 60)
# bbox: 80km around Delhi
west, south, east, north = 76.5, 28.1, 77.9, 29.1
bbox = f"{west},{south},{east},{north}"
firms_url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_KEY}/VIIRS_SNPP_NRT/{bbox}/2"
try:
    with urllib.request.urlopen(firms_url, timeout=15) as r:
        text = r.read().decode("utf-8")
    lines = [l for l in text.strip().splitlines() if l]
    if len(lines) <= 1:
        print(f"  Status        : LIVE ✓ (no active fires in last 2 days near Delhi)")
        print(f"  Fire count    : 0")
    else:
        print(f"  Status        : LIVE DATA ✓")
        print(f"  Fire hotspots : {len(lines)-1} detected near Delhi (80km radius, 2 days)")
        header = lines[0].split(",")
        for row in lines[1:4]:  # show first 3
            vals = dict(zip(header, row.split(",")))
            print(f"    lat={vals.get('latitude','?')} lon={vals.get('longitude','?')} "
                  f"date={vals.get('acq_date','?')} confidence={vals.get('confidence','?')}")
        if len(lines) > 4:
            print(f"    ... and {len(lines)-4} more")
except Exception as e:
    print(f"  ERROR: {e}")

# ── 3. FIRMS MODIS fallback ────────────────────────────────────────────────────
print()
print("=" * 60)
print("3. NASA FIRMS MODIS_NRT (fallback source)")
print("=" * 60)
firms_url2 = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_KEY}/MODIS_NRT/{bbox}/2"
try:
    with urllib.request.urlopen(firms_url2, timeout=15) as r:
        text2 = r.read().decode("utf-8")
    lines2 = [l for l in text2.strip().splitlines() if l]
    if len(lines2) <= 1:
        print(f"  Status        : LIVE ✓ (no MODIS fires near Delhi)")
    else:
        print(f"  Status        : LIVE DATA ✓")
        print(f"  MODIS hotspots: {len(lines2)-1}")
except Exception as e:
    print(f"  ERROR: {e}")

print()
print("Done.")
