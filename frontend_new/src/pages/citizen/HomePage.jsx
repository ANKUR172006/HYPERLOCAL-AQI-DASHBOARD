import { useMemo, useRef } from "react";
import {
  useDelhiBoundary,
  useDelhiWardsGrid,
  useEnvironmentUnified,
  useForecast,
  useGeolocation,
  useLocationInsights,
  usePollutants,
  useWardAqi,
  useWardMap,
} from "../../hooks/index.js";
import { aqiTone, safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import WardGeoMap from "../../features/map/WardGeoMap.jsx";

function arrow(delta) {
  if (delta > 4) return { icon: "arrowUp", label: "Rising" };
  if (delta < -4) return { icon: "arrowDown", label: "Falling" };
  return { icon: "minus", label: "Steady" };
}

function advisoryForAqi(aqi) {
  const n = safeNum(aqi, 0);
  if (n <= 50) return ["Enjoy outdoor activities.", "Keep windows open for fresh air."];
  if (n <= 100) return ["Sensitive groups: limit prolonged outdoor exertion.", "Consider a light mask in traffic."];
  if (n <= 200) return ["Reduce outdoor exercise.", "Use N95/FFP2 mask on commutes.", "Keep indoor air clean (close windows during peak traffic)."];
  if (n <= 300) return ["Avoid outdoor exertion.", "Wear N95/FFP2 mask outdoors.", "Use indoor air filtration if available."];
  return ["Stay indoors as much as possible.", "Avoid outdoor exercise.", "Wear N95/FFP2 mask if you must go out.", "Follow local advisories."];
}

function inferCause(primaryPollutant, weather) {
  const p = safeStr(primaryPollutant, "").toUpperCase();
  const wind = safeNum(weather?.wind_speed, 0);
  // `environment/unified` uses Open-Meteo wind speed (typically km/h). Treat <10 km/h as low dispersion.
  const isStagnant = wind > 0 && wind < 10.0;

  if (p.includes("NO2")) return { label: "Traffic & combustion", icon: "car", why: isStagnant ? "Low winds are trapping roadside emissions." : "Traffic corridors typically drive NO₂ spikes." };
  if (p.includes("PM10")) return { label: "Dust & construction", icon: "layers", why: isStagnant ? "Stagnant air increases resuspension and persistence of dust." : "Wind can lift and transport coarse particles (PM10)." };
  if (p.includes("PM2.5")) return { label: "Smoke & fine particles", icon: "flame", why: isStagnant ? "Low winds and higher humidity can keep fine particles suspended." : "Fine particles often come from combustion sources (traffic/biomass)." };
  if (p.includes("CO")) return { label: "Combustion hotspots", icon: "flame", why: isStagnant ? "CO can build up under stagnant conditions." : "CO is associated with incomplete combustion." };
  return { label: "Mixed urban sources", icon: "info", why: isStagnant ? "Low winds reduce dispersion." : "Multiple sources contribute at once." };
}

function riskFromAqi(aqi) {
  const n = safeNum(aqi, 0);
  if (n <= 50) return { level: "Low Risk", tone: "success", label: "Minimal health impact for most people." };
  if (n <= 100) return { level: "Guarded Risk", tone: "info", label: "Sensitive groups may feel effects outdoors." };
  if (n <= 200) return { level: "Moderate Risk", tone: "warning", label: "Reduce prolonged outdoor exertion." };
  if (n <= 300) return { level: "High Risk", tone: "danger", label: "Outdoor exposure can trigger symptoms." };
  return { level: "Extreme Risk", tone: "danger", label: "Disaster-level precautions needed." };
}

function formatPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

export default function HomePage({ onNavigate }) {
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const boundary = useDelhiBoundary();
  const wardPolys = useDelhiWardsGrid();
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);

  const nearestWardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const wardAqi = useWardAqi(nearestWardId);
  const forecast = useForecast(nearestWardId);
  const breakdown = usePollutants(nearestWardId);

  const aqiVal = safeNum(wardAqi.data?.data?.aqi ?? wardAqi.data?.data?.aqi_value ?? wardAqi.data?.data?.value, 0);
  const tone = useMemo(() => aqiTone(aqiVal), [aqiVal]);
  const forecastVal = safeNum(forecast.data?.data?.aqi_pred ?? forecast.data?.data?.aqi ?? forecast.data?.aqi_pred, 0);
  const delta = forecastVal ? forecastVal - aqiVal : 0;
  const dir = arrow(delta);

  const locationLabel = safeStr(env.data?.data?.location?.locality, safeStr(env.data?.data?.location?.city, "Central Delhi"));
  const primaryPollutant = safeStr(wardAqi.data?.data?.primary_pollutant, safeStr(wardMap.data?.data?.[0]?.primary_pollutant, "PM2.5"));
  const weather = env.data?.data?.weather || {};
  const sat = env.data?.data?.satellite || {};
  const cause = inferCause(primaryPollutant, weather);
  const recRef = useRef(null);
  const confidence = useMemo(() => {
    let c = 58;
    if (weather?.wind_speed != null && weather?.humidity != null) c += 18;
    if (sat?.aerosol_index != null) c += 12;
    if (nearestWardId) c += 6;
    return Math.max(45, Math.min(92, c));
  }, [weather?.wind_speed, weather?.humidity, sat?.aerosol_index, nearestWardId]);

  const advisory = useMemo(() => advisoryForAqi(aqiVal), [aqiVal]);
  const risk = useMemo(() => riskFromAqi(aqiVal), [aqiVal]);
  const detection = breakdown.data?.data?.source_detection || wardAqi.data?.data?.source_detection || null;
  const detectionPrimary = detection?.primary || null;
  const detectionSecondary = detection?.secondary || null;
  const detectionReasons = Array.isArray(detection?.reasons) && detection.reasons.length ? detection.reasons : null;
  const detectionTrend = detection?.trend || null;

  const insight = useMemo(() => {
    const raw = breakdown.data?.data?.raw_concentration || {};
    const pm25 = safeNum(raw.pm25, null);
    const pm10 = safeNum(raw.pm10, null);
    const no2 = safeNum(raw.no2, null);
    const wind = safeNum(weather?.wind_speed, null);
    const rh = safeNum(weather?.humidity, null);
    const hour = Number(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", hour12: false }));
    const isPeakTraffic = Number.isFinite(hour) && ((hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21));

    const reasons = [];
    if (Number.isFinite(pm25) && pm25 >= 60) reasons.push(`High PM2.5 (${pm25.toFixed(0)} µg/m³)`);
    if (Number.isFinite(pm10) && pm10 >= 150) reasons.push(`Elevated PM10 (${pm10.toFixed(0)} µg/m³)`);
    if (Number.isFinite(no2) && no2 >= 60) reasons.push(`Traffic-linked NO₂ (${no2.toFixed(0)} µg/m³)`);
    if (isPeakTraffic) reasons.push("Peak traffic hours");
    if (Number.isFinite(wind) && wind < 10) reasons.push(`Low wind (${wind.toFixed(0)} km/h) reduces dispersion`);
    if (Number.isFinite(rh) && rh >= 70) reasons.push(`High humidity (${rh.toFixed(0)}%) increases particle persistence`);
    if (sat?.aerosol_index != null) reasons.push(`Satellite signal: ${Number(sat.aerosol_index).toFixed(2)}`);
    if (!reasons.length) reasons.push("Using pollution + weather context; no single dominant driver detected.");

    let composite = "Mixed sources";
    const p = safeStr(primaryPollutant, "").toUpperCase();
    if (p.includes("PM2.5")) composite = "Traffic + biomass burning";
    else if (p.includes("NO2")) composite = "Traffic corridors";
    else if (p.includes("PM10")) composite = "Dust + construction";
    else if (p.includes("O3")) composite = "Photochemical smog";
    else if (p.includes("CO")) composite = "Combustion hotspots";

    return { composite, reasons };
  }, [breakdown.data, weather?.wind_speed, weather?.humidity, sat?.aerosol_index, primaryPollutant]);

  const affectedPopulation = useMemo(() => {
    // Prototype estimate: Delhi split into ~25 zones; scale by risk.
    const base = 800_000;
    const n = safeNum(aqiVal, 0);
    const factor = n > 300 ? 1.8 : n > 200 ? 1.5 : n > 100 ? 1.2 : 0.9;
    return Math.round(base * factor);
  }, [aqiVal]);

  const rankingNearYou = useMemo(() => {
    const rows = Array.isArray(insights?.data?.ranking) ? insights.data.ranking : [];
    return rows
      .map((r) => ({
        ward_id: safeStr(r?.ward_id, ""),
        ward_name: safeStr(r?.ward_name, r?.ward_id),
        aqi: safeNum(r?.aqi, 0),
        primary: safeStr(r?.primary_pollutant, ""),
        cause: safeStr(r?.source_detection?.primary?.label, ""),
        conf: r?.source_detection?.primary?.confidence,
      }))
      .filter((r) => r.ward_id)
      .slice(0, 5);
  }, [insights?.data]);

  const cityCompare = useMemo(() => {
    const rows = Array.isArray(wardMap.data?.data) ? wardMap.data.data : [];
    const vals = rows.map((r) => safeNum(r?.aqi, null)).filter((n) => Number.isFinite(n));
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const best = rows
      .filter((r) => r?.aqi != null)
      .map((r) => ({ ward_id: safeStr(r.ward_id, ""), ward_name: safeStr(r.ward_name, r.ward_id), aqi: safeNum(r.aqi, 0) }))
      .sort((a, b) => a.aqi - b.aqi)[0] || null;
    const worst = rows
      .filter((r) => r?.aqi != null)
      .map((r) => ({ ward_id: safeStr(r.ward_id, ""), ward_name: safeStr(r.ward_name, r.ward_id), aqi: safeNum(r.aqi, 0) }))
      .sort((a, b) => b.aqi - a.aqi)[0] || null;
    return { avg, best, worst };
  }, [wardMap.data]);

  const pmi = useMemo(() => {
    const n = safeNum(aqiVal, 0);
    const f = safeNum(forecastVal, 0);
    if (!n || !f) return 0;
    return Math.round(f - n);
  }, [aqiVal, forecastVal]);

  return (
    <div className="dash" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div className="card card-elevated" style={{ padding: 18, background: tone.gradient, borderColor: `${tone.color}30`, boxShadow: tone.glow }}>
        <div className="dash-top">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name="mapPin" size={16} color="var(--text-muted)" />
            <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {locationLabel}
            </div>
            <Badge tone="info">
              <Icon name={geo.mode === "device" ? "eye" : "flag"} size={14} />
              {geo.mode === "device" ? "Device" : "Demo"}
            </Badge>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Updated {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })} IST
          </div>
        </div>

        <div className="dash-hero">
          <div className="aqi-block">
            <div className="aqi-value" style={{ color: tone.color }}>{Number.isFinite(aqiVal) ? aqiVal : "—"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="pill" style={{ borderColor: `${tone.color}55`, background: tone.bg, color: tone.text }}>
                <Icon name={tone.icon} size={16} color={tone.color} />
                {tone.label}
              </span>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.9375rem" }}>
                Dominant: <b style={{ color: "var(--text-primary)" }}>{primaryPollutant}</b>
              </span>
            </div>
            <div style={{ marginTop: 10, color: "var(--text-secondary)" }}>
              {tone.description}
            </div>
          </div>

          {/* Quick cards */}
          <div className="dash-metrics">
            <div className="mini" style={{ borderColor: risk.tone === "danger" ? "rgba(196,43,26,0.35)" : undefined }}>
              <div className="mini-k">Risk Level</div>
              <div className="mini-v" style={{ fontWeight: 850 }}>
                <Icon name={risk.tone === "danger" ? "alert" : risk.tone === "warning" ? "triangle" : "info"} size={16} />
                <span style={{ fontFamily: "var(--font-mono)" }}>{risk.level}</span>
              </div>
              <div className="mini-s">
                Affected population: <b style={{ color: "var(--text-primary)" }}>{formatPop(affectedPopulation)}</b>
              </div>
            </div>
            <div className="mini">
              <div className="mini-k">Forecast (3h)</div>
              {forecast.loading ? <Skeleton height="20px" width="90px" /> : (
                <div className="mini-v">
                  <span style={{ color: aqiTone(forecastVal).color, fontWeight: 750, fontFamily: "var(--font-mono)" }}>{forecastVal || "—"}</span>
                  <span className="mini-d">
                    <Icon name={dir.icon} size={14} />
                    {dir.label}
                  </span>
                </div>
              )}
              <div className="mini-s">{safeStr(forecast.data?.data?.category, "")}</div>
            </div>
            <div className="mini">
              <div className="mini-k">Wind</div>
              <div className="mini-v">
                <Icon name="wind" size={16} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{weather.wind_speed != null ? `${weather.wind_speed} km/h` : "—"}</span>
              </div>
              <div className="mini-s">{weather.wind_speed != null && weather.wind_speed < 10 ? "Low dispersion" : "Moderate dispersion"}</div>
            </div>
            <div className="mini">
              <div className="mini-k">Humidity</div>
              <div className="mini-v">
                <Icon name="droplet" size={16} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{weather.humidity != null ? `${weather.humidity}%` : "—"}</span>
              </div>
              <div className="mini-s">{weather.humidity != null && weather.humidity > 70 ? "Particle persistence" : "Normal"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Legacy panels (from old frontend): Ranking + Comparison + PMI */}
      <div className="grid-2">
        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Zone Ranking Near You" right={<Badge tone="info">{rankingNearYou.length ? "Top 5" : "—"}</Badge>} />
          {rankingNearYou.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {rankingNearYou.map((z, idx) => {
                const t = aqiTone(z.aqi);
                return (
                  <div key={z.ward_id || idx} className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {idx + 1}. {z.ward_name || z.ward_id}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: "0.8125rem" }}>
                        Dominant: {z.primary || "—"} · Cause: {z.cause || "Mixed"}{Number.isFinite(z.conf) ? ` (${z.conf}%)` : ""}
                      </div>
                    </div>
                    <div className="pill" style={{ borderColor: `${t.color}55`, background: t.bg, color: t.text }}>
                      <Icon name={t.icon} size={14} color={t.color} />
                      AQI {z.aqi}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted">No ranking yet (needs location insights).</div>
          )}
        </div>

        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Comparative AQI" right={<Badge tone="info">City</Badge>} />
          <div style={{ display: "grid", gap: 10 }}>
            {[
              { label: "Your zone", aqi: aqiVal, extra: nearestWardId ? nearestWardId.replace("DEL_WARD_", "Z") : "—" },
              { label: "City average", aqi: cityCompare.avg, extra: "Mean" },
              { label: "Best zone", aqi: cityCompare.best?.aqi, extra: cityCompare.best?.ward_id ? cityCompare.best.ward_id.replace("DEL_WARD_", "Z") : "—" },
              { label: "Worst zone", aqi: cityCompare.worst?.aqi, extra: cityCompare.worst?.ward_id ? cityCompare.worst.ward_id.replace("DEL_WARD_", "Z") : "—" },
            ].map((r) => {
              const v = safeNum(r.aqi, 0);
              const t = aqiTone(v);
              return (
                <div key={r.label} className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 850 }}>{r.label}</div>
                    <div className="muted" style={{ marginTop: 4, fontSize: "0.8125rem" }}>{r.extra}</div>
                  </div>
                  <div className="pill" style={{ borderColor: `${t.color}55`, background: t.bg, color: t.text }}>
                    <Icon name={t.icon} size={14} color={t.color} />
                    {r.aqi == null ? "—" : `AQI ${v}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card card-elevated" style={{ padding: 16 }}>
        <SectionHeader title="Pollution Momentum Index" right={<Badge tone={pmi > 0 ? "danger" : pmi < 0 ? "success" : "info"}>{pmi > 0 ? "RISING" : pmi < 0 ? "IMPROVING" : "STEADY"}</Badge>} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 900, color: pmi > 0 ? "var(--color-danger)" : pmi < 0 ? "var(--color-success)" : "var(--text-muted)" }}>
            {pmi > 0 ? `+${pmi}` : pmi}
          </div>
          <div className="muted" style={{ lineHeight: 1.6 }}>
            Based on current AQI vs +3h forecast. Use this to see if conditions are likely to worsen soon.
          </div>
        </div>
      </div>

      {/* AI Insight + Health */}
      <div className="grid-2">
        <div className="card card-elevated">
          <SectionHeader
            title="AI Pollution Insight"
            right={(
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => recRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                >
                  View Recommendations
                </button>
                <Badge tone="info">{Number.isFinite(detectionPrimary?.confidence) ? detectionPrimary.confidence : confidence}% confidence</Badge>
              </div>
            )}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div className="ins-ic" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>
              <Icon name={cause.icon} size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "1rem", fontWeight: 850, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name={detectionPrimary?.icon || cause.icon} size={16} />
                  Primary:{" "}
                  <b>
                    {detectionPrimary?.label || insight.composite}
                    {Number.isFinite(detectionPrimary?.confidence) ? ` — ${detectionPrimary.confidence}%` : ""}
                  </b>
                </span>
                {detectionSecondary?.label && detectionSecondary.label !== "—" ? (
                  <span className="tag">
                    <Icon name={detectionSecondary?.icon || "info"} size={14} />
                    Secondary: <b style={{ color: "var(--text-primary)" }}>{detectionSecondary.label}{Number.isFinite(detectionSecondary?.confidence) ? ` — ${detectionSecondary.confidence}%` : ""}</b>
                  </span>
                ) : null}
              </div>
              <div className="muted" style={{ marginTop: 6, lineHeight: 1.65 }}>
                {cause.why} Always shows the “why” (no empty states).
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 750, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Reason
                </div>
                <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                  {(detectionReasons || insight.reasons).slice(0, 4).map((t, idx) => (
                    <li key={idx}>{t}</li>
                  ))}
                </ul>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="tag"><Icon name="thermometer" size={14} />{weather.temperature != null ? `${weather.temperature}°C` : "—"}</span>
                <span className="tag"><Icon name="wind" size={14} />{weather.wind_speed != null ? `${weather.wind_speed} km/h` : "—"}</span>
                <span className="tag"><Icon name="droplet" size={14} />{weather.humidity != null ? `${weather.humidity}%` : "—"}</span>
                {detectionTrend?.direction ? (
                  <span className="tag">
                    <Icon name={detectionTrend.direction === "increasing" ? "arrowUp" : detectionTrend.direction === "decreasing" ? "arrowDown" : "minus"} size={14} />
                    Source trend: {detectionTrend.direction}{Number.isFinite(detectionTrend.delta_pct) ? ` (${detectionTrend.delta_pct > 0 ? "+" : ""}${detectionTrend.delta_pct})` : ""}
                  </span>
                ) : null}
                <span className="tag"><Icon name="satellite" size={14} />{sat?.aerosol_index != null ? `Satellite signal ${Number(sat.aerosol_index).toFixed(2)}` : "Satellite: unavailable"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card card-elevated">
          <SectionHeader title="Health Advisory" right={<Badge tone={aqiVal > 200 ? "danger" : aqiVal > 100 ? "warning" : "success"}>Citizens</Badge>} />
          <ul className="advice">
            {advisory.map((t, idx) => (
              <li key={idx}>
                <span className="dot" style={{ background: tone.color }} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: 10 }}>
            Tip: keep updates enabled—conditions can change within an hour.
          </div>
        </div>
      </div>

      {/* Forecast + Weather impact */}
      <div className="grid-2">
        <div className="card card-elevated">
          <SectionHeader title="AQI Forecast" right={<button className="btn btn-sm" onClick={() => onNavigate?.("trends")}>View trends</button>} />
          {forecast.loading ? (
            <Skeleton height="90px" />
          ) : (
            <div className="forecast">
              <div className="fc-aqi">
                <div className="fc-k">Now</div>
                <div className="fc-v" style={{ color: tone.color }}>{aqiVal || "—"}</div>
              </div>
              <div className="fc-mid">
                <Icon name={dir.icon} size={22} color="var(--text-muted)" />
                <div className="fc-d">{delta ? `${delta > 0 ? "+" : ""}${Math.round(delta)}` : "0"} pts</div>
                <div className="muted">Next 3 hours</div>
              </div>
              <div className="fc-aqi">
                <div className="fc-k">+3h</div>
                <div className="fc-v" style={{ color: aqiTone(forecastVal).color }}>{forecastVal || "—"}</div>
              </div>
            </div>
          )}
          <div className="muted" style={{ marginTop: 10 }}>
            Reasoning: {weather.wind_speed != null && weather.wind_speed < 10 ? "low wind speeds reduce dispersion" : "winds help disperse pollutants"}; humidity can increase particle persistence.
          </div>
        </div>

        <div className="card card-elevated">
          <SectionHeader title="Weather Impact" right={<Badge tone="info">Dispersion</Badge>} />
          {env.loading ? (
            <Skeleton height="110px" />
          ) : (
            <div className="wx">
              <div className="wx-row">
                <Icon name="wind" size={18} />
                <div className="wx-k">Wind</div>
                <div className="wx-v">{weather.wind_speed != null ? `${weather.wind_speed} km/h` : "—"}</div>
                <div className="wx-s">{weather.wind_speed != null && weather.wind_speed < 10 ? "Stagnant air" : "Some mixing"}</div>
              </div>
              <div className="wx-row">
                <Icon name="droplet" size={18} />
                <div className="wx-k">Humidity</div>
                <div className="wx-v">{weather.humidity != null ? `${weather.humidity}%` : "—"}</div>
                <div className="wx-s">{weather.humidity != null && weather.humidity > 70 ? "Higher persistence" : "Normal"}</div>
              </div>
              <div className="wx-row">
                <Icon name="thermometer" size={18} />
                <div className="wx-k">Temp</div>
                <div className="wx-v">{weather.temperature != null ? `${weather.temperature}°C` : "—"}</div>
                <div className="wx-s">{weather.temperature != null && weather.temperature < 18 ? "Stable layer risk" : "Typical"}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="card card-elevated">
        <SectionHeader title="Interactive Zone Map" right={<button className="btn btn-sm" onClick={() => onNavigate?.("explore")}>Explore</button>} />
        <WardGeoMap
          boundary={boundary.data?.data}
          wardGeojson={wardPolys.data?.data}
          wards={wardMap.data?.data}
          loading={boundary.loading || wardPolys.loading || wardMap.loading}
        />
        <div className="muted" style={{ marginTop: 10 }}>
          Tap a zone area to see details (AQI, dominant pollutant, and cause).
        </div>
      </div>

      {/* Recommendations */}
      <div ref={recRef} className="card card-elevated" style={{ padding: 16 }}>
        <SectionHeader title="Recommendations" right={<Badge tone={risk.tone}>{risk.level}</Badge>} />
        <div className="muted" style={{ marginTop: 2 }}>
          Why: {(detectionReasons || insight.reasons)?.[0] || risk.label}
        </div>

        {aqiVal > 300 ? (
          <div className="card-flat" style={{ padding: 12, marginTop: 12, border: "1px solid rgba(196,43,26,0.25)", background: "rgba(196,43,26,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="alert" size={18} color="var(--color-danger)" />
              <div style={{ fontWeight: 900, letterSpacing: "0.03em" }}>DISASTER MODE ACTIVATED</div>
            </div>
            <ul style={{ marginTop: 10, paddingLeft: 18, color: "var(--text-secondary)", lineHeight: 1.65 }}>
              <li>Schools should close / reduce outdoor activity.</li>
              <li>Outdoor activity restricted; mask advisory escalated.</li>
              <li>Emergency response recommended for hotspots.</li>
            </ul>
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div className="card-flat" style={{ padding: 12 }}>
            <div style={{ fontWeight: 850 }}>What next (citizens)</div>
            <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--text-secondary)", lineHeight: 1.65 }}>
              {aqiVal > 300 ? (
                <>
                  <li>Stay indoors; avoid outdoor activity.</li>
                  <li>Wear N95/FFP2 if you must go outside.</li>
                  <li>Close windows during peak hours; use filtration if available.</li>
                </>
              ) : aqiVal > 200 ? (
                <>
                  <li>Limit outdoor exercise; prefer indoor activities.</li>
                  <li>Use a mask on commutes; avoid high-traffic corridors.</li>
                  <li>Reduce exposure for children/elderly/asthma patients.</li>
                </>
              ) : (
                <>
                  <li>Plan commute to avoid peak traffic hours.</li>
                  <li>Ventilate indoors when AQI improves; close windows during spikes.</li>
                  <li>Track updates hourly for rapid changes.</li>
                </>
              )}
            </ul>
          </div>

          <div className="card-flat" style={{ padding: 12 }}>
            <div style={{ fontWeight: 850 }}>What next (government ops)</div>
            <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--text-secondary)", lineHeight: 1.65 }}>
              {safeStr(primaryPollutant, "").toUpperCase().includes("PM10") ? (
                <>
                  <li>Water sprinkling + mechanized sweeping in priority zones.</li>
                  <li>Enforce construction dust controls; cover debris transport.</li>
                </>
              ) : safeStr(primaryPollutant, "").toUpperCase().includes("NO2") ? (
                <>
                  <li>Optimize traffic flow; restrict heavy vehicles in hotspots.</li>
                  <li>Enforce no-idling near schools/hospitals.</li>
                </>
              ) : (
                <>
                  <li>Target smoke sources; curb open burning.</li>
                  <li>Issue advisories + increase monitoring frequency.</li>
                </>
              )}
            </ul>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={() => onNavigate?.("alerts")}>View Alerts</button>
              <button className="btn btn-sm" onClick={() => onNavigate?.("officer")}>Open Officer Dashboard</button>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="card card-elevated">
        <SectionHeader title="Pollutant Mix" right={<Badge tone="info">Zone {nearestWardId || "—"}</Badge>} />
        {breakdown.loading ? (
          <Skeleton height="100px" />
        ) : (
          <div className="mix">
            {["pm25", "pm10", "no2", "so2", "o3", "co"].map((k) => {
              const v = breakdown.data?.data?.raw_concentration?.[k] ?? wardMap.data?.data?.[0]?.[k] ?? null;
              const label = k.toUpperCase().replace("PM25", "PM2.5");
              return (
                <div key={k} className="mix-it">
                  <div className="mix-k">{label}</div>
                  <div className="mix-v">{v != null ? Number(v).toFixed(1) : "—"}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
