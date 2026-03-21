import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import { useAqiForecast, useEnvironmentUnified, useGeolocation, useLocationInsights, useTrends, useWardAqi, useWardMap } from "../../hooks/index.js";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import { aqiTone, safeNum } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";

function fmtHourLabel(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  // Keep as-is; backend sends hour strings already.
  return rows;
}

export default function TrendsPage() {
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const wardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const trends = useTrends(wardId);
  const nowAqi = useWardAqi(wardId);
  const f1 = useAqiForecast(wardId, 1);
  const f2 = useAqiForecast(wardId, 2);
  const f3 = useAqiForecast(wardId, 3);
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);
  const [metric, setMetric] = useState("aqi"); // aqi | pm25 | no2

  const hourly = useMemo(() => {
    const rows = Array.isArray(trends.data?.data?.hourly) ? trends.data.data.hourly : [];
    return fmtHourLabel(rows).map((r, i) => ({
      h: r.h || r.hour || String(i),
      aqi: Number(r.aqi ?? 0),
      pm25: Number(r.pm25 ?? 0),
      pm10: Number(r.pm10 ?? 0),
      no2: Number(r.no2 ?? 0),
      so2: Number(r.so2 ?? 0),
      o3: Number(r.o3 ?? 0),
      co: Number(r.co ?? 0),
    }));
  }, [trends.data]);

  const nowVal = safeNum(nowAqi.data?.data?.aqi ?? nowAqi.data?.data?.aqi_value ?? nowAqi.data?.data?.value, 0);
  const nowTone = aqiTone(nowVal);
  const sourceDet = nowAqi.data?.data?.source_detection || null;
  const f1Val = safeNum(f1.data?.data?.aqi_pred, 0);
  const f2Val = safeNum(f2.data?.data?.aqi_pred, 0);
  const f3Val = safeNum(f3.data?.data?.aqi_pred, 0);

  const stats = useMemo(() => {
    const vals = hourly.map((r) => Number(r.aqi)).filter((n) => Number.isFinite(n));
    if (!vals.length) return { min: null, max: null, avg: null, spike: null };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    let spike = null;
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      if (Math.abs(d) >= 45) spike = { delta: d, at: hourly[i]?.h };
    }
    return { min, max, avg, spike };
  }, [hourly]);

  const view = useMemo(() => {
    const key = metric === "pm25" ? "pm25" : metric === "no2" ? "no2" : "aqi";
    const label = metric === "pm25" ? "PM2.5 (µg/m³)" : metric === "no2" ? "NO₂ (µg/m³)" : "AQI";
    const color = metric === "aqi" ? nowTone.color : "var(--accent)";
    const vals = hourly.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
    const max = vals.length ? Math.max(...vals) : 0;
    const peakPoint = hourly.reduce((best, r) => (Number(r[key] ?? -Infinity) > Number(best?.[key] ?? -Infinity) ? r : best), null);
    const domain = metric === "aqi" ? [0, 500] : [0, Math.max(10, Math.ceil(max / 10) * 10)];
    return { key, label, color, peakPoint, domain };
  }, [metric, hourly, nowTone.color]);

  const trendInsight = useMemo(() => {
    if (!hourly.length) return { icon: "minus", title: "Trend: Steady", reasons: ["Not enough recent data yet."], peak: null };
    const key = view.key;
    const recent = hourly.slice(-3).map((r) => Number(r[key] ?? 0));
    const prev = hourly.slice(-6, -3).map((r) => Number(r[key] ?? 0));
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const d = avg(recent) - avg(prev);
    const dir = d > 8 ? "rising" : d < -8 ? "falling" : "steady";
    const icon = dir === "rising" ? "arrowUp" : dir === "falling" ? "arrowDown" : "minus";
    const title = `Trend: ${dir === "rising" ? "Rising" : dir === "falling" ? "Falling" : "Steady"}`;

    const wind = safeNum(env.data?.data?.weather?.wind_speed, null);
    const pm25Rise = hourly.length >= 2 ? (hourly[hourly.length - 1].pm25 - hourly[hourly.length - 2].pm25) : 0;
    const reasons = [];
    if (Number.isFinite(wind) && wind < 10) reasons.push("Low wind");
    if (Number.isFinite(pm25Rise) && pm25Rise > 5) reasons.push("increasing PM2.5");
    if (!reasons.length) reasons.push("stable conditions");

    const peak = view.peakPoint && metric === "aqi" && Number(view.peakPoint.aqi) >= 300
      ? { at: view.peakPoint.h, value: Number(view.peakPoint.aqi) }
      : null;
    return { icon, title, reasons, peak };
  }, [hourly, env.data, metric, view.key, view.peakPoint]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader
        title="Trends & Forecast"
        right={<Badge tone={nowVal > 200 ? "danger" : nowVal > 100 ? "warning" : "success"}>Zone {wardId ? wardId.replace("DEL_WARD_", "Z") : "-"}</Badge>}
      />

      {!wardId && (
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700 }}>No zone resolved</div>
          <div className="muted" style={{ marginTop: 6 }}>Location insights are unavailable; try reloading after backend restart.</div>
        </div>
      )}

      <div className="grid-2">
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: "0.8125rem" }}>Current AQI</div>
          {nowAqi.loading ? (
            <Skeleton height="56px" />
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 10, height: 34, borderRadius: 999, background: nowTone.color, boxShadow: "0 10px 22px rgba(0,0,0,0.14)" }} />
                <div>
                  <div style={{ fontSize: 44, fontWeight: 820, lineHeight: 1, color: nowTone.color }}>{nowVal || "-"}</div>
                  <div className="muted" style={{ marginTop: 6 }}>{nowTone.label}</div>
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, textAlign: "right" }}>
                <div className="tag"><Icon name="clock" size={14} />{nowAqi.data?.data?.as_of_utc ? "Updated" : "—"}</div>
                {!!stats.avg && <div className="muted">24h avg: <b style={{ color: "var(--text-primary)" }}>{stats.avg}</b></div>}
              </div>
            </div>
          )}
        </div>

        <div className="card card-elevated" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: "0.8125rem" }}>Next 3 hours (forecast)</div>
          {(f1.loading || f2.loading || f3.loading) ? (
            <Skeleton height="86px" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
              {[{ h: "+1h", v: f1Val, meta: f1 }, { h: "+2h", v: f2Val, meta: f2 }, { h: "+3h", v: f3Val, meta: f3 }].map((x) => {
                const t = aqiTone(x.v || 0);
                const delta = (x.v || 0) - nowVal;
                return (
                  <div key={x.h} style={{ border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 12, background: "var(--bg-surface)" }}>
                    <div className="muted" style={{ fontSize: "0.8125rem" }}>{x.h}</div>
                    <div style={{ marginTop: 6, fontWeight: 850, fontSize: 28, color: t.color, lineHeight: 1 }}>{x.v || "-"}</div>
                    <div className="muted" style={{ marginTop: 6, fontSize: "0.8125rem" }}>{delta ? `${delta > 0 ? "+" : ""}${Math.round(delta)} pts` : "0 pts"}</div>
                    <div className="muted" style={{ marginTop: 8, fontSize: "0.75rem" }}>{x.meta.data?.data?.model?.name || "model"}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="muted" style={{ marginTop: 10 }}>
            Forecast auto-generates if the scheduler is down (prevents 404/blank cards).
          </div>
        </div>
      </div>

      <div className="card card-elevated" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800 }}>24-hour history</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {stats.min != null ? `Min ${stats.min} · Max ${stats.max} · Avg ${stats.avg}` : "No history yet (needs a few pipeline cycles)."}
              {stats.spike ? ` · Spike ${stats.spike.delta > 0 ? "+" : ""}${Math.round(stats.spike.delta)} at ${stats.spike.at}:00` : ""}
            </div>
          </div>
          <Badge tone="info">Real data (DB)</Badge>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div className="card-flat" style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Icon name={trendInsight.icon} size={18} color="var(--text-muted)" />
                <div style={{ fontWeight: 850 }}>{trendInsight.title}</div>
              </div>
              <div className="tabs" role="tablist" aria-label="Metric toggle">
                {[
                  { id: "aqi", label: "AQI" },
                  { id: "pm25", label: "PM2.5" },
                  { id: "no2", label: "NO₂" },
                ].map((t) => (
                  <button
                    key={t.id}
                    className={`tab-btn ${metric === t.id ? "active" : ""}`}
                    onClick={() => setMetric(t.id)}
                    type="button"
                    role="tab"
                    aria-selected={metric === t.id}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Reason: {trendInsight.reasons.join(" + ")}.
              {trendInsight.peak ? ` Peak alert at ${trendInsight.peak.at}:00 → ${trendInsight.peak.value} AQI.` : ""}
              {sourceDet?.primary?.label ? ` Detected source: ${sourceDet.primary.label}${Number.isFinite(sourceDet.primary.confidence) ? ` (${sourceDet.primary.confidence}%)` : ""}${sourceDet?.trend?.direction ? ` — ${sourceDet.trend.direction}` : ""}.` : ""}
            </div>
          </div>
        </div>

        {trends.loading ? (
          <Skeleton height="300px" />
        ) : (
          <div style={{ height: 300, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourly} margin={{ left: 6, right: 18, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.35)" />
                <XAxis dataKey="h" tickMargin={8} />
                <YAxis domain={view.domain} tickCount={6} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
                  formatter={(value) => [metric === "aqi" ? `AQI ${value}` : `${value} µg/m³`, ""]}
                  labelFormatter={(label) => `${label}:00`}
                />
                {metric === "aqi" && view.peakPoint && Number(view.peakPoint.aqi) >= 300 ? (
                  <ReferenceDot x={view.peakPoint.h} y={view.peakPoint.aqi} r={6} fill="var(--color-danger)" stroke="#fff" strokeWidth={2} />
                ) : null}
                <Line type="monotone" dataKey={view.key} stroke={view.color} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
