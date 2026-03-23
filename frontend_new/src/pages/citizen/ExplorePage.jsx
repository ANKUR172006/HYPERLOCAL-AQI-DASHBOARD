import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import {
  useDelhiBoundary,
  useDelhiWardsGrid,
  useEnvironmentUnified,
  useFiresNearby,
  useGeolocation,
  useNewDelhiBoundary,
  useStationsLive,
} from "../../hooks/index.js";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import Icon from "../../components/ui/Icon.jsx";
import { aqiTone, safeNum, safeStr } from "../../tokens/index.js";

const DEFAULT_CENTER = { lat: 28.6139, lon: 77.2090 }; // New Delhi

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bboxFromCenterKm(lat, lon, radiusKm) {
  const r = Math.max(0.2, Number(radiusKm) || 0);
  const dLat = r / 111.0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLon = r / (111.0 * Math.max(0.15, cosLat));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lon - dLon;
  const east = lon + dLon;
  return [[south, west], [north, east]];
}

function boundsFromGeoJson(geojson) {
  try {
    let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    const walk = (coords) => {
      if (!Array.isArray(coords)) return;
      if (coords.length && typeof coords[0] === "number") {
        const [lon, lat] = coords;
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        return;
      }
      coords.forEach(walk);
    };
    (geojson?.features || []).forEach((f) => walk(f?.geometry?.coordinates));
    if (minLon > maxLon) return null;
    return [[minLat, minLon], [maxLat, maxLon]];
  } catch {
    return null;
  }
}

function MapFocus({ enabled, bounds }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || !bounds) return;
    try {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
    } catch {
      // ignore
    }
  }, [enabled, bounds, map]);
  return null;
}

function MapZoomTracker({ onZoom }) {
  useMapEvents({
    zoomend(e) {
      try {
        onZoom?.(e.target.getZoom());
      } catch {
        // ignore
      }
    },
  });
  return null;
}

function pointInPolygon(lat, lon, polygonCoords) {
  // polygonCoords: [ [lon,lat], ... ] (ring)
  let inside = false;
  for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
    const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
    const xj = polygonCoords[j][0], yj = polygonCoords[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInsideDelhi(lat, lon, boundaryGeoJson) {
  try {
    const feat = boundaryGeoJson?.features?.[0];
    const geom = feat?.geometry;
    if (!geom) return true;
    if (geom.type === "Polygon") {
      const ring = geom.coordinates?.[0] || [];
      return pointInPolygon(lat, lon, ring);
    }
    if (geom.type === "MultiPolygon") {
      const polys = geom.coordinates || [];
      return polys.some((p) => pointInPolygon(lat, lon, p?.[0] || []));
    }
    return true;
  } catch {
    return true;
  }
}

function isInsideBoundary(lat, lon, boundaryGeoJson) {
  return isInsideDelhi(lat, lon, boundaryGeoJson);
}

function centroidFromGeometry(geometry) {
  try {
    if (!geometry) return null;
    const t = geometry.type;
    const coords = geometry.coordinates;
    const collectRing = (ring) => {
      let sx = 0, sy = 0, n = 0;
      for (const p of ring || []) {
        if (!Array.isArray(p) || p.length < 2) continue;
        sx += Number(p[1]);
        sy += Number(p[0]);
        n += 1;
      }
      if (!n) return null;
      return { lat: sx / n, lon: sy / n };
    };
    if (t === "Polygon") {
      return collectRing(coords?.[0] || []);
    }
    if (t === "MultiPolygon") {
      const polys = coords || [];
      const cents = polys.map((p) => collectRing(p?.[0] || [])).filter(Boolean);
      if (!cents.length) return null;
      const lat = cents.reduce((s, c) => s + c.lat, 0) / cents.length;
      const lon = cents.reduce((s, c) => s + c.lon, 0) / cents.length;
      return { lat, lon };
    }
    return null;
  } catch {
    return null;
  }
}

function calcSubIndex(conc, pollutant) {
  const bp = {
    pm25: [[0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200], [90, 120, 201, 300], [120, 250, 301, 400], [250, 350, 401, 500]],
    pm10: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 250, 101, 200], [250, 350, 201, 300], [350, 430, 301, 400], [430, 500, 401, 500]],
    no2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 180, 101, 200], [180, 280, 201, 300], [280, 400, 301, 400], [400, 1000, 401, 500]],
    so2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 380, 101, 200], [380, 800, 201, 300], [800, 1600, 301, 400], [1600, 2000, 401, 500]],
    o3: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 168, 101, 200], [168, 208, 201, 300], [208, 748, 301, 400], [748, 1000, 401, 500]],
    co: [[0, 1.0, 0, 50], [1.0, 2.0, 51, 100], [2.0, 10, 101, 200], [10, 17, 201, 300], [17, 34, 301, 400], [34, 50, 401, 500]],
  }[pollutant];
  if (!bp) return 0;
  const c = Math.max(0, Number(conc) || 0);
  for (let idx = 0; idx < bp.length; idx++) {
    const [lo, hi, ilo, ihi] = bp[idx];
    const loOk = idx === 0 ? c >= lo : c > lo;
    if (loOk && c <= hi) {
      const val = ((ihi - ilo) / (hi - lo)) * (c - lo) + ilo;
      return Math.max(0, Math.min(500, Math.round(val)));
    }
  }
  return 500;
}

function deriveAqiFromPollutants(p) {
  const indices = {
    "PM2.5": calcSubIndex(p.pm25, "pm25"),
    PM10: calcSubIndex(p.pm10, "pm10"),
    NO2: calcSubIndex(p.no2, "no2"),
    SO2: calcSubIndex(p.so2, "so2"),
    O3: calcSubIndex(p.o3, "o3"),
    CO: calcSubIndex(p.co, "co"),
  };
  const dominant = Object.keys(indices).reduce((a, b) => (indices[a] > indices[b] ? a : b));
  return { aqi: indices[dominant], dominant };
}

function idwInterpolate(center, sensors, k = 6, power = 2) {
  const sorted = sensors
    .map((s) => ({ s, d: haversineKm(center.lat, center.lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  const eps = 0.6; // km
  const weight = (d) => 1 / Math.pow(d + eps, power);
  const fields = ["pm25", "pm10", "no2", "so2", "o3", "co"];
  const out = {};
  for (const f of fields) {
    let num = 0;
    let den = 0;
    for (const { s, d } of sorted) {
      const v = Number(s.pollutants?.[f]);
      if (!Number.isFinite(v)) continue;
      const w = weight(d);
      num += w * v;
      den += w;
    }
    out[f] = den > 0 ? num / den : null;
  }
  return { pollutants: out, nearest: sorted };
}

function densityLabel(lat, lon) {
  const d = haversineKm(lat, lon, DEFAULT_CENTER.lat, DEFAULT_CENTER.lon);
  if (d <= 8) return "High";
  if (d <= 18) return "Medium";
  return "Low";
}

function riskLevel(aqi, density, weather) {
  const n = safeNum(aqi, 0);
  const wind = safeNum(weather?.wind_speed, 0);
  const rh = safeNum(weather?.humidity, 0);
  let score = n > 300 ? 3 : n > 200 ? 2 : n > 100 ? 1 : 0;
  if (density === "High") score += 1;
  if (wind > 0 && wind < 10) score += 1;
  if (rh > 70) score += 1;
  const level = score >= 4 ? "High" : score >= 2 ? "Moderate" : "Low";
  const tone = level === "High" ? "danger" : level === "Moderate" ? "warning" : "success";
  const why = [
    n > 200 ? "High AQI" : n > 100 ? "Elevated AQI" : "Lower AQI",
    density === "High" ? "dense population" : density === "Medium" ? "moderate density" : "low density",
    wind > 0 && wind < 10 ? "low wind dispersion" : "wind supports dispersion",
    rh > 70 ? "high humidity persistence" : "normal humidity",
  ].join(" + ");
  return { level, tone, why };
}

function detectSource({ pollutants, weather, fireNearby }) {
  // Lightweight JS port (aligned with backend rules).
  const scale = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || hi <= lo) return 0;
    const x = (n - lo) / (hi - lo);
    return Math.max(0, Math.min(1, x));
  };
  const inv = (v, lo, hi) => 1 - scale(v, lo, hi);
  const pm25 = pollutants?.pm25;
  const pm10 = pollutants?.pm10;
  const no2 = pollutants?.no2;
  const so2 = pollutants?.so2;
  const co = pollutants?.co;
  const wind = weather?.wind_speed;
  const rh = weather?.humidity;
  const s_pm25 = scale(pm25, 30, 160);
  const s_pm10 = scale(pm10, 50, 280);
  const s_no2 = scale(no2, 20, 120);
  const s_so2 = scale(so2, 10, 80);
  const s_co = scale(co, 0.4, 2.0);
  const s_wind_low = inv(wind, 6, 18);
  const s_humid = scale(rh, 55, 90);
  const s_firms = fireNearby ? 1 : 0;
  let biomass = 0.55 * s_pm25 + 0.15 * s_humid + 0.10 * s_wind_low + 0.80 * s_firms;
  let dust = 0.55 * s_pm10 + 0.20 * s_wind_low;
  let traffic = 0.50 * s_no2 + 0.15 * s_co + 0.15 * s_wind_low;
  let industrial = 0.65 * s_so2 + 0.15 * s_no2 + 0.10 * s_wind_low;
  const scores = {
    "Traffic Emissions": traffic,
    "Dust / Construction": dust,
    "Biomass Burning": biomass + (fireNearby ? 10 : 0),
    "Industrial Emissions": industrial,
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  const [pLabel, pScore] = ranked[0];
  const [sLabel, sScore] = ranked[1];
  const pConf = Math.round((pScore / total) * 100);
  const sConf = Math.max(0, Math.min(100, 100 - pConf));
  const icon = (label) =>
    label.startsWith("Traffic") ? "car" :
    label.startsWith("Dust") ? "layers" :
    label.startsWith("Biomass") ? "flame" :
    label.startsWith("Industrial") ? "building" : "info";
  const reasons = [];
  if (pLabel.startsWith("Biomass") && fireNearby) reasons.push("FIRMS hotspot detected nearby (satellite)");
  if (pLabel.startsWith("Biomass") && s_pm25 >= 0.45) reasons.push("High PM2.5 suggests smoke/fine particles");
  if (pLabel.startsWith("Dust") && s_pm10 >= 0.45) reasons.push("High PM10 suggests dust/construction");
  if (pLabel.startsWith("Traffic") && s_no2 >= 0.45) reasons.push("High NO₂ suggests traffic/combustion");
  if (!reasons.length) reasons.push("Multi-signal inference from sensors + weather.");
  return {
    primary: { label: pLabel, confidence: pConf, icon: icon(pLabel) },
    secondary: { label: sLabel, confidence: sConf, icon: icon(sLabel) },
    reasons: reasons.slice(0, 3),
  };
}

export default function ExplorePage() {
  const [selectedWard, setSelectedWard] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [focusNewDelhi, setFocusNewDelhi] = useState(true);
  const [layers, setLayers] = useState({ wards: true, grid: false, sensors: true, fires: true, wardLabels: true });
  const [zoom, setZoom] = useState(11);
  const geo = useGeolocation();
  const center = geo.lat && geo.lon ? { lat: geo.lat, lon: geo.lon } : DEFAULT_CENTER;

  const boundary = useDelhiBoundary();
  const newDelhiBoundary = useNewDelhiBoundary();
  const wardsGrid = useDelhiWardsGrid();
  const stations = useStationsLive(center.lat, center.lon, 70, 120);
  const env = useEnvironmentUnified(center.lat, center.lon, true);
  const firesNearby = useFiresNearby(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon, 80, 2);

  const stationList = stations.data?.data || [];
  const firePoints = firesNearby.data?.fires || [];
  const weather = env.data?.data?.weather || {};

  const tsSlot = stations.data?.ts_slot_utc || null;
  const liveLabel = useMemo(() => {
    if (!tsSlot) return { txt: "Using last known data", tone: "warning" };
    const dt = new Date(tsSlot);
    const mins = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
    if (!Number.isFinite(mins)) return { txt: "Using last known data", tone: "warning" };
    return { txt: `Live Air Quality Data — Updated ${mins} min ago`, tone: "success" };
  }, [tsSlot]);

  const boundaryGeo = boundary.data?.data || null;
  const newDelhiGeo = newDelhiBoundary.data?.data || null;
  const wardsGeo = wardsGrid.data?.data || null;
  const fallbackBounds = useMemo(() => bboxFromCenterKm(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon, 12), []);
  const newDelhiBounds = useMemo(() => boundsFromGeoJson(newDelhiGeo) || fallbackBounds, [newDelhiGeo, fallbackBounds]);

  const wardsComputed = useMemo(() => {
    if (!wardsGeo) return { geo: null, byId: new Map(), list: [] };
    const features = Array.isArray(wardsGeo.features) ? wardsGeo.features : [];
    const outFeatures = [];
    const byId = new Map();
    const list = [];
    for (const f of features) {
      const props = f?.properties || {};
      const wardId = safeStr(props.Ward_No, safeStr(props.ward_id, safeStr(props.wardId, ""))) || null;
      const wardName = safeStr(props.Ward_Name, safeStr(props.ward_name, safeStr(props.name, wardId || "Ward")));
      const centroid = centroidFromGeometry(f?.geometry) || null;
      if (!wardId || !centroid) continue;

      const inNewDelhi = newDelhiGeo ? isInsideBoundary(centroid.lat, centroid.lon, newDelhiGeo) : (
        centroid.lat >= newDelhiBounds[0][0] && centroid.lat <= newDelhiBounds[1][0] && centroid.lon >= newDelhiBounds[0][1] && centroid.lon <= newDelhiBounds[1][1]
      );
      if (focusNewDelhi && !inNewDelhi) continue;

      const { pollutants, nearest } = stationList.length ? idwInterpolate({ lat: centroid.lat, lon: centroid.lon }, stationList, 6, 2) : { pollutants: {}, nearest: [] };
      const { aqi, dominant } = deriveAqiFromPollutants(pollutants || {});
      const fireNearby = (firePoints || []).some((p) => haversineKm(centroid.lat, centroid.lon, p.lat, p.lon) <= 10);
      const src = detectSource({ pollutants, weather, fireNearby });
      const density = densityLabel(centroid.lat, centroid.lon);
      const risk = riskLevel(aqi, density, weather);

      const wardObj = {
        ward_id: wardId,
        ward_name: wardName,
        centroid_lat: centroid.lat,
        centroid_lon: centroid.lon,
        aqi,
        primary_pollutant: dominant,
        dominant_pollutant: dominant,
        source_detection: { ...src, fires: fireNearby ? (firePoints || []).slice(0, 4) : [], fireNearby },
        density,
        risk,
        nearest: (nearest || []).map((x) => ({
          station_name: x.s.station_name,
          station_code: x.s.station_code,
          aqi: x.s.aqi,
          dominant_pollutant: x.s.dominant_pollutant,
          distance_km: Math.round(x.d * 100) / 100,
        })),
      };
      byId.set(wardId, wardObj);
      list.push(wardObj);
      outFeatures.push({
        ...f,
        properties: {
          ...props,
          ward_id: wardId,
          ward_name: wardName,
          centroid_lat: centroid.lat,
          centroid_lon: centroid.lon,
          aqi,
          dominant_pollutant: dominant,
          in_new_delhi: inNewDelhi,
        },
      });
    }
    return { geo: { ...wardsGeo, features: outFeatures }, byId, list };
  }, [wardsGeo, stationList, firePoints, weather.wind_speed, weather.humidity, focusNewDelhi, newDelhiGeo, newDelhiBounds]);

  const wardLabels = useMemo(() => {
    if (!layers.wardLabels) return [];
    if (zoom < 12) return [];
    const ranked = (wardsComputed.list || [])
      .map((w) => ({ ...w, _aqi: safeNum(w.aqi, 0) }))
      .sort((a, b) => b._aqi - a._aqi)
      .slice(0, focusNewDelhi ? 14 : 10);
    return ranked;
  }, [focusNewDelhi, layers.wardLabels, wardsComputed.list, zoom]);

  const nearestSensorsForWard = useMemo(() => {
    if (!selectedWard || !stationList.length) return [];
    const lat = Number(selectedWard.centroid_lat);
    const lon = Number(selectedWard.centroid_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (Array.isArray(selectedWard.nearest) && selectedWard.nearest.length) return selectedWard.nearest.slice(0, 4);
    return [];
  }, [selectedWard, stationList]);

  const gridCells = useMemo(() => {
    if (!layers.grid) return [];
    const geojson = boundaryGeo;
    if (!geojson || !stationList.length) return [];

    // Compute bbox from GeoJSON
    let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    const walk = (coords) => {
      if (!Array.isArray(coords)) return;
      if (coords.length && typeof coords[0] === "number") {
        const [lon, lat] = coords;
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        return;
      }
      coords.forEach(walk);
    };
    (geojson.features || []).forEach((f) => walk(f?.geometry?.coordinates));
    if (minLon > maxLon) return [];

    const cols = 22;
    const rows = 22;
    const dLon = (maxLon - minLon) / cols;
    const dLat = (maxLat - minLat) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const west = minLon + c * dLon;
        const east = west + dLon;
        const south = minLat + r * dLat;
        const north = south + dLat;
        const clat = (south + north) / 2;
        const clon = (west + east) / 2;
        if (!isInsideDelhi(clat, clon, geojson)) continue;

        const { pollutants, nearest } = idwInterpolate({ lat: clat, lon: clon }, stationList, 6, 2);
        const { aqi, dominant } = deriveAqiFromPollutants(pollutants);
        const density = densityLabel(clat, clon);
        const fireNearby = (firePoints || []).some((p) => haversineKm(clat, clon, p.lat, p.lon) <= 10);
        const src = detectSource({ pollutants, weather, fireNearby });
        const risk = riskLevel(aqi, density, weather);
        cells.push({
          id: `${r}-${c}`,
          bounds: [[south, west], [north, east]],
          center: { lat: clat, lon: clon },
          aqi,
          dominant,
          density,
          risk,
          source: src,
          nearest: nearest.map((x) => ({
            station_name: x.s.station_name,
            aqi: x.s.aqi,
            dominant_pollutant: x.s.dominant_pollutant,
            distance_km: Math.round(x.d * 100) / 100,
          })),
        });
      }
    }
    return cells;
  }, [layers.grid, boundaryGeo, stationList, firePoints, weather.wind_speed, weather.humidity]);

  const selected = selectedCell ? gridCells.find((c) => c.id === selectedCell) : null;
  const selectedTone = selectedWard ? aqiTone(safeNum(selectedWard.aqi, 0)) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SectionHeader title="Explore Map — New Delhi" />
        <Badge tone={liveLabel.tone}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: liveLabel.tone === "success" ? "var(--success)" : "var(--warning)" }} />
            {liveLabel.txt}
          </span>
        </Badge>
      </div>

      <div className="card card-elevated" style={{ padding: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Badge tone="info"><Icon name={geo.mode === "device" ? "eye" : "flag"} size={14} /> {geo.mode === "device" ? "Device" : "Demo"}</Badge>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={focusNewDelhi} onChange={(e) => setFocusNewDelhi(e.target.checked)} /> Focus: New Delhi
          </label>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={layers.sensors} onChange={(e) => setLayers((s) => ({ ...s, sensors: e.target.checked }))} /> Sensors
          </label>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={layers.wards} onChange={(e) => setLayers((s) => ({ ...s, wards: e.target.checked }))} /> Wards (AQI)
          </label>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={layers.wardLabels} onChange={(e) => setLayers((s) => ({ ...s, wardLabels: e.target.checked }))} /> Ward labels
          </label>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={layers.grid} onChange={(e) => setLayers((s) => ({ ...s, grid: e.target.checked }))} /> Hyperlocal grid
          </label>
          <label className="tag" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={layers.fires} onChange={(e) => setLayers((s) => ({ ...s, fires: e.target.checked }))} /> FIRMS fires
          </label>
          {(stations.loading || boundary.loading || wardsGrid.loading || newDelhiBoundary.loading) ? <Skeleton height="14px" width="220px" /> : null}
          {(stations.error || boundary.error || wardsGrid.error || newDelhiBoundary.error) ? <span className="muted">Some layers unavailable — using last known values.</span> : null}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <MapContainer center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lon]} zoom={11} style={{ height: "72vh", width: "100%", borderRadius: 16, overflow: "hidden" }}>
          <MapFocus enabled={focusNewDelhi} bounds={newDelhiBounds} />
          <MapZoomTracker onZoom={setZoom} />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO"
          />
          {boundaryGeo ? (
            <GeoJSON
              data={boundaryGeo}
              style={() => ({ color: "#4fd1c5", weight: 2, fillOpacity: 0 })}
            />
          ) : null}

          {/* New Delhi boundary (real admin boundary via Nominatim when available) */}
          {focusNewDelhi && newDelhiGeo ? (
            <GeoJSON
              data={newDelhiGeo}
              style={() => ({ color: "#a78bfa", weight: 2.5, fillColor: "#a78bfa", fillOpacity: 0.06 })}
            />
          ) : focusNewDelhi ? (
            <Rectangle
              bounds={newDelhiBounds}
              pathOptions={{ color: "#a78bfa", weight: 2, dashArray: "6 8", fillColor: "#a78bfa", fillOpacity: 0.06 }}
            />
          ) : null}

          {layers.wards && wardsComputed.geo ? (
            <GeoJSON
              key={`wards-${focusNewDelhi ? "nd" : "all"}`}
              data={wardsComputed.geo}
              style={(feature) => {
                const wid = feature?.properties?.ward_id;
                const aqi = safeNum(feature?.properties?.aqi, 0);
                const t = aqiTone(aqi);
                const isSel = selectedWard && String(wid) === String(selectedWard.ward_id);
                const isHigh = aqi >= 300;
                const isSevere = aqi >= 400;
                return {
                  color: isSel ? "#ffffff" : isHigh ? `${t.color}` : "rgba(255,255,255,0.16)",
                  weight: isSel ? 2.4 : isHigh ? 1.6 : 1,
                  fillColor: Number.isFinite(aqi) ? t.color : "rgba(0,0,0,0)",
                  fillOpacity: Number.isFinite(aqi) ? (isSel ? 0.62 : 0.54) : 0.0,
                  className: isSevere ? "aqi-ward-glow" : isHigh ? "aqi-ward-glow-soft" : "",
                };
              }}
              onEachFeature={(feature, layer) => {
                const wid = feature?.properties?.ward_id;
                const aqi = safeNum(feature?.properties?.aqi, 0);
                const dom = safeStr(feature?.properties?.dominant_pollutant, "");
                const wardName = safeStr(feature?.properties?.ward_name, wid);
                const tone = aqiTone(aqi);
                layer.on({
                  click: () => {
                    const obj = wid ? wardsComputed.byId.get(String(wid)) : null;
                    setSelectedWard(obj || null);
                    setSelectedCell(null);
                    try {
                      const b = layer.getBounds?.();
                      if (b) layer._map?.fitBounds(b, { padding: [22, 22], maxZoom: 13 });
                    } catch {
                      // ignore
                    }
                  },
                  mouseover: () => layer.setStyle({ weight: 2.2, color: `${tone.color}` }),
                  mouseout: () => layer.setStyle({ weight: 1, color: "rgba(255,255,255,0.16)" }),
                });
                layer.bindTooltip(`${wardName} — AQI ${aqi}${dom ? ` · ${dom}` : ""}`, {
                  sticky: true,
                  opacity: 0.9,
                });
              }}
            />
          ) : null}

          {/* Ward labels (top AQI wards in focus area) */}
          {layers.wardLabels ? wardLabels.map((w) => {
            const lat = Number(w.centroid_lat);
            const lon = Number(w.centroid_lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            const aqi = safeNum(w.aqi, 0);
            const t = aqiTone(aqi);
            return (
              <CircleMarker
                key={`lbl-${w.ward_id}`}
                center={[lat, lon]}
                radius={1}
                pathOptions={{ color: "rgba(0,0,0,0)", fillColor: "rgba(0,0,0,0)", fillOpacity: 0, weight: 0 }}
              >
                <Tooltip permanent direction="center" className="ward-label" opacity={1}>
                  <span style={{ borderColor: `${t.color}55` }}>
                    {safeStr(w.ward_name, w.ward_id)} · {aqi}
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          }) : null}

          {layers.sensors && stationList.map((s) => {
            const aqi = safeNum(s.aqi, 0);
            const t = aqiTone(aqi);
            return (
              <CircleMarker
                key={s.station_code}
                center={[s.lat, s.lon]}
                radius={8}
                pathOptions={{ color: t.color, fillColor: t.color, fillOpacity: 0.85, weight: 1 }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                  <div style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 800 }}>{safeStr(s.station_name, s.station_code)}</div>
                    <div>AQI: <b>{aqi}</b> · {safeStr(s.dominant_pollutant, "-")}</div>
                    <div className="muted">Data Source: CPCB</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

          {layers.fires && (firePoints || []).map((f, idx) => (
            <CircleMarker
              key={`${f.lat}-${f.lon}-${idx}`}
              center={[f.lat, f.lon]}
              radius={3}
              pathOptions={{ color: "#ff3b30", fillColor: "#ff3b30", fillOpacity: 0.9, weight: 0 }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                Satellite-detected fire (possible biomass burning)
              </Tooltip>
            </CircleMarker>
          ))}

          {layers.grid && gridCells.map((cell) => {
            const t = aqiTone(cell.aqi);
            const isSel = selectedCell === cell.id;
            return (
              <Rectangle
                key={cell.id}
                bounds={cell.bounds}
                pathOptions={{
                  color: isSel ? "#ffffff" : "#000000",
                  weight: isSel ? 1.5 : 0.25,
                  fillColor: t.color,
                  fillOpacity: 0.52,
                }}
                eventHandlers={{
                  click: () => setSelectedCell(cell.id),
                }}
              >
                <Tooltip sticky opacity={0.9}>
                  AQI {cell.aqi} · {cell.dominant}
                </Tooltip>
              </Rectangle>
            );
          })}
        </MapContainer>

        {/* AQI legend */}
        <div style={{
          position: "absolute",
          left: 14,
          bottom: 14,
          background: "rgba(10,12,18,0.86)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 14,
          padding: 12,
          backdropFilter: "blur(10px)",
          minWidth: 220,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 850 }}>AQI legend</div>
            <div className="muted" style={{ fontSize: 12 }}>Wards</div>
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "Good", v: 40 },
              { label: "Moderate", v: 90 },
              { label: "Poor", v: 170 },
              { label: "Very Poor", v: 260 },
              { label: "Severe", v: 360 },
              { label: "Hazardous", v: 450 },
            ].map((x) => {
              const t = aqiTone(x.v);
              return (
                <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: t.color, boxShadow: `0 0 12px ${t.color}55` }} />
                  <span style={{ fontSize: 12 }}>{x.label}</span>
                </div>
              );
            })}
          </div>
          {selectedWard ? (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="muted" style={{ fontSize: 12 }}>Selected</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: selectedTone?.color || "#fff" }} />
                <div style={{ fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {safeStr(selectedWard.ward_name, selectedWard.ward_id)}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {selectedWard ? (
          <div style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 380,
            maxWidth: "calc(100% - 28px)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            <div className="card card-elevated" style={{
              background: "rgba(10,12,18,0.92)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: 14,
              backdropFilter: "blur(10px)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>{safeStr(selectedWard.ward_name, selectedWard.ward_id)}</span>
                  <Badge tone={aqiTone(safeNum(selectedWard.aqi, 0)).tone}>
                    AQI {safeNum(selectedWard.aqi, 0)}
                  </Badge>
                </div>
                <button className="btn btn-sm" onClick={() => setSelectedWard(null)}>Close</button>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="tag">
                  <Icon name={selectedWard.source_detection?.primary?.icon || "info"} size={14} /> Primary: <b style={{ color: "var(--text-primary)" }}>{safeStr(selectedWard.source_detection?.primary?.label, "-")}</b> ({safeNum(selectedWard.source_detection?.primary?.confidence, 0)}%)
                </span>
                <span className="tag">
                  Dominant: <b style={{ color: "var(--text-primary)" }}>{safeStr(selectedWard.dominant_pollutant, "-")}</b>
                </span>
                <span className="tag">
                  Risk: <b style={{ color: "var(--text-primary)" }}>{safeStr(selectedWard.risk?.level, "-")}</b>
                </span>
              </div>
              <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {safeStr(selectedWard.source_detection?.reasons?.[0], "Calculated using spatial interpolation (IDW) from nearest CPCB sensors.")}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {nearestSensorsForWard.length ? nearestSensorsForWard.map((s, idx) => (
                  <div key={idx} className="tag" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {safeStr(s.station_name, s.station_code)}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{safeNum(s.distance_km, 0)} km</span>
                  </div>
                )) : (
                  <div className="muted">No stations available.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {selected ? (
          <div style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 360,
            maxWidth: "calc(100% - 28px)",
            background: "rgba(10,12,18,0.92)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 16,
            padding: 14,
            backdropFilter: "blur(10px)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>Micro-zone detail</div>
              <button className="btn btn-sm" onClick={() => setSelectedCell(null)}>Close</button>
            </div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="mini">
                <div className="mini-k">AQI</div>
                <div className="mini-v" style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: aqiTone(selected.aqi).color }}>{selected.aqi}</div>
                <div className="mini-s">{safeStr(selected.dominant, "-")}</div>
              </div>
              <div className="mini">
                <div className="mini-k">Risk</div>
                <div className="mini-v">
                  <Badge tone={selected.risk.tone}>{selected.risk.level} Risk</Badge>
                </div>
                <div className="mini-s">{selected.risk.why}</div>
              </div>
              <div className="mini">
                <div className="mini-k">Density</div>
                <div className="mini-v" style={{ fontFamily: "var(--font-mono)", fontWeight: 800 }}>{selected.density}</div>
                <div className="mini-s">Population Density: {selected.density}</div>
              </div>
              <div className="mini">
                <div className="mini-k">Method</div>
                <div className="mini-v"><Icon name="sparkles" size={16} /> IDW</div>
                <div className="mini-s">Calculated using spatial interpolation (IDW)</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="tag">
                  <Icon name={selected.source.primary.icon} size={14} /> Primary: <b>{selected.source.primary.label}</b> ({selected.source.primary.confidence}%)
                </span>
                <span className="tag">
                  <Icon name={selected.source.secondary.icon} size={14} /> Secondary: <b>{selected.source.secondary.label}</b>
                </span>
              </div>
              <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                Why: {safeStr(selected.source.reasons?.[0], "—")}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 850, marginBottom: 6 }}>Nearest sensors used</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selected.nearest.slice(0, 4).map((s, idx) => (
                  <div key={idx} className="tag" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{safeStr(s.station_name, "Sensor")}</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{safeNum(s.distance_km, 0)} km</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
