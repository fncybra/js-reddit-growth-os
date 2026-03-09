import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SettingsService } from '../services/growthEngine';
import { db } from '../db/db';

const AuthContext = createContext(null);

// Section visibility per role
const SECTION_ACCESS = {
  admin: ['AGENCY', 'REDDIT', 'THREADS', 'OF TRACKER', 'AI CHAT', 'SYSTEM'],
  threadsManager: ['AGENCY', 'THREADS', 'OF TRACKER', 'AI CHAT', 'SYSTEM'],
  redditManager: ['AGENCY', 'REDDIT', 'SYSTEM'],
  chatMonitor: ['AI CHAT'],
};

// Route whitelist per role (admin = null = all routes allowed)
const ROUTE_ACCESS = {
  admin: null,
  threadsManager: ['/', '/threads', '/threads/settings', '/of', '/of/import', '/of/reports', '/of/config', '/of/ai-chat-import', '/of/ai-chat-leaderboard', '/of/ai-chat-report', '/of/ai-chat-replay', '/settings', '/sop'],
  redditManager: ['/', '/reddit', '/discovery', '/models', '/model', '/account',
    '/accounts', '/subreddits', '/library', '/repurpose', '/tasks', '/links', '/settings', '/sop'],
  chatMonitor: ['/of/ai-chat-import', '/of/ai-chat-leaderboard', '/of/ai-chat-report', '/of/ai-chat-replay'],
};

export function getAllowedSections(role) {
  return SECTION_ACCESS[role] || [];
}

export function isRouteAllowed(role, pathname) {
  if (!role) return false;
  const allowed = ROUTE_ACCESS[role];
  if (allowed === null) return true; // admin sees all
  // Check exact match or prefix match for dynamic routes like /model/:id, /account/:id
  return allowed.some(r => pathname === r || pathname.startsWith(r + '/'));
}

export function getDefaultRoute(role) {
  if (role === 'threadsManager') return '/threads';
  if (role === 'redditManager') return '/reddit';
  if (role === 'chatMonitor') return '/of/ai-chat-leaderboard';
  return '/';
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [role, setRole] = useState(() => {
    return sessionStorage.getItem('authRole') || null;
  });

  useEffect(() => {
    if (role) {
      sessionStorage.setItem('authRole', role);
    } else {
      sessionStorage.removeItem('authRole');
    }
  }, [role]);

  // Rate-limit PIN attempts (max 5 per 60s)
  const attemptsRef = React.useRef([]);
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 60000;

  const authenticate = useCallback(async (pin) => {
    const trimmed = pin.trim();
    if (!trimmed) return null;

    // Rate limiting
    const now = Date.now();
    attemptsRef.current = attemptsRef.current.filter(t => now - t < WINDOW_MS);
    if (attemptsRef.current.length >= MAX_ATTEMPTS) {
      throw new Error('Too many attempts. Wait 60 seconds.');
    }
    attemptsRef.current.push(now);

    try {
      const settings = await SettingsService.getSettings();

      const vaPinRow = await db.settings.where({ key: 'vaPin' }).first();
      const masterPin = vaPinRow ? vaPinRow.value : '1234';

      // Priority: master (admin) > threads manager > reddit manager
      if (trimmed === String(masterPin)) {
        setRole('admin');
        return 'admin';
      }

      if (settings.threadsManagerPin && trimmed === String(settings.threadsManagerPin)) {
        setRole('threadsManager');
        return 'threadsManager';
      }

      if (settings.redditManagerPin && trimmed === String(settings.redditManagerPin)) {
        setRole('redditManager');
        return 'redditManager';
      }

      if (settings.chatMonitorPin && trimmed === String(settings.chatMonitorPin)) {
        setRole('chatMonitor');
        return 'chatMonitor';
      }

      return null;
    } catch (err) {
      console.error('Auth error:', err);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setRole(null);
    sessionStorage.removeItem('authRole');
  }, []);

  return (
    <AuthContext.Provider value={{ role, authenticate, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function PinGate({ children }) {
  const { role, authenticate } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (role) return children;

  async function handleUnlock() {
    setLoading(true);
    setError('');
    try {
      const result = await authenticate(pin);
      if (!result) {
        setError('Invalid access PIN');
        setPin('');
      }
    } catch (err) {
      console.error('Unlock error:', err);
      setError('Database error — please refresh the page');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: '#1a1d24', padding: '40px', borderRadius: '12px', border: '1px solid #2d313a', width: '320px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔐</div>
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Dashboard Access</h2>
          <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: '8px' }}>Enter your PIN to continue</p>
        </div>
        <form onSubmit={e => { e.preventDefault(); handleUnlock(); }}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            className="input-field"
            style={{ textAlign: 'center', marginBottom: '16px', backgroundColor: '#0f1115', width: '100%', boxSizing: 'border-box', fontSize: '1.2rem', letterSpacing: '0.3em' }}
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value)}
            autoFocus
          />
          {error && <div style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Checking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function RouteGuard({ children }) {
  const { role } = useAuth();
  const location = useLocation();

  if (!role) return null;

  if (!isRouteAllowed(role, location.pathname)) {
    return <Navigate to={getDefaultRoute(role)} replace />;
  }

  return children;
}
