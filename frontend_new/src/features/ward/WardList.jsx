import { useMemo, useState } from "react";
import { getAqiCategory, safeNum, safeStr } from "../../tokens/index.js";
import { Skeleton } from "../../components/ui/index.jsx";

function normalizeRows(apiResponse) {
  const rows = Array.isArray(apiResponse?.data) ? apiResponse.data : Array.isArray(apiResponse) ? apiResponse : [];
  return rows.map((r, idx) => ({
    ward_id: safeStr(r.ward_id, `WARD_${idx + 1}`),
    ward_name: safeStr(r.ward_name, r.ward_id),
    aqi: safeNum(r.aqi ?? r.aqi_value, 0),
    centroid_lat: r.centroid_lat,
    centroid_lon: r.centroid_lon,
  }));
}

export default function WardList({ data, loading, error, retry, selectedWard, onSelectWard }) {
  const [q, setQ] = useState("");
  const rows = normalizeRows(data);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((w) => `${w.ward_id} ${w.ward_name}`.toLowerCase().includes(s));
  }, [rows, q]);

  if (loading) {
    return (
      <div className="card card-elevated" style={{ padding: 16 }}>
        <Skeleton height="40px" style={{ marginBottom: 12 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height="44px" />
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
      <input className="input" placeholder="Search zones…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ height: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((w) => {
          const cat = getAqiCategory(w.aqi);
          const selected = selectedWard?.ward_id === w.ward_id;
          return (
            <button
              key={w.ward_id}
              className="btn row-btn"
              type="button"
              onClick={() => onSelectWard?.(selected ? null : w)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border-subtle)"}`,
                background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
              }}
            >
              <span style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{w.ward_name}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{w.ward_id}</div>
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: cat.color }}>{w.aqi}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
