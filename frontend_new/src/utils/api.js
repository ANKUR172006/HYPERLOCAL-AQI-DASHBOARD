const API_BASE = "/v1";
const DEFAULT_TIMEOUT_MS = 12000;

async function fetchWithTimeout(path, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function getJson(path, options = {}) {
  const res = await fetchWithTimeout(path, {}, options.timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function postJson(path, body, options = {}) {
  const res = await fetchWithTimeout(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }, options.timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patchJson(path, body, options = {}) {
  const res = await fetchWithTimeout(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }, options.timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getWardMap(lat, lon, cityId = "DELHI") {
    const qs = new URLSearchParams({
      city_id: cityId,
      lat: String(lat),
      lon: String(lon),
    });
    return getJson(`/ward-map-data?${qs.toString()}`);
  },
  getLocationInsights(lat, lon, cityId = "DELHI") {
    const qs = new URLSearchParams({
      city_id: cityId,
      lat: String(lat),
      lon: String(lon),
      top_n: "8",
    });
    return getJson(`/location-insights?${qs.toString()}`);
  },
  getWardAqi(wardId) {
    const qs = new URLSearchParams({ ward_id: String(wardId) });
    return getJson(`/ward-aqi?${qs.toString()}`);
  },
  getAqiForecast(wardId, horizonHour = 3) {
    const qs = new URLSearchParams({ ward_id: String(wardId), horizon: String(horizonHour) });
    return getJson(`/aqi-forecast?${qs.toString()}`);
  },
  getPollutants(wardId) {
    const qs = new URLSearchParams({ ward_id: String(wardId) });
    return getJson(`/pollutant-breakdown?${qs.toString()}`);
  },
  getWardAlerts(wardId) {
    const qs = new URLSearchParams({ ward_id: String(wardId) });
    return getJson(`/alerts?${qs.toString()}`);
  },
  getAlertsFeed(limit = 12, cityId = "DELHI") {
    const qs = new URLSearchParams({ city_id: cityId, limit: String(limit) });
    return getJson(`/alerts/feed?${qs.toString()}`);
  },
  getTrends(wardId) {
    const qs = new URLSearchParams({ ward_id: String(wardId) });
    return getJson(`/analytics/trends?${qs.toString()}`);
  },
  getEnvironmentUnified(lat, lon, refresh = false) {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      refresh: refresh ? "true" : "false",
    });
    return getJson(`/environment/unified?${qs.toString()}`, {
      timeoutMs: refresh ? 18000 : DEFAULT_TIMEOUT_MS,
    });
  },
  getStationsLive(lat, lon, radiusKm = 60, limit = 80) {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius_km: String(radiusKm),
      limit: String(limit),
    });
    return getJson(`/stations/live?${qs.toString()}`);
  },
  getFiresNearby(lat, lon, radiusKm = 80, days = 2) {
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius_km: String(radiusKm),
      days: String(days),
    });
    return getJson(`/fires/nearby?${qs.toString()}`);
  },
  getGovRecommendations(cityId = "DELHI") {
    const qs = new URLSearchParams({ city_id: cityId });
    return getJson(`/gov/recommendations?${qs.toString()}`);
  },
  getReadiness() {
    return getJson(`/readiness`);
  },
  getDisasterOfficerView(cityId = "DELHI", topN = 10) {
    const qs = new URLSearchParams({ city_id: cityId, top_n: String(topN) });
    return getJson(`/disaster/officer-view?${qs.toString()}`);
  },
  getDisasterStatus(cityId = "DELHI") {
    const qs = new URLSearchParams({ city_id: cityId });
    return getJson(`/disaster/status?${qs.toString()}`);
  },
  getWardReportSummary(wardId, days = 7) {
    const qs = new URLSearchParams({ ward_id: String(wardId), days: String(days) });
    return getJson(`/reports/ward-summary?${qs.toString()}`);
  },
  getComplaints(cityId = "DELHI") {
    const qs = new URLSearchParams({ city_id: cityId });
    return getJson(`/complaints?${qs.toString()}`);
  },
  updateComplaint(id, patch) {
    return patchJson(`/complaints/${id}`, patch);
  },
  patchComplaint(id, patch) {
    return patchJson(`/complaints/${id}`, patch);
  },
  getDelhiBoundary() {
    return getJson(`/geojson/delhi-boundary`);
  },
  getDelhiWardsGrid() {
    return getJson(`/geojson/delhi-wards-grid`);
  },
  getLocationBoundary(lat, lon) {
    const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    return getJson(`/geojson/location-boundary?${qs.toString()}`);
  },
  searchLocations(query, limit = 5) {
    const qs = new URLSearchParams({ q: String(query), limit: String(limit) });
    return getJson(`/location/search?${qs.toString()}`);
  },
  getLocationVirtualGrid(lat, lon, gridSize = 25) {
    const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), grid_size: String(gridSize) });
    return getJson(`/geojson/location-virtual-grid?${qs.toString()}`);
  },
  getNewDelhiBoundary() {
    return getJson(`/geojson/new-delhi-boundary`);
  },
};
