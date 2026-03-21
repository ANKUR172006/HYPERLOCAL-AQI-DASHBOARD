import { useState, useCallback, useReducer, useMemo, useEffect } from 'react';
import { api } from '../../utils/api';
import { useComplaints, useWardMap, useGeolocation, useAlertsFeed, useGovRecommendations } from '../../hooks/index.js';
import { getAqiCategory, safeNum, safeStr } from '../../tokens/index.js';
import { s } from '../../i18n/strings';
import Icon from '../../components/ui/Icon.jsx';
import { Badge, StatusCard, SectionHeader, Skeleton } from '../../components/ui/index.jsx';
import WardHeatmap from '../../features/ward/WardHeatmap.jsx';
import WardList from '../../features/ward/WardList.jsx';
import WardDetailPanel from '../../features/ward/WardDetailPanel.jsx';
import { AlertItem } from '../../features/alerts/AlertsPreview.jsx';

// ─── Complaints tab ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open',        label: s.officerStatusOpen },
  { value: 'in_progress', label: s.officerStatusInProgress },
  { value: 'resolved',    label: s.officerStatusResolved },
];

function statusColor(status) {
  const s_ = String(status).toLowerCase();
  if (s_ === 'resolved') return 'success';
  if (s_ === 'in_progress') return 'warning';
  return 'info';
}

function complaintsReducer(state, action) {
  switch (action.type) {
    case 'SET':    return action.payload;
    case 'UPDATE': return state.map(c => c.id === action.id ? { ...c, ...action.patch } : c);
    case 'REVERT': return state.map(c => c.id === action.id ? action.original : c);
    default:       return state;
  }
}

function ComplaintDrawer({ complaint, onClose, onUpdate }) {
  const [newStatus, setNewStatus]   = useState(complaint?.status ?? 'open');
  const [note,      setNote]        = useState('');
  const [saving,    setSaving]      = useState(false);
  const [saved,     setSaved]       = useState(false);
  const [errMsg,    setErrMsg]      = useState('');

  const handleSave = useCallback(async () => {
    setSaving(true); setSaved(false); setErrMsg('');
    try {
      await onUpdate(complaint.id, { status: newStatus, note: note.trim() || undefined });
      setSaved(true);
    } catch {
      setErrMsg(s.officerSaveError);
    } finally {
      setSaving(false);
    }
  }, [complaint, newStatus, note, onUpdate]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complaint-drawer-title"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="drawer">
        <div className="drawer-handle" aria-hidden="true" />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <h2 id="complaint-drawer-title" style={{ fontSize: '1.1rem' }}>Complaint Details</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close" style={{ padding: 6, borderRadius: 'var(--radius-full)' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
          {[
            ['ID',          complaint?.id],
            ['Type',        complaint?.type],
            ['Description', complaint?.description],
            ['Location',    complaint?.location],
            ['Submitted',   complaint?.created_at],
          ].map(([label, val]) => val ? (
            <div key={label}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{String(val)}</div>
            </div>
          ) : null)}
        </div>

        <div className="divider" />

        {/* Status update */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ fontSize: '0.9375rem' }}>{s.officerUpdateStatus}</h3>
          <select className="input" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <textarea
            className="input" rows={3}
            placeholder="Add a note (optional)..."
            value={note} onChange={e => setNote(e.target.value)}
          />
          {errMsg && <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>{errMsg}</p>}
          {saved  && <p style={{ color: 'var(--color-success)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="check" size={14} />{s.officerSaveSuccess}</p>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? s.officerSaving : <><Icon name="check" size={15} /> {s.officerSave}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComplaintsTab() {
  const raw = useComplaints();
  const [complaints, dispatch] = useReducer(complaintsReducer, []);
  const [filter, setFilter]    = useState('all');
  const [drawer, setDrawer]    = useState(null);

  // Sync from API once loaded
  useEffect(() => {
    if (!raw.data) return;
    const list = Array.isArray(raw.data) ? raw.data : (raw.data.complaints ?? []);
    if (Array.isArray(list)) dispatch({ type: 'SET', payload: list });
  }, [raw.data]);

  const filtered = useMemo(() => {
    if (filter === 'all') return complaints;
    return complaints.filter(c => String(c?.status ?? '').toLowerCase() === filter);
  }, [complaints, filter]);

  const handleUpdate = useCallback(async (id, patch) => {
    const original = complaints.find(c => c.id === id);
    dispatch({ type: 'UPDATE', id, patch }); // optimistic
    try {
      await api.patchComplaint(id, patch);
    } catch {
      dispatch({ type: 'REVERT', id, original }); // rollback
      throw new Error('update failed');
    }
  }, [complaints]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: s.officerComplaintsAll },
          { key: 'open', label: s.officerStatusOpen },
          { key: 'in_progress', label: s.officerStatusInProgress },
          { key: 'resolved', label: s.officerStatusResolved },
        ].map(f => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <StatusCard loading={raw.loading} error={raw.error} retry={raw.retry} empty={!raw.loading && !filtered.length} skeletonLines={4}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Status</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c?.id ?? i} style={{ cursor: 'pointer' }} onClick={() => setDrawer(c)}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 500, fontSize: '0.875rem' }}>{safeStr(c?.type, '–')}</td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {safeStr(c?.description, '–')}
                  </td>
                  <td>
                    <Badge tone={statusColor(c?.status)}>
                      {safeStr(c?.status, 'open').replace('_', ' ')}
                    </Badge>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {c?.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '–'}
                  </td>
                  <td><Icon name="chevronRight" size={14} color="var(--text-muted)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StatusCard>

      {drawer && (
        <ComplaintDrawer
          complaint={drawer}
          onClose={() => setDrawer(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}

// ─── Policy tab ────────────────────────────────────────────────────────────────

function PolicyTab() {
  const geo = useGeolocation();
  const wardMap = useWardMap(geo.lat, geo.lon);
  const recs = useGovRecommendations();
  const items = Array.isArray(recs.data?.data) ? recs.data.data : [];

  const topZones = useMemo(() => {
    const rows = Array.isArray(wardMap.data?.data) ? wardMap.data.data : [];
    return rows
      .filter((r) => r && r.aqi != null)
      .map((r) => ({
        ward_id: safeStr(r.ward_id, ""),
        ward_name: safeStr(r.ward_name, r.ward_id),
        aqi: safeNum(r.aqi, 0),
        primary: safeStr(r.primary_pollutant, ""),
        cause: safeStr(r?.source_detection?.primary?.label, ""),
        cause_conf: r?.source_detection?.primary?.confidence,
      }))
      .sort((a, b) => b.aqi - a.aqi)
      .slice(0, 5);
  }, [wardMap.data]);

  const engine = useMemo(() => {
    const top = topZones[0];
    const cause = safeStr(top?.cause, "Mixed sources");

    const actions = [];
    if (cause.toLowerCase().includes("dust")) {
      actions.push("Water sprinkling in priority zones");
      actions.push("Restrict construction temporarily in hotspots");
      actions.push("Mechanized sweeping + debris coverage enforcement");
    } else if (cause.toLowerCase().includes("traffic")) {
      actions.push("Restrict heavy vehicles in hotspots");
      actions.push("Optimize traffic signal timing to reduce idling");
      actions.push("Enforce no-idling near schools/hospitals");
    } else {
      actions.push("Target inspections for smoke/open burning sources");
      actions.push("Increase monitoring frequency + public advisories");
      actions.push("Coordinate ward-level response teams");
    }
    return { cause, actions };
  }, [topZones]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Policy Recommendation Engine" right={<Badge tone="info">Live</Badge>} />
      <StatusCard loading={wardMap.loading} error={wardMap.error} retry={wardMap.retry} empty={!wardMap.loading && topZones.length === 0} skeletonLines={4}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card-flat" style={{ padding: 12 }}>
            <div style={{ fontWeight: 900 }}>Cause: {engine.cause}</div>
            <div className="muted" style={{ marginTop: 6 }}>Recommended Actions</div>
            <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {engine.actions.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>

          <div className="card-flat" style={{ padding: 12 }}>
            <div style={{ fontWeight: 900 }}>Top Risk Zones</div>
            <div className="muted" style={{ marginTop: 6 }}>Prioritize response in these zones first.</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {topZones.map((z, idx) => (
                <div key={z.ward_id || idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {idx + 1}. {z.ward_name || z.ward_id}
                    </div>
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>
                      Cause: {safeStr(z.cause, '—')}{Number.isFinite(z.cause_conf) ? ` (${z.cause_conf}%)` : ""}
                    </div>
                  </div>
                  <div className="pill" style={{ borderColor: `${getAqiCategory(z.aqi).color}55`, background: getAqiCategory(z.aqi).bg, color: getAqiCategory(z.aqi).text }}>
                    <Icon name={getAqiCategory(z.aqi).icon} size={14} color={getAqiCategory(z.aqi).color} />
                    AQI {z.aqi}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </StatusCard>

      <SectionHeader title="System Recommendations" right={<Badge tone="info">Top 12</Badge>} />
      <StatusCard loading={recs.loading} error={recs.error} retry={recs.retry} empty={!recs.loading && items.length === 0} skeletonLines={4}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((rec, i) => (
            <div key={`${rec?.ward_id ?? i}`} className="card-flat" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {safeStr(rec?.ward_name, rec?.ward_id || 'Zone')}
                  </div>
                  <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>{safeStr(rec?.action, 'No recommendation')}</div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge tone={String(rec?.priority).includes('P1') ? 'danger' : String(rec?.priority).includes('P2') ? 'warning' : 'info'}>
                      {safeStr(rec?.priority, 'P3')}
                    </Badge>
                    <span className="tag">Expected impact: {safeStr(rec?.expected_impact, '—')} pts</span>
                    <span className="tag">{safeStr(rec?.department, '—')}</span>
                  </div>
                </div>
                <div className="pill" style={{ borderColor: `${getAqiCategory(safeNum(rec?.aqi, 0)).color}55`, background: getAqiCategory(safeNum(rec?.aqi, 0)).bg, color: getAqiCategory(safeNum(rec?.aqi, 0)).text }}>
                  <Icon name={getAqiCategory(safeNum(rec?.aqi, 0)).icon} size={14} color={getAqiCategory(safeNum(rec?.aqi, 0)).color} />
                  AQI {safeNum(rec?.aqi, 0)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </StatusCard>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const cityFeed = useAlertsFeed();
  const feedItems = cityFeed.data?.alerts ?? cityFeed.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="City-wide Alerts" />
      <StatusCard loading={cityFeed.loading} error={cityFeed.error} retry={cityFeed.retry} empty={!cityFeed.loading && Array.isArray(feedItems) && feedItems.length === 0} skeletonLines={4}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.isArray(feedItems) && feedItems.map((a, i) => <AlertItem key={a?.id ?? i} alert={a} />)}
        </div>
      </StatusCard>
    </div>
  );
}

// ─── Heatmap tab ─────────────────────────────────────────────────────────────

function HeatmapTab() {
  const [selectedWard, setSelectedWard] = useState(null);
  const geo = useGeolocation();
  const wardMap = useWardMap(geo.lat, geo.lon);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WardHeatmap
        data={wardMap.data} loading={wardMap.loading}
        error={wardMap.error} retry={wardMap.retry}
        selectedWard={selectedWard} onSelectWard={setSelectedWard}
      />
      {selectedWard && <WardDetailPanel ward={selectedWard} />}
    </div>
  );
}

function SensorsTab() {
  const geo = useGeolocation();
  const wardMap = useWardMap(geo.lat, geo.lon);
  const rows = useMemo(() => {
    const arr = Array.isArray(wardMap.data?.data) ? wardMap.data.data : [];
    return arr
      .map((r) => ({
        ward_id: safeStr(r?.ward_id, ""),
        ward_name: safeStr(r?.ward_name, r?.ward_id),
        sensors_online: safeNum(r?.sensors_online, 0),
        sector: safeStr(r?.sector, "Central"),
      }))
      .sort((a, b) => b.sensors_online - a.sensors_online);
  }, [wardMap.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader title="Sensor Monitoring Panel" right={<Badge tone="info">Zones</Badge>} />
      <StatusCard loading={wardMap.loading} error={wardMap.error} retry={wardMap.retry} empty={!wardMap.loading && rows.length === 0} skeletonLines={4}>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((z, i) => {
            const health = z.sensors_online >= 5 ? "HEALTHY" : z.sensors_online >= 3 ? "STABLE" : "LOW";
            const tone = health === "HEALTHY" ? "success" : health === "STABLE" ? "info" : "warning";
            return (
              <div key={z.ward_id || i} className="card-flat" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i + 1}. {z.ward_name || z.ward_id}
                  </div>
                  <div className="muted" style={{ marginTop: 4, fontSize: "0.8125rem" }}>
                    {z.sector} · {z.sensors_online} sensors online
                  </div>
                </div>
                <Badge tone={tone}>{health}</Badge>
              </div>
            );
          })}
        </div>
      </StatusCard>
    </div>
  );
}

// ─── Wards tab ────────────────────────────────────────────────────────────────

function WardsTab() {
  const [selectedWard, setSelectedWard] = useState(null);
  const geo = useGeolocation();
  const wardMap = useWardMap(geo.lat, geo.lon);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedWard ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
      <WardList
        data={wardMap.data} loading={wardMap.loading}
        error={wardMap.error} retry={wardMap.retry}
        selectedWard={selectedWard} onSelectWard={setSelectedWard}
      />
      {selectedWard && <WardDetailPanel ward={selectedWard} />}
    </div>
  );
}

// ─── Main officer dashboard ────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: s.officerTabOverview,    Component: OverviewTab },
  { id: 'heatmap',     label: s.officerTabHeatmap,     Component: HeatmapTab },
  { id: 'wards',       label: s.officerTabWards,       Component: WardsTab },
  { id: 'sensors',     label: s.officerTabSensors,     Component: SensorsTab },
  { id: 'policy',      label: s.officerTabPolicy,      Component: PolicyTab },
  { id: 'complaints',  label: s.officerTabComplaints,  Component: ComplaintsTab },
];

export default function OfficerPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('overview');
  const active = TABS.find(t => t.id === activeTab);
  const { Component } = active;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Officer header */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{
          width: 36, height: 36, background: 'var(--accent)', borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name="building" size={18} color="white" />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.125rem', marginBottom: 2 }}>{s.officerTitle}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>Delhi Municipal Corporation · Air Quality Management</p>
        </div>
        <button className="btn btn-sm" onClick={onBack}>
          <Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} />
          Back to Citizen View
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div className="tabs" style={{ display: 'inline-flex', minWidth: 'max-content', width: '100%' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
              role="tab"
              aria-selected={activeTab === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div role="tabpanel" key={activeTab} className="animate-fade-in">
        <Component />
      </div>
    </div>
  );
}
