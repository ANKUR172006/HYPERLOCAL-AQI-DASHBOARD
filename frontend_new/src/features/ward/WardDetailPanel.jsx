import { getAqiCategory, safeNum } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";

function causeFromPrimary(primaryPollutant) {
  const p = String(primaryPollutant || "").toUpperCase();
  if (p.includes("PM10")) return "Dust";
  if (p.includes("NO2")) return "Traffic";
  if (p.includes("PM2.5")) return "Traffic + Biomass Burning";
  if (p.includes("O3")) return "Photochemical smog";
  if (p.includes("CO")) return "Combustion hotspots";
  return "Mixed sources";
}

export default function WardDetailPanel({ ward }) {
  if (!ward) return null;
  const aqi = safeNum(ward.aqi, 0);
  const cat = getAqiCategory(aqi);
  const lat = Number(ward.centroid_lat);
  const lon = Number(ward.centroid_lon);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const primary = ward.primary_pollutant || ward.primary || "";
  const sd = ward.source_detection || null;
  const primaryCause = sd?.primary?.label || null;
  const primaryConf = sd?.primary?.confidence;
  const secondaryCause = sd?.secondary?.label || null;
  const secondaryConf = sd?.secondary?.confidence;

  return (
    <div className="card card-elevated" style={{ padding: 16, borderColor: `${cat.color}30` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Selected zone
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 650 }}>{ward.ward_name || ward.ward_id}</div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>{ward.ward_id}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "2rem", fontWeight: 800, color: cat.color, lineHeight: 1 }}>{aqi}</div>
          <div style={{ fontSize: "0.875rem", color: cat.text, background: cat.bg, border: `1px solid ${cat.color}40`, borderRadius: "var(--radius-full)", padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name={cat.icon} size={14} color={cat.color} />
            {cat.label}
          </div>
        </div>
      </div>

      {hasCoords ? (
        <div style={{ marginTop: 14, fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          Centroid: <span style={{ fontFamily: "var(--font-mono)" }}>{lat.toFixed(5)}, {lon.toFixed(5)}</span>
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: "0.875rem", color: "var(--text-muted)" }}>
          No centroid coordinates available.
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!!primary && <span className="tag">Dominant: <b style={{ color: "var(--text-primary)" }}>{primary}</b></span>}
        <span className="tag">
          Cause:{" "}
          <b style={{ color: "var(--text-primary)" }}>
            {primaryCause ? `${primaryCause}${Number.isFinite(primaryConf) ? ` (${primaryConf}%)` : ""}` : causeFromPrimary(primary)}
          </b>
        </span>
        {secondaryCause && secondaryCause !== "—" ? (
          <span className="tag">
            Secondary:{" "}
            <b style={{ color: "var(--text-primary)" }}>
              {secondaryCause}{Number.isFinite(secondaryConf) ? ` (${secondaryConf}%)` : ""}
            </b>
          </span>
        ) : null}
      </div>
    </div>
  );
}
