import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../utils/api";
import {
  useAlertsFeed,
  useAppLocation,
  APP_AUTO_REFRESH_MS,
  useAsync,
  useComplaints,
  useDelhiBoundary,
  useDelhiWardsGrid,
  useEnvironmentUnified,
  useFiresNearby,
  useGovRecommendations,
  useLocationBoundary,
  useLocationVirtualGrid,
  useReadiness,
  useTrends,
  useWardMap,
} from "../../hooks/index.js";
import { aqiTone, getAqiCategory, safeNum, safeStr } from "../../tokens/index.js";
import Icon from "../../components/ui/Icon.jsx";
import { Badge, SectionHeader, StatusCard } from "../../components/ui/index.jsx";
import WardGeoMap from "../../features/map/WardGeoMap.jsx";

const CITY_ID = "DELHI";
const ACTION_LOG_STORAGE_KEY = "officer:action-log";
const TABS = ["Overview", "Map", "Incidents", "Actions", "Complaints", "Trends"];

const toneForStatus = (status) => {
  const v = String(status || "").toUpperCase();
  if (["CRITICAL", "SEVERE", "DISASTER", "EMERGENCY"].some((t) => v.includes(t))) return "danger";
  if (["HIGH", "ACTIVE", "WARNING", "ASSIGNED", "IN_PROGRESS"].some((t) => v.includes(t))) return "warning";
  if (["RESOLVED", "NORMAL", "READY", "VERIFIED"].some((t) => v.includes(t))) return "success";
  return "info";
};
const formatTime = (value) => {
  if (!value) return "Unknown";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const formatPop = (value) => safeNum(value, 0).toLocaleString("en-IN");
const riskLabel = (row) => safeNum(row?.risk_score, 0) >= 80 ? "Critical" : safeNum(row?.risk_score, 0) >= 60 ? "High" : safeNum(row?.risk_score, 0) >= 35 ? "Medium" : "Low";
const trendArrow = (t) => String(t || "").toLowerCase().includes("rise") || String(t || "").toLowerCase().includes("worsen") ? "↑" : String(t || "").toLowerCase().includes("fall") || String(t || "").toLowerCase().includes("improv") ? "↓" : "→";
const densityLabel = (score) => score >= 75 ? "Very high" : score >= 55 ? "High" : score >= 35 ? "Medium" : "Low";
const readActionLog = () => { try { return JSON.parse(localStorage.getItem(ACTION_LOG_STORAGE_KEY) || "{}"); } catch { return {}; } };
const writeActionLog = (value) => localStorage.setItem(ACTION_LOG_STORAGE_KEY, JSON.stringify(value));
const sourceKind = (label) => {
  const txt = String(label || "").toLowerCase();
  if (txt.includes("fire") || txt.includes("burn")) return "Fire";
  if (txt.includes("traffic")) return "Traffic";
  if (txt.includes("industrial")) return "Industrial";
  return "Mixed";
};
const complaintType = (text) => {
  const t = String(text || "").toLowerCase();
  if (t.includes("smoke")) return "Smoke";
  if (t.includes("smell")) return "Burning smell";
  if (t.includes("industrial") || t.includes("factory")) return "Industrial pollution";
  if (t.includes("dust") || t.includes("construction")) return "Dust";
  return "Air pollution";
};
const readableTrigger = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return safeStr(value?.title, safeStr(value?.type, safeStr(value?.reason, safeStr(value?.description, ""))));
};
const trendLabel = (sourceTrend, trendPayload, forecastRows) => {
  const explicit = safeStr(sourceTrend, "");
  if (explicit) return explicit;
  const hourly = Array.isArray(trendPayload?.data?.hourly)
    ? trendPayload.data.hourly
    : Array.isArray(trendPayload?.hourly)
      ? trendPayload.hourly
      : [];
  if (hourly.length >= 2) {
    const first = safeNum(hourly[0]?.aqi, 0);
    const last = safeNum(hourly[hourly.length - 1]?.aqi, 0);
    if (last - first >= 15) return "rising";
    if (first - last >= 15) return "falling";
  }
  if (Array.isArray(forecastRows) && forecastRows.length >= 2) {
    const first = safeNum(forecastRows[0]?.aqi, 0);
    const last = safeNum(forecastRows[forecastRows.length - 1]?.aqi, 0);
    if (last - first >= 12) return "rising";
    if (first - last >= 12) return "falling";
  }
  return "stable";
};
const actionDescriptor = (key) => ({
  issue_advisory: { label: "Issue advisory", status: "ADVISORY_ISSUED" },
  restrict_traffic: { label: "Restrict traffic", status: "TRAFFIC_RESTRICTED" },
  assign_field_team: { label: "Assign field team", status: "FIELD_TEAM_ASSIGNED" },
  increase_monitoring: { label: "Increase monitoring", status: "MONITORING_INCREASED" },
  mark_resolved: { label: "Mark resolved", status: "RESOLVED" },
}[key] || { label: "Action taken", status: "ACTIVE" });

function TabButton({ label, active, count, onClick }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-sm" style={{ borderColor: active ? "rgba(249,115,22,0.35)" : "var(--border-subtle)", background: active ? "rgba(249,115,22,0.12)" : "var(--bg-surface)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{label}{Number.isFinite(count) ? <Badge tone={active ? "warning" : "info"}>{count}</Badge> : null}</span>
    </button>
  );
}

function Metric({ title, value, note, tone, icon }) {
  return (
    <div className="card card-elevated" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bg-muted)" }}><Icon name={icon} size={18} /></div>
        <div style={{ fontSize: "1.85rem", fontWeight: 900, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ marginTop: 10 }}><Badge tone={tone}>{note}</Badge></div>
    </div>
  );
}

function ZoneCard({ row, active, onClick, extra }) {
  return (
    <button type="button" onClick={onClick} className="card-flat" style={{ padding: 12, textAlign: "left", border: active ? `1px solid ${aqiTone(row.aqi).color}` : "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 850 }}>{row.ward_name}</div>
          <div className="muted" style={{ marginTop: 5 }}>AQI {row.aqi} · Population {formatPop(row.affected_population)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge tone={toneForStatus(riskLabel(row))}>{riskLabel(row)}</Badge>
          <span className="tag">{extra}</span>
        </div>
      </div>
    </button>
  );
}

export default function OfficerPage({ onBack }) {
  const location = useAppLocation();
  const readiness = useReadiness();
  const alerts = useAlertsFeed();
  const recommendations = useGovRecommendations();
  const complaints = useComplaints();
  const wardMap = useWardMap(location.lat, location.lon);
  const officerView = useAsync(() => api.getDisasterOfficerView(CITY_ID, 15), [], { refreshMs: APP_AUTO_REFRESH_MS });
  const disasterStatus = useAsync(() => api.getDisasterStatus(CITY_ID), [], { refreshMs: APP_AUTO_REFRESH_MS });
  const firesNearby = useFiresNearby(location.lat, location.lon, 90, 2);
  const environment = useEnvironmentUnified(location.lat, location.lon, true);
  const delhiBoundary = useDelhiBoundary();
  const delhiWards = useDelhiWardsGrid();
  const locationBoundary = useLocationBoundary(location.lat, location.lon);
  const locationGrid = useLocationVirtualGrid(location.lat, location.lon, 25);

  const [activeTab, setActiveTab] = useState("Overview");
  const [activeLayer, setActiveLayer] = useState("AQI");
  const [responsibleAuthority, setResponsibleAuthority] = useState("District Control Room");
  const [assignedOfficer, setAssignedOfficer] = useState("Duty Officer");
  const [actionLog, setActionLog] = useState(() => readActionLog());
  const [selectedWardId, setSelectedWardId] = useState("");

  const isDelhiMode = safeStr(locationBoundary.data?.mode, "delhi") === "delhi";
  const mapBoundary = isDelhiMode ? delhiBoundary.data?.data : locationBoundary.data?.data;
  const mapGrid = isDelhiMode ? delhiWards.data?.data : locationGrid.data?.data;
  const fireHotspots = Array.isArray(firesNearby.data?.fires) ? firesNearby.data.fires : [];

  useEffect(() => { writeActionLog(actionLog); }, [actionLog]);

  const zoneRows = useMemo(() => {
    const rows = Array.isArray(wardMap.data?.data) ? wardMap.data.data : [];
    const officerRows = new Map((Array.isArray(officerView.data?.top_critical_wards) ? officerView.data.top_critical_wards : []).map((r) => [safeStr(r.ward_id, ""), r]));
    const recRows = new Map((Array.isArray(recommendations.data?.data) ? recommendations.data.data : []).map((r) => [safeStr(r.ward_id, ""), r]));
    return rows.map((row) => {
      const wardId = safeStr(row.ward_id, "");
      const assessment = row.disaster_assessment || {};
      const officer = officerRows.get(wardId) || {};
      const rec = recRows.get(wardId) || {};
      const aqi = safeNum(row.aqi, 0);
      const affected = safeNum(assessment.affected_population, safeNum(officer.affected_population, Math.round(aqi * 120)));
      const exposure = safeNum(assessment.exposure_risk, safeNum(officer.exposure_risk, aqi * Math.max(1, affected / 1000)));
      const risk = safeNum(assessment.risk_score, safeNum(officer.risk_score, exposure / 100));
      const density = safeNum(assessment.population_density_index, Math.max(20, Math.min(95, exposure / Math.max(1, aqi || 1))));
      const primaryLabel = safeStr(row.source_detection?.primary?.label, safeStr(row.primary_pollutant, "Mixed"));
      return {
        ward_id: wardId,
        ward_name: safeStr(row.ward_name, wardId),
        aqi,
        category: safeStr(row.category, getAqiCategory(aqi).label),
        centroid_lat: safeNum(row.centroid_lat, null),
        centroid_lon: safeNum(row.centroid_lon, null),
        primary_pollutant: safeStr(row.primary_pollutant, ""),
        source_detection: row.source_detection || {},
        affected_population: affected,
        exposure_risk: exposure,
        risk_score: risk,
        density_score: density,
        alert_level: safeStr(assessment.alert_level, safeStr(officer.alert_level, "")),
        status: safeStr(assessment.status, safeStr(officer.status, "MONITOR")),
        disaster_type: safeStr(assessment.disaster_type, safeStr(officer.disaster_type, "pollution spike")),
        disaster_mode: Boolean(assessment.disaster_mode ?? officer.disaster_mode),
        confidence_score: safeNum(assessment.confidence_score, safeNum(row.source_detection?.primary?.confidence, 0)),
        causes: Array.isArray(assessment.causes) ? assessment.causes : (Array.isArray(officer.source_panel) ? officer.source_panel : []),
        triggers: Array.isArray(assessment.triggers) ? assessment.triggers : (Array.isArray(officer.triggers) ? officer.triggers : []),
        actions: Array.isArray(assessment.actions) && assessment.actions.length ? assessment.actions : (Array.isArray(officer.suggested_actions) ? officer.suggested_actions : []),
        metrics: assessment.metrics || officer.metrics || {},
        summary: assessment.summary || {},
        estimated: Boolean(row.estimated),
        sector: safeStr(row.sector, ""),
        sensors_online: safeNum(row.sensors_online, 0),
        as_of_utc: safeStr(assessment.as_of_utc, safeStr(officer.as_of_utc, row.as_of_utc)),
        recommendation: rec,
        source_kind: sourceKind(primaryLabel),
      };
    }).sort((a, b) => safeNum(b.risk_score, 0) - safeNum(a.risk_score, 0) || safeNum(b.affected_population, 0) - safeNum(a.affected_population, 0));
  }, [officerView.data, recommendations.data, wardMap.data]);

  useEffect(() => {
    if (!zoneRows.length) return;
    if (!selectedWardId || !zoneRows.some((r) => r.ward_id === selectedWardId)) setSelectedWardId(zoneRows[0].ward_id);
  }, [selectedWardId, zoneRows]);

  const selectedZone = useMemo(() => zoneRows.find((r) => r.ward_id === selectedWardId) || zoneRows[0] || null, [selectedWardId, zoneRows]);
  const trends = useTrends(selectedZone?.ward_id || "");
  const forecast = useAsync(selectedZone?.ward_id ? async () => {
    const rows = await Promise.all([1, 2, 3].map((h) => api.getAqiForecast(selectedZone.ward_id, h)));
    return rows.map((item, idx) => {
      const payload = item?.data || {};
      return {
        horizon: safeNum(payload?.horizon_hour, idx + 1),
        aqi: safeNum(payload?.aqi_pred, null),
        category: safeStr(payload?.category, ""),
        generatedAt: safeStr(payload?.ts_generated_utc, ""),
        targetAt: safeStr(payload?.target_ts_utc, ""),
        modelName: safeStr(payload?.model?.name, ""),
      };
    }).filter((item) => Number.isFinite(item.aqi));
  } : null, [selectedZone?.ward_id], { refreshMs: APP_AUTO_REFRESH_MS });

  const selectedTrend = trendLabel(
    selectedZone?.summary?.citizen?.trend_prediction || selectedZone?.source_detection?.trend?.direction || selectedZone?.source_detection?.trend,
    trends.data?.data || trends.data,
    forecast.data,
  );
  const selectedActionState = actionLog[selectedZone?.ward_id || ""] || { status: "NO_ACTION", history: [] };

  const complaintRows = useMemo(() => {
    const base = Array.isArray(complaints.data?.data) ? complaints.data.data : [];
    const byWard = {};
    base.forEach((row) => { const id = safeStr(row.ward_id, ""); byWard[id] = (byWard[id] || 0) + 1; });
    const zoneById = new Map(zoneRows.map((row) => [row.ward_id, row]));
    return base.map((row) => {
      const wardId = safeStr(row.ward_id, "");
      const zone = zoneById.get(wardId) || null;
      const cluster = byWard[wardId] || 1;
      const severityScore = Math.min(100, (zone?.aqi >= 300 ? 70 : zone?.aqi >= 200 ? 50 : 30) + (cluster - 1) * 8 + Math.min(18, safeNum(row.votes, 0) * 4) + (zone?.source_kind === "Fire" ? 12 : 0) + (zone?.source_kind === "Industrial" ? 10 : 0));
      return {
        id: row.id,
        ward_id: wardId,
        ward_name: safeStr(row.ward_name, zone?.ward_name || wardId),
        text: safeStr(row.text, ""),
        status: safeStr(row.status, "OPEN"),
        votes: safeNum(row.votes, 0),
        time_utc: safeStr(row.time_utc, ""),
        updated_at_utc: safeStr(row.updated_at_utc, ""),
        type: complaintType(row.text),
        cluster,
        severityScore,
        severity: severityScore >= 75 ? "Critical" : severityScore >= 55 ? "High" : severityScore >= 35 ? "Medium" : "Low",
        matchedSource: zone?.source_kind || "Mixed",
        matchedAqi: zone?.aqi ?? null,
        recommended: cluster >= 3 ? "Trigger alert and assign team" : zone?.actions?.[0] || "Verify complaint on ground",
      };
    }).sort((a, b) => b.severityScore - a.severityScore);
  }, [complaints.data, zoneRows]);

  const sourceSummary = useMemo(() => {
    const totals = { Fire: 0, Traffic: 0, Industrial: 0, Mixed: 0 };
    zoneRows.forEach((row) => { totals[row.source_kind in totals ? row.source_kind : "Mixed"] += Math.max(1, safeNum(row.risk_score, 1)); });
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0) || 1;
    return Object.entries(totals).map(([key, value]) => ({ key, pct: Math.round((value / total) * 100) }));
  }, [zoneRows]);

  const timelineRows = useMemo(() => {
    const alertEvents = (Array.isArray(alerts.data?.data) ? alerts.data.data : []).map((row, idx) => ({ id: `alert-${idx}`, time: row.time_utc || row.as_of_utc || alerts.data?.timestamp, title: safeStr(row.event, "Alert"), ward_id: safeStr(row.ward_id, ""), ward_name: safeStr(row.ward_name, row.ward_id), severity: safeStr(row.sev, "info"), status: safeStr(row.status, "active"), note: safeStr(row.action, "") }));
    const disasterEvents = (Array.isArray(officerView.data?.event_history) ? officerView.data.event_history : []).map((row, idx) => ({ id: `event-${idx}`, time: row.started_at_utc, title: safeStr(row.reason, "Disaster event"), ward_id: safeStr(row.ward_id, ""), ward_name: safeStr(row.ward_name, row.ward_id), severity: safeStr(row.level, "warning"), status: row.disaster_mode ? "active" : "resolved", note: row.disaster_mode ? "Disaster mode active" : "Recovered" }));
    const actionEvents = Object.entries(actionLog).flatMap(([wardId, state]) => (Array.isArray(state?.history) ? state.history : []).map((entry, idx) => ({ id: `action-${wardId}-${idx}`, time: entry.timestamp, title: safeStr(entry.label, "Authority action"), ward_id: wardId, severity: safeStr(entry.status, "info"), status: safeStr(entry.status, "ACTIVE"), note: `${safeStr(entry.responsible, "Authority")} · ${safeStr(entry.note, "")}`.trim() })));
    const complaintEvents = complaintRows.slice(0, 8).map((row) => ({ id: `complaint-${row.id}`, time: row.updated_at_utc || row.time_utc, title: `${row.type} complaint`, ward_id: row.ward_id, ward_name: row.ward_name, severity: row.severity, status: row.status, note: row.recommended }));
    return [...alertEvents, ...disasterEvents, ...actionEvents, ...complaintEvents].filter((row) => row.time).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 16);
  }, [actionLog, alerts.data, complaintRows, officerView.data]);

  const summary = useMemo(() => {
    const totalAffected = zoneRows.reduce((sum, row) => sum + safeNum(row.affected_population, 0), 0);
    const criticalCount = zoneRows.filter((row) => row.aqi >= 300 || riskLabel(row) === "Critical").length;
    const avgAqi = zoneRows.length ? Math.round(zoneRows.reduce((sum, row) => sum + safeNum(row.aqi, 0), 0) / zoneRows.length) : 0;
    return {
      cityStatus: disasterStatus.data?.disaster_mode ? "Disaster" : criticalCount ? "Warning" : "Normal",
      criticalCount,
      totalAffected,
      avgAqi,
      activeAlerts: timelineRows.length,
      disasterType: safeStr(zoneRows.find((row) => row.disaster_mode)?.disaster_type, disasterStatus.data?.disaster_mode ? "pollution spike" : "None"),
      lastUpdated: safeStr(officerView.data?.timestamp, safeStr(wardMap.data?.timestamp, "")),
    };
  }, [disasterStatus.data, officerView.data, timelineRows.length, wardMap.data, zoneRows]);

  const recordAction = useCallback((actionKey, zone = selectedZone) => {
    if (!zone) return;
    const desc = actionDescriptor(actionKey);
    const timestamp = new Date().toISOString();
    setActionLog((prev) => {
      const current = prev[zone.ward_id] || { status: "NO_ACTION", history: [] };
      return {
        ...prev,
        [zone.ward_id]: {
          status: desc.status,
          responsible: responsibleAuthority,
          assignedOfficer,
          history: [{ key: actionKey, label: desc.label, status: desc.status, timestamp, responsible: responsibleAuthority, assignedOfficer, note: zone.actions?.[0] || zone.recommendation?.action || "Manual authority action" }, ...(Array.isArray(current.history) ? current.history : [])].slice(0, 20),
        },
      };
    });
  }, [assignedOfficer, responsibleAuthority, selectedZone]);

  const updateComplaint = useCallback(async (id, patch) => { await api.patchComplaint(id, patch); complaints.retry?.(); }, [complaints]);
  const visibleHotspots = activeLayer === "Density" ? [] : fireHotspots;
  const topZones = zoneRows.slice(0, 10);
  const actionZones = zoneRows.filter((row) => row.aqi >= 180 || riskLabel(row) !== "Low").slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card card-elevated" style={{ padding: 18, background: "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(17,24,39,0.92) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)", display: "grid", placeItems: "center" }}><Icon name="building" size={20} color="#fff" /></div>
            <div><h1 style={{ fontSize: "1.3rem", marginBottom: 2 }}>Government Officer Command System</h1><div className="muted">Environmental monitoring, disaster response, complaints, and action control in one screen</div></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone={summary.cityStatus === "Disaster" ? "danger" : summary.cityStatus === "Warning" ? "warning" : "success"}>{summary.cityStatus}</Badge>
            <Badge tone={readiness.data?.status === "ready" ? "success" : "warning"}>{readiness.data?.status === "ready" ? "System ready" : "Syncing"}</Badge>
            <Badge tone="info">{safeStr(locationBoundary.data?.region?.district || location.label, "Delhi Region")}</Badge>
            <button className="btn btn-sm" onClick={onBack}>Back to Citizen View</button>
          </div>
        </div>
        {disasterStatus.data?.disaster_mode ? <div className="card-flat" style={{ marginTop: 14, padding: 14, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(127,29,29,0.28)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}><div style={{ fontWeight: 900, color: "#fecaca" }}>DISASTER MODE ACTIVE</div><Badge tone="danger">{summary.disasterType}</Badge></div><div className="muted" style={{ marginTop: 8 }}>Critical thresholds crossed. Prioritize alerts, field teams, and zone-level restrictions immediately.</div></div> : null}
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
          <Metric title="Region" value={safeStr(locationBoundary.data?.region?.district || locationBoundary.data?.region?.city, "Delhi")} note="Officer monitoring region" tone="info" icon="mapPin" />
          <Metric title="Current AQI" value={summary.avgAqi || "-"} note={getAqiCategory(summary.avgAqi || 0).label} tone={aqiTone(summary.avgAqi || 0).tone || "info"} icon="wind" />
          <Metric title="Risk Level" value={summary.cityStatus} note={`${summary.criticalCount} critical zones`} tone={toneForStatus(summary.cityStatus)} icon="alert" />
          <Metric title="Disaster Status" value={disasterStatus.data?.disaster_mode ? "Active" : "None"} note={summary.disasterType} tone={disasterStatus.data?.disaster_mode ? "danger" : "success"} icon="flame" />
          <Metric title="Last Updated" value={summary.lastUpdated ? formatTime(summary.lastUpdated) : "-"} note="Real-time refresh" tone="info" icon="refresh" />
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div className="card-flat" style={{ padding: 12 }}><div className="muted">Critical zones</div><div style={{ marginTop: 6, fontWeight: 850, fontSize: "1.4rem" }}>{summary.criticalCount}</div></div>
          <div className="card-flat" style={{ padding: 12 }}><div className="muted">Affected population</div><div style={{ marginTop: 6, fontWeight: 850, fontSize: "1.4rem" }}>{formatPop(summary.totalAffected)}</div></div>
          <div className="card-flat" style={{ padding: 12 }}><div className="muted">Active alerts</div><div style={{ marginTop: 6, fontWeight: 850, fontSize: "1.4rem" }}>{summary.activeAlerts}</div></div>
          <div className="card-flat" style={{ padding: 12 }}><div className="muted">Disaster type</div><div style={{ marginTop: 6, fontWeight: 850, fontSize: "1.1rem" }}>{summary.disasterType}</div></div>
        </div>
      </div>

      <div className="card card-elevated" style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TABS.map((tab) => <TabButton key={tab} label={tab} active={activeTab === tab} count={tab === "Overview" ? topZones.length : tab === "Map" ? zoneRows.length : tab === "Incidents" ? timelineRows.length : tab === "Actions" ? actionZones.length : tab === "Complaints" ? complaintRows.length : 3} onClick={() => setActiveTab(tab)} />)}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["AQI", "Fire", "Density"].map((layer) => <button key={layer} type="button" onClick={() => setActiveLayer(layer)} className="btn btn-sm" style={{ borderColor: activeLayer === layer ? "rgba(59,130,246,0.35)" : "var(--border-subtle)", background: activeLayer === layer ? "rgba(59,130,246,0.14)" : "var(--bg-surface)" }}>{layer}</button>)}
          </div>
        </div>
      </div>

      {activeTab === "Overview" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16, alignItems: "start" }}>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title="Top Critical Zones" right={<Badge tone="danger">Exposure risk = AQI × Density</Badge>} />
            <StatusCard loading={wardMap.loading || officerView.loading} error={wardMap.error || officerView.error} retry={() => { wardMap.retry?.(); officerView.retry?.(); }} empty={!topZones.length} skeletonLines={6}>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {topZones.map((row) => <ZoneCard key={row.ward_id} row={row} active={row.ward_id === selectedZone?.ward_id} onClick={() => setSelectedWardId(row.ward_id)} extra={`${trendArrow(selectedTrend)} ${selectedTrend}`} />)}
              </div>
            </StatusCard>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Source Summary" />
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {sourceSummary.map((item) => <div key={item.key} className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 8 }}><div style={{ fontWeight: 800 }}>{item.key}</div><Badge tone={item.key === "Fire" ? "danger" : item.key === "Traffic" ? "warning" : item.key === "Industrial" ? "info" : "info"}>{item.pct}%</Badge></div>)}
              </div>
            </div>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Key Insight" />
              <div className="card-flat" style={{ marginTop: 12, padding: 14, lineHeight: 1.65 }}>
                Pollution is {selectedTrend} in {safeStr(selectedZone?.ward_name, "the selected zone")} due to {safeStr(selectedZone?.source_detection?.primary?.label, safeStr(selectedZone?.primary_pollutant, "mixed causes")).toLowerCase()} with density pressure marked as {densityLabel(safeNum(selectedZone?.density_score, 0)).toLowerCase()}. {complaintRows[0]?.cluster >= 3 ? "Complaint clustering in the same area is increasing operational priority." : "Continue monitoring complaint inflow and hotspot changes."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "Map" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16, alignItems: "start" }}>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title="Interactive Zone Map" right={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge tone="danger">{visibleHotspots.length} fire hotspots</Badge><Badge tone={activeLayer === "Density" ? "warning" : "info"}>{activeLayer} layer</Badge></div>} />
            <div className="muted" style={{ marginTop: 6, marginBottom: 12 }}>Click any ward to inspect AQI, density, risk, source, and trend.</div>
            <StatusCard loading={wardMap.loading || (isDelhiMode ? delhiBoundary.loading || delhiWards.loading : locationBoundary.loading || locationGrid.loading)} error={wardMap.error || delhiBoundary.error || delhiWards.error || locationBoundary.error || locationGrid.error} retry={() => { wardMap.retry?.(); delhiBoundary.retry?.(); delhiWards.retry?.(); locationBoundary.retry?.(); locationGrid.retry?.(); }} empty={!zoneRows.length}>
              <WardGeoMap
                boundary={mapBoundary}
                wardGeojson={mapGrid}
                wards={zoneRows.map((row) => ({ ward_id: row.ward_id, ward_name: row.ward_name, aqi: activeLayer === "Density" ? Math.round(row.density_score * 5) : row.aqi, centroid_lat: row.centroid_lat, centroid_lon: row.centroid_lon, primary_pollutant: row.primary_pollutant, source_detection: row.source_detection, estimated: row.estimated, has_snapshot: !row.estimated, as_of_utc: row.as_of_utc }))}
                loading={false}
                hotspots={visibleHotspots}
                selectedWardId={selectedZone?.ward_id || ""}
                onSelect={(row) => setSelectedWardId(row?.ward_id || "")}
                legendLabel={isDelhiMode && delhiWards.data?.data ? "Delhi ward map" : "Ward heatmap"}
              />
            </StatusCard>
          </div>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title={selectedZone ? selectedZone.ward_name : "Zone Detail"} right={selectedZone ? <Badge tone={toneForStatus(riskLabel(selectedZone))}>{riskLabel(selectedZone)}</Badge> : null} />
            <StatusCard loading={!selectedZone && wardMap.loading} empty={!selectedZone}>
              {selectedZone ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">AQI</div><div style={{ marginTop: 6, fontWeight: 900, fontSize: "1.8rem", color: aqiTone(selectedZone.aqi).color }}>{selectedZone.aqi}</div></div>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">Density</div><div style={{ marginTop: 6, fontWeight: 800 }}>{densityLabel(selectedZone.density_score)}</div></div>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">Risk</div><div style={{ marginTop: 6, fontWeight: 800 }}>{safeNum(selectedZone.risk_score, 0)}</div></div>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">Source</div><div style={{ marginTop: 6, fontWeight: 800 }}>{safeStr(selectedZone.source_detection?.primary?.label, selectedZone.source_kind)}</div></div>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">Trend</div><div style={{ marginTop: 6, fontWeight: 800 }}>{trendArrow(selectedTrend)} {selectedTrend}</div></div>
                  <div className="card-flat" style={{ padding: 12 }}><div className="muted">Sensitive locations</div><div style={{ marginTop: 6, fontWeight: 800 }}>{safeNum(selectedZone.metrics?.sensitive_sites, 0) || "—"}</div></div>
                </div>
              ) : null}
            </StatusCard>
          </div>
        </div>
      ) : null}

      {activeTab === "Incidents" ? (
        <div className="card card-elevated" style={{ padding: 16 }}>
          <SectionHeader title="Incident Timeline" right={<Badge tone="warning">{timelineRows.length} events</Badge>} />
          <StatusCard loading={alerts.loading || officerView.loading} error={alerts.error || officerView.error} retry={() => { alerts.retry?.(); officerView.retry?.(); }} empty={!timelineRows.length} skeletonLines={6}>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {timelineRows.map((row) => <div key={row.id} className="card-flat" style={{ padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}><div style={{ fontWeight: 800 }}>{safeStr(row.title, "Incident")}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge tone={toneForStatus(row.severity)}>{safeStr(row.severity, "info")}</Badge><span className="tag">{safeStr(row.status, "active")}</span></div></div><div className="muted" style={{ marginTop: 6 }}>{safeStr(row.ward_name, safeStr(row.ward_id, "City-wide"))} · {formatTime(row.time)}</div><div style={{ marginTop: 6 }}>{safeStr(row.note, "No note")}</div></div>)}
            </div>
          </StatusCard>
        </div>
      ) : null}

      {activeTab === "Actions" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title="Action Queue" right={<Badge tone="danger">{actionZones.length}</Badge>} />
            <div className="muted" style={{ marginTop: 6 }}>Priority zones for advisory, traffic restriction, field deployment, and resolution tracking.</div>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {actionZones.map((zone) => {
                const state = actionLog[zone.ward_id] || {};
                return (
                  <div key={zone.ward_id} className="card-flat" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div><div style={{ fontWeight: 850 }}>{zone.ward_name}</div><div className="muted" style={{ marginTop: 5 }}>Risk {safeNum(zone.risk_score, 0)} · Source {zone.source_kind}</div></div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge tone={toneForStatus(riskLabel(zone))}>{riskLabel(zone)}</Badge><span className="tag">AQI {zone.aqi}</span></div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn-xs" onClick={() => { setSelectedWardId(zone.ward_id); recordAction("issue_advisory", zone); }}>Issue advisory</button>
                      <button className="btn btn-xs" onClick={() => { setSelectedWardId(zone.ward_id); recordAction("restrict_traffic", zone); }}>Restrict traffic</button>
                      <button className="btn btn-xs" onClick={() => { setSelectedWardId(zone.ward_id); recordAction("assign_field_team", zone); }}>Assign field team</button>
                      <button className="btn btn-xs" onClick={() => { setSelectedWardId(zone.ward_id); recordAction("increase_monitoring", zone); }}>Increase monitoring</button>
                      <button className="btn btn-xs" onClick={() => { setSelectedWardId(zone.ward_id); recordAction("mark_resolved", zone); }}>Mark resolved</button>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>Status: {safeStr(state.status, "NO_ACTION")} {state.history?.[0]?.timestamp ? `· ${formatTime(state.history[0].timestamp)}` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title={selectedZone ? `Action Control · ${selectedZone.ward_name}` : "Action Control"} right={selectedZone ? <Badge tone={toneForStatus(selectedActionState.status)}>{safeStr(selectedActionState.status, "NO_ACTION")}</Badge> : null} />
            <StatusCard loading={!selectedZone && wardMap.loading} empty={!selectedZone}>
              {selectedZone ? (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  <input value={responsibleAuthority} onChange={(e) => setResponsibleAuthority(e.target.value)} placeholder="Responsible authority" style={{ minHeight: 40, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)", padding: "0 12px" }} />
                  <input value={assignedOfficer} onChange={(e) => setAssignedOfficer(e.target.value)} placeholder="Assigned officer" style={{ minHeight: 40, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)", padding: "0 12px" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                      ["Issue advisory", "warning", "issue_advisory"],
                      ["Restrict traffic", "warning", "restrict_traffic"],
                      ["Assign field team", "info", "assign_field_team"],
                      ["Increase monitoring", "info", "increase_monitoring"],
                      ["Mark resolved", "success", "mark_resolved"],
                    ].map(([label, tone, key]) => <button key={key} className="btn btn-sm" onClick={() => recordAction(key)}><Badge tone={tone}>{label}</Badge></button>)}
                  </div>
                  <div className="card-flat" style={{ padding: 12 }}><div style={{ fontWeight: 850 }}>Recommended action</div><div className="muted" style={{ marginTop: 6 }}>{selectedZone.actions?.[0] || selectedZone.recommendation?.action || "Continue monitoring and notify local teams."}</div></div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {(selectedActionState.history || []).slice(0, 6).map((entry, idx) => <div key={`${entry.timestamp}-${idx}`} className="card-flat" style={{ padding: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><div style={{ fontWeight: 800 }}>{entry.label}</div><Badge tone={toneForStatus(entry.status)}>{entry.status}</Badge></div><div className="muted" style={{ marginTop: 5 }}>{safeStr(entry.responsible, "Authority")} · {safeStr(entry.assignedOfficer, "Officer")} · {formatTime(entry.timestamp)}</div></div>)}
                  </div>
                </div>
              ) : null}
            </StatusCard>
          </div>
        </div>
      ) : null}

      {activeTab === "Complaints" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 16, alignItems: "start" }}>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title="Citizen Complaints" right={<Badge tone="warning">{complaintRows.length}</Badge>} />
            <StatusCard loading={complaints.loading} error={complaints.error} retry={complaints.retry} empty={!complaintRows.length} skeletonLines={5}>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {complaintRows.map((row) => (
                  <div key={row.id} className="card-flat" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontWeight: 850 }}>{safeStr(row.ward_name, row.ward_id)}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge><span className="tag">{row.status}</span></div>
                    </div>
                    <div style={{ marginTop: 6 }}>{row.type}</div>
                    <div className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>{row.text}</div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className="tag">AQI {row.matchedAqi ?? "—"}</span>
                      <span className="tag">Source {row.matchedSource}</span>
                      <span className="tag">Cluster {row.cluster}</span>
                      <span className="tag">Votes {row.votes}</span>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>{row.recommended}</div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn-xs" onClick={() => updateComplaint(row.id, { status: "VERIFIED" })}>Verify</button>
                      <button className="btn btn-xs" onClick={() => updateComplaint(row.id, { status: "IN_PROGRESS" })}>Assign team</button>
                      <button className="btn btn-xs" onClick={() => updateComplaint(row.id, { status: "RESOLVED" })}>Resolve</button>
                    </div>
                  </div>
                ))}
              </div>
            </StatusCard>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Complaint Logic" />
              <div className="card-flat" style={{ marginTop: 12, padding: 14, lineHeight: 1.6 }}>Complaints are cross-checked against AQI severity, fire signals, industrial attribution, and same-zone clustering. Multi-complaint areas automatically rise in officer priority.</div>
            </div>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Escalation Watch" />
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {complaintRows.filter((row) => row.cluster >= 2 || row.severity === "Critical").slice(0, 6).map((row) => <div key={`watch-${row.id}`} className="card-flat" style={{ padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div style={{ fontWeight: 800 }}>{safeStr(row.ward_name, row.ward_id)}</div><Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge></div><div className="muted" style={{ marginTop: 6 }}>{row.type} · {row.cluster} linked complaints</div></div>)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "Trends" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <div className="card card-elevated" style={{ padding: 16 }}>
            <SectionHeader title="24-Hour AQI Trend" right={selectedZone ? <Badge tone="info">{selectedZone.ward_name}</Badge> : null} />
            <StatusCard loading={trends.loading} error={trends.error} retry={trends.retry} empty={!Array.isArray(trends.data?.data?.hourly) || !trends.data.data.hourly.length} skeletonLines={5}>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {(Array.isArray(trends.data?.data?.hourly) ? trends.data.data.hourly : []).slice(-12).map((point, idx) => <div key={`${point.h || idx}`} className="card-flat" style={{ padding: 10, display: "grid", gridTemplateColumns: "70px 1fr 70px", gap: 10, alignItems: "center" }}><div className="muted">{safeStr(point.h, `${idx}:00`)}</div><div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,0.12)", overflow: "hidden" }}><div style={{ width: `${Math.min(100, (safeNum(point.aqi, 0) / 500) * 100)}%`, height: "100%", background: aqiTone(safeNum(point.aqi, 0)).color }} /></div><div style={{ textAlign: "right", fontWeight: 800 }}>{safeNum(point.aqi, 0)}</div></div>)}
              </div>
            </StatusCard>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="1-3 Hour Forecast" />
              <StatusCard loading={forecast.loading} error={forecast.error} retry={forecast.retry} empty={!Array.isArray(forecast.data) || !forecast.data.length} skeletonLines={3}>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {(Array.isArray(forecast.data) ? forecast.data : []).map((item) => <div key={item.horizon} className="card-flat" style={{ padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><div style={{ fontWeight: 800 }}>+{item.horizon} hour</div><Badge tone={toneForStatus(item.category)}>{safeStr(item.category, "forecast")}</Badge></div><div style={{ marginTop: 8, fontWeight: 900, fontSize: "1.5rem", color: aqiTone(item.aqi).color }}>{item.aqi}</div><div className="muted" style={{ marginTop: 6 }}>{safeStr(item.modelName, "forecast")} {item.targetAt ? `· ${formatTime(item.targetAt)}` : ""}</div></div>)}
                </div>
              </StatusCard>
            </div>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Risk Trend" />
              <div className="card-flat" style={{ marginTop: 12, padding: 14, lineHeight: 1.6 }}>Risk is {selectedTrend} for {safeStr(selectedZone?.ward_name, "the selected zone")}. Early warning signal: {readableTrigger(selectedZone?.triggers?.[0]) || safeStr(selectedZone?.actions?.[0], "monitor for sustained AQI elevation and complaints clustering")}.</div>
            </div>
            <div className="card card-elevated" style={{ padding: 16 }}>
              <SectionHeader title="Live Context" />
              <div className="card-flat" style={{ marginTop: 12, padding: 14, lineHeight: 1.6 }}>Weather {safeNum(environment.data?.data?.weather?.temperature, "—")} C · Wind {safeNum(environment.data?.data?.weather?.wind_speed, "—")} · Humidity {safeNum(environment.data?.data?.weather?.humidity, "—")}% · FIRMS hotspots {fireHotspots.length}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
