import { getAqiCategory, safeNum, safeStr } from "../../tokens/index.js";
import { Skeleton } from "../../components/ui/index.jsx";

function normalizeRows(apiResponse) {
  const rows = Array.isArray(apiResponse?.data) ? apiResponse.data : Array.isArray(apiResponse) ? apiResponse : [];
  return rows.map((r, idx) => ({
    ward_id: safeStr(r.ward_id, `WARD_${idx + 1}`),
    ward_name: safeStr(r.ward_name, r.ward_id),
    aqi: safeNum(r.aqi ?? r.aqi_value, 0),
    category: safeStr(r.category, ""),
    primary_pollutant: safeStr(r.primary_pollutant, ""),
    source_detection: r.source_detection || null,
    centroid_lat: r.centroid_lat,
    centroid_lon: r.centroid_lon,
    pm25: r.pm25,
    pm10: r.pm10,
    no2: r.no2,
    so2: r.so2,
    o3: r.o3,
    co: r.co,
  }));
}

export default function WardHeatmap({ data, loading, error, retry, selectedWard, onSelectWard }) {
  const rows = normalizeRows(data);

  if (loading) {
    return (
      <div className="card card-elevated" style={{ padding: 16 }}>
        <Skeleton height="12px" width="160px" style={{ marginBottom: 12 }} />
        <div className="heatmap-grid">
          {Array.from({ length: 40 }).map((_, i) => (
            <Skeleton key={i} height="52px" style={{ borderRadius: 10 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card card-elevated" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ color: "var(--text-secondary)" }}>Failed to load zones: {String(error)}</div>
        {retry ? (
          <button className="btn btn-sm" onClick={retry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card card-elevated" style={{ padding: 16 }}>
      <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: 12 }}>
        Tap a zone to see details (AQI and cause).
      </div>
      <div className="heatmap-grid" role="list">
        {rows.map((w) => {
          const cat = getAqiCategory(w.aqi);
          const selected = selectedWard?.ward_id === w.ward_id;
          return (
            <button
              key={w.ward_id}
              type="button"
              className="heatmap-cell"
              role="listitem"
              aria-pressed={selected}
              onClick={() => onSelectWard?.(selected ? null : w)}
              style={{
                ["--cell-color"]: cat.color,
                background: cat.color,
                boxShadow: selected ? `0 0 0 3px ${cat.color}55` : undefined,
              }}
              title={`${w.ward_name} · AQI ${w.aqi}${w.primary_pollutant ? ` · ${w.primary_pollutant}` : ""}`}
            >
              <span style={{ position: "relative", zIndex: 1 }}>{w.aqi}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
