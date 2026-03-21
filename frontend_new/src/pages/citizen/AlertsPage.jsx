import { useAlertsFeed, useAqiForecast, useEnvironmentUnified, useGeolocation, useLocationInsights, useWardAqi, useWardMap } from "../../hooks/index.js";
import { SectionHeader, Skeleton } from "../../components/ui/index.jsx";
import { AlertItem } from "../../features/alerts/AlertsPreview.jsx";
import { aqiTone, safeNum } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";

export default function AlertsPage() {
  const geo = useGeolocation();
  const insights = useLocationInsights(geo.lat, geo.lon);
  const wardMap = useWardMap(geo.lat, geo.lon);
  const wardId = insights?.data?.nearest_ward?.ward_id || wardMap?.data?.data?.[0]?.ward_id || null;
  const nowAqi = useWardAqi(wardId);
  const f2 = useAqiForecast(wardId, 2);
  const env = useEnvironmentUnified(geo.lat, geo.lon, true);

  const feed = useAlertsFeed();
  const items = Array.isArray(feed.data?.data) ? feed.data.data : [];
  const nowVal = safeNum(nowAqi.data?.data?.aqi ?? nowAqi.data?.data?.aqi_value ?? nowAqi.data?.data?.value, 0);
  const pred2 = safeNum(f2.data?.data?.aqi_pred, 0);
  const wind = safeNum(env.data?.data?.weather?.wind_speed, null);
  const cause = wind != null && wind < 10 ? "Low wind conditions" : "Unfavorable dispersion";
  const isDisaster = nowVal > 300;
  const crosses250 = pred2 >= 250;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader title="City alerts" />

      {isDisaster ? (
        <div className="card card-elevated" style={{ padding: 16, borderColor: `${aqiTone(nowVal).color}40`, background: "rgba(196,43,26,0.06)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name="alert" size={18} color="var(--color-danger)" />
            <div style={{ fontWeight: 900, letterSpacing: "0.03em" }}>DISASTER MODE ACTIVATED</div>
          </div>
          <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            AQI is above 300 in your zone. Outdoor activity should be restricted and emergency response is recommended.
          </div>
        </div>
      ) : null}

      {crosses250 ? (
        <div className="card card-elevated" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Icon name="triangle" size={18} color="var(--color-warning)" />
              <div style={{ fontWeight: 850 }}>AQI expected to cross 250 in next 2 hours</div>
            </div>
            <div className="tag">Zone {wardId ? wardId.replace("DEL_WARD_", "Z") : "—"}</div>
          </div>
          <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            Cause: {cause}. Forecast: <b style={{ color: "var(--text-primary)" }}>{pred2}</b> AQI at +2h.
          </div>
        </div>
      ) : null}

      {feed.loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height="74px" />
          <Skeleton height="74px" />
          <Skeleton height="74px" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.length ? items.map((a, i) => <AlertItem key={`${a.id ?? i}`} alert={a} />) : <div className="card card-elevated" style={{ padding: 16 }}>No alerts.</div>}
        </div>
      )}
    </div>
  );
}
