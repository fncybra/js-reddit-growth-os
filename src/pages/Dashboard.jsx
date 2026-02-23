import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { TrendingUp, Users, Smartphone, Activity, Heart, ShieldAlert } from 'lucide-react';

export function Dashboard() {
    const [metrics, setMetrics] = useState(null);
    const models = useLiveQuery(() => db.models.toArray());

    // We want to force a re-fetch of metrics when the models table updates or tasks change.
    // In a real app we might liveQuery the whole computation, but for now we poll/re-fetch on load
    const taskCountTrigger = useLiveQuery(() => db.tasks.count(), []);

    useEffect(() => {
        async function fetchMetrics() {
            const data = await AnalyticsEngine.getAgencyMetrics();
            setMetrics(data);
        }
        fetchMetrics();
    }, [models, taskCountTrigger]);

    if (!models) return <div>Loading...</div>;

    if (models.length === 0) {
        return (
            <div className="page-content">
                <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                    <h2>Welcome to JS Reddit Growth OS</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px', marginBottom: '24px' }}>
                        To get started, please add your first Model.
                    </p>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                        <Link to="/models" className="btn btn-primary">Go to Models</Link>
                        <button className="btn btn-outline" onClick={async () => {
                            try {
                                // 1. Create Model
                                const modelId = await db.models.add({
                                    name: 'Mia pregnant', primaryNiche: 'Fitness', weeklyViewTarget: 50000, weeklyPostTarget: 50, status: 'active'
                                });
                                // 2. Create Account
                                await db.accounts.add({
                                    modelId, handle: 'u/miapreggo', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: 'Auto-seeded'
                                });
                                // 3. Import CSV Subs
                                const res = await fetch('/reddit_sfw_selfie_subs.csv');
                                if (!res.ok) throw new Error("Could not find CSV in public folder");
                                const text = await res.text();
                                const lines = text.split('\n').filter(l => l.trim().length > 0).slice(1);

                                const subsToInsert = lines.map(line => {
                                    const parts = line.split(',');
                                    const nameRaw = parts[0] ? parts[0].replace(/^(r\/|\/r\/)/i, '') : 'unknown';
                                    return {
                                        modelId, name: nameRaw, url: parts[1] || '', status: 'testing', nicheTag: 'sfw selfie', riskLevel: 'low', contentComplexity: 'general', totalTests: 0, avg24hViews: 0, removalPct: 0, lastTestedDate: null
                                    };
                                }).filter(s => s.name !== 'unknown');

                                await db.subreddits.bulkAdd(subsToInsert);

                                // 4. Create Asset (Empty Blob to mock file)
                                await db.assets.add({
                                    modelId, assetType: 'image', angleTag: 'auto_seeded_asset', locationTag: '', reuseCooldownSetting: 30, approved: 1, lastUsedDate: null, timesUsed: 0, fileBlob: null, fileName: 'mia_seeded.png'
                                });

                                alert(`Success! Created Model 'Mia pregnant', Account 'u/miapreggo', attached 1 Asset, and imported ${subsToInsert.length} Subreddits from CSV!`);
                            } catch (err) {
                                alert("Failed to seed: " + err.message);
                            }
                        }}>
                            ✨ Auto-Seed 'Mia preggo' & CSV
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!metrics) return <div>Loading Analytics...</div>;

    const {
        totalModels,
        activeAccounts,
        totalAccounts,
        agencyTotalViews,
        agencyAvgViews,
        agencyRemovalRate,
        leaderboard
    } = metrics;

    const isHighRemoval = agencyRemovalRate > 20;

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Global Agency Dashboard</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Overview of all models and operations
                    </div>
                </div>
            </header>

            <div className="page-content">
                {/* Aggregate KPI Cards */}
                <div className="grid-cards mb-6" style={{ marginBottom: '24px' }}>
                    <div className="card metric-card">
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><TrendingUp size={16} /> Total Views (All Time)</span>
                        <span className="metric-value" style={{ color: 'var(--primary-color)' }}>
                            {agencyTotalViews.toLocaleString()}
                        </span>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={16} /> Total Models</span>
                        <span className="metric-value">{totalModels}</span>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Smartphone size={16} /> Network Accounts</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <span className="metric-value">{activeAccounts}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                / {totalAccounts} active
                            </span>
                        </div>
                    </div>

                    <div className={`card metric-card`} style={isHighRemoval ? { borderColor: 'var(--status-danger)' } : {}}>
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Activity size={16} /> Agency Removal Rate</span>
                        <span className="metric-value" style={isHighRemoval ? { color: 'var(--status-danger)' } : {}}>
                            {agencyRemovalRate}%
                        </span>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Heart size={16} /> Agency Health</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <span className="metric-value">{leaderboard.reduce((acc, m) => acc + (m.metrics.accountHealth?.activeCount || 0), 0)}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                Accounts Healthy
                            </span>
                        </div>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ShieldAlert size={16} /> Suspended</span>
                        <span className="metric-value" style={{ color: leaderboard.some(m => m.metrics.accountHealth?.suspendedCount > 0) ? 'var(--status-danger)' : 'inherit' }}>
                            {leaderboard.reduce((acc, m) => acc + (m.metrics.accountHealth?.suspendedCount || 0), 0)}
                        </span>
                    </div>
                </div>

                {/* Leaderboard Table */}
                <div className="card">
                    <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Model Leaderboard</h2>
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Model Name</th>
                                    <th>Total Views</th>
                                    <th>Weekly Target</th>
                                    <th>Avg Post View</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((model, idx) => {
                                    const m = model.metrics;
                                    const targetHit = model.targetHit;
                                    const target = model.weeklyViewTarget;

                                    return (
                                        <tr key={model.id}>
                                            <td style={{ fontWeight: 'bold', color: idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? '#cd7f32' : 'inherit' }}>
                                                #{idx + 1}
                                            </td>
                                            <td style={{ fontWeight: '600' }}>{model.name}</td>
                                            <td style={{ fontWeight: 'bold' }}>{m.totalViews.toLocaleString()}</td>
                                            <td>
                                                {target > 0 ? (
                                                    <span style={{
                                                        color: targetHit ? 'var(--status-success)' : 'var(--status-danger)',
                                                        fontWeight: '500'
                                                    }}>
                                                        {targetHit ? 'Hit' : 'Failed'} ({target.toLocaleString()})
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-secondary)' }}>No target set</span>
                                                )}
                                            </td>
                                            <td>{m.avgViewsPerPost.toLocaleString()}</td>
                                            <td>
                                                <Link to={`/model/${model.id}`} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                                                    Drill Down
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
}
