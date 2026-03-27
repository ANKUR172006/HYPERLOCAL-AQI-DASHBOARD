import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { APP_AUTO_REFRESH_MS, useAppLocation, useTheme } from './hooks/index.js';
import AppLayout from './components/layout/AppLayout.jsx';
import { Skeleton } from './components/ui/index.jsx';
import { api } from './utils/api.js';
import './index.css';

// Lazy-loaded pages for code splitting
const HomePage    = lazy(() => import('./pages/citizen/HomePage.jsx'));
const InsightsPage = lazy(() => import('./pages/citizen/InsightsPage.jsx'));
const ExplorePage = lazy(() => import('./pages/citizen/ExplorePage.jsx'));
const AlertsPage  = lazy(() => import('./pages/citizen/AlertsPage.jsx'));
const TrendsPage  = lazy(() => import('./pages/citizen/TrendsPage.jsx'));
const OfficerPage = lazy(() => import('./pages/officer/OfficerPage.jsx'));

// Page loading fallback
function PageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780, margin: '0 auto' }}>
      <Skeleton height="280px" />
      <Skeleton height="160px" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Skeleton height="140px" />
        <Skeleton height="140px" />
      </div>
    </div>
  );
}

function AppBootScreen({ locationLabel, progressText, statusText }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px 16px', background: 'radial-gradient(circle at top, rgba(15,23,42,0.96) 0%, rgba(10,15,25,1) 55%, rgba(6,10,18,1) 100%)' }}>
      <div style={{ width: 'min(680px, 100%)', padding: 28, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(15,23,42,0.82)', boxShadow: '0 30px 80px rgba(0,0,0,0.35)', backdropFilter: 'blur(14px)', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)', boxShadow: '0 16px 44px rgba(14,165,233,0.28)' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', animation: 'spin 900ms linear infinite' }} />
          </div>
          <div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)' }}>Loading live AQI dashboard</div>
            <div className="muted" style={{ marginTop: 4 }}>Preparing API data for {locationLabel || 'Delhi'} before the dashboard opens.</div>
          </div>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'rgba(148,163,184,0.14)', overflow: 'hidden' }}>
          <div style={{ width: progressText, height: '100%', background: 'linear-gradient(90deg, #38bdf8 0%, #34d399 100%)', boxShadow: '0 0 20px rgba(56,189,248,0.3)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="muted">{statusText}</div>
          <div className="tag">Auto-refresh every 5 minutes</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();
  const location = useAppLocation();
  const [page, setPage] = useState('home');
  const [bootState, setBootState] = useState({ loading: true, completed: 0, total: 0 });
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    if (bootDone) return;
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    let cancelled = false;
    const runBootstrap = async () => {
      const baseTasks = [
        ['Location insights', () => api.getLocationInsights(lat, lon)],
        ['Ward map', () => api.getWardMap(lat, lon)],
        ['Environment', () => api.getEnvironmentUnified(lat, lon, true)],
        ['Stations', () => api.getStationsLive(lat, lon, 70, 8)],
        ['Delhi boundary', () => api.getDelhiBoundary()],
        ['Delhi wards', () => api.getDelhiWardsGrid()],
        ['Alerts feed', () => api.getAlertsFeed(12)],
        ['Recommendations', () => api.getGovRecommendations()],
        ['Readiness', () => api.getReadiness()],
        ['Complaints', () => api.getComplaints()],
        ['Officer view', () => api.getDisasterOfficerView('DELHI', 15)],
        ['Disaster status', () => api.getDisasterStatus('DELHI')],
      ];

      const setProgress = (completed, total) => {
        if (!cancelled) setBootState({ loading: true, completed, total });
      };

      let completed = 0;
      let total = baseTasks.length;
      setProgress(completed, total);

      const baseResults = await Promise.allSettled(
        baseTasks.map(async ([, loader]) => {
          try {
            return await loader();
          } finally {
            completed += 1;
            setProgress(completed, total);
          }
        }),
      );

      const insightsPayload = baseResults[0]?.status === 'fulfilled' ? baseResults[0].value : null;
      const wardMapPayload = baseResults[1]?.status === 'fulfilled' ? baseResults[1].value : null;
      const wardId = insightsPayload?.nearest_ward?.ward_id || wardMapPayload?.data?.[0]?.ward_id || null;

      if (wardId) {
        const extraTasks = [
          ['Trends', () => api.getTrends(wardId)],
          ['Forecast +1h', () => api.getAqiForecast(wardId, 1)],
          ['Forecast +2h', () => api.getAqiForecast(wardId, 2)],
          ['Forecast +3h', () => api.getAqiForecast(wardId, 3)],
        ];
        total += extraTasks.length;
        setProgress(completed, total);
        await Promise.allSettled(
          extraTasks.map(async ([, loader]) => {
            try {
              return await loader();
            } finally {
              completed += 1;
              setProgress(completed, total);
            }
          }),
        );
      }

      if (!cancelled) {
        setBootState({ loading: false, completed, total: Math.max(total, completed) });
        setBootDone(true);
      }
    };

    runBootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootDone, location.lat, location.lon]);

  const bootProgressPct = useMemo(() => {
    if (!bootState.total) return '8%';
    return `${Math.max(8, Math.min(100, Math.round((bootState.completed / bootState.total) * 100)))}%`;
  }, [bootState.completed, bootState.total]);

  if (!bootDone) {
    return (
      <AppBootScreen
        locationLabel={location.label}
        progressText={bootProgressPct}
        statusText={`Loaded ${bootState.completed}/${bootState.total || 0} API feeds. After startup, data refreshes automatically every ${Math.round(APP_AUTO_REFRESH_MS / 60000)} minutes.`}
      />
    );
  }

  // Officer page renders outside normal layout
  if (page === 'officer') {
    return (
      <div style={{ minHeight: '100vh', padding: '20px 16px 40px' }}>
        <Suspense fallback={<PageSkeleton />}>
          <OfficerPage onBack={() => setPage('home')} />
        </Suspense>
      </div>
    );
  }

  return (
    <AppLayout
      page={page}
      onNavigate={setPage}
      theme={theme}
      onThemeToggle={toggle}
    >
      <Suspense fallback={<PageSkeleton />}>
        {page === 'home'    && <HomePage    onNavigate={setPage} />}
        {page === 'insights' && <InsightsPage onNavigate={setPage} />}
        {page === 'explore' && <ExplorePage />}
        {page === 'alerts'  && <AlertsPage />}
        {page === 'trends'  && <TrendsPage />}
      </Suspense>
    </AppLayout>
  );
}
