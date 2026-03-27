import json

with open('cpcb_live_check.json', encoding='utf-8-sig') as f:
    data = json.load(f)

records = data.get('records', [])

stations = {}
for r in records:
    s = r['station']
    if s not in stations:
        stations[s] = {'lat': r.get('latitude',''), 'lon': r.get('longitude',''), 'updated': r.get('last_update','')}
    pid = r.get('pollutant_id','')
    try:
        stations[s][pid] = float(r.get('avg_value', 0) or 0)
    except:
        pass

def aqi_pm25(c):
    bp = [(0,30,0,50),(30,60,51,100),(60,90,101,200),(90,120,201,300),(120,250,301,400),(250,350,401,500)]
    for lo,hi,ilo,ihi in bp:
        if lo <= c <= hi:
            return round(ilo + (ihi-ilo)*(c-lo)/(hi-lo))
    return 500

def category(aqi):
    if aqi <= 50: return 'Good'
    if aqi <= 100: return 'Satisfactory'
    if aqi <= 200: return 'Moderate'
    if aqi <= 300: return 'Poor'
    if aqi <= 400: return 'Very Poor'
    return 'Severe'

print(f"{'Station':<48} {'PM2.5':>6} {'AQI':>5} {'Category':<14} Updated")
print('-'*105)
for s in sorted(stations.keys()):
    pm = stations[s].get('PM2.5')
    if pm:
        aqi = aqi_pm25(pm)
        cat = category(aqi)
        upd = stations[s]['updated']
        print(f"{s[:47]:<48} {pm:>6.0f} {aqi:>5} {cat:<14} {upd}")

print(f"\nTotal records from API: {len(records)}")
print(f"Stations with PM2.5: {sum(1 for s in stations.values() if s.get('PM2.5'))}")
print(f"Data timestamp: {data.get('updated_date','')}")
