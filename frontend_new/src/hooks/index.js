import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../utils/api';

export const APP_AUTO_REFRESH_MS = 300_000;

const GEOLOCATION_MODE = String(import.meta?.env?.VITE_GEOLOCATION_MODE || 'off').toLowerCase(); // demo | device | off
const DEMO_LOCATION_LABEL = String(import.meta?.env?.VITE_DEMO_LOCATION_LABEL || 'Pragati Maidan, Delhi');
const DEMO_LOCATION_LAT = Number(import.meta?.env?.VITE_DEMO_LAT || 28.6129);
const DEMO_LOCATION_LON = Number(import.meta?.env?.VITE_DEMO_LON || 77.2295);
const LOCATION_STORAGE_KEY = 'aqi:selected_location';
const LOCATION_EVENT = 'aqi:selected-location-changed';

function defaultLocation() {
  return { lat: DEMO_LOCATION_LAT, lon: DEMO_LOCATION_LON, label: DEMO_LOCATION_LABEL, source: 'default' };
}

function normalizeStoredLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: String(value.label || 'Selected location'),
    source: String(value.source || 'search'),
  };
}

function readStoredLocation() {
  try {
    return normalizeStoredLocation(JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

function writeStoredLocation(location) {
  const normalized = normalizeStoredLocation(location);
  if (!normalized) return null;
  localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(LOCATION_EVENT, { detail: normalized }));
  return normalized;
}

function clearStoredLocation() {
  localStorage.removeItem(LOCATION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(LOCATION_EVENT, { detail: null }));
}

// Generic data fetching hook with loading/error/retry
export function useAsync(asyncFn, deps = [], options = {}) {
  const refreshMs = Number(options?.refreshMs || 0);
  const [state, setState] = useState({ data: null, loading: !!asyncFn, error: null });
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    if (!asyncFn) { setState(s => ({ ...s, loading: false })); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const data = await asyncFn();
      if (mountedRef.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (mountedRef.current) {
        setState((prev) => ({ data: prev.data, loading: false, error: err.message || 'Unknown error' }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    if (!asyncFn) {
      setState(s => ({ ...s, loading: false }));
    } else {
      run();
    }
    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (!asyncFn || !Number.isFinite(refreshMs) || refreshMs <= 0) return undefined;
    const timer = window.setInterval(() => {
      if (mountedRef.current) run();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [asyncFn, refreshMs, run]);

  return { ...state, retry: run };
}

// Geolocation hook
export function useGeolocation() {
  const [geo, setGeo] = useState({ lat: null, lon: null, loading: true, error: null, mode: GEOLOCATION_MODE, label: DEMO_LOCATION_LABEL });

  useEffect(() => {
    if (GEOLOCATION_MODE === 'off') {
      setGeo({ lat: null, lon: null, loading: false, error: 'disabled', mode: 'off', label: DEMO_LOCATION_LABEL });
      return;
    }

    if (GEOLOCATION_MODE !== 'device') {
      setGeo({ lat: DEMO_LOCATION_LAT, lon: DEMO_LOCATION_LON, loading: false, error: null, mode: 'demo', label: DEMO_LOCATION_LABEL });
      return;
    }

    if (!navigator.geolocation) {
      setGeo({ lat: DEMO_LOCATION_LAT, lon: DEMO_LOCATION_LON, loading: false, error: 'geolocation_unsupported', mode: 'demo', label: DEMO_LOCATION_LABEL });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude, loading: false, error: null, mode: 'device', label: 'Device location' }),
      (err) => {
        // Fallback to Delhi center
        setGeo({ lat: DEMO_LOCATION_LAT, lon: DEMO_LOCATION_LON, loading: false, error: err.code === 1 ? 'denied' : 'unavailable', mode: 'demo', label: DEMO_LOCATION_LABEL });
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  return geo;
}

export function useSelectedLocation() {
  const [location, setLocationState] = useState(() => readStoredLocation());

  useEffect(() => {
    const syncFromStorage = () => setLocationState(readStoredLocation());
    const syncFromEvent = (event) => setLocationState(normalizeStoredLocation(event?.detail));
    window.addEventListener('storage', syncFromStorage);
    window.addEventListener(LOCATION_EVENT, syncFromEvent);
    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener(LOCATION_EVENT, syncFromEvent);
    };
  }, []);

  const setLocation = useCallback((next) => {
    const normalized = writeStoredLocation(next);
    setLocationState(normalized);
  }, []);

  const clearLocation = useCallback(() => {
    clearStoredLocation();
    setLocationState(null);
  }, []);

  return { location, setLocation, clearLocation };
}

export function useAppLocation() {
  const geo = useGeolocation();
  const selected = useSelectedLocation();

  const location = useMemo(() => {
    if (selected.location) return selected.location;
    if (Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
      return { lat: geo.lat, lon: geo.lon, label: geo.label, source: geo.mode };
    }
    return defaultLocation();
  }, [geo.label, geo.lat, geo.lon, geo.mode, selected.location]);

  const locationMode = selected.location ? 'search' : location.source;

  return {
    ...location,
    mode: locationMode,
    hasSelectedLocation: !!selected.location,
    setSelectedLocation: selected.setLocation,
    clearSelectedLocation: selected.clearLocation,
    geo,
  };
}

// Theme hook
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => t === 'light' ? 'dark' : 'light'), []);
  return { theme, toggle };
}

// Ward data hooks
export function useWardAqi(wardId) {
  return useAsync(wardId ? () => api.getWardAqi(wardId) : null, [wardId]);
}

export function useForecast(wardId) {
  return useAsync(wardId ? () => api.getAqiForecast(wardId, 3) : null, [wardId], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useAqiForecast(wardId, horizonHour = 3) {
  return useAsync(wardId ? () => api.getAqiForecast(wardId, horizonHour) : null, [wardId, horizonHour], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function usePollutants(wardId) {
  return useAsync(wardId ? () => api.getPollutants(wardId) : null, [wardId], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useWardAlerts(wardId) {
  return useAsync(wardId ? () => api.getWardAlerts(wardId) : null, [wardId], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useAlertsFeed() {
  return useAsync(() => api.getAlertsFeed(12), [], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useTrends(wardId) {
  return useAsync(wardId ? () => api.getTrends(wardId) : null, [wardId], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useLocationInsights(lat, lon) {
  return useAsync(
    lat && lon ? () => api.getLocationInsights(lat, lon) : null,
    [lat, lon],
    { refreshMs: APP_AUTO_REFRESH_MS }
  );
}

export function useWardMap(lat, lon) {
  return useAsync(
    lat && lon ? () => api.getWardMap(lat, lon) : null,
    [lat, lon],
    { refreshMs: APP_AUTO_REFRESH_MS }
  );
}

export function useGovRecommendations() {
  return useAsync(() => api.getGovRecommendations(), [], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useReadiness() {
  return useAsync(() => api.getReadiness(), [], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useComplaints() {
  return useAsync(() => api.getComplaints(), [], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useEnvironmentUnified(lat, lon, refresh = false) {
  return useAsync(
    lat && lon ? () => api.getEnvironmentUnified(lat, lon, refresh) : null,
    [lat, lon, refresh],
    { refreshMs: APP_AUTO_REFRESH_MS }
  );
}

export function useStationsLive(lat, lon, radiusKm = 60, limit = 80) {
  return useAsync(
    lat && lon ? () => api.getStationsLive(lat, lon, radiusKm, limit) : null,
    [lat, lon, radiusKm, limit],
    { refreshMs: APP_AUTO_REFRESH_MS }
  );
}

export function useFiresNearby(lat, lon, radiusKm = 80, days = 2) {
  return useAsync(
    lat && lon ? () => api.getFiresNearby(lat, lon, radiusKm, days) : null,
    [lat, lon, radiusKm, days],
    { refreshMs: APP_AUTO_REFRESH_MS }
  );
}

export function useDelhiBoundary() {
  return useAsync(() => api.getDelhiBoundary(), []);
}

export function useDelhiWardsGrid() {
  return useAsync(() => api.getDelhiWardsGrid(), []);
}

export function useLocationBoundary(lat, lon) {
  return useAsync(lat && lon ? () => api.getLocationBoundary(lat, lon) : null, [lat, lon], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useLocationVirtualGrid(lat, lon, gridSize = 25) {
  return useAsync(lat && lon ? () => api.getLocationVirtualGrid(lat, lon, gridSize) : null, [lat, lon, gridSize], { refreshMs: APP_AUTO_REFRESH_MS });
}

export function useNewDelhiBoundary() {
  return useAsync(() => api.getNewDelhiBoundary(), []);
}
