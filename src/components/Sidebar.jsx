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
  CloudOff
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
  { path: '/tasks', label: 'Post Tasks', icon: CheckSquare },
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isSynced ? 'var(--status-success)' : 'var(--text-secondary)' }}>
      {isSynced ? <Cloud size={14} /> : <CloudOff size={14} />}
      <span>{isSynced ? "Agency Cloud: Connected" : "Cloud Sync: Offline"}</span>
    </div>
  );
}
