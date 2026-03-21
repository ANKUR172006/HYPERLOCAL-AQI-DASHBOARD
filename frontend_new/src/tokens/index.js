export function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeStr(value, fallback = "") {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.trim() ? s : fallback;
}

const AQI = [
  { max: 50, label: "Good", color: "var(--aqi-good)", bg: "var(--aqi-good-bg)", text: "var(--aqi-good-text)", icon: "check-circle", description: "Air quality is satisfactory." },
  { max: 100, label: "Moderate", color: "var(--aqi-moderate)", bg: "var(--aqi-moderate-bg)", text: "var(--aqi-moderate-text)", icon: "info", description: "Acceptable; some pollutants may affect sensitive groups." },
  { max: 150, label: "Unhealthy (SG)", color: "var(--aqi-usg)", bg: "var(--aqi-usg-bg)", text: "var(--aqi-usg-text)", icon: "alert-circle", description: "Sensitive groups may experience health effects." },
  { max: 200, label: "Unhealthy", color: "var(--aqi-unhealthy)", bg: "var(--aqi-unhealthy-bg)", text: "var(--aqi-unhealthy-text)", icon: "alert-triangle", description: "Everyone may begin to experience health effects." },
  { max: 300, label: "Very Unhealthy", color: "var(--aqi-veryunhealthy)", bg: "var(--aqi-veryunhealthy-bg)", text: "var(--aqi-veryunhealthy-text)", icon: "skull", description: "Health alert: increased risk for everyone." },
  { max: Infinity, label: "Hazardous", color: "var(--aqi-hazardous)", bg: "var(--aqi-hazardous-bg)", text: "var(--aqi-hazardous-text)", icon: "skull", description: "Emergency conditions." },
];

export function getAqiCategory(aqi) {
  const n = safeNum(aqi, 0);
  return AQI.find((c) => n <= c.max) || AQI[AQI.length - 1];
}

export function aqiTone(aqi) {
  const cat = getAqiCategory(aqi);
  return {
    ...cat,
    gradient: `linear-gradient(135deg, ${cat.bg} 0%, var(--bg-surface) 60%)`,
    glow: `0 8px 24px ${String(cat.color).includes("var(") ? "rgba(0,0,0,0.12)" : `${cat.color}22`}`,
  };
}
