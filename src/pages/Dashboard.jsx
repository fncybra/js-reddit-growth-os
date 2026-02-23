import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { TrendingUp, Users, Smartphone, Activity, Heart, ShieldAlert, RefreshCw, Cloud, RefreshCcw, CheckCircle, AlertCircle, Zap } from 'lucide-react';

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

                {/* Agency Execution Progress */}
                <div style={{ minWidth: '250px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: '600' }}>Today's Execution</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                            {metrics.executionToday?.completed || 0} / {metrics.executionToday?.total || 0} posts
                        </span>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--surface-color)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                        <div style={{
                            width: `${metrics.executionToday?.percent || 0}%`,
                            height: '100%',
                            backgroundColor: metrics.executionToday?.percent === 100 ? 'var(--status-success)' : 'var(--primary-color)',
                            transition: 'width 0.5s ease'
                        }} />
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

                <div className="grid-cards mb-6" style={{ marginBottom: '24px' }}>
                    <div className="card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '1.2rem' }}>Scaling Intelligence</h2>
                            <button
                                className="btn btn-primary"
                                onClick={async () => {
                                    const { PerformanceSyncService } = await import('../services/growthEngine');
                                    alert("Syncing all post performance... this takes a few moments.");
                                    await PerformanceSyncService.syncAllPendingPerformance();
                                    alert("Sync complete!");
                                    window.location.reload();
                                }}
                                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                            >
                                <RefreshCw size={14} style={{ marginRight: '6px' }} />
                                Sync All Active Posts
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div style={{ padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px dotted var(--border-color)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Model Yield</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{agencyAvgViews.toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>views / post</span></div>
                                <div style={{ marginTop: '12px', fontSize: '0.9rem', color: 'var(--status-success)' }}>
                                    🎯 Total Agency Capacity: {(activeAccounts * 10 * agencyAvgViews).toLocaleString()} views / day
                                </div>
                            </div>
                            <div style={{ padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px dotted var(--border-color)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Growth Multiplier</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(agencyAvgViews * 0.8).toFixed(0)} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>est. return / follower</span></div>
                                <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-warning)' }}>
                                    💡 Scale Tip: Add 5 more <b>Proven Subreddits</b> to increase predictability by 15%.
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Cloud Control Center</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    const { CloudSyncService } = await import('../services/growthEngine');
                                    await CloudSyncService.pushLocalToCloud();
                                    alert("Agency data backed up to Supabase 'Forever' Cloud.");
                                }}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                <Cloud size={16} style={{ marginRight: '8px' }} />
                                Backup All Data to Cloud
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    if (confirm("This will overwrite your local computer data with the Cloud data. Proceed?")) {
                                        const { CloudSyncService } = await import('../services/growthEngine');
                                        await CloudSyncService.pullCloudToLocal();
                                        alert("Agency data restored from Cloud.");
                                        window.location.reload();
                                    }
                                }}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                <RefreshCcw size={16} style={{ marginRight: '8px' }} />
                                Restore from Cloud
                            </button>
                        </div>
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
                                    <th>Health</th>
                                    <th>Total Views</th>
                                    <th>Weekly Target</th>
                                    <th>Avg View/Post</th>
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
                                            <td>
                                                <ModelStatusBadge metrics={m} />
                                            </td>
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

function ModelStatusBadge({ metrics }) {
    const isRisky = metrics.removalRatePct > 25;
    const isHealthy = metrics.removalRatePct < 15 && metrics.totalViews > 0;
    const lowAssets = metrics.tasksTotal < 5;

    if (isRisky) return <span className="badge badge-danger" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={12} /> Risky</span>;
    if (lowAssets) return <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} /> Low Feed</span>;
    if (isHealthy) return <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> Healthy</span>;

    return <span className="badge badge-info">Stable</span>;
}
