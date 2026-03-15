import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { TrendingUp, Users, CheckSquare, Globe } from 'lucide-react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';

export function AgencyCommandCenter() {
  const [metrics, setMetrics] = useState(null);

  const analyticsTrigger = useLiveQuery(async () => {
    const [tasks, perfs, accounts, subreddits] = await Promise.all([
      db.tasks.toArray(),
      db.performances.toArray(),
      db.accounts.toArray(),
      db.subreddits.toArray(),
    ]);
    return `${tasks.length}:${perfs.length}:${accounts.length}:${subreddits.length}`;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await AnalyticsEngine.getAgencyMetrics();
      if (!cancelled) {
        setMetrics(result);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [analyticsTrigger]);

  const cards = [
    { label: 'Accounts', value: metrics?.totalAccounts ?? '-', icon: Users, to: '/accounts' },
    { label: 'Posts Today', value: metrics ? `${metrics.executionToday.completed}/${metrics.executionToday.total}` : '-', icon: CheckSquare, to: '/tasks' },
    { label: 'Removal Rate', value: metrics ? `${metrics.agencyRemovalRate}%` : '-', icon: TrendingUp, to: '/reddit' },
    { label: 'Tracked Subs', value: metrics?.totalSubreddits ?? '-', icon: Globe, to: '/subreddits' },
  ];

  const quickLinks = [
    { label: 'Open Dashboard', to: '/reddit' },
    { label: 'Manage Accounts', to: '/accounts' },
    { label: 'Review Tasks', to: '/tasks' },
    { label: 'System Settings', to: '/settings' },
  ];

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Reddit Command Center</h1>
      </header>
      <div className="page-content" style={{ display: 'grid', gap: '24px' }}>
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <Link key={card.label} to={card.to} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px', minHeight: '120px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>{card.label}</span>
                      <Icon size={16} color="#ff4500" />
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 700 }}>{card.value}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: '16px' }}>Quick Access</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {quickLinks.map((link) => (
              <Link key={link.to} to={link.to} className="btn btn-outline">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
