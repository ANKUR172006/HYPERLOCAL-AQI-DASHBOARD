import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import { useAqiForecast, useAppLocation, useEnvironmentUnified, useLocationInsights, useStationsLive, useTrends, useWardMap } from "../../hooks/index.js";
import { ApiStatusStrip, Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import { aqiTone, getAqiCategory, safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";

function clampForecastToCurrent(currentAqi, forecastAqi, horizon) {
  const now = Number(currentAqi);
  const pred = Number(forecastAqi);
  if (!Number.isFinite(now) || !Number.isFinite(pred)) return { aqi: Number.isFinite(pred) ? pred : null, adjusted: false };
  const maxDelta = horizon === 1 ? 35 : horizon === 2 ? 55 : 75;
  const delta = pred - now;
  if (Math.abs(delta) <= maxDelta) return { aqi: pred, adjusted: false };
  return {
    aqi: Math.max(0, Math.min(500, Math.round(now + Math.sign(delta || 1) * maxDelta))),
    adjusted: true,
  };
}

export default function TrendsPage() {
  const location = useAppLocation();
  const insights = useLocationInsights(location.lat, location.lon);
  const wardMap = useWardMap(location.lat, location.lon);
  const nearestWard = insights?.data?.nearest_ward || wardMap?.data?.data?.[0] || null;
  const wardId = nearestWard?.ward_id || null;
  const trends = useTrends(wardId);
  const forecast1h = useAqiForecast(wardId, 1);
  const forecast2h = useAqiForecast(wardId, 2);
  const forecast3h = useAqiForecast(wardId, 3);
  const env = useEnvironmentUnified(location.lat, location.lon, false);
  const stations = useStationsLive(location.lat, location.lon, 12, 8);
  const [metric, setMetric] = useState("aqi");

  const nearestStation = stations.data?.data?.[0] || null;
  const hourly = useMemo(() => {
    const rows = Array.isArray(trends.data?.data?.hourly) ? trends.data.data.hourly : [];
    return rows
      .filter((r) => r.aqi != null)
      .map((r, i) => ({
        h: r.h || r.hour || String(i),
        aqi: Number(r.aqi),
        pm25: r.pm25 != null ? Number(r.pm25) : null,
        pm10: r.pm10 != null ? Number(r.pm10) : null,
        no2: r.no2 != null ? Number(r.no2) : null,
        so2: r.so2 != null ? Number(r.so2) : null,
        o3: r.o3 != null ? Number(r.o3) : null,
        co: r.co != null ? Number(r.co) : null,
      }));
  }, [trends.data]);

  const nowVal = nearestStation?.aqi != null ? safeNum(nearestStation?.aqi, 0) : safeNum(nearestWard?.aqi, 0);
  const nowTone = aqiTone(nowVal);
  const sourceDet = env.data?.data?.pollution?.source_detection || null;
  const forecasts = [forecast1h, forecast2h, forecast3h].map((item, idx) => {
    const data = item?.data?.data || null;
    const pred = safeNum(data?.aqi_pred, null);
    const sanitized = nearestStation?.aqi != null ? clampForecastToCurrent(nowVal, pred, idx + 1) : { aqi: pred, adjusted: false };
    const displayAqi = sanitized.aqi;
    return {
      horizon: idx + 1,
      loading: item.loading,
      error: item.error,
      aqi: displayAqi,
      rawAqi: pred,
      adjusted: sanitized.adjusted,
      category: Number.isFinite(displayAqi) ? getAqiCategory(displayAqi).label : safeStr(data?.category, ""),
      generatedAt: safeStr(data?.ts_generated_utc, ""),
      targetAt: safeStr(data?.target_ts_utc, ""),
      modelName: safeStr(data?.model?.name, ""),
    };
  });
  const forecastReady = forecasts.some((f) => Number.isFinite(f.aqi));
  const forecastAdjusted = forecasts.some((f) => f.adjusted);

  const stats = useMemo(() => {
    const vals = hourly.map((r) => Number(r.aqi)).filter((n) => Number.isFinite(n));
    if (!vals.length) return { min: null, max: null, avg: null, spike: null };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    let spike = null;
    for (let i = 1; i < vals.length; i += 1) {
      const d = vals[i] - vals[i - 1];
      if (Math.abs(d) >= 45) spike = { delta: d, at: hourly[i]?.h };
    }
    return { min, max, avg, spike };
  }, [hourly]);

  const view = useMemo(() => {
    const key = metric === "pm25" ? "pm25" : metric === "no2" ? "no2" : "aqi";
    const color = metric === "aqi" ? nowTone.color : "var(--accent)";
    const vals = hourly.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
    const max = vals.length ? Math.max(...vals) : 0;
    const peakPoint = hourly.reduce((best, r) => (Number(r[key] ?? -Infinity) > Number(best?.[key] ?? -Infinity) ? r : best), null);
    const domain = metric === "aqi" ? [0, 500] : [0, Math.max(10, Math.ceil(max / 10) * 10)];
    return { key, color, peakPoint, domain };
  }, [metric, hourly, nowTone.color]);

  const trendInsight = useMemo(() => {
    if (!hourly.length) return { icon: "minus", title: "Trend: Steady", reasons: ["Not enough recent zone history yet."], peak: null };
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
        title="Live AQI & Zone Trend"
        right={<Badge tone={nowVal > 200 ? "danger" : nowVal > 100 ? "warning" : "success"}>{nearestStation ? "Live CPCB station" : "Zone only"}</Badge>}
      />

      <ApiStatusStrip envData={env.data} stationsData={stations.data} />

      {!nearestStation && !wardId && (
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700 }}>No location resolved</div>
          <div className="muted" style={{ marginTop: 6 }}>Location insights are unavailable; try reloading after backend restart.</div>
        </div>
      )}

      <div className="grid-2">
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: "0.8125rem" }}>Current live AQI</div>
          {stations.loading ? (
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
                <div className="tag"><Icon name="mapPin" size={14} />{nearestStation ? `${safeNum(nearestStation.distance_km, 0)} km` : "-"}</div>
                <div className="muted">{nearestStation?.station_name || "No live station resolved"}</div>
              </div>
            </div>
          )}
        </div>

        <div className="card card-elevated" style={{ padding: 16 }}>
          <div className="muted" style={{ fontSize: "0.8125rem" }}>Forecast</div>
          {(forecast1h.loading || forecast2h.loading || forecast3h.loading) && !forecastReady ? (
            <div style={{ marginTop: 10 }}><Skeleton height="72px" /></div>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {forecasts.map((f) => {
                const tone = aqiTone(safeNum(f.aqi, 0));
                return (
                  <div key={f.horizon} className="mini">
                    <div className="mini-k">{f.horizon}h forecast</div>
                    <div className="mini-v" style={{ color: Number.isFinite(f.aqi) ? tone.color : "var(--text-muted)" }}>
                      {Number.isFinite(f.aqi) ? f.aqi : "-"}
                    </div>
                    <div className="mini-s">
                      {f.category || (f.error ? "Unavailable" : "Pending")}
                    </div>
                    <div className="mini-s">{f.adjusted ? "Live-aligned forecast" : "Zone forecast model"}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {forecastReady
              ? `${forecastAdjusted ? "Forecast is aligned to the current live station reading to avoid unrealistic jumps. " : "Forecast is active and refreshes automatically. "}Model: ${safeStr(forecast3h.data?.data?.model?.name, safeStr(forecast1h.data?.data?.model?.name, "forecast"))}.`
              : "Forecast will appear as soon as the backend has a recent ward snapshot."}
          </div>
        </div>
      </div>

      <div className="card card-elevated" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800 }}>24-hour zone history</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {stats.min != null ? `Min ${stats.min} | Max ${stats.max} | Avg ${stats.avg}` : "No history yet (needs a few pipeline cycles)."}
              {stats.spike ? ` | Spike ${stats.spike.delta > 0 ? "+" : ""}${Math.round(stats.spike.delta)} at ${stats.spike.at}:00` : ""}
            </div>
          </div>
          <Badge tone="info">Zone model</Badge>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Current AQI uses the nearest live station when available. History is zone-level modeled data for your surrounding area.
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
                  { id: "no2", label: "NO2" },
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
              {trendInsight.peak ? ` Peak alert at ${trendInsight.peak.at}:00 -> ${trendInsight.peak.value} AQI.` : ""}
              {sourceDet?.primary?.label ? ` Detected source near the live station: ${sourceDet.primary.label}${Number.isFinite(sourceDet.primary.confidence) ? ` (${sourceDet.primary.confidence}%)` : ""}${sourceDet?.trend?.direction ? ` - ${sourceDet.trend.direction}` : ""}.` : ""}
            </div>
          </div>
        </div>

        {trends.loading ? (
          <Skeleton height="300px" />
        ) : hourly.length <= 1 ? (
          <div className="card-flat" style={{ padding: 20, marginTop: 12, textAlign: "center" }}>
            <Icon name="info" size={20} color="var(--text-muted)" />
            <div style={{ marginTop: 8, fontWeight: 700 }}>Only {hourly.length} data point so far</div>
            <div className="muted" style={{ marginTop: 6 }}>
              The pipeline runs every 5 minutes. Come back after a few cycles to see a real trend chart.
              {hourly.length === 1 ? ` Current: AQI ${hourly[0]?.aqi} at ${hourly[0]?.h}:00` : ""}
            </div>
          </div>
        ) : (
          <div style={{ height: 300, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourly} margin={{ left: 6, right: 18, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.35)" />
                <XAxis dataKey="h" tickMargin={8} />
                <YAxis domain={view.domain} tickCount={6} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
                  formatter={(value) => [metric === "aqi" ? `AQI ${value}` : `${value} ug/m3`, ""]}
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
