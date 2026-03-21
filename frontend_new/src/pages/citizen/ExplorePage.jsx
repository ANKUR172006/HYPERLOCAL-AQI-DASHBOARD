import { useState } from "react";
import { useGeolocation, useWardMap } from "../../hooks/index.js";
import { SectionHeader } from "../../components/ui/index.jsx";
import { aqiTone } from "../../tokens/index.js";
import WardHeatmap from "../../features/ward/WardHeatmap.jsx";
import WardDetailPanel from "../../features/ward/WardDetailPanel.jsx";

export default function ExplorePage() {
  const [selected, setSelected] = useState(null);
  const geo = useGeolocation();
  const wardMap = useWardMap(geo.lat, geo.lon);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader title="Zone heatmap" />
      <div className="aqi-mini-legend" aria-label="AQI legend">
        {[
          { label: "Good", v: 30 },
          { label: "Moderate", v: 90 },
          { label: "Poor", v: 220 },
          { label: "Severe", v: 350 },
        ].map((x) => {
          const t = aqiTone(x.v);
          return (
            <div key={x.label} className="aqi-mini-legend-item">
              <span className="aqi-mini-swatch" style={{ background: t.color }} aria-hidden="true" />
              <span>{x.label}</span>
            </div>
          );
        })}
      </div>
      <WardHeatmap
        data={wardMap.data}
        loading={wardMap.loading}
        error={wardMap.error}
        retry={wardMap.retry}
        selectedWard={selected}
        onSelectWard={setSelected}
      />
      {selected ? <WardDetailPanel ward={selected} /> : null}
    </div>
  );
}
