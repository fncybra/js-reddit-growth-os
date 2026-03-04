import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Smartphone,
  Globe,
  Image as ImageIcon,
  CheckSquare,
  Settings,
  Settings2,
  Telescope,
  Cloud,
  CloudOff,
  BookOpen,
  Repeat,
  Link2,
  AtSign,
  Lock,
  BarChart3,
  Upload,
  FileText,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { SettingsService } from '../services/growthEngine';
import { useAuth, getAllowedSections } from './AuthContext';

const navSections = [
  {
    label: 'AGENCY',
    items: [
      { path: '/', label: 'Command Center', icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: 'REDDIT',
    items: [
      { path: '/discovery', label: 'Discovery Scraper', icon: Telescope },
      { path: '/models', label: 'Models', icon: Users },
      { path: '/accounts', label: 'Accounts', icon: Smartphone },
      { path: '/subreddits', label: 'Subreddits', icon: Globe },
      { path: '/library', label: 'Content Library', icon: ImageIcon },
      { path: '/repurpose', label: 'Repurpose Ready', icon: Repeat },
      { path: '/tasks', label: 'Post Tasks', icon: CheckSquare },
      { path: '/links', label: 'Link Tracker', icon: Link2 },
    ],
  },
  {
    label: 'THREADS',
    items: [
      { path: '/threads', label: 'Threads Dashboard', icon: AtSign },
      { path: '/threads/settings', label: 'Threads Settings', icon: Settings2 },
    ],
  },
  {
    label: 'OF TRACKER',
    items: [
      { path: '/of', label: 'OF Dashboard', icon: BarChart3 },
      { path: '/of/import', label: 'Import Data', icon: Upload },
      { path: '/of/reports', label: 'Reports', icon: FileText },
      { path: '/of/config', label: 'Configuration', icon: Settings2 },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { path: '/sop', label: 'Training SOP', icon: BookOpen },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const { role, logout } = useAuth();
  const allowedLabels = getAllowedSections(role);
  const visibleSections = navSections.filter(s => allowedLabels.includes(s.label));

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, fontSize: '0.7rem', color: '#fff', letterSpacing: '-0.5px' }}>JS</div>
          <span>JS Media</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {visibleSections.map((section, sIdx) => (
          <div key={section.label}>
            {sIdx > 0 && <div style={{ borderTop: '1px solid var(--border-light, var(--border-color))', margin: '4px 12px 0' }} />}
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted, var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '12px 16px 4px' }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end || false}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
        <CloudSyncStatus />
        <button
          onClick={logout}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', width: '100%', justifyContent: 'center' }}
        >
          <Lock size={12} />
          Lock
        </button>
      </div>
    </div>
  );
}

function CloudSyncStatus() {
    const settings = useLiveQuery(() => db.settings.toArray());
    const [isSynced, setIsSynced] = React.useState(false);
    const [proxyState, setProxyState] = React.useState({ checking: true, connected: false, ip: '' });

    React.useEffect(() => {
      let cancelled = false;

      async function checkCloud() {
        try {
          const cfg = await SettingsService.getSettings();
          const connected = !!(cfg?.supabaseUrl && cfg?.supabaseAnonKey);
          if (!cancelled) setIsSynced(connected);
        } catch (_err) {
          if (!cancelled) setIsSynced(false);
        }
      }

      checkCloud();
      return () => { cancelled = true; };
    }, [settings]);

  React.useEffect(() => {
    let cancelled = false;

    async function checkProxy() {
      try {
        const cfg = await SettingsService.getSettings();
        const base = cfg?.proxyUrl;
        if (!base) {
          if (!cancelled) setProxyState({ checking: false, connected: false, ip: '' });
          return;
        }

        const res = await fetch(`${base}/api/proxy/status`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setProxyState({
            checking: false,
            connected: !!(res.ok && data.connected),
            ip: data.currentIp || '',
          });
        }
      } catch (_err) {
        if (!cancelled) setProxyState({ checking: false, connected: false, ip: '' });
      }
    }

    checkProxy();
    const timer = setInterval(checkProxy, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isSynced ? 'var(--status-success)' : 'var(--text-secondary)' }}>
        {isSynced ? <Cloud size={14} /> : <CloudOff size={14} />}
        <span style={{ fontWeight: '500' }}>{isSynced ? "Cloud Live" : "Offline"}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: proxyState.connected ? 'var(--status-success)' : 'var(--text-secondary)' }}>
        {proxyState.connected ? <Cloud size={14} /> : <CloudOff size={14} />}
        <span style={{ fontWeight: '500' }}>
          {proxyState.checking ? 'Proxy Checking...' : (proxyState.connected ? 'Proxy Connected' : 'Proxy Offline')}
        </span>
      </div>
      {proxyState.connected && proxyState.ip && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>IP {proxyState.ip}</div>
      )}
      {isSynced && (
        <button
          onClick={async () => {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.pullCloudToLocal();
            window.location.reload();
          }}
          className="btn btn-primary"
          style={{ padding: '4px 8px', fontSize: '0.65rem', width: 'fit-content' }}
        >
          Pull Updates
        </button>
      )}
    </div>
  );
}
