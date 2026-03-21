import { useMemo, useRef, useState } from "react";
import { aqiTone, safeNum, safeStr } from "../../tokens/index.js";
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

function bboxFromGeoJSON(geo) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const push = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };
  const walkCoords = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === "number") {
      push(coords[0], coords[1]);
      return;
    }
    for (const c of coords) walkCoords(c);
  };
  for (const f of geo?.features || []) walkCoords(f?.geometry?.coordinates);
  if (!Number.isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function pathsFromGeoJSON(geo, project) {
  const out = [];
  const coordsToPath = (ring) => {
    if (!Array.isArray(ring) || ring.length < 2) return "";
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      const [x, y] = project(pt[0], pt[1]);
      d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
    }
    return d + "Z";
  };
  for (const f of geo?.features || []) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      const rings = g.coordinates || [];
      const d = rings.map(coordsToPath).filter(Boolean).join(" ");
      if (d) out.push({ id: safeStr(f?.properties?.ward_id, String(out.length)), d, props: f?.properties || {} });
    } else if (g.type === "MultiPolygon") {
      const polys = g.coordinates || [];
      for (const rings of polys) {
        const d = (rings || []).map(coordsToPath).filter(Boolean).join(" ");
        if (d) out.push({ id: safeStr(f?.properties?.ward_id, String(out.length)), d, props: f?.properties || {} });
      }
    }
  }
  return out;
}

export default function WardGeoMap({ boundary, wardGeojson, wards, loading }) {
  const [selected, setSelected] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef(null);

  const rows = useMemo(() => {
    const arr = Array.isArray(wards) ? wards : [];
    return arr
      .map((w) => ({
        ward_id: safeStr(w.ward_id, ""),
        ward_name: safeStr(w.ward_name, w.ward_id),
        aqi: w.aqi == null ? null : safeNum(w.aqi, null),
        lat: Number(w.centroid_lat),
        lon: Number(w.centroid_lon),
        primary: safeStr(w.primary_pollutant, ""),
        source_detection: w.source_detection || null,
        has_snapshot: Boolean(w.has_snapshot),
        as_of_utc: w.as_of_utc || null,
        raw: w,
      }))
      .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon));
  }, [wards]);

  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.ward_id, r])), [rows]);

  const geo = boundary?.data ? boundary.data : boundary;
  const wardPoly = wardGeojson?.data ? wardGeojson.data : wardGeojson;
  const box = useMemo(() => bboxFromGeoJSON(wardPoly) || bboxFromGeoJSON(geo), [wardPoly, geo]);
  const view = { w: 1000, h: 520, pad: 28 };

  const project = useMemo(() => {
    if (!box) return (lon, lat) => [0, 0];
    const dx = box.maxLon - box.minLon || 1;
    const dy = box.maxLat - box.minLat || 1;
    const sx = (view.w - view.pad * 2) / dx;
    const sy = (view.h - view.pad * 2) / dy;
    const s = Math.min(sx, sy);
    const ox = view.pad + ((view.w - view.pad * 2) - dx * s) / 2;
    const oy = view.pad + ((view.h - view.pad * 2) - dy * s) / 2;
    return (lon, lat) => {
      const x = ox + (lon - box.minLon) * s;
      const y = oy + (box.maxLat - lat) * s;
      return [x, y];
    };
  }, [box]);

  const boundaryPaths = useMemo(() => pathsFromGeoJSON(geo, project), [geo, project]);
  const wardPaths = useMemo(() => pathsFromGeoJSON(wardPoly, project), [wardPoly, project]);

  const maxAqi = useMemo(() => Math.max(1, ...rows.map((r) => (r.aqi == null ? 0 : r.aqi))), [rows]);
  const hovered = hoveredId ? byId[hoveredId] : null;

  if (loading) {
    return (
      <div style={{ height: 520, borderRadius: "var(--radius-lg)", background: "var(--bg-muted)", border: "1px solid var(--border-subtle)" }} />
    );
  }

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      onMouseMove={(e) => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setHoverPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHoveredId(null)}
    >
      <svg viewBox={`0 0 ${view.w} ${view.h}`} className="map-svg" role="img" aria-label="Zone map">
        <defs>
          <linearGradient id="aqiLegend" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0E9E6D" />
            <stop offset="0.5" stopColor="#C9820A" />
            <stop offset="1" stopColor="#C42B1A" />
          </linearGradient>
          <pattern id="nodataHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(20)">
            <rect width="8" height="8" fill="rgba(148,163,184,0.18)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(17,24,39,0.12)" strokeWidth="3" />
          </pattern>
          <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodOpacity="0.18" />
          </filter>
          {/* Clip wards to the Delhi boundary so the choropleth looks like a real city outline. */}
          <clipPath id="delhiBoundaryClip">
            {boundaryPaths.map((p) => (
              <path key={`clip-${p.id}`} d={p.d} />
            ))}
          </clipPath>
        </defs>

        {/* Boundary */}
        <g filter="url(#shadow)">
          {boundaryPaths.map((p) => (
            <path
              key={`b-${p.id}`}
              d={p.d}
              fill="var(--bg-surface)"
              stroke="rgba(2,6,23,0.32)"
              strokeWidth="2.2"
              strokeLinejoin="round"
              opacity="0.98"
            />
          ))}
        </g>

        {/* Base tint so the outline never looks blank */}
        {!!boundaryPaths.length && (
          <g clipPath="url(#delhiBoundaryClip)">
            <rect x="0" y="0" width={view.w} height={view.h} fill="rgba(148,163,184,0.10)" />
          </g>
        )}

        {/* Ward polygons (choropleth) */}
        {!!wardPaths.length && (
          <g clipPath="url(#delhiBoundaryClip)">
            {wardPaths.map((p) => {
              const wardId = safeStr(p.props?.ward_id, p.id);
              const row = byId[wardId];
              const aqi = row?.aqi ?? null;
              const hasSnapshot = Boolean(row?.has_snapshot);
              const isEstimated = Boolean(row?.estimated);
              const hasValue = aqi != null;
              const tone = aqi != null ? aqiTone(aqi) : null;
              const isSel = selected?.ward_id === wardId;
              const isHover = hoveredId === wardId;
              const intensity = aqi != null ? Math.max(0.16, Math.min(0.54, 0.16 + (aqi / 500) * 0.38)) : 0.12;
              const fillOpacity = hasValue ? (isHover ? Math.min(0.70, intensity + 0.14) : intensity) : 0.55;
              const baseStroke = isSel ? "rgba(2,6,23,0.55)" : isHover ? "rgba(2,6,23,0.42)" : "rgba(2,6,23,0.22)";
              return (
                <path
                  key={`w-${wardId}`}
                  d={p.d}
                  className={`ward-shape ${isSel ? "sel" : ""}`}
                  fill={tone ? tone.bg : "url(#nodataHatch)"}
                  fillOpacity={fillOpacity}
                  stroke={baseStroke}
                  strokeDasharray={hasSnapshot ? "0" : isEstimated ? "4 3" : "6 4"}
                  strokeWidth={isSel ? 3.2 : isHover ? 2.2 : 1.2}
                  strokeLinejoin="round"
                  onMouseEnter={() => setHoveredId(wardId)}
                  onClick={() => {
                    const next = row || { ward_id: wardId, ward_name: safeStr(p.props?.ward_name, wardId), aqi: 0, primary: "" };
                    setSelected(isSel ? null : next);
                  }}
                />
              );
            })}
          </g>
        )}

        {/* Ward labels (subtle) */}
        {!!wardPaths.length && (
          <g clipPath="url(#delhiBoundaryClip)" pointerEvents="none">
            {wardPaths.map((p) => {
              const wardId = safeStr(p.props?.ward_id, p.id);
              const row = byId[wardId];
              const lat = Number(p.props?.centroid_lat ?? row?.lat);
              const lon = Number(p.props?.centroid_lon ?? row?.lon);
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
              const [x, y] = project(lon, lat);
              const short = wardId.replace("DEL_WARD_", "W");
              return (
                <text
                  key={`t-${wardId}`}
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="rgba(17,24,39,0.62)"
                >
                  {short}
                </text>
              );
            })}
          </g>
        )}

        {/* Ward markers (fallback when polygons missing) */}
        {!wardPaths.length && (
          <g>
            {rows.map((w) => {
              const [x, y] = project(w.lon, w.lat);
              const tone = aqiTone(w.aqi);
              const r = 4 + (w.aqi / maxAqi) * 6;
              const isSel = selected?.ward_id === w.ward_id;
              return (
                <g key={w.ward_id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={tone.color}
                    opacity={isSel ? 0.95 : 0.78}
                    stroke={isSel ? "#111" : "#fff"}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(isSel ? null : w)}
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* Legend */}
        <g>
          <rect x={24} y={24} width={240} height={10} rx={5} fill="url(#aqiLegend)" opacity="0.95" />
          <text x={24} y={50} fontSize="12" fill="var(--text-muted)" fontFamily="var(--font-sans)">
            AQI intensity (low to high)
          </text>
          <text x={view.w - 24} y={36} fontSize="12" textAnchor="end" fill="var(--text-muted)" fontFamily="var(--font-sans)">
            Delhi zones (prototype grid)
          </text>
        </g>
      </svg>

      {!!hovered && (
        <div
          className="map-tip"
          style={{
            left: Math.min(Math.max(12, hoverPos.x + 12), (wrapRef.current?.clientWidth || 0) - 280),
            top: Math.min(Math.max(12, hoverPos.y + 12), 520 - 90),
          }}
        >
          <div style={{ fontWeight: 750, lineHeight: 1.2 }}>{hovered.ward_name || hovered.ward_id}</div>
          <div className="muted" style={{ fontSize: "0.8125rem", marginTop: 2 }}>{hovered.ward_id}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {hovered.aqi == null ? (
              <span className="tag"><Icon name="info" size={14} />No live snapshot</span>
            ) : (
              <span className="pill" style={{ padding: "4px 10px", borderColor: `${aqiTone(hovered.aqi).color}55`, background: aqiTone(hovered.aqi).bg, color: aqiTone(hovered.aqi).text }}>
                <Icon name={aqiTone(hovered.aqi).icon} size={14} color={aqiTone(hovered.aqi).color} />
                AQI {hovered.aqi}
              </span>
            )}
            {hovered.estimated && <span className="tag"><Icon name="wind" size={14} />Estimated (IDW)</span>}
            {!!hovered.primary && <span className="muted">Dominant: <b style={{ color: "var(--text-primary)" }}>{hovered.primary}</b></span>}
            <span className="muted">
              Cause:{" "}
              <b style={{ color: "var(--text-primary)" }}>
                {hovered.source_detection?.primary?.label
                  ? `${hovered.source_detection.primary.label}${Number.isFinite(hovered.source_detection.primary.confidence) ? ` (${hovered.source_detection.primary.confidence}%)` : ""}`
                  : causeFromPrimary(hovered.primary)}
              </b>
            </span>
          </div>
        </div>
      )}

      {!!selected && (
        <div className="map-pop">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="muted" style={{ fontSize: "0.8125rem" }}>Selected zone</div>
              <div style={{ fontWeight: 750, fontSize: "1rem", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected.ward_name || selected.ward_id}
              </div>
              <div className="muted" style={{ fontSize: "0.8125rem" }}>{selected.ward_id}</div>
            </div>
            <button className="btn btn-xs" onClick={() => setSelected(null)} aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>

          <div className="map-pop-row">
            {selected.aqi == null ? (
              <div className="tag"><Icon name="info" size={14} />No live snapshot</div>
            ) : (
              <div className="pill" style={{ borderColor: `${aqiTone(selected.aqi).color}55`, background: aqiTone(selected.aqi).bg, color: aqiTone(selected.aqi).text }}>
                <Icon name={aqiTone(selected.aqi).icon} size={14} color={aqiTone(selected.aqi).color} />
                AQI {selected.aqi}
              </div>
            )}
            {selected.estimated && <div className="tag"><Icon name="wind" size={14} />Estimated (IDW)</div>}
            <div className="muted">Dominant: <b style={{ color: "var(--text-primary)" }}>{selected.primary || "-"}</b></div>
            <div className="muted">
              Cause:{" "}
              <b style={{ color: "var(--text-primary)" }}>
                {selected.source_detection?.primary?.label
                  ? `${selected.source_detection.primary.label}${Number.isFinite(selected.source_detection.primary.confidence) ? ` (${selected.source_detection.primary.confidence}%)` : ""}`
                  : causeFromPrimary(selected.primary)}
              </b>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
