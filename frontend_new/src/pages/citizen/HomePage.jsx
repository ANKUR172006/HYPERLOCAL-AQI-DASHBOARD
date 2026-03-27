import { useMemo } from "react";
import {
  useAppLocation,
  useEnvironmentUnified,
  useLocationInsights,
  useStationsLive,
  useWardMap,
} from "../../hooks/index.js";
import { aqiTone, safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";
import { ApiStatusStrip, Badge, SectionHeader, Skeleton } from "../../components/ui/index.jsx";

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
  const location = useAppLocation();
  const insights = useLocationInsights(location.lat, location.lon);
  const wardMap = useWardMap(location.lat, location.lon);
  const env = useEnvironmentUnified(location.lat, location.lon, true);
  const stations = useStationsLive(location.lat, location.lon, 70, 8);

  const nearestWardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const nearestWard = insights?.data?.nearest_ward || wardMap?.data?.data?.[0] || null;
  const nearestStation = stations.data?.data?.[0] || null;
  const stationFreshness = safeStr(stations.data?.freshness, nearestStation ? "live" : "");
  const stationAgeMinutes = safeNum(stations.data?.age_minutes, null);

  const aqiVal = nearestStation?.aqi != null ? safeNum(nearestStation?.aqi, 0) : safeNum(nearestWard?.aqi, null);
  const tone = useMemo(() => aqiTone(aqiVal), [aqiVal]);

  const weather = env.data?.data?.weather || {};
  const region = insights?.data?.region || wardMap?.data?.region || null;
  const locationLabel = safeStr(
    env.data?.data?.location?.locality,
    safeStr(
      env.data?.data?.location?.city,
      [safeStr(region?.city, ""), safeStr(region?.district, ""), safeStr(region?.state, "")].filter(Boolean).join(", ") || "Current location",
    ),
  );
  const primaryPollutant = safeStr(
    nearestStation?.dominant_pollutant,
    safeStr(env.data?.data?.pollution?.station_name ? "station mix" : nearestWard?.primary_pollutant, "PM2.5"),
  );

  const advisory = useMemo(() => advisoryForAqi(aqiVal), [aqiVal]);
  const risk = useMemo(() => riskFromAqi(aqiVal), [aqiVal]);

  const affectedPopulation = useMemo(() => {
    const realPop = nearestWard?.disaster_assessment?.affected_population;
    if (realPop && realPop > 0) return realPop;
    const base = safeNum(insights?.data?.nearest_ward?.population, 50000);
    return base > 0 ? base : null;
  }, [nearestWard, insights?.data]);

  const det = env.data?.data?.pollution?.source_detection || {};
  const detectionPrimary = det?.primary || null;
  const detectionSecondary = det?.secondary || null;
  const detectionReasons = Array.isArray(det?.reasons) ? det.reasons : [];
  const confidence = Number.isFinite(detectionPrimary?.confidence) ? detectionPrimary.confidence : null;
  const firesPayload = env.data?.data?.fires || {};
  const fires = Array.isArray(firesPayload?.fires) ? firesPayload.fires : [];
  const fireNearby = Boolean(firesPayload?.fireNearby ?? det?.fireNearby);
  const satellite = env.data?.data?.satellite || {};
  const satSource = safeStr(satellite?.source, "-");
  const satMeta = satellite?.metadata || {};
  const satHotspots = safeNum(satMeta?.hotspot_count, fires.length);

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
              <Icon name={location.mode === "search" ? "search" : location.mode === "device" ? "eye" : "flag"} size={14} />
              {location.mode === "search" ? "Searched" : location.mode === "device" ? "Device" : "Default"}
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
              <Badge tone={nearestStation ? "success" : nearestWard ? "info" : "warning"}>
                {nearestStation ? (stationFreshness === "stale" ? "CPCB cache" : "Live CPCB station") : nearestWard ? "Virtual ward AQI" : "Awaiting live station"}
              </Badge>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.9375rem" }}>
                Dominant: <b style={{ color: "var(--text-primary)" }}>{primaryPollutant}</b>
              </span>
            </div>
            <div style={{ marginTop: 10, color: "var(--text-secondary)" }}>
              {nearestStation
                ? `${tone.description} Nearest station: ${safeStr(nearestStation.station_name, "Unknown station")} (${safeNum(nearestStation.distance_km, 0)} km).`
                : nearestWard
                  ? `${tone.description} Virtual ward: ${safeStr(nearestWard.ward_name, nearestWard.ward_id)}.`
                  : tone.description}
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
              <div className="mini-k">Primary source</div>
              {stations.loading ? <Skeleton height="20px" width="120px" /> : nearestStation ? (
                <div className="mini-v">
                  <span style={{ color: tone.color, fontWeight: 750, fontFamily: "var(--font-mono)" }}>{safeNum(nearestStation?.distance_km, 0)} km</span>
                  <span className="mini-d"><Icon name="mapPin" size={14} />{stationFreshness === "stale" ? "Cached" : "Live"}</span>
                </div>
              ) : (
                <div className="mini-v">
                  <span style={{ color: tone.color, fontWeight: 750, fontFamily: "var(--font-mono)" }}>{safeNum(nearestWard?.aqi, 0)}</span>
                  <span className="mini-d"><Icon name="layers" size={14} />Virtual ward</span>
                </div>
              )}
              <div className="mini-s">
                {nearestStation
                  ? `${safeStr(nearestStation?.station_name, "Unknown station")}${Number.isFinite(stationAgeMinutes) ? ` · ${stationAgeMinutes} min old` : ""}`
                  : nearestWard
                    ? `Using ${safeStr(nearestWard.ward_name, nearestWard.ward_id)} virtual ward estimate`
                    : "No live CPCB station resolved yet"}
              </div>
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

      <ApiStatusStrip envData={env.data} stationsData={stations.data} />

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
          <SectionHeader title="Cause preview" right={<Badge tone="info">{confidence != null ? `${confidence}%` : "Live"}</Badge>} />
          <div style={{ padding: 16 }}>
            <div className="muted" style={{ marginBottom: 8 }}>
              Based on live station pollutants + weather near {locationLabel}.
            </div>
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

      <div className="card card-elevated">
        <SectionHeader
          title="Satellite & Fires"
          right={<Badge tone={fireNearby ? "danger" : "success"}>{fireNearby ? "Fire nearby" : "No nearby fire"}</Badge>}
        />
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <div className="mini">
            <div className="mini-k">Satellite source</div>
            <div className="mini-v" style={{ gap: 8 }}>
              <Icon name={satSource.toLowerCase().includes("firms") ? "flame" : "satellite"} size={16} />
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{satSource}</span>
            </div>
            <div className="mini-s">{safeStr(satMeta?.note, "-")}</div>
          </div>
          <div className="mini">
            <div className="mini-k">Hotspots</div>
            <div className="mini-v">
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 750 }}>{Number.isFinite(satHotspots) ? satHotspots : fires.length}</span>
              <span className="mini-d">last 1 day</span>
            </div>
            <div className="mini-s">{fireNearby ? "Biomass burning likely" : "No hotspot within radius"}</div>
          </div>
          <div className="mini" style={{ gridColumn: "1 / -1" }}>
            <div className="mini-k">Nearest detections</div>
            {fires.length ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                {fires.slice(0, 4).map((f, idx) => (
                  <span key={idx} className="tag" style={{ fontFamily: "var(--font-mono)" }}>
                    {safeNum(f?.lat, 0).toFixed(4)}, {safeNum(f?.lon, 0).toFixed(4)} · {safeStr(f?.confidence, "-")}
                  </span>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 8 }}>No FIRMS detections in the selected box.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
