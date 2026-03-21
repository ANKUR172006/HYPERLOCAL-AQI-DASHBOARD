import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

const GEOLOCATION_MODE = String(import.meta?.env?.VITE_GEOLOCATION_MODE || 'demo').toLowerCase(); // demo | device | off
const DEMO_LOCATION_LABEL = String(import.meta?.env?.VITE_DEMO_LOCATION_LABEL || 'Pragati Maidan, Delhi');
const DEMO_LOCATION_LAT = Number(import.meta?.env?.VITE_DEMO_LAT || 28.6129);
const DEMO_LOCATION_LON = Number(import.meta?.env?.VITE_DEMO_LON || 77.2295);

// Generic data fetching hook with loading/error/retry
export function useAsync(asyncFn, deps = []) {
  const [state, setState] = useState({ data: null, loading: !!asyncFn, error: null });
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    if (!asyncFn) { setState(s => ({ ...s, loading: false })); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const data = await asyncFn();
      if (mountedRef.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (mountedRef.current) setState({ data: null, loading: false, error: err.message || 'Unknown error' });
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
  return useAsync(wardId ? () => api.getAqiForecast(wardId, 3) : null, [wardId]);
}

export function useAqiForecast(wardId, horizonHour = 3) {
  return useAsync(wardId ? () => api.getAqiForecast(wardId, horizonHour) : null, [wardId, horizonHour]);
}

export function usePollutants(wardId) {
  return useAsync(wardId ? () => api.getPollutants(wardId) : null, [wardId]);
}

export function useWardAlerts(wardId) {
  return useAsync(wardId ? () => api.getWardAlerts(wardId) : null, [wardId]);
}

export function useAlertsFeed() {
  return useAsync(() => api.getAlertsFeed(12), []);
}

export function useTrends(wardId) {
  return useAsync(wardId ? () => api.getTrends(wardId) : null, [wardId]);
}

export function useLocationInsights(lat, lon) {
  return useAsync(
    lat && lon ? () => api.getLocationInsights(lat, lon) : null,
    [lat, lon]
  );
}

export function useWardMap(lat, lon) {
  return useAsync(
    lat && lon ? () => api.getWardMap(lat, lon) : null,
    [lat, lon]
  );
}

export function useGovRecommendations() {
  return useAsync(() => api.getGovRecommendations(), []);
}

export function useComplaints() {
  return useAsync(() => api.getComplaints(), []);
}

export function useEnvironmentUnified(lat, lon, refresh = false) {
  return useAsync(
    lat && lon ? () => api.getEnvironmentUnified(lat, lon, refresh) : null,
    [lat, lon, refresh]
  );
}

export function useDelhiBoundary() {
  return useAsync(() => api.getDelhiBoundary(), []);
}

export function useDelhiWardsGrid() {
  return useAsync(() => api.getDelhiWardsGrid(), []);
}
