import React from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Models } from './pages/Models';
import { Accounts } from './pages/Accounts';
import { Subreddits } from './pages/Subreddits';
import { Library } from './pages/Library';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { Discovery } from './pages/Discovery';
import { ModelDetail } from './pages/ModelDetail';
import { AccountDetail } from './pages/AccountDetail';
import { VADashboard } from './pages/VADashboard';
import { CloudSyncHandler } from './components/CloudSyncHandler';
import { SOP } from './pages/SOP';

// Error Boundary to catch runtime crashes and show them instead of a black screen
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
          <h2 style={{ color: '#fff', marginBottom: '16px' }}>⚠️ Something crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#fbbf24', marginBottom: '16px' }}>
            {this.state.error?.toString()}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#9ca3af', fontSize: '0.8rem' }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null, errorInfo: null }); }}
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
    <BrowserRouter>
      <RoutePersistence />
      <CloudSyncHandler />
      <ErrorBoundary>
        <Routes>
          {/* VA Mode: No Internal sidebars, pure robot mode */}
          <Route path="/va" element={<VADashboard />} />

          {/* Admin/Agency Mode: Full dashboard */}
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="discovery" element={<Discovery />} />
            <Route path="models" element={<Models />} />
            <Route path="model/:id" element={<ModelDetail />} />
            <Route path="account/:id" element={<AccountDetail />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="subreddits" element={<Subreddits />} />
            <Route path="library" element={<Library />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="settings" element={<Settings />} />
            <Route path="sop" element={<SOP />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
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
    } catch (_err) {
      // no-op
    }
  }, [location.pathname, navigate]);

  return null;
}

export default App;
