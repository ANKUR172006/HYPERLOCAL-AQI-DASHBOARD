import { Badge } from "./index.jsx";

function toneFor(ok, warn = false) {
  if (ok) return "success";
  if (warn) return "warning";
  return "danger";
}

function item(label, tone, detail) {
  return { label, tone, detail: String(detail || "-") };
}

export default function ApiStatusStrip({ envData, stationsData }) {
  const weather = envData?.data?.weather || {};
  const satellite = envData?.data?.satellite || {};
  const fires = envData?.data?.fires || {};
  const stationRows = Array.isArray(stationsData?.data) ? stationsData.data : [];
  const freshness = String(stationsData?.freshness || "");

  const stationOk = stationRows.length > 0;
  const weatherSource = String(weather?.source || "");
  const weatherOk = weatherSource.toUpperCase().includes("OPEN_METEO");
  const satSource = String(satellite?.source || "");
  const satOk = satSource === "NASA_EARTH" || satSource === "FIRMS";
  const satWarn = satSource === "SATELLITE_DISABLED";
  const firesEnabled = fires?.enabled !== false && !String(fires?.reason || "").includes("missing");
  const firesOk = firesEnabled && !String(fires?.error || "");

  const items = [
    item("CPCB", toneFor(stationOk, freshness === "stale"), stationOk ? (freshness === "stale" ? "cached" : "live") : "no station"),
    item("Weather", toneFor(weatherOk, !!weather?.timestamp), weatherSource || "unavailable"),
    item("Satellite", toneFor(satOk, satWarn), satSource || "unavailable"),
    item("Fires", toneFor(firesOk, Array.isArray(fires?.fires)), firesOk ? `${Array.isArray(fires?.fires) ? fires.fires.length : 0} hotspots` : (fires?.reason || "unavailable")),
  ];

  return (
    <div className="card card-elevated" style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>API status</div>
        <div className="muted" style={{ fontSize: "0.8125rem" }}>Live source health for this location</div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        {items.map((entry) => (
          <div key={entry.label} className="tag" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34 }}>
            <Badge tone={entry.tone}>{entry.label}</Badge>
            <span className="muted" style={{ fontSize: "0.8125rem" }}>{entry.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
