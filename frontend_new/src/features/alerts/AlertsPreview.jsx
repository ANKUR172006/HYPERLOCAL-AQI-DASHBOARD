import Icon from "../../components/ui/Icon.jsx";

function sevTone(sev) {
  const s = String(sev || "").toLowerCase();
  if (s.includes("critical") || s.includes("severe")) return { icon: "alert-triangle", color: "var(--color-danger)" };
  if (s.includes("high")) return { icon: "alert-circle", color: "var(--color-warning)" };
  return { icon: "info", color: "var(--color-info)" };
}

export function AlertItem({ alert }) {
  const t = sevTone(alert?.sev || alert?.level);
  return (
    <div className="alert-item">
      <div className="alert-icon">
        <Icon name={t.icon} size={18} color={t.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 650, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {alert?.ward || alert?.ward_id || "Zone"}
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {alert?.time || ""}
          </div>
        </div>
        <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>{alert?.event || alert?.reason || "Incident detected"}</div>
        {alert?.action ? <div style={{ color: "var(--text-muted)", marginTop: 6, fontSize: "0.875rem" }}>{alert.action}</div> : null}
      </div>
    </div>
  );
}
