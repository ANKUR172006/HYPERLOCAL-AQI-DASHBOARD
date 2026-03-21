import { useMemo } from "react";
import {
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

function riskFromAqi(aqi) {
  const n = safeNum(aqi, 0);
  if (n <= 50) return { level: "Low Risk", tone: "success", label: "Minimal health impact for most people." };
  if (n <= 100) return { level: "Guarded Risk", tone: "info", label: "Sensitive groups may feel effects outdoors." };
  if (n <= 200) return { level: "Moderate Risk", tone: "warning", label: "Reduce prolonged outdoor exertion." };
  if (n <= 300) return { level: "High Risk", tone: "danger", label: "Outdoor exposure can trigger symptoms." };
  return { level: "Extreme Risk", tone: "danger", label: "Disaster-level precautions needed." };
}

export default function InsightsPage({ onNavigate }) {
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);

  const nearestWardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const wardAqi = useWardAqi(nearestWardId);
  const forecast = useForecast(nearestWardId);
  const breakdown = usePollutants(nearestWardId);

  const aqiVal = safeNum(wardAqi.data?.data?.aqi ?? wardAqi.data?.data?.aqi_value ?? wardAqi.data?.data?.value, 0);
  const tone = useMemo(() => aqiTone(aqiVal), [aqiVal]);
  const forecastVal = safeNum(forecast.data?.data?.aqi_pred ?? forecast.data?.data?.aqi ?? forecast.data?.aqi_pred, 0);
  const delta = forecastVal ? Math.round(forecastVal - aqiVal) : 0;

  const primaryPollutant = safeStr(
    wardAqi.data?.data?.primary_pollutant,
    safeStr(wardMap.data?.data?.[0]?.primary_pollutant, "PM2.5"),
  );
  const weather = env.data?.data?.weather || {};
  const sat = env.data?.data?.satellite || {};
  const risk = riskFromAqi(aqiVal);

  const det = wardAqi.data?.data?.source_detection || {};
  const detectionPrimary = det?.primary || null;
  const detectionSecondary = det?.secondary || null;
  const detectionReasons = Array.isArray(det?.reasons) ? det.reasons : [];
  const detectionTrend = det?.trend || null;

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
      .slice(0, 6);
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

  const whyLine = safeStr(detectionReasons?.[0], risk.label);
  const confidence = Number.isFinite(detectionPrimary?.confidence) ? detectionPrimary.confidence : 64;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card card-elevated" style={{ padding: 16, borderColor: `${tone.color}30` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.8125rem" }}>Zone</div>
            <div style={{ fontWeight: 900, fontSize: "1.125rem" }}>{nearestWardId ? nearestWardId.replace("DEL_WARD_", "Z") : "—"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: "0.8125rem" }}>Now</div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 950, fontSize: 34, lineHeight: 1, color: tone.color }}>
              {aqiVal || "—"}
            </div>
            <div className="muted" style={{ fontSize: "0.8125rem" }}>
              +3h {forecast.loading ? "…" : `${forecastVal || "—"} (${delta > 0 ? "+" : ""}${delta})`}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="pill" style={{ borderColor: `${tone.color}55`, background: tone.bg, color: tone.text }}>
            <Icon name={tone.icon} size={16} color={tone.color} />
            {tone.label}
          </span>
          <span className="tag">
            Dominant: <b style={{ color: "var(--text-primary)" }}>{primaryPollutant}</b>
          </span>
          <Badge tone={risk.tone}>{risk.level}</Badge>
          <span className="tag"><Icon name="wind" size={14} />{weather?.wind_speed != null ? `${weather.wind_speed} km/h` : "—"}</span>
          <span className="tag"><Icon name="droplet" size={14} />{weather?.humidity != null ? `${weather.humidity}%` : "—"}</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-elevated">
          <SectionHeader
            title="AI Pollution Insight"
            right={(
              <Badge tone="info">{confidence}% confidence</Badge>
            )}
          />
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div className="ins-ic" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>
                <Icon name={detectionPrimary?.icon || "info"} size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "1rem", fontWeight: 900, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span>
                    Primary: <b>{safeStr(detectionPrimary?.label, "Mixed sources")}</b>
                    {Number.isFinite(detectionPrimary?.confidence) ? ` — ${detectionPrimary.confidence}%` : ""}
                  </span>
                  {detectionSecondary?.label ? (
                    <span className="tag">
                      <Icon name={detectionSecondary?.icon || "info"} size={14} />
                      Secondary: <b style={{ color: "var(--text-primary)" }}>{safeStr(detectionSecondary.label, "—")}</b>
                      {Number.isFinite(detectionSecondary?.confidence) ? ` — ${detectionSecondary.confidence}%` : ""}
                    </span>
                  ) : null}
                </div>

                <div className="muted" style={{ marginTop: 8, lineHeight: 1.65 }}>
                  Why: {whyLine || "Using pollution + weather context (fallback)."}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 750, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Signals
                  </div>
                  <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                    {(detectionReasons.length ? detectionReasons : [
                      weather?.wind_speed != null && weather.wind_speed < 10 ? "Low wind speed (stagnant air)" : null,
                      weather?.humidity != null && weather.humidity > 70 ? "High humidity (particle persistence)" : null,
                      sat?.aerosol_index != null ? `Satellite aerosol index: ${Number(sat.aerosol_index).toFixed(2)}` : null,
                    ].filter(Boolean)).slice(0, 3).map((t, idx) => (
                      <li key={idx}>{t}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {detectionTrend?.direction ? (
                    <span className="tag">
                      <Icon name={detectionTrend.direction === "increasing" ? "arrowUp" : detectionTrend.direction === "decreasing" ? "arrowDown" : "minus"} size={14} />
                      Source trend: {detectionTrend.direction}
                    </span>
                  ) : null}
                  <span className="tag"><Icon name="satellite" size={14} />{sat?.aerosol_index != null ? `Satellite ${Number(sat.aerosol_index).toFixed(2)}` : "Satellite: unavailable"}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={() => onNavigate?.("explore")}>Open map</button>
              <button className="btn btn-sm" onClick={() => onNavigate?.("trends")}>View trends</button>
              <button className="btn btn-sm" onClick={() => onNavigate?.("alerts")}>View alerts</button>
              <button className="btn btn-sm" onClick={() => onNavigate?.("officer")}>Officer dashboard</button>
            </div>
          </div>
        </div>

        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Recommendations" right={<Badge tone={risk.tone}>{risk.level}</Badge>} />
          <div className="muted" style={{ marginTop: 2 }}>
            {whyLine || risk.label}
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
                <button className="btn btn-sm" onClick={() => onNavigate?.("alerts")}>Open alerts</button>
                <button className="btn btn-sm" onClick={() => onNavigate?.("officer")}>Open officer tools</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Zone ranking near you" right={<Badge tone="info">{rankingNearYou.length ? "Top 6" : "—"}</Badge>} />
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {rankingNearYou.length ? rankingNearYou.map((r, i) => {
              const t = aqiTone(r.aqi);
              return (
                <div key={r.ward_id || i} className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i + 1}. {r.ward_name || r.ward_id}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: "0.8125rem" }}>
                      {r.primary ? `Dominant ${r.primary}` : "—"}
                      {r.cause ? ` · Cause ${r.cause}${Number.isFinite(r.conf) ? ` (${r.conf}%)` : ""}` : ""}
                    </div>
                  </div>
                  <span className="pill" style={{ borderColor: `${t.color}55`, background: t.bg, color: t.text, fontFamily: "var(--font-mono)", fontWeight: 850 }}>
                    {safeNum(r.aqi, 0)}
                  </span>
                </div>
              );
            }) : (
              <div className="muted">No ranking available yet.</div>
            )}
          </div>
        </div>

        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Comparative AQI" right={<Badge tone="info">City</Badge>} />
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 850 }}>City average</div>
                <div className="muted" style={{ marginTop: 4 }}>Across all zones</div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontWeight: 950, fontSize: 26, color: cityCompare.avg != null ? aqiTone(cityCompare.avg).color : "var(--text-muted)" }}>
                {cityCompare.avg ?? "—"}
              </div>
            </div>
            <div className="card-flat" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 850 }}>Best zone</div>
                  <div className="muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cityCompare.best?.ward_name || "—"}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 950, fontSize: 26, color: cityCompare.best ? aqiTone(cityCompare.best.aqi).color : "var(--text-muted)" }}>
                  {cityCompare.best?.aqi ?? "—"}
                </div>
              </div>
            </div>
            <div className="card-flat" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 850 }}>Worst zone</div>
                  <div className="muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cityCompare.worst?.ward_name || "—"}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 950, fontSize: 26, color: cityCompare.worst ? aqiTone(cityCompare.worst.aqi).color : "var(--text-muted)" }}>
                  {cityCompare.worst?.aqi ?? "—"}
                </div>
              </div>
            </div>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Use Explore to open the heatmap and tap zones for details.
          </div>
        </div>
      </div>

      <div className="card card-elevated">
        <SectionHeader title="Pollutant mix" right={<Badge tone="info">Zone {nearestWardId || "—"}</Badge>} />
        {breakdown.loading ? (
          <div style={{ padding: 16 }}><Skeleton height="92px" /></div>
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

