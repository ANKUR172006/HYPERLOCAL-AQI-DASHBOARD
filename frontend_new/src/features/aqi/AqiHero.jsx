import { memo } from 'react';
import { getAqiCategory, safeNum, safeStr } from '../../tokens/index.js';
import { s } from '../../i18n/strings';
import Icon from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/index.jsx';

function formatAge(timestamp) {
  if (!timestamp) return s.heroUnknownTime;
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (diff <= 1) return s.heroJustNow;
  if (diff < 60) return `${diff} ${s.heroMinutesAgo}`;
  const hrs = Math.floor(diff / 60);
  return `${hrs}h ago`;
}

// AQI circle visual
function AqiCircle({ aqi, category }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        width: 'clamp(160px, 35vw, 220px)',
        height: 'clamp(160px, 35vw, 220px)',
        borderRadius: '50%',
        background: category.bg,
        border: `3px solid ${category.color}`,
        flexShrink: 0,
        transition: 'all 0.4s ease',
      }}
    >
      <div
        className="aqi-display"
        style={{ color: category.color, lineHeight: 1 }}
        aria-label={`AQI ${aqi}`}
      >
        {safeNum(aqi, '–')}
      </div>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: category.color, letterSpacing: '0.08em', marginTop: 4 }}>
        {s.unitAqi}
      </div>
    </div>
  );
}

function AqiHeroContent({ data }) {
  const aqi = safeNum(data?.aqi ?? data?.value ?? data?.current_aqi, 0);
  const wardName = safeStr(data?.ward_name ?? data?.name, 'Delhi');
  const timestamp = data?.timestamp ?? data?.updated_at;
  const category = getAqiCategory(aqi);

  return (
    <div
      className="card-elevated animate-fade-in"
      style={{
        background: `linear-gradient(135deg, ${category.bg} 0%, var(--bg-surface) 60%)`,
        padding: 'clamp(20px, 5vw, 36px)',
        borderColor: `${category.color}30`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <div className="status-dot" style={{ '--color-success': category.color, background: category.color }} />
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {s.heroSubtitle} {formatAge(timestamp)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="mapPin" size={13} />
          {wardName}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 5vw, 40px)', flexWrap: 'wrap' }}>
        <AqiCircle aqi={aqi} category={category} />

        <div style={{ flex: 1, minWidth: '180px' }}>
          <h1 style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)', marginBottom: '8px', lineHeight: 1.2 }}>
            {s.heroTitle}
          </h1>

          {/* Category label with icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px',
                background: category.bg, color: category.text,
                border: `1.5px solid ${category.color}40`,
                borderRadius: 'var(--radius-full)',
                fontSize: '0.9375rem', fontWeight: 600,
              }}
              role="status"
              aria-live="polite"
            >
              <Icon name={category.icon} size={16} color={category.color} />
              {category.label}
            </span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            {category.description}
          </p>
        </div>
      </div>
    </div>
  );
}

export default memo(function AqiHero({ loading, error, data, retry }) {
  if (loading) {
    return (
      <div className="card-elevated" style={{ padding: '36px' }}>
        <Skeleton height="12px" width="140px" style={{ marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <Skeleton width="180px" height="180px" style={{ borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height="28px" width="70%" />
            <Skeleton height="20px" width="40%" />
            <Skeleton height="14px" width="90%" />
            <Skeleton height="14px" width="75%" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card-elevated" style={{ padding: '36px', textAlign: 'center' }}>
        <Icon name="alert-circle" size={32} color="var(--color-danger)" />
        <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>{s.error}</p>
        {retry && <button className="btn btn-sm" onClick={retry}><Icon name="refresh" size={14} />{s.retry}</button>}
      </div>
    );
  }

  return <AqiHeroContent data={data} />;
});
