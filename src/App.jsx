import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CloudSyncHandler } from './components/CloudSyncHandler';
import { AuthProvider } from './components/AuthContext';
import { AgencyCommandCenter } from './pages/AgencyCommandCenter';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Models = lazy(() => import('./pages/Models').then((m) => ({ default: m.Models })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const Subreddits = lazy(() => import('./pages/Subreddits').then((m) => ({ default: m.Subreddits })));
const Library = lazy(() => import('./pages/Library').then((m) => ({ default: m.Library })));
const Tasks = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Discovery = lazy(() => import('./pages/Discovery').then((m) => ({ default: m.Discovery })));
const ForceSync = lazy(() => import('./pages/ForceSync').then((m) => ({ default: m.ForceSync })));
const VADashboard = lazy(() => import('./pages/VADashboard').then((m) => ({ default: m.VADashboard })));

const PageLoader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
    Loading...
  </div>
);

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '48px', color: '#ef4444', backgroundColor: '#0f1115', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#fff', marginBottom: '16px' }}>Something crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#fbbf24', marginBottom: '16px' }}>
            {this.state.error?.toString()}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#9ca3af', fontSize: '0.8rem' }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null });
            }}
            style={{ marginTop: '16px', padding: '8px 16px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <HashRouter>
      <RoutePersistence />
      <CloudSyncHandler />
      <ErrorBoundary>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/force-sync" element={<ForceSync />} />
              <Route path="/va" element={<VADashboard />} />
              <Route element={<Layout />}>
                <Route path="/" element={<AgencyCommandCenter />} />
                <Route path="reddit" element={<Dashboard />} />
                <Route path="discovery" element={<Discovery />} />
                <Route path="models" element={<Models />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="subreddits" element={<Subreddits />} />
                <Route path="library" element={<Library />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ErrorBoundary>
    </HashRouter>
  );
}

function RoutePersistence() {
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    const current = `${location.pathname}${location.search}${location.hash}`;
    sessionStorage.setItem('lastRoute', current);
  }, [location.pathname, location.search, location.hash]);

  React.useEffect(() => {
    try {
      const navEntry = performance.getEntriesByType('navigation')?.[0];
      const isReload = navEntry?.type === 'reload';
      const lastRoute = sessionStorage.getItem('lastRoute');

      if (isReload && location.pathname === '/' && lastRoute && lastRoute !== '/') {
        navigate(lastRoute, { replace: true });
      }
    } catch {
      // no-op
    }
  }, [location.pathname, navigate]);

  return null;
}

export default App;
