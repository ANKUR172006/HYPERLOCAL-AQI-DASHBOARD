const API_BASE = "/v1";

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
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
    return getJson(`/environment/unified?${qs.toString()}`);
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
  getComplaints(cityId = "DELHI") {
    const qs = new URLSearchParams({ city_id: cityId });
    return getJson(`/complaints?${qs.toString()}`);
  },
  updateComplaint(_id, _patch) {
    // Prototype backend doesn't implement updates yet; keep UI responsive.
    return Promise.resolve({ ok: true });
  },
  patchComplaint(id, patch) {
    return Promise.resolve({ id, ...patch, ok: true });
  },
  getDelhiBoundary() {
    return getJson(`/geojson/delhi-boundary`);
  },
  getDelhiWardsGrid() {
    return getJson(`/geojson/delhi-wards-grid`);
  },
  getNewDelhiBoundary() {
    return getJson(`/geojson/new-delhi-boundary`);
  },
};
