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
  Activity,
  Telescope,
  Cloud,
  CloudOff,
  BookOpen,
  Repeat,
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
  { path: '/sop', label: 'Training SOP', icon: BookOpen },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Activity size={24} color="var(--accent-primary)" />
          JS Growth OS
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
  const isSynced = settings?.some(s => s.key === 'supabaseUrl' && s.value && s.value.length > 0);
  const [proxyState, setProxyState] = React.useState({ checking: true, connected: false, ip: '' });

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
