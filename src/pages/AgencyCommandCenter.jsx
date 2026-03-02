import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    AnalyticsEngine,
    AirtableService,
    SettingsService,
} from '../services/growthEngine';

export function AgencyCommandCenter() {
    const [redditMetrics, setRedditMetrics] = useState(null);
    const [threadsMetrics, setThreadsMetrics] = useState(null);
    const [threadsConnected, setThreadsConnected] = useState(null);

    const analyticsTrigger = useLiveQuery(async () => {
        const [tasks, perfs] = await Promise.all([db.tasks.toArray(), db.performances.toArray()]);
        return `${tasks.length}:${perfs.length}`;
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            const cfg = await SettingsService.getSettings();
            const hasAirtable = !!(cfg?.airtableApiKey?.trim());

            if (!cancelled) setThreadsConnected(hasAirtable);

            const [redditResult, threadsResult] = await Promise.allSettled([
                AnalyticsEngine.getAgencyMetrics(),
                hasAirtable ? AirtableService.getThreadsMetrics() : Promise.resolve(null),
            ]);

            if (cancelled) return;

            if (redditResult.status === 'fulfilled') {
                setRedditMetrics(redditResult.value);
            }
            if (threadsResult.status === 'fulfilled') {
                setThreadsMetrics(threadsResult.value);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [analyticsTrigger]);

    // Derive Reddit health
    const redditHealth = (() => {
        if (!redditMetrics) return null;
        const removal = Number(redditMetrics.agencyRemovalRate);
        if (removal > 25) return 'critical';
        if (removal > 15) return 'warn';
        return 'ok';
    })();

    const healthColors = { ok: 'var(--status-success)', warn: 'var(--status-warning)', critical: 'var(--status-danger)' };

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Agency Command Center</h1>
            </header>
            <div className="page-content">
                {/* Platform Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                    {/* Reddit Card */}
                    <Link to="/reddit" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card" style={{ borderLeft: '4px solid #FF4500', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#FF4500"/><path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.14.45a1.04 1.04 0 1 0 .12-.61l-2.39-.52a.35.35 0 0 0-.41.27l-.73 3.45a7.14 7.14 0 0 0-3.92 1.23 1.46 1.46 0 1 0-1.6 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .8-1.35zM7.27 11.17a1.04 1.04 0 1 1 1.04 1.04 1.04 1.04 0 0 1-1.04-1.04zm5.92 2.77a3.58 3.58 0 0 1-2.25.68 3.58 3.58 0 0 1-2.25-.68.35.35 0 1 1 .5-.49 2.9 2.9 0 0 0 1.75.52 2.9 2.9 0 0 0 1.75-.52.35.35 0 1 1 .5.49zm-.18-1.73a1.04 1.04 0 1 1 1.04-1.04 1.04 1.04 0 0 1-1.04 1.04z" fill="#FFF"/></svg>
                                Reddit
                            </h2>
                            {redditMetrics ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                    <MetricCell label="Total Accounts" value={redditMetrics.totalAccounts} />
                                    <MetricCell label="Active Accounts" value={redditMetrics.activeAccounts} />
                                    <MetricCell label="Posts Today" value={`${redditMetrics.executionToday.completed}/${redditMetrics.executionToday.total}`} />
                                    <MetricCell label="Avg Views" value={redditMetrics.agencyAvgViews} />
                                    <MetricCell label="Removal Rate" value={`${redditMetrics.agencyRemovalRate}%`} color={Number(redditMetrics.agencyRemovalRate) > 20 ? 'var(--status-danger)' : undefined} />
                                    <MetricCell label="Health" value={redditHealth} color={healthColors[redditHealth]} />
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>Loading...</div>
                            )}
                        </div>
                    </Link>

                    {/* Threads Card */}
                    <Link to="/threads" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card" style={{ borderLeft: '4px solid #000', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-5.602.04-8.196 3.2-8.68 8.862.488-1.56 1.39-2.776 2.702-3.636 1.408-.923 3.076-1.39 4.967-1.39 2.14 0 4.035.592 5.636 1.762 1.654 1.21 2.584 2.932 2.765 5.122.142 1.712-.334 3.287-1.378 4.56-1.09 1.327-2.67 2.149-4.56 2.375-.34.04-.68.06-1.02.06-1.73 0-3.268-.57-4.572-1.693-.22.56-.49 1.084-.814 1.57-.148.222-.316.438-.503.648l-.007.006C11.698 22.696 11.94 23.342 12.186 24zm.088-6.412c.922 0 1.765-.2 2.51-.598 1.496-.797 2.322-2.26 2.183-3.862-.126-1.44-.81-2.587-2.033-3.408-1.164-.782-2.53-1.178-4.063-1.178-1.477 0-2.78.374-3.878 1.112-1.203.808-1.908 1.95-2.1 3.395-.213 1.608.344 3.075 1.564 4.12 1.12.959 2.442 1.412 3.817 1.419z"/></svg>
                                Threads
                            </h2>
                            {threadsConnected === false ? (
                                <div style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>
                                    Not Connected <Link to="/threads/settings" style={{ color: 'var(--primary-color)', marginLeft: '8px' }} onClick={e => e.stopPropagation()}>Settings</Link>
                                </div>
                            ) : threadsMetrics ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                    <MetricCell label="Total Accounts" value={threadsMetrics.total} />
                                    <MetricCell label="Active" value={threadsMetrics.active} color="var(--status-success)" />
                                    <MetricCell label="Suspended" value={threadsMetrics.suspended} color={threadsMetrics.suspended > 0 ? 'var(--status-warning)' : undefined} />
                                    <MetricCell label="Dead / Banned" value={threadsMetrics.dead} color={threadsMetrics.dead > 0 ? 'var(--status-danger)' : undefined} />
                                    <MetricCell label="Login Errors" value={threadsMetrics.loginErrors} color={threadsMetrics.loginErrors > 0 ? '#f97316' : undefined} />
                                    <MetricCell label="Active %" value={threadsMetrics.total > 0 ? `${Math.round((threadsMetrics.active / threadsMetrics.total) * 100)}%` : '0%'} />
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-secondary)', padding: '12px 0' }}>Loading...</div>
                            )}
                        </div>
                    </Link>
                </div>

            </div>
        </>
    );
}

function MetricCell({ label, value, color }) {
    return (
        <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value ?? '-'}</div>
        </div>
    );
}
