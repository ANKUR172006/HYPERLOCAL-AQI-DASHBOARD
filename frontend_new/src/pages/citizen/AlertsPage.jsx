import { useEffect, useMemo, useState } from "react";
import { useAlertsFeed, useAqiForecast, useAppLocation, useEnvironmentUnified, useLocationInsights, useStationsLive, useWardMap } from "../../hooks/index.js";
import { ApiStatusStrip, Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import { AlertItem } from "../../features/alerts/AlertsPreview.jsx";
import { safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatRelativeTime(isoLike, now = new Date()) {
  const d = parseIsoDate(isoLike);
  if (!d) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function AlertsPage() {
  const location = useAppLocation();
  const insights = useLocationInsights(location.lat, location.lon);
  const wardMap = useWardMap(location.lat, location.lon);
  const nearestWard = insights?.data?.nearest_ward || wardMap?.data?.data?.[0] || null;
  const wardId = nearestWard?.ward_id || null;
  const stations = useStationsLive(location.lat, location.lon, 12, 8);
  const env = useEnvironmentUnified(location.lat, location.lon, true);
  const forecast3h = useAqiForecast(wardId, 3);

  const feed = useAlertsFeed();
  const feedItems = Array.isArray(feed.data?.data)
    ? feed.data.data
    : Array.isArray(feed.data?.alerts)
      ? feed.data.alerts
      : Array.isArray(feed.data)
        ? feed.data
        : [];

  const nearestStation = stations.data?.data?.[0] || null;
  const nowVal = nearestStation?.aqi != null ? safeNum(nearestStation?.aqi, 0) : safeNum(nearestWard?.aqi, 0);
  const forecastVal = safeNum(forecast3h.data?.data?.aqi_pred, null);
  const wind = safeNum(env.data?.data?.weather?.wind_speed, null);
  const metCause = wind != null && wind < 10 ? "Low wind conditions" : "Unfavorable dispersion";
  const isDisaster = nowVal > 300;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const now = useMemo(() => new Date(), [tick]);
  const updated = formatRelativeTime(feed.data?.timestamp, now);

  const pinned = useMemo(() => {
    const out = [];
    const zone = wardId || "DEL_WARD_--";
    const isoNow = new Date().toISOString();

    if (isDisaster) {
      out.push({
        id: "system-disaster",
        sev: "critical",
        ward_id: zone,
        title: "DISASTER MODE",
        event: "Live AQI above 300 detected",
        time_utc: isoNow,
        aqi: nowVal,
        action: "Restrict outdoor activity immediately",
        active: true,
        cause: safeStr(env.data?.data?.pollution?.source_detection?.primary?.label, metCause),
      });
    }
    if (nearestStation && nowVal > 200 && !isDisaster) {
      out.push({
        id: "system-high-live",
        sev: "high",
        ward_id: zone,
        title: "LIVE STATION ALERT",
        event: `${nearestStation.station_name} is reporting unhealthy AQI`,
        time_utc: isoNow,
        aqi: nowVal,
        action: "Reduce prolonged outdoor exposure",
        active: true,
        cause: safeStr(env.data?.data?.pollution?.source_detection?.primary?.label, metCause),
      });
    }
    if (Number.isFinite(forecastVal) && forecastVal > 300) {
      out.push({
        id: "system-forecast-3h",
        sev: "high",
        ward_id: zone,
        title: "FORECAST ALERT",
        event: `AQI may cross severe range within 3 hours`,
        time_utc: isoNow,
        aqi: forecastVal,
        action: "Prepare masks, reduce outdoor exposure, and monitor updates",
        active: true,
        cause: `3h forecast ${forecastVal}`,
      });
    }
    return out;
  }, [wardId, isDisaster, nowVal, nearestStation, env.data, metCause, forecastVal]);

  const allItems = useMemo(() => {
    const merged = [...pinned, ...(Array.isArray(feedItems) ? feedItems : [])];
    merged.sort((a, b) => {
      const ta = parseIsoDate(a?.time_utc || a?.timeUtc || a?.time)?.getTime() ?? 0;
      const tb = parseIsoDate(b?.time_utc || b?.timeUtc || b?.time)?.getTime() ?? 0;
      return tb - ta;
    });
    return merged;
  }, [feedItems, pinned]);

  const grouped = useMemo(() => {
    const g = { critical: [], high: [], moderate: [] };
    for (const a of allItems) {
      const sev = String(a?.sev || a?.level || "").toLowerCase();
      const key = sev.includes("critical") ? "critical" : sev.includes("severe") || sev.includes("high") ? "high" : "moderate";
      g[key].push(a);
    }
    return g;
  }, [allItems]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader
        title="Alerts"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="status-dot" />
              <span className="muted">Live feed</span>
            </div>
            {updated ? <Badge tone="info">Updated {updated}</Badge> : null}
          </div>
        }
      />

      <ApiStatusStrip envData={env.data} stationsData={stations.data} />

      <div className="card card-elevated" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name="mapPin" size={18} color="var(--accent)" />
            <div style={{ fontWeight: 850 }}>Primary live source</div>
          </div>
          <div className="tag">{nearestStation ? `${safeNum(nearestStation.distance_km, 0)} km` : "—"}</div>
        </div>
        <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
          {nearestStation
            ? `${nearestStation.station_name} is the nearest live CPCB station. Current AQI: ${nowVal}.`
            : nearestWard
              ? `${safeStr(nearestWard.ward_name, wardId || "Selected ward")} is being used as the current ward estimate. AQI: ${nowVal}.`
              : "No live CPCB station is resolved yet."}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          {Number.isFinite(forecastVal) ? `3-hour forecast is active: AQI ${forecastVal}.` : "Forecast will appear once the backend has a recent ward snapshot."}
        </div>
      </div>

      {feed.loading || stations.loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height="74px" />
          <Skeleton height="74px" />
          <Skeleton height="74px" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grouped.critical.length ? (
            <div>
              <div className="alerts-group-header">
                <div className="alerts-group-title">
                  <Icon name="alert-triangle" size={16} color="var(--color-danger)" /> Critical Alerts
                </div>
                <div className="muted">{grouped.critical.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {grouped.critical.map((a, i) => <AlertItem key={`${a.id ?? `c-${i}`}`} alert={a} />)}
              </div>
            </div>
          ) : null}

          {grouped.high.length ? (
            <div>
              <div className="alerts-group-header">
                <div className="alerts-group-title">
                  <Icon name="alert-circle" size={16} color="var(--color-warning)" /> High Alerts
                </div>
                <div className="muted">{grouped.high.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {grouped.high.map((a, i) => <AlertItem key={`${a.id ?? `h-${i}`}`} alert={a} />)}
              </div>
            </div>
          ) : null}

          {grouped.moderate.length ? (
            <div>
              <div className="alerts-group-header">
                <div className="alerts-group-title">
                  <Icon name="info" size={16} color="var(--color-info)" /> Moderate Alerts
                </div>
                <div className="muted">{grouped.moderate.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {grouped.moderate.map((a, i) => <AlertItem key={`${a.id ?? `m-${i}`}`} alert={a} />)}
              </div>
            </div>
          ) : null}

          {!grouped.critical.length && !grouped.high.length && !grouped.moderate.length ? (
            <div className="card card-elevated" style={{ padding: 16 }}>
              No alerts.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
