import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    AnalyticsEngine,
    AirtableService,
    SettingsService,
    ThreadsGrowthService,
} from '../services/growthEngine';
import { TrendingUp, Users } from 'lucide-react';
import { BarChart, COLORS } from '../components/charts';

export function AgencyCommandCenter() {
    const [redditMetrics, setRedditMetrics] = useState(null);
    const [threadsMetrics, setThreadsMetrics] = useState(null);
    const [threadsConnected, setThreadsConnected] = useState(null);
    const [fleetHealth, setFleetHealth] = useState(null);
    const [modelPerformance, setModelPerformance] = useState([]);
    const [recommendations, setRecommendations] = useState([]);

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

            const promises = [
                AnalyticsEngine.getAgencyMetrics(),
                hasAirtable ? AirtableService.getThreadsMetrics() : Promise.resolve(null),
                hasAirtable ? ThreadsGrowthService.getFleetHealth() : Promise.resolve(null),
                hasAirtable ? ThreadsGrowthService.getModelPerformance() : Promise.resolve(null),
                hasAirtable ? ThreadsGrowthService.getRecommendations() : Promise.resolve(null),
            ];

            const [redditResult, threadsResult, healthResult, modelResult, recsResult] = await Promise.allSettled(promises);

            if (cancelled) return;

            if (redditResult.status === 'fulfilled') setRedditMetrics(redditResult.value);
            if (threadsResult.status === 'fulfilled') setThreadsMetrics(threadsResult.value);
            if (healthResult.status === 'fulfilled' && healthResult.value) setFleetHealth(healthResult.value);
            if (modelResult.status === 'fulfilled' && modelResult.value) setModelPerformance(modelResult.value);
            if (recsResult.status === 'fulfilled' && recsResult.value) setRecommendations(recsResult.value);
        }

        load();
        return () => { cancelled = true; };
    }, [analyticsTrigger]);

    const threadsActive = threadsMetrics?.active || 0;
    const threadsTotal = threadsMetrics?.total || 0;
    const threadsActivePct = threadsTotal > 0 ? Math.round((threadsActive / threadsTotal) * 100) : 0;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Command Center</h1>
            </header>
            <div className="page-content">
                {/* Platform Cards — side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                    {/* Threads */}
                    <Link to="/threads" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card" style={{ borderLeft: '3px solid #000', cursor: 'pointer', height: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Threads</h2>
                                {fleetHealth && (
                                    <span style={{
                                        fontSize: '0.8rem', fontWeight: 700, padding: '2px 10px', borderRadius: '10px',
                                        color: fleetHealth.grade === 'A' ? COLORS.success : fleetHealth.grade === 'B' ? COLORS.accent : fleetHealth.grade === 'C' ? COLORS.warning : COLORS.danger,
                                        background: fleetHealth.grade === 'A' ? 'rgba(16,185,129,0.12)' : fleetHealth.grade === 'B' ? 'rgba(59,130,246,0.12)' : fleetHealth.grade === 'C' ? 'rgba(245,158,11,0.12)' : 'rgba(244,63,94,0.12)',
                                    }}>
                                        {fleetHealth.grade} ({fleetHealth.score})
                                    </span>
                                )}
                            </div>
                            {threadsConnected === false ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    Not connected — <Link to="/threads/settings" style={{ color: 'var(--accent-primary)' }} onClick={e => e.stopPropagation()}>Set up</Link>
                                </div>
                            ) : threadsMetrics ? (
                                <div style={{ display: 'flex', gap: '32px' }}>
                                    <Stat label="Accounts" value={threadsTotal.toLocaleString()} />
                                    <Stat label="Active" value={threadsActive.toLocaleString()} sub={`${threadsActivePct}%`} color={COLORS.success} />
                                    <Stat label="Suspended" value={threadsMetrics.suspended} color={threadsMetrics.suspended > 0 ? COLORS.warning : undefined} />
                                    <Stat label="Dead" value={threadsMetrics.dead} color={threadsMetrics.dead > 0 ? COLORS.danger : undefined} />
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</div>
                            )}
                        </div>
                    </Link>

                    {/* Reddit */}
                    <Link to="/reddit" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card" style={{ borderLeft: '3px solid #FF4500', cursor: 'pointer', height: '100%' }}>
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px' }}>Reddit</h2>
                            {redditMetrics ? (
                                <div style={{ display: 'flex', gap: '32px' }}>
                                    <Stat label="Accounts" value={redditMetrics.totalAccounts} />
                                    <Stat label="Active" value={redditMetrics.activeAccounts} color={COLORS.success} />
                                    <Stat label="Posts Today" value={`${redditMetrics.executionToday.completed}/${redditMetrics.executionToday.total}`} />
                                    <Stat label="Removal" value={`${redditMetrics.agencyRemovalRate}%`} color={Number(redditMetrics.agencyRemovalRate) > 20 ? COLORS.danger : undefined} />
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</div>
                            )}
                        </div>
                    </Link>
                </div>

                {/* Alerts + Top Models */}
                <div style={{ display: 'grid', gridTemplateColumns: recommendations.length > 0 && modelPerformance.length > 0 ? '1fr 1fr' : '1fr', gap: '20px' }}>
                    {recommendations.length > 0 && (
                        <div className="card">
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <TrendingUp size={16} /> Alerts
                            </h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {recommendations.slice(0, 6).map((rec, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 10px', borderRadius: '6px', fontSize: '0.82rem',
                                        background: rec.severity === 'critical' ? 'rgba(244,63,94,0.06)' : rec.severity === 'warning' ? 'rgba(245,158,11,0.06)' : rec.severity === 'success' ? 'rgba(16,185,129,0.06)' : 'rgba(59,130,246,0.06)',
                                        color: 'var(--text-primary)',
                                    }}>
                                        <span className={`status-dot status-dot--${rec.severity === 'critical' ? 'danger' : rec.severity === 'warning' ? 'warning' : rec.severity === 'success' ? 'success' : 'info'}`} style={{ marginTop: '4px', flexShrink: 0 }} />
                                        <span>{rec.message}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {modelPerformance.length > 0 && (
                        <div className="card">
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Users size={16} /> Top Models
                            </h2>
                            <BarChart
                                labels={modelPerformance.slice(0, 8).map(m => m.model)}
                                datasets={[{
                                    label: 'Active Followers',
                                    data: modelPerformance.slice(0, 8).map(m => m.activeFollowers),
                                    color: COLORS.accent,
                                }]}
                                horizontal
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

function Stat({ label, value, sub, color }) {
    return (
        <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1.2 }}>{value ?? '-'}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{sub}</div>}
        </div>
    );
}
