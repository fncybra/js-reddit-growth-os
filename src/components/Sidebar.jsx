import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart2,
  Users,
  Smartphone,
  Globe,
  Image as ImageIcon,
  CheckSquare,
  Settings,
  Telescope,
  Cloud,
  CloudOff,
  BookOpen,
  Repeat,
  Link2,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { SettingsService } from '../services/growthEngine';

const navItems = [
  { path: '/', label: 'Global Dashboard', icon: BarChart2 },
  { path: '/discovery', label: 'Discovery Scraper', icon: Telescope },
  { path: '/models', label: 'Models', icon: Users },
  { path: '/accounts', label: 'Accounts', icon: Smartphone },
  { path: '/subreddits', label: 'Subreddits', icon: Globe },
  { path: '/library', label: 'Content Library', icon: ImageIcon },
  { path: '/repurpose', label: 'Repurpose Ready', icon: Repeat },
  { path: '/tasks', label: 'Post Tasks', icon: CheckSquare },
  { path: '/links', label: 'Link Tracker', icon: Link2 },
  { path: '/sop', label: 'Training SOP', icon: BookOpen },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <svg viewBox="0 0 20 20" width="28" height="28" style={{ flexShrink: 0 }}>
            <circle cx="10" cy="10" r="10" fill="#FF4500" />
            <path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.14.45a1.04 1.04 0 1 0 .12-.61l-2.39-.52a.35.35 0 0 0-.41.27l-.73 3.45a7.14 7.14 0 0 0-3.92 1.23 1.46 1.46 0 1 0-1.6 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .8-1.35zM7.27 11.17a1.04 1.04 0 1 1 1.04 1.04 1.04 1.04 0 0 1-1.04-1.04zm5.92 2.77a3.58 3.58 0 0 1-2.25.68 3.58 3.58 0 0 1-2.25-.68.35.35 0 1 1 .5-.49 2.9 2.9 0 0 0 1.75.52 2.9 2.9 0 0 0 1.75-.52.35.35 0 1 1 .5.49zm-.18-1.73a1.04 1.04 0 1 1 1.04-1.04 1.04 1.04 0 0 1-1.04 1.04z" fill="#FFF" />
          </svg>
          <span>Reddit Growth OS</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
        <CloudSyncStatus />
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
