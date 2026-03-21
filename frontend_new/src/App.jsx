import { useState, lazy, Suspense } from 'react';
import { useTheme } from './hooks/index.js';
import AppLayout from './components/layout/AppLayout.jsx';
import { Skeleton } from './components/ui/index.jsx';
import './index.css';

// Lazy-loaded pages for code splitting
const HomePage    = lazy(() => import('./pages/citizen/HomePage.jsx'));
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

export default function App() {
  const { theme, toggle } = useTheme();
  const [page, setPage] = useState('home');

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
        {page === 'explore' && <ExplorePage />}
        {page === 'alerts'  && <AlertsPage />}
        {page === 'trends'  && <TrendsPage />}
      </Suspense>
    </AppLayout>
  );
}
