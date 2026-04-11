import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Circle, CircleMarker, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import {
  useAppLocation,
  useDelhiBoundary,
  useDelhiWardsGrid,
  useEnvironmentUnified,
  useFiresNearby,
  useLocationBoundary,
  useLocationInsights,
  useLocationVirtualGrid,
  useNewDelhiBoundary,
  useStationsLive,
  useWardMap,
} from "../../hooks/index.js";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import Icon from "../../components/ui/Icon.jsx";
import { aqiTone, safeLocationLabel, safeNum, safeStr } from "../../tokens/index.js";
import { api } from "../../utils/api.js";

const DEFAULT_CENTER = { lat: 28.4440009, lon: 76.7709646 }; // WCTM College campus, Gurugram
const PRAGATI_MAIDAN_HIGHLIGHT = { stroke: "#ffd166", fill: "#fff3bf" };
const MAX_FALLBACK_MAP_SENSORS = 12;
const MAX_NEAREST_SENSOR_DETAILS = 8;
const WCTM_CAMPUS = {
  lat: 28.4440009,
  lon: 76.7709646,
  radiusMeters: 320,
  title: "WCTM College, Gurugram",
  shortTitle: "WCTM College",
  address: "5 km ahead Farrukhnagar, Khera Khurrampur, Gurugram, Haryana 122506",
  source: "Official WCTM contact page / Google Maps pin",
  focusKm: 18,
  regionFocusKm: 5,
};

function mixHex(a, b, t) {
  const ah = String(a).replace("#", "");
  const bh = String(b).replace("#", "");
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${b2})`;
}

function heatColor(aqi) {
  return aqiTone(aqi).color;
}

function buildPollutionReason(ward) {
  if (!ward) return "No explanation available for this area yet.";
  const primary = safeStr(ward.source_detection?.primary?.label, safeStr(ward.dominant_pollutant, "mixed factors"));
  const secondary = safeStr(ward.source_detection?.secondary?.label, "");
  const reasons = Array.isArray(ward.source_detection?.reasons) ? ward.source_detection.reasons.filter(Boolean) : [];
  const hotspot = ward.hotspot_location;
  const parts = [];
  parts.push(`Likely driven by ${primary.toLowerCase()}.`);
  if (secondary && !secondary.includes("—")) parts.push(`Secondary signal points to ${secondary.toLowerCase()}.`);
  if (reasons[0]) parts.push(reasons[0] + ".");
  if (hotspot?.place_name) parts.push(`Nearest strong measured hotspot is ${safeStr(hotspot.place_name, "nearby")} (${safeNum(hotspot.distance_km, 0)} km away).`);
  return parts.join(" ");
}

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

function rankNearestStations(lat, lon, sensors, limit = MAX_NEAREST_SENSOR_DETAILS) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(sensors) || !sensors.length) return [];
  return [...sensors]
    .map((sensor) => ({
      station_name: sensor.station_name,
      station_code: sensor.station_code,
      aqi: sensor.aqi,
      dominant_pollutant: sensor.dominant_pollutant,
      distance_km: Math.round(haversineKm(lat, lon, sensor.lat, sensor.lon) * 100) / 100,
    }))
    .sort((a, b) => safeNum(a.distance_km, 1e9) - safeNum(b.distance_km, 1e9))
    .slice(0, limit);
}

function geometryContainsLocation(geometry, lat, lon) {
  try {
    if (!geometry) return false;
    if (geometry.type === "Polygon") {
      return pointInPolygon(lat, lon, geometry.coordinates?.[0] || []);
    }
    if (geometry.type === "MultiPolygon") {
      return (geometry.coordinates || []).some((poly) => pointInPolygon(lat, lon, poly?.[0] || []));
    }
    return false;
  } catch {
    return false;
  }
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

function boundsFromPoints(points) {
  try {
    let minLat = 90;
    let minLon = 180;
    let maxLat = -90;
    let maxLon = -180;
    for (const point of points || []) {
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      minLat = Math.min(minLat, lat);
      minLon = Math.min(minLon, lon);
      maxLat = Math.max(maxLat, lat);
      maxLon = Math.max(maxLon, lon);
    }
    if (minLat > maxLat || minLon > maxLon) return null;
    return [[minLat, minLon], [maxLat, maxLon]];
  } catch {
    return null;
  }
}

function mergeBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ];
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

function MapCenterOnLocation({ center }) {
  const map = useMap();
  useEffect(() => {
    if (!center?.lat || !center?.lon) return;
    try {
      map.setView([center.lat, center.lon], Math.max(map.getZoom(), 11), { animate: true });
    } catch {
      // ignore
    }
  }, [center?.lat, center?.lon, map]);
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

function geojsonContainsLocation(geojson, lat, lon) {
  try {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    return features.some((feature) => geometryContainsLocation(feature?.geometry, lat, lon));
  } catch {
    return false;
  }
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

function canonicalWardId(rawId, cityId = "DELHI", fallbackIndex = 1) {
  const normalizedCity = safeStr(cityId, "DELHI").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const city = normalizedCity === "DELHI" ? "DEL" : normalizedCity;
  const raw = safeStr(rawId, "").trim();
  if (!raw) return `${city}_WARD_${String(fallbackIndex).padStart(3, "0")}`;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (upper.startsWith(`${city}_WARD_`)) return upper;
  const digits = raw.replace(/\D+/g, "");
  if (digits) return `${city}_WARD_${String(Number(digits)).padStart(3, "0")}`;
  return upper;
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
  const [focusNewDelhi, setFocusNewDelhi] = useState(false);
  const [layers, setLayers] = useState({ wards: true, grid: false, sensors: true, fires: true, wardLabels: true });
  const [zoom, setZoom] = useState(11);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const location = useAppLocation();
  const center = { lat: location.lat, lon: location.lon, label: location.label, source: location.mode };

  const boundary = useDelhiBoundary();
  const newDelhiBoundary = useNewDelhiBoundary();
  const wardsGrid = useDelhiWardsGrid();
  const locationBoundary = useLocationBoundary(center.lat, center.lon);
  const locationGrid = useLocationVirtualGrid(center.lat, center.lon, 25);
  const locationInsights = useLocationInsights(center.lat, center.lon);
  const wardMap = useWardMap(center.lat, center.lon);
  const stations = useStationsLive(center.lat, center.lon, 120, 120);
  const env = useEnvironmentUnified(center.lat, center.lon, false);
  const firesNearby = useFiresNearby(center.lat, center.lon, 80, 2);

  const stationList = stations.data?.data || [];
  const firePoints = firesNearby.data?.fires || [];
  const weather = env.data?.data?.weather || {};

  const tsSlot = stations.data?.ts_slot_utc || null;
  const freshness = safeStr(stations.data?.freshness, "");
  const ageMinutes = safeNum(stations.data?.age_minutes, null);
  const liveLabel = useMemo(() => {
    if (!tsSlot) return { txt: "Using last known data", tone: "warning" };
    const mins = Number.isFinite(ageMinutes)
      ? ageMinutes
      : Math.max(0, Math.round((Date.now() - new Date(tsSlot).getTime()) / 60000));
    if (!Number.isFinite(mins)) return { txt: "Using last known data", tone: "warning" };
    if (freshness === "stale") return { txt: `Using cached CPCB data · ${mins} min old`, tone: "warning" };
    return { txt: `Live Air Quality Data · Updated ${mins} min ago`, tone: "success" };
  }, [ageMinutes, freshness, tsSlot]);

  const locationMode = safeStr(locationBoundary.data?.mode, safeStr(wardMap.data?.mode, safeStr(locationInsights.data?.mode, "delhi")));
  const isDelhiMode = locationMode === "delhi";
  const region = locationBoundary.data?.region || locationInsights.data?.region || null;
  const delhiRegionLabel = [safeLocationLabel(region?.district, ""), safeLocationLabel(region?.city, "Delhi")].filter(Boolean).join(", ");
  const boundaryGeo = isDelhiMode ? (locationBoundary.data?.data || boundary.data?.data || null) : (locationBoundary.data?.data || null);
  const newDelhiGeo = newDelhiBoundary.data?.data || null;
  const wardsGeo = isDelhiMode ? (wardsGrid.data?.data || locationGrid.data?.data || null) : (locationGrid.data?.data || null);
  const hasRealWardPolygons = safeStr(locationGrid.data?.mode, "") === "real" || (isDelhiMode && !!wardsGrid.data?.data);
  const fallbackBounds = useMemo(() => bboxFromCenterKm(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon, 12), []);
  const newDelhiBounds = useMemo(() => boundsFromGeoJson(newDelhiGeo) || fallbackBounds, [newDelhiGeo, fallbackBounds]);
  const districtBounds = useMemo(() => boundsFromGeoJson(locationBoundary.data?.data) || null, [locationBoundary.data?.data]);
  const regionBounds = useMemo(() => boundsFromGeoJson(boundaryGeo) || fallbackBounds, [boundaryGeo, fallbackBounds]);
  const wardsBounds = useMemo(() => boundsFromGeoJson(wardsGeo) || districtBounds || regionBounds, [wardsGeo, districtBounds, regionBounds]);
  const stationsInsideRegion = useMemo(() => {
    if (!stationList.length || !boundaryGeo) return [];
    return stationList.filter((station) => geojsonContainsLocation(boundaryGeo, station.lat, station.lon));
  }, [boundaryGeo, stationList]);
  const mapStationList = useMemo(() => {
    if (!stationList.length) return [];
    if (isDelhiMode) return stationList;
    if (stationsInsideRegion.length) return stationsInsideRegion;
    return [...stationList]
      .sort((a, b) => safeNum(a.distance_km, 1e9) - safeNum(b.distance_km, 1e9))
      .slice(0, MAX_FALLBACK_MAP_SENSORS);
  }, [isDelhiMode, stationList, stationsInsideRegion]);
  const sensorBounds = useMemo(() => boundsFromPoints([{ lat: center.lat, lon: center.lon }, ...mapStationList]), [center.lat, center.lon, mapStationList]);
  const wardMapRows = wardMap.data?.data || [];
  const wardMapById = useMemo(() => {
    const byId = new Map();
    for (const row of wardMapRows) {
      const id = safeStr(row?.ward_id, "");
      if (id) byId.set(id, row);
    }
    return byId;
  }, [wardMapRows]);

  const wardsComputed = useMemo(() => {
    if (!wardsGeo) return { geo: null, byId: new Map(), list: [] };
    const features = Array.isArray(wardsGeo.features) ? wardsGeo.features : [];
    const outFeatures = [];
    const byId = new Map();
    const list = [];
    for (let idx = 0; idx < features.length; idx += 1) {
      const f = features[idx];
      const props = f?.properties || {};
      const rawWardId =
        safeStr(
          props.ward_id,
          safeStr(
            props.Ward_ID,
            safeStr(
              props.wardId,
              safeStr(
                props.WARD_ID,
                safeStr(
                  props.Ward_No,
                  safeStr(props.ward_no, safeStr(props.wardNo, safeStr(props.WARD_NO, safeStr(props.id, "")))),
                ),
              ),
            ),
          ),
        ) || null;
      const wardId = canonicalWardId(rawWardId, isDelhiMode ? "DELHI" : safeStr(wardMap.data?.city_id, "LOCAL"), idx + 1);
      const wardName = safeStr(props.Ward_Name, safeStr(props.ward_name, safeStr(props.name, wardId || "Ward")));
      const centroid = centroidFromGeometry(f?.geometry) || null;
      if (!wardId || !centroid) continue;
      const apiWard = wardMapById.get(wardId) || null;

      const inNewDelhi = isDelhiMode && (newDelhiGeo ? isInsideBoundary(centroid.lat, centroid.lon, newDelhiGeo) : (
        centroid.lat >= newDelhiBounds[0][0] && centroid.lat <= newDelhiBounds[1][0] && centroid.lon >= newDelhiBounds[0][1] && centroid.lon <= newDelhiBounds[1][1]
      ));
      if (isDelhiMode && focusNewDelhi && !inNewDelhi) continue;

      const { pollutants, nearest } = stationList.length ? idwInterpolate({ lat: centroid.lat, lon: centroid.lon }, stationList, 6, 2) : { pollutants: {}, nearest: [] };
      const fallbackAqi = deriveAqiFromPollutants(pollutants || {});
      const aqi = safeNum(apiWard?.aqi, fallbackAqi.aqi);
      const dominant = safeStr(apiWard?.primary_pollutant, fallbackAqi.dominant);
      const fireNearby = (firePoints || []).some((p) => haversineKm(centroid.lat, centroid.lon, p.lat, p.lon) <= 10);
      const src = apiWard?.source_detection || detectSource({ pollutants, weather, fireNearby });
      const density = densityLabel(centroid.lat, centroid.lon);
      const risk = riskLevel(aqi, density, weather);

      const wardObj = {
        ward_id: wardId,
        ward_name: safeStr(apiWard?.ward_name, wardName),
        centroid_lat: safeNum(apiWard?.centroid_lat, centroid.lat),
        centroid_lon: safeNum(apiWard?.centroid_lon, centroid.lon),
        aqi,
        primary_pollutant: dominant,
        dominant_pollutant: dominant,
        source_detection: { ...src, fires: fireNearby ? (firePoints || []).slice(0, 4) : [], fireNearby },
        hotspot_location: apiWard?.hotspot_location || null,
        density,
        risk,
        sensors_online: safeNum(apiWard?.sensors_online, Math.max(1, (nearest || []).length || 0)),
        estimated: Boolean(apiWard?.estimated),
        as_of_utc: apiWard?.as_of_utc || null,
        nearest: Array.isArray(apiWard?.nearest) && apiWard.nearest.length ? apiWard.nearest : (nearest || []).map((x) => ({
          station_name: x.s.station_name,
          station_code: x.s.station_code,
          aqi: x.s.aqi,
          dominant_pollutant: x.s.dominant_pollutant,
          distance_km: Math.round(x.d * 100) / 100,
        })),
      };
      const isPragatiMaidan =
        isDelhiMode &&
        geometryContainsLocation(f?.geometry, DEFAULT_CENTER.lat, DEFAULT_CENTER.lon);
      wardObj.is_pragati_maidan = isPragatiMaidan;
      byId.set(wardId, wardObj);
      list.push(wardObj);
      outFeatures.push({
        ...f,
        properties: {
          ...props,
          ward_id: wardId,
          ward_name: safeStr(apiWard?.ward_name, wardName),
          centroid_lat: safeNum(apiWard?.centroid_lat, centroid.lat),
          centroid_lon: safeNum(apiWard?.centroid_lon, centroid.lon),
          aqi,
          dominant_pollutant: dominant,
          is_pragati_maidan: isPragatiMaidan,
          in_new_delhi: inNewDelhi,
        },
      });
    }
    return { geo: { ...wardsGeo, features: outFeatures }, byId, list };
  }, [wardsGeo, wardMapById, stationList, firePoints, weather.wind_speed, weather.humidity, focusNewDelhi, isDelhiMode, newDelhiGeo, newDelhiBounds, wardMap.data?.city_id]);

  const wardLabels = useMemo(() => {
    if (!layers.wardLabels) return [];
    if (zoom < 10) return [];
    const ranked = (wardsComputed.list || [])
      .map((w) => ({ ...w, _aqi: safeNum(w.aqi, 0) }))
      .sort((a, b) => b._aqi - a._aqi)
      .slice(0, zoom >= 12 ? (isDelhiMode && focusNewDelhi ? 18 : 14) : (isDelhiMode && focusNewDelhi ? 10 : 8));
    if (selectedWard?.ward_id && !ranked.some((w) => String(w.ward_id) === String(selectedWard.ward_id))) {
      const selected = (wardsComputed.list || []).find((w) => String(w.ward_id) === String(selectedWard.ward_id));
      if (selected) ranked.unshift(selected);
    }
    return ranked;
  }, [focusNewDelhi, isDelhiMode, layers.wardLabels, selectedWard, wardsComputed.list, zoom]);

  const searchedWard = useMemo(() => {
    if (!location.hasSelectedLocation) return null;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const features = Array.isArray(wardsComputed.geo?.features) ? wardsComputed.geo.features : [];
    for (const feature of features) {
      const wardId = safeStr(feature?.properties?.ward_id, "");
      if (!wardId) continue;
      if (geometryContainsLocation(feature?.geometry, lat, lon)) {
        return wardsComputed.byId.get(wardId) || null;
      }
    }

    let nearestWard = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const ward of wardsComputed.list || []) {
      const wardLat = Number(ward?.centroid_lat);
      const wardLon = Number(ward?.centroid_lon);
      if (!Number.isFinite(wardLat) || !Number.isFinite(wardLon)) continue;
      const distance = haversineKm(lat, lon, wardLat, wardLon);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestWard = ward;
      }
    }
    return nearestWard;
  }, [center.lat, center.lon, location.hasSelectedLocation, wardsComputed.byId, wardsComputed.geo, wardsComputed.list]);
  const searchedWardId = searchedWard?.ward_id ? String(searchedWard.ward_id) : "";
  const distanceToCampusKm = useMemo(
    () => haversineKm(center.lat, center.lon, WCTM_CAMPUS.lat, WCTM_CAMPUS.lon),
    [center.lat, center.lon],
  );
  const campusInView = distanceToCampusKm <= WCTM_CAMPUS.focusKm || safeStr(locationBoundary.data?.city_id, "").includes("GURUGRAM");
  const regionLabel = isDelhiMode
    ? safeLocationLabel(delhiRegionLabel, "Delhi")
    : (campusInView ? `${WCTM_CAMPUS.shortTitle} Region` : [safeLocationLabel(region?.city, ""), safeLocationLabel(region?.district, ""), safeLocationLabel(region?.state, "India")].filter(Boolean).join(", "));
  const activeLocationLabel = !isDelhiMode && campusInView
    ? `${WCTM_CAMPUS.shortTitle} campus region`
    : safeLocationLabel(location.label, regionLabel || "WCTM College, Gurugram");
  const campusRegionBounds = useMemo(
    () => bboxFromCenterKm(WCTM_CAMPUS.lat, WCTM_CAMPUS.lon, WCTM_CAMPUS.regionFocusKm),
    [],
  );
  const focusBounds = isDelhiMode ? (districtBounds || newDelhiBounds) : wardsBounds;
  const activeMapBounds = useMemo(() => {
    if (isDelhiMode) {
      return focusNewDelhi ? focusBounds : (wardsBounds || regionBounds || fallbackBounds);
    }
    if (campusInView) {
      return mergeBounds(campusRegionBounds, stationsInsideRegion.length ? null : sensorBounds);
    }
    if (stationsInsideRegion.length) {
      return wardsBounds || regionBounds || fallbackBounds;
    }
    return mergeBounds(wardsBounds || regionBounds || fallbackBounds, sensorBounds) || fallbackBounds;
  }, [
    campusInView,
    campusRegionBounds,
    fallbackBounds,
    focusBounds,
    focusNewDelhi,
    isDelhiMode,
    regionBounds,
    sensorBounds,
    stationsInsideRegion.length,
    wardsBounds,
  ]);
  const campusWard = useMemo(() => {
    if (!campusInView) return null;
    let nearest = null;
    let best = Number.POSITIVE_INFINITY;
    for (const ward of wardsComputed.list || []) {
      const wardLat = Number(ward?.centroid_lat);
      const wardLon = Number(ward?.centroid_lon);
      if (!Number.isFinite(wardLat) || !Number.isFinite(wardLon)) continue;
      const d = haversineKm(WCTM_CAMPUS.lat, WCTM_CAMPUS.lon, wardLat, wardLon);
      if (d < best) {
        best = d;
        nearest = ward;
      }
    }
    return nearest;
  }, [campusInView, wardsComputed.list]);

  const sensorLabels = useMemo(() => {
    if (!layers.sensors) return [];
    if (zoom < 11) return [];
    const ranked = [...mapStationList];
    const wardLat = Number(selectedWard?.centroid_lat);
    const wardLon = Number(selectedWard?.centroid_lon);
    if (Number.isFinite(wardLat) && Number.isFinite(wardLon)) {
      ranked.sort(
        (a, b) => haversineKm(wardLat, wardLon, a.lat, a.lon) - haversineKm(wardLat, wardLon, b.lat, b.lon),
      );
    } else {
      ranked.sort((a, b) => safeNum(b.aqi, 0) - safeNum(a.aqi, 0));
    }
    return ranked.slice(0, zoom >= 12 ? 14 : 8);
  }, [layers.sensors, mapStationList, selectedWard?.centroid_lat, selectedWard?.centroid_lon, zoom]);

  const nearestSensorsForWard = useMemo(() => {
    if (!selectedWard) return [];
    const lat = Number(selectedWard.centroid_lat);
    const lon = Number(selectedWard.centroid_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (Array.isArray(selectedWard.nearest) && selectedWard.nearest.length) {
      return [...selectedWard.nearest]
        .sort((a, b) => safeNum(a.distance_km, 1e9) - safeNum(b.distance_km, 1e9))
        .slice(0, MAX_NEAREST_SENSOR_DETAILS);
    }
    return rankNearestStations(lat, lon, mapStationList, MAX_NEAREST_SENSOR_DETAILS);
  }, [mapStationList, selectedWard]);

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
        if (!isInsideBoundary(clat, clon, geojson)) continue;

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

  async function handleLocationSearch(event) {
    event?.preventDefault?.();
    const query = safeStr(searchQuery, "").trim();
    if (query.length < 2) {
      setSearchError("Enter a city, area, or lat,lon.");
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const res = await api.searchLocations(query, 6);
      const results = Array.isArray(res?.data) ? res.data : [];
      setSearchResults(results);
      if (!results.length) setSearchError("No India location found for that search.");
    } catch (err) {
      setSearchResults([]);
      setSearchError(err?.message || "Location search failed.");
    } finally {
      setSearchLoading(false);
    }
  }

  function applyManualLocation(item) {
    if (!item) return;
    location.setSelectedLocation({
      lat: Number(item.lat),
      lon: Number(item.lon),
      label: safeStr(item.display_name, "Selected location"),
      source: "search",
    });
    setSearchQuery(safeStr(item.display_name, ""));
    setSearchResults([]);
    setSelectedWard(null);
    setSelectedCell(null);
  }

  function clearSearchedLocation() {
    location.clearSelectedLocation();
    setSearchResults([]);
    setSelectedWard(null);
    setSelectedCell(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SectionHeader title={`Explore Map — ${regionLabel || "India"}`} />
        <Badge tone={liveLabel.tone}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: liveLabel.tone === "success" ? "var(--success)" : "var(--warning)" }} />
            {liveLabel.txt}
          </span>
        </Badge>
      </div>

      <div className="card card-elevated" style={{ padding: 10 }}>
        <form onSubmit={handleLocationSearch} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: "1 1 320px", minWidth: 220, display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any city, area, district, or paste lat,lon"
              style={{
                width: "100%",
                minHeight: 40,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--text-primary)",
                padding: "0 14px",
              }}
            />
          </div>
          <button className="btn" type="submit" disabled={searchLoading}>{searchLoading ? "Searching..." : "Search location"}</button>
          <button className="btn btn-secondary" type="button" onClick={clearSearchedLocation}>Clear search</button>
          <Badge tone={location.hasSelectedLocation ? "warning" : "info"}>
            {location.hasSelectedLocation ? "Searched location" : "Default location"}
          </Badge>
        </form>
        {searchError ? <div className="muted" style={{ marginBottom: 10 }}>{searchError}</div> : null}
        {searchResults.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            {searchResults.map((item, idx) => (
              <button
                key={`${item.lat}-${item.lon}-${idx}`}
                type="button"
                className="tag"
                onClick={() => applyManualLocation(item)}
                style={{ textAlign: "left", padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
              >
                {safeStr(item.display_name, "Selected location")}
              </button>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Badge tone="info"><Icon name={location.mode === "search" ? "search" : location.mode === "device" ? "eye" : "flag"} size={14} /> {location.mode === "search" ? "Searched" : location.mode === "device" ? "Device" : "Default"}</Badge>
          {location.geo?.error && location.mode !== "search" ? <Badge tone="warning">GPS off: {safeStr(location.geo.error, "disabled")}</Badge> : null}
          <Badge tone="info">{activeLocationLabel}</Badge>
          {campusInView ? <Badge tone="success">{WCTM_CAMPUS.shortTitle} · {distanceToCampusKm.toFixed(1)} km</Badge> : null}
          {isDelhiMode ? (
            <label className="tag" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={focusNewDelhi} onChange={(e) => setFocusNewDelhi(e.target.checked)} /> District focus: {safeStr(region?.district, "Delhi district")}
            </label>
          ) : (
            <Badge tone="info">{safeStr(region?.district, "Detected district")} · {safeStr(region?.state, "India")}</Badge>
          )}
          {!isDelhiMode ? (
            <Badge tone={stationsInsideRegion.length ? "success" : "warning"}>
              {stationsInsideRegion.length ? `${stationsInsideRegion.length} live sensors in region` : `${mapStationList.length} nearest live CPCB sensors shown`}
            </Badge>
          ) : null}
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
          {searchedWardId ? <Badge tone="warning">Search ward: {safeStr(searchedWard?.ward_name, searchedWardId)}</Badge> : null}
          {(stations.loading || boundary.loading || wardsGrid.loading || newDelhiBoundary.loading || locationBoundary.loading || locationGrid.loading || wardMap.loading) ? <Skeleton height="14px" width="220px" /> : null}
          {(stations.error || boundary.error || wardsGrid.error || newDelhiBoundary.error || locationBoundary.error || locationGrid.error || wardMap.error) ? <span className="muted">Some layers unavailable — using last known values.</span> : null}
        </div>
        {campusInView ? (
          <div className="card-flat" style={{ marginTop: 12, padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontWeight: 850 }}>{WCTM_CAMPUS.title}</div>
              <Badge tone="success">Official college pin</Badge>
            </div>
            <div className="muted" style={{ lineHeight: 1.6 }}>
              {WCTM_CAMPUS.address}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="tag">Lat {WCTM_CAMPUS.lat}</span>
              <span className="tag">Lon {WCTM_CAMPUS.lon}</span>
              <span className="tag">Campus focus radius {WCTM_CAMPUS.radiusMeters} m</span>
              <span className="tag">District: {safeStr(region?.district, "Gurugram")}</span>
              {campusWard ? <span className="tag">Nearest ward: {safeStr(campusWard.ward_name, campusWard.ward_id)}</span> : null}
            </div>
            <div className="muted" style={{ fontSize: "0.875rem" }}>
              Map sources: district boundary from backend district GeoJSON/topology, campus anchor from the official WCTM contact-page Google Maps pin.
            </div>
          </div>
        ) : null}
        {!isDelhiMode && !stationsInsideRegion.length && mapStationList.length ? (
          <div className="card-flat" style={{ marginTop: 12, padding: 12 }}>
            <div style={{ fontWeight: 800 }}>Sensor coverage for {safeStr(region?.district, "this region")}</div>
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
              CPCB does not currently appear to expose a live station inside this district in the feed, so the map shows the nearest live stations around Gurugram while the ward AQI layer is still interpolated from those nearby measurements.
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ position: "relative" }}>
        <MapContainer center={[center.lat, center.lon]} zoom={11} style={{ height: "72vh", width: "100%", borderRadius: 16, overflow: "hidden" }}>
          <MapCenterOnLocation center={center} />
          <MapFocus enabled={true} bounds={activeMapBounds} />
          <MapZoomTracker onZoom={setZoom} />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO"
          />
          {boundaryGeo ? (
            <GeoJSON
              data={boundaryGeo}
              style={() => ({ color: isDelhiMode ? "#4fd1c5" : "#38bdf8", weight: isDelhiMode ? 2 : 2.4, fillOpacity: 0 })}
            />
          ) : null}

          {/* New Delhi boundary (real admin boundary via Nominatim when available) */}
          {isDelhiMode && focusNewDelhi && boundaryGeo ? (
            <GeoJSON
              data={boundaryGeo}
              style={() => ({ color: "#a78bfa", weight: 2.5, fillOpacity: 0 })}
            />
          ) : isDelhiMode && focusNewDelhi ? (
            <Rectangle
              bounds={focusBounds}
              pathOptions={{ color: "#a78bfa", weight: 2, dashArray: "6 8", fillOpacity: 0 }}
            />
          ) : null}

          {layers.wards && wardsComputed.geo ? (
            <GeoJSON
              key={`wards-${isDelhiMode && focusNewDelhi ? "nd" : "all"}`}
              data={wardsComputed.geo}
              style={(feature) => {
                const wid = feature?.properties?.ward_id;
                const aqi = safeNum(feature?.properties?.aqi, 0);
                const fill = heatColor(aqi);
                const isSel = selectedWard && String(wid) === String(selectedWard.ward_id);
                const isSearchMatch = searchedWardId && String(wid) === searchedWardId;
                const isHigh = aqi >= 300;
                const isSevere = aqi >= 400;
                return {
                  color: isSearchMatch ? "#f59e0b" : isSel ? "#ffffff" : "rgba(255,255,255,0.22)",
                  weight: isSearchMatch ? 3.2 : isSel ? 2.4 : isHigh ? 1.2 : 0.8,
                  fillColor: Number.isFinite(aqi) ? fill : "rgba(0,0,0,0)",
                  fillOpacity: Number.isFinite(aqi) ? (isSearchMatch ? 0.8 : isSel ? 0.82 : 0.68) : 0.0,
                  className: isSevere ? "aqi-ward-glow" : isHigh ? "aqi-ward-glow-soft" : "",
                };
              }}
              onEachFeature={(feature, layer) => {
                const wid = feature?.properties?.ward_id;
                const aqi = safeNum(feature?.properties?.aqi, 0);
                const dom = safeStr(feature?.properties?.dominant_pollutant, "");
                const wardName = safeStr(feature?.properties?.ward_name, wid);
                const fill = heatColor(aqi);
                const isSelectedWard = selectedWard && String(wid) === String(selectedWard.ward_id);
                const isSearchMatch = searchedWardId && String(wid) === searchedWardId;
                const isHigh = aqi >= 300;
                const isPragatiMaidan = Boolean(feature?.properties?.is_pragati_maidan);
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
                  mouseover: () => layer.setStyle({ weight: 2.2, color: "#ffffff", fillOpacity: 0.84 }),
                  mouseout: () => layer.setStyle({
                    weight: isSearchMatch ? 3.2 : isSelectedWard ? 2.4 : isHigh ? 1.2 : 0.8,
                    color: isSearchMatch ? "#f59e0b" : isSelectedWard ? "#ffffff" : "rgba(255,255,255,0.22)",
                    fillColor: Number.isFinite(aqi) ? fill : "rgba(0,0,0,0)",
                    fillOpacity: Number.isFinite(aqi) ? (isSearchMatch ? 0.8 : isSelectedWard ? 0.82 : 0.68) : 0,
                  }),
                });
                layer.bindTooltip(`${wardName}${isPragatiMaidan ? " · Pragati Maidan" : ""} — AQI ${aqi}${dom ? ` · ${dom}` : ""}`, {
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
                interactive={false}
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

          {layers.sensors ? sensorLabels.map((s) => {
            const lat = Number(s.lat);
            const lon = Number(s.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return (
              <CircleMarker
                key={`sensor-label-${s.station_code}`}
                center={[lat, lon]}
                radius={1}
                interactive={false}
                pathOptions={{ color: "rgba(0,0,0,0)", fillColor: "rgba(0,0,0,0)", fillOpacity: 0, weight: 0 }}
              >
                <Tooltip permanent direction="top" offset={[0, -12]} className="sensor-label" opacity={0.96}>
                  <span>{safeStr(s.station_name, s.station_code)}</span>
                </Tooltip>
              </CircleMarker>
            );
          }) : null}

          {layers.sensors && mapStationList.map((s) => {
            const aqi = safeNum(s.aqi, 0);
            const t = aqiTone(aqi);
            const derived = safeStr(s.aqi_mode, "").includes("derived");
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
                    <div>{derived ? "Derived AQI" : "AQI"}: <b>{aqi}</b> · {safeStr(s.dominant_pollutant, "-")}</div>
                    <div className="muted">Data Source: {safeStr(s.source, "CPCB")}{derived ? " · from CPCB pollutants" : ""}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

          {center?.lat && center?.lon ? (
            <CircleMarker
              center={[center.lat, center.lon]}
              radius={9}
              pathOptions={{ color: "#ffffff", fillColor: "#38bdf8", fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                Your location
              </Tooltip>
            </CircleMarker>
          ) : null}

          {campusInView ? (
            <>
              <Circle
                center={[WCTM_CAMPUS.lat, WCTM_CAMPUS.lon]}
                radius={WCTM_CAMPUS.radiusMeters}
                pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.08, weight: 2, dashArray: "8 8" }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.97}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 800 }}>{WCTM_CAMPUS.title}</div>
                    <div>{WCTM_CAMPUS.address}</div>
                    <div className="muted" style={{ marginTop: 4 }}>Campus zone highlight from official college map pin.</div>
                  </div>
                </Tooltip>
              </Circle>
              <CircleMarker
                center={[WCTM_CAMPUS.lat, WCTM_CAMPUS.lon]}
                radius={10}
                pathOptions={{ color: "#fff7ed", fillColor: "#f59e0b", fillOpacity: 0.95, weight: 2 }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.97}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 800 }}>{WCTM_CAMPUS.shortTitle}</div>
                    <div>{WCTM_CAMPUS.address}</div>
                    {campusWard ? <div className="muted" style={{ marginTop: 4 }}>Nearest ward: {safeStr(campusWard.ward_name, campusWard.ward_id)}</div> : null}
                  </div>
                </Tooltip>
              </CircleMarker>
            </>
          ) : null}

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
            const fill = heatColor(cell.aqi);
            const isSel = selectedCell === cell.id;
            return (
              <Rectangle
                key={cell.id}
                bounds={cell.bounds}
                pathOptions={{
                  color: isSel ? "#ffffff" : "#000000",
                  weight: isSel ? 1.5 : 0.25,
                  fillColor: fill,
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
          <div className="muted" style={{ fontSize: 12 }}>{hasRealWardPolygons ? "Real wards" : (isDelhiMode ? "Delhi wards" : "Virtual wards")}</div>
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
                <span className="tag">
                  {selectedWard.estimated ? "Estimated ward AQI" : "Ward snapshot"}
                </span>
              </div>
              <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {safeStr(selectedWard.source_detection?.reasons?.[0], "Calculated using spatial interpolation (IDW) from nearest CPCB sensors.")}
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="mini">
                  <div className="mini-k">Data trust</div>
                  <div className="mini-v">{selectedWard.estimated ? "Interpolated" : "Snapshot"}</div>
                  <div className="mini-s">{selectedWard.estimated ? "Built from nearby live CPCB sensors" : "Latest stored ward reading"}</div>
                </div>
                <div className="mini">
                  <div className="mini-k">Updated</div>
                  <div className="mini-v">{selectedWard.as_of_utc ? safeStr(selectedWard.as_of_utc, "Live") : "Live"}</div>
                  <div className="mini-s">{selectedWard.hotspot_location ? "Hotspot-backed context" : "Area summary"}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="info" size={14} />
                  Reason behind pollution
                </div>
                <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
                  {buildPollutionReason(selectedWard)}
                </div>
              </div>
              {selectedWard.hotspot_location ? (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Icon name="map-pin" size={14} />
                    Hotspot near {safeStr(selectedWard.hotspot_location.place_name, "measured location")}
                    <Badge tone={aqiTone(safeNum(selectedWard.hotspot_location.aqi, 0)).tone}>
                      AQI {safeNum(selectedWard.hotspot_location.aqi, 0)}
                    </Badge>
                  </div>
                  <div className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
                    {safeStr(selectedWard.hotspot_location.reason, "Strongest measured hotspot around this ward.")}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="tag">Lat {safeNum(selectedWard.hotspot_location.lat, 0)}</span>
                    <span className="tag">Lon {safeNum(selectedWard.hotspot_location.lon, 0)}</span>
                    <span className="tag">{safeStr(selectedWard.hotspot_location.primary_pollutant, "-")}</span>
                    <span className="tag">{safeNum(selectedWard.hotspot_location.distance_km, 0)} km away</span>
                  </div>
                </div>
              ) : null}
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
                {selected.nearest.slice(0, MAX_NEAREST_SENSOR_DETAILS).map((s, idx) => (
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
