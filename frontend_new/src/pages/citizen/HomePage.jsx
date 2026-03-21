import { useMemo } from "react";
import {
  useEnvironmentUnified,
  useForecast,
  useGeolocation,
  useLocationInsights,
  useWardAqi,
  useWardMap,
} from "../../hooks/index.js";
import { aqiTone, safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";
import { Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";

function arrow(delta) {
  if (delta > 4) return { icon: "arrowUp", label: "Rising" };
  if (delta < -4) return { icon: "arrowDown", label: "Falling" };
  return { icon: "minus", label: "Steady" };
}

function advisoryForAqi(aqi) {
  const n = safeNum(aqi, 0);
  if (n <= 50) return ["Enjoy outdoor activities.", "Keep windows open for fresh air."];
  if (n <= 100) return ["Sensitive groups: limit prolonged outdoor exertion.", "Consider a light mask in traffic."];
  if (n <= 200) return ["Reduce outdoor exercise.", "Use N95/FFP2 mask on commutes.", "Keep indoor air clean during peak traffic."];
  if (n <= 300) return ["Avoid outdoor exertion.", "Wear N95/FFP2 mask outdoors.", "Use indoor air filtration if available."];
  return ["Stay indoors as much as possible.", "Avoid outdoor exercise.", "Wear N95/FFP2 mask if you must go out."];
}

function riskFromAqi(aqi) {
  const n = safeNum(aqi, 0);
  if (n <= 50) return { level: "Low Risk", tone: "success", label: "Minimal impact for most people." };
  if (n <= 100) return { level: "Guarded Risk", tone: "info", label: "Sensitive groups may feel effects outdoors." };
  if (n <= 200) return { level: "Moderate Risk", tone: "warning", label: "Reduce prolonged outdoor exertion." };
  if (n <= 300) return { level: "High Risk", tone: "danger", label: "Outdoor exposure can trigger symptoms." };
  return { level: "Extreme Risk", tone: "danger", label: "Disaster-level precautions needed." };
}

function formatPop(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "-";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

export default function HomePage({ onNavigate }) {
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);

  const nearestWardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const wardAqi = useWardAqi(nearestWardId);
  const forecast = useForecast(nearestWardId);

  const aqiVal = safeNum(wardAqi.data?.data?.aqi ?? wardAqi.data?.data?.aqi_value ?? wardAqi.data?.data?.value, 0);
  const tone = useMemo(() => aqiTone(aqiVal), [aqiVal]);
  const forecastVal = safeNum(forecast.data?.data?.aqi_pred ?? forecast.data?.data?.aqi ?? forecast.data?.aqi_pred, 0);
  const delta = forecastVal ? forecastVal - aqiVal : 0;
  const dir = arrow(delta);

  const weather = env.data?.data?.weather || {};
  const locationLabel = safeStr(env.data?.data?.location?.locality, safeStr(env.data?.data?.location?.city, "Central Delhi"));
  const primaryPollutant = safeStr(
    wardAqi.data?.data?.primary_pollutant,
    safeStr(wardMap.data?.data?.[0]?.primary_pollutant, "PM2.5"),
  );

  const advisory = useMemo(() => advisoryForAqi(aqiVal), [aqiVal]);
  const risk = useMemo(() => riskFromAqi(aqiVal), [aqiVal]);

  const affectedPopulation = useMemo(() => {
    const base = 800_000;
    const n = safeNum(aqiVal, 0);
    const factor = n > 300 ? 1.8 : n > 200 ? 1.5 : n > 100 ? 1.2 : 0.9;
    return Math.round(base * factor);
  }, [aqiVal]);

  const det = wardAqi.data?.data?.source_detection || {};
  const detectionPrimary = det?.primary || null;
  const detectionSecondary = det?.secondary || null;
  const detectionReasons = Array.isArray(det?.reasons) ? det.reasons : [];
  const confidence = Number.isFinite(detectionPrimary?.confidence) ? detectionPrimary.confidence : 64;

  return (
    <div className="dash" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div className="aqi-value" style={{ color: tone.color }}>{Number.isFinite(aqiVal) ? aqiVal : "-"}</div>
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
                  <span style={{ color: aqiTone(forecastVal).color, fontWeight: 750, fontFamily: "var(--font-mono)" }}>{forecastVal || "-"}</span>
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
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{weather.wind_speed != null ? `${weather.wind_speed} km/h` : "-"}</span>
              </div>
              <div className="mini-s">{weather.wind_speed != null && weather.wind_speed < 10 ? "Low dispersion" : "Moderate dispersion"}</div>
            </div>
            <div className="mini">
              <div className="mini-k">Humidity</div>
              <div className="mini-v">
                <Icon name="droplet" size={16} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{weather.humidity != null ? `${weather.humidity}%` : "-"}</span>
              </div>
              <div className="mini-s">{weather.humidity != null && weather.humidity > 70 ? "Particle persistence" : "Normal"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card card-elevated" style={{ padding: 16 }}>
        <SectionHeader title="Quick actions" right={<Badge tone="info">Simple view</Badge>} />
        <div className="muted" style={{ marginTop: 2 }}>
          Details moved out of Home to keep it fast and clean.
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => onNavigate?.("insights")}>Open Insights</button>
          <button className="btn btn-sm" onClick={() => onNavigate?.("explore")}>Open Map</button>
          <button className="btn btn-sm" onClick={() => onNavigate?.("trends")}>View Trends</button>
          <button className="btn btn-sm" onClick={() => onNavigate?.("alerts")}>View Alerts</button>
          <button className="btn btn-sm" onClick={() => onNavigate?.("officer")}>Officer</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-elevated">
          <SectionHeader title="Cause preview" right={<Badge tone="info">{confidence}%</Badge>} />
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: "1rem", fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icon name={detectionPrimary?.icon || "info"} size={16} />
                Primary: <b>{safeStr(detectionPrimary?.label, "Mixed sources")}</b>
              </span>
              {detectionSecondary?.label ? (
                <span className="tag">
                  <Icon name={detectionSecondary?.icon || "info"} size={14} />
                  Secondary: <b style={{ color: "var(--text-primary)" }}>{safeStr(detectionSecondary.label, "-")}</b>
                </span>
              ) : null}
            </div>
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.65 }}>
              Why: {safeStr(detectionReasons?.[0], risk.label)}
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-sm" onClick={() => onNavigate?.("insights")}>View full insight + recommendations</button>
            </div>
          </div>
        </div>

        <div className="card card-elevated">
          <SectionHeader title="Health advisory" right={<Badge tone={aqiVal > 200 ? "danger" : aqiVal > 100 ? "warning" : "success"}>Citizens</Badge>} />
          <ul className="advice">
            {advisory.slice(0, 4).map((t, idx) => (
              <li key={idx}>
                <span className="dot" style={{ background: tone.color }} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: 10 }}>
            Tip: conditions can change within an hour.
          </div>
        </div>
      </div>
    </div>
  );
}

