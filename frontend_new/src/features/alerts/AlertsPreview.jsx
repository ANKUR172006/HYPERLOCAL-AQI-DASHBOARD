import Icon from "../../components/ui/Icon.jsx";
import { useMemo, useState } from "react";

function normalizeSeverity(sev) {
  const s = String(sev || "").toLowerCase();
  if (s.includes("critical")) return "critical";
  if (s.includes("severe") || s.includes("high")) return "high";
  return "moderate";
}

function severityUi(sev) {
  const key = normalizeSeverity(sev);
  if (key === "critical") return { key, label: "CRITICAL", icon: "alert-triangle", color: "var(--color-danger)" };
  if (key === "high") return { key, label: "HIGH", icon: "alert-circle", color: "var(--color-warning)" };
  return { key, label: "MODERATE", icon: "info", color: "var(--color-info)" };
}

function formatZone(wardId) {
  const raw = String(wardId || "").trim();
  if (!raw) return "Zone —";
  if (raw.startsWith("DEL_WARD_")) return `Zone Z${raw.replace("DEL_WARD_", "")}`;
  return raw;
}

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatRelativeTime(isoLike, now = new Date()) {
  const d = parseIsoDate(isoLike);
  if (!d) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function extractSpikePct(alert) {
  const direct = Number(alert?.pm25_spike_pct ?? alert?.pm25SpikePct ?? alert?.spike_pct ?? alert?.spikePct);
  if (Number.isFinite(direct)) return direct;

  const text = String(alert?.event || alert?.reason || alert?.trigger_reason || "");
  const m = text.match(/PM2\.?5\s*spike\s*([+-]?\d+(\.\d+)?)%/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function shortAction(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.toLowerCase().includes("issue advisory")) return "Action required: Issue advisory";
  if (s.length <= 70) return s;
  return `${s.slice(0, 68)}…`;
}

function causeUi(alert) {
  const text = `${alert?.cause || ""} ${alert?.event || ""} ${alert?.reason || ""}`.toLowerCase();
  if (text.includes("burn") || text.includes("fire") || text.includes("biomass")) return { icon: "flame", label: "Biomass Burning" };
  if (text.includes("traffic") || text.includes("vehicle")) return { icon: "car", label: "Traffic" };
  if (text.includes("dust") || text.includes("construction")) return { icon: "layers", label: "Dust" };
  if (text.includes("smog") || text.includes("haze") || text.includes("pm2.5") || text.includes("aqi")) return { icon: "wind", label: "Smog" };
  return { icon: "info", label: "Air quality" };
}

export function AlertItem({ alert }) {
  const [open, setOpen] = useState(false);
  const ui = useMemo(() => severityUi(alert?.sev || alert?.level), [alert?.sev, alert?.level]);
  const now = new Date();
  const rel = formatRelativeTime(alert?.time_utc || alert?.timeUtc || alert?.time, now);
  const zone = formatZone(alert?.ward || alert?.ward_id || alert?.zone);
  const aqi = Number(alert?.aqi ?? alert?.aqi_value ?? alert?.aqiValue);
  const hasAqi = Number.isFinite(aqi);
  const spike = extractSpikePct(alert);
  const cause = causeUi(alert);
  const action = shortAction(alert?.action);
  const title = String(alert?.title || alert?.event || alert?.reason || "Air quality anomaly").trim();
  const isActive = alert?.active === true;

  return (
    <div className={`alert-item alert-feed-item sev-${ui.key} ${isActive ? "is-active" : ""} ${open ? "is-open" : ""}`} style={{ ["--alert-strip"]: ui.color }}>
      <div className="alert-feed-icon">
        <Icon name={ui.icon} size={18} color={ui.color} />
      </div>

      <div className="alert-feed-body">
        <div className="alert-feed-top">
          <div className="alert-feed-top-left">
            <span className={`alert-sev-badge sev-${ui.key}`}>
              {ui.label}
              {isActive ? <span className="alert-active-dot" title="Active" /> : null}
            </span>
            <span className="alert-feed-time">{rel || ""}</span>
          </div>
          <div className="alert-feed-actions">
            <button className="btn btn-xs" onClick={() => setOpen(true)}>
              Advisory
            </button>
            <button className="btn btn-xs" onClick={() => setOpen((v) => !v)}>
              Details
              <Icon name="chevronDown" size={14} style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
            </button>
          </div>
        </div>

        <div className="alert-feed-main">
          <div className="alert-feed-zone">{zone}</div>
          <div className="alert-feed-metrics" aria-label="Key metrics">
            <div className="alert-metric">
              <div className="alert-metric-label">AQI</div>
              <div className="alert-metric-value">{hasAqi ? aqi : "—"}</div>
            </div>
            <div className="alert-metric">
              <div className="alert-metric-label">PM2.5</div>
              <div className={`alert-metric-value ${spike != null && spike > 0 ? "is-up" : ""}`}>
                {spike == null ? "—" : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name={spike >= 0 ? "arrowUp" : "arrowDown"} size={16} color={spike >= 0 ? "var(--color-danger)" : "var(--color-info)"} />
                    <span>{`${spike >= 0 ? "+" : ""}${Math.round(spike)}%`}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="alert-feed-bottom">
          <div className="alert-feed-cause" title={cause.label}>
            <Icon name={cause.icon} size={16} color="var(--text-secondary)" />
            <span>{cause.label}</span>
          </div>
          <div className="alert-feed-summary" title={title}>
            {action || title}
          </div>
        </div>

        {open ? (
          <div className="alert-feed-details">
            {title ? <div className="alert-detail-line"><span className="muted">Signal:</span> {title}</div> : null}
            {alert?.event && alert?.event !== title ? <div className="alert-detail-line"><span className="muted">Reason:</span> {String(alert.event)}</div> : null}
            {alert?.action ? <div className="alert-detail-line"><span className="muted">Recommended:</span> {shortAction(alert.action)}</div> : null}
            {alert?.ward_id ? <div className="alert-detail-line"><span className="muted">Ward:</span> {String(alert.ward_id)}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
