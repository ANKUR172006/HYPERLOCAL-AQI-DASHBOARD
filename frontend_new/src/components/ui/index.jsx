import Icon from "./Icon.jsx";

export function Skeleton({ width = "100%", height = "12px", style = {} }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background: "linear-gradient(90deg, var(--bg-muted), rgba(255,255,255,0.18), var(--bg-muted))",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.1s infinite",
        ...style,
      }}
    />
  );
}

export function Badge({ tone = "info", children }) {
  const map = {
    success: { bg: "var(--aqi-good-bg)", color: "var(--aqi-good-text)", bdr: "var(--aqi-good)" },
    warning: { bg: "var(--aqi-moderate-bg)", color: "var(--aqi-moderate-text)", bdr: "var(--aqi-moderate)" },
    danger: { bg: "var(--aqi-unhealthy-bg)", color: "var(--aqi-unhealthy-text)", bdr: "var(--aqi-unhealthy)" },
    info: { bg: "var(--accent-bg)", color: "var(--accent-text)", bdr: "var(--accent)" },
  };
  const t = map[tone] || map.info;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: "var(--radius-full)",
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.bdr}40`,
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function SectionHeader({ title, right }) {
  return (
    <div className="section-header">
      <div className="section-title">{title}</div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function StatusCard(props) {
  const {
    loading,
    error,
    retry,
    empty,
    skeletonLines = 3,
    children,
    title,
    value,
    subtitle,
    icon = "info",
    tone = "info",
  } = props || {};

  // Wrapper mode (used heavily by Officer pages)
  const isWrapper = children != null || loading != null || error != null || retry != null || empty != null;
  if (isWrapper) {
    return (
      <div className="card card-elevated" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: Math.max(1, Number(skeletonLines) || 3) }).map((_, i) => (
              <Skeleton key={i} height="14px" />
            ))}
          </div>
        ) : error ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ color: "var(--text-secondary)" }}>{String(error)}</div>
            {retry ? (
              <button className="btn btn-sm" onClick={retry}>
                Retry
              </button>
            ) : null}
          </div>
        ) : empty ? (
          <div className="muted">No data available.</div>
        ) : (
          children
        )}
      </div>
    );
  }

  // Metric mode (fallback)
  return (
    <div className="card card-elevated" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius-md)",
          display: "grid",
          placeItems: "center",
          background: "var(--bg-muted)",
          border: "1px solid var(--border-subtle)",
          marginTop: 2,
        }}
      >
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 650, lineHeight: 1.1 }}>{value}</div>
          {subtitle ? <Badge tone={tone}>{subtitle}</Badge> : null}
        </div>
      </div>
    </div>
  );
}
