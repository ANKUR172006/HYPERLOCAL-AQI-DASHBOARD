import { useEffect, useMemo, useState } from "react";
import { useAlertsFeed, useAqiForecast, useEnvironmentUnified, useGeolocation, useLocationInsights, useWardAqi, useWardMap } from "../../hooks/index.js";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import { AlertItem } from "../../features/alerts/AlertsPreview.jsx";
import { safeNum } from "../../tokens/index.js";
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
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const wardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const nowAqi = useWardAqi(wardId);
  const f2 = useAqiForecast(wardId, 2);
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);

  const feed = useAlertsFeed();
  const feedItems = Array.isArray(feed.data?.data)
    ? feed.data.data
    : Array.isArray(feed.data?.alerts)
      ? feed.data.alerts
      : Array.isArray(feed.data)
        ? feed.data
        : [];
  const nowVal = safeNum(nowAqi.data?.data?.aqi ?? nowAqi.data?.data?.aqi_value ?? nowAqi.data?.data?.value, 0);
  const pred2 = safeNum(f2.data?.data?.aqi_pred, 0);
  const wind = safeNum(env.data?.data?.weather?.wind_speed, null);
  const metCause = wind != null && wind < 10 ? "Low wind conditions" : "Unfavorable dispersion";
  const cause = metCause;
  const isDisaster = nowVal > 300;
  const crosses250 = pred2 >= 250;

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
        event: "AQI above 300 detected",
        time_utc: isoNow,
        aqi: nowVal,
        action: "Action required: restrict outdoor activity",
        active: true,
        cause: "Smog",
      });
    }
    if (crosses250) {
      out.push({
        id: "system-forecast",
        sev: "high",
        ward_id: zone,
        title: "EARLY WARNING",
        event: "Forecast: may cross 250 (+2h)",
        time_utc: isoNow,
        aqi: pred2,
        action: "Action required: Issue advisory",
        active: true,
        cause: metCause,
      });
    }
    return out;
  }, [wardId, isDisaster, crosses250, nowVal, pred2, metCause]);

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

      {false ? (
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Icon name="triangle" size={18} color="var(--color-warning)" />
              <div style={{ fontWeight: 850 }}>AQI expected to cross 250 in next 2 hours</div>
            </div>
            <div className="tag">Zone {wardId ? wardId.replace("DEL_WARD_", "Z") : "—"}</div>
          </div>
          <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            Cause: {cause}. Forecast: <b style={{ color: "var(--text-primary)" }}>{pred2}</b> AQI at +2h.
          </div>
        </div>
      ) : null}

      {feed.loading ? (
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
