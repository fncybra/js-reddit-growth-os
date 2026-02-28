import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine, AccountLifecycleService, SnapshotService } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowUp, Users, Shield, AlertTriangle, RefreshCw, Cloud, RefreshCcw, Smartphone, CheckCircle, XCircle } from 'lucide-react';

export function Dashboard() {
    const [metrics, setMetrics] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [snapshots, setSnapshots] = useState([]);
    const models = useLiveQuery(() => db.models.toArray());
    const accountsAll = useLiveQuery(() => db.accounts.toArray());
    const subredditsAll = useLiveQuery(() => db.subreddits.toArray());
    const tasksAll = useLiveQuery(() => db.tasks.toArray());
    const performancesAll = useLiveQuery(() => db.performances.toArray());
    const assetsAll = useLiveQuery(() => db.assets.toArray());
    const analyticsTrigger = useLiveQuery(async () => {
        const [tasks, perfs] = await Promise.all([db.tasks.toArray(), db.performances.toArray()]);
        const taskSig = tasks.map(t => `${t.id}:${t.status}:${t.redditPostId || ''}`).join('|');
        const perfSig = perfs.map(p => `${p.taskId}:${p.views24h || 0}:${p.removed ? 1 : 0}`).join('|');
        return `${taskSig}::${perfSig}`;
    }, []);

    useEffect(() => {
        async function fetchMetrics() {
            const data = await AnalyticsEngine.getAgencyMetrics();
            setMetrics(data);
        }
        fetchMetrics();
    }, [models, analyticsTrigger]);

    useEffect(() => {
        SnapshotService.getSnapshots(14).then(setSnapshots).catch(() => {});
    }, [syncing]);

    if (!models) return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>;

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
                                const modelId = await db.models.add({
                                    name: 'Mia pregnant', primaryNiche: 'Fitness', weeklyViewTarget: 50000, weeklyPostTarget: 50, status: 'active'
                                });
                                await db.accounts.add({
                                    modelId, handle: 'u/miapreggo', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: 'Auto-seeded'
                                });
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
                                await db.assets.add({
                                    modelId, assetType: 'image', angleTag: 'auto_seeded_asset', locationTag: '', reuseCooldownSetting: 30, approved: 1, lastUsedDate: null, timesUsed: 0, fileBlob: null, fileName: 'mia_seeded.png'
                                });
                                alert(`Success! Created Model, Account, and imported ${subsToInsert.length} Subreddits.`);
                            } catch (err) {
                                alert("Failed to seed: " + err.message);
                            }
                        }}>
                            ✨ Auto-Seed Demo Data
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!metrics) return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading Analytics...</div>;

    const {
        totalModels, activeAccounts, totalAccounts,
        agencyTotalViews, agencyAvgViews, agencyRemovalRate, leaderboard
    } = metrics;

    const healthyAccounts = leaderboard.reduce((acc, m) => acc + (m.metrics.accountHealth?.activeCount || 0), 0);
    const suspendedAccounts = leaderboard.reduce((acc, m) => acc + (m.metrics.accountHealth?.suspendedCount || 0), 0);

    // Health score breakdown
    const healthCounts = (() => {
        if (!accountsAll) return { healthy: 0, warning: 0, critical: 0 };
        let healthy = 0, warning = 0, critical = 0;
        for (const acc of accountsAll) {
            const score = AnalyticsEngine.computeAccountHealthScore(acc);
            if (score >= 80) healthy++;
            else if (score >= 50) warning++;
            else critical++;
        }
        return { healthy, warning, critical };
    })();

    const accountSubredditLeaders = (() => {
        if (!tasksAll || !performancesAll || !accountsAll || !subredditsAll) return [];
        const perfByTaskId = new Map(performancesAll.map(p => [p.taskId, p]));
        const accountsById = new Map(accountsAll.map(a => [a.id, a]));
        const subsById = new Map(subredditsAll.map(s => [s.id, s]));
        const bucket = new Map();

        for (const task of tasksAll) {
            if (!task.accountId || !task.subredditId) continue;
            const perf = perfByTaskId.get(task.id);
            if (!perf) continue;

            const key = `${task.accountId}:${task.subredditId}`;
            if (!bucket.has(key)) {
                bucket.set(key, {
                    accountId: task.accountId,
                    subredditId: task.subredditId,
                    posts: 0,
                    totalUps: 0,
                    removed: 0,
                });
            }

            const row = bucket.get(key);
            row.posts += 1;
            row.totalUps += Number(perf.views24h || 0);
            if (perf.removed) row.removed += 1;
        }

        return Array.from(bucket.values())
            .map(row => ({
                ...row,
                accountHandle: accountsById.get(row.accountId)?.handle || `acct-${row.accountId}`,
                subredditName: subsById.get(row.subredditId)?.name || `sub-${row.subredditId}`,
                avgUps: row.posts > 0 ? Math.round(row.totalUps / row.posts) : 0,
                removalPct: row.posts > 0 ? Number(((row.removed / row.posts) * 100).toFixed(1)) : 0,
            }))
            .sort((a, b) => b.avgUps - a.avgUps)
            .slice(0, 12);
    })();

    const accountNicheLeaders = (() => {
        if (!tasksAll || !performancesAll || !accountsAll || !assetsAll) return [];
        const perfByTaskId = new Map(performancesAll.map(p => [p.taskId, p]));
        const assetsById = new Map(assetsAll.map(a => [a.id, a]));
        const accountsById = new Map(accountsAll.map(a => [a.id, a]));
        const bucket = new Map();

        for (const task of tasksAll) {
            if (!task.accountId || !task.assetId) continue;
            const perf = perfByTaskId.get(task.id);
            if (!perf) continue;
            const asset = assetsById.get(task.assetId);
            const niche = (asset?.angleTag || 'general').toLowerCase();

            const key = `${task.accountId}:${niche}`;
            if (!bucket.has(key)) {
                bucket.set(key, {
                    accountId: task.accountId,
                    niche,
                    posts: 0,
                    totalUps: 0,
                    removed: 0,
                });
            }

            const row = bucket.get(key);
            row.posts += 1;
            row.totalUps += Number(perf.views24h || 0);
            if (perf.removed) row.removed += 1;
        }

        return Array.from(bucket.values())
            .map(row => ({
                ...row,
                accountHandle: accountsById.get(row.accountId)?.handle || `acct-${row.accountId}`,
                avgUps: row.posts > 0 ? Math.round(row.totalUps / row.posts) : 0,
                removalPct: row.posts > 0 ? Number(((row.removed / row.posts) * 100).toFixed(1)) : 0,
            }))
            .sort((a, b) => b.avgUps - a.avgUps)
            .slice(0, 12);
    })();

    async function handleSync() {
        setSyncing(true);
        try {
            const { PerformanceSyncService, AccountSyncService, AccountLifecycleService, CloudSyncService } = await import('../services/growthEngine');
            const parts = [];

            // Step 1: Pull latest from cloud first (gets VA-submitted data)
            const cloudEnabled = await CloudSyncService.isEnabled();
            if (cloudEnabled) {
                try {
                    await CloudSyncService.pullCloudToLocal();
                    parts.push('Cloud pull: synced.');
                } catch (e) {
                    parts.push('Cloud pull: failed (' + e.message + ')');
                }
            }

            // Step 2: Evaluate account lifecycle phases
            try {
                await AccountLifecycleService.evaluateAccountPhases();
                parts.push('Phases: evaluated.');
            } catch (e) {
                parts.push('Phases: failed (' + e.message + ')');
            }

            // Step 3: Sync account health from Reddit
            const accountResult = await AccountSyncService.syncAllAccounts();
            if (accountResult.total === 0) {
                parts.push('Accounts: none found.');
            } else if (accountResult.failed > 0) {
                parts.push(`Accounts: ${accountResult.succeeded}/${accountResult.total} synced (${accountResult.failed} failed).`);
            } else {
                parts.push(`Accounts: ${accountResult.succeeded}/${accountResult.total} synced.`);
            }

            // Step 3: Sync Reddit post stats
            const stats = await PerformanceSyncService.syncAllPendingPerformance();
            if (stats.scanned === 0) {
                // Show task breakdown so user understands WHY there's nothing to sync
                const allTasks = await db.tasks.toArray();
                const statusCounts = {};
                allTasks.forEach(t => { statusCounts[t.status || 'unknown'] = (statusCounts[t.status || 'unknown'] || 0) + 1; });
                const breakdown = Object.entries(statusCounts).map(([s, c]) => `${s}: ${c}`).join(', ');
                parts.push(`Posts: 0 to check.`);
                if (allTasks.length > 0) {
                    parts.push(`Task breakdown: ${breakdown}`);
                    parts.push('(Only "closed" or "failed" tasks get synced. VAs must post and paste the Reddit URL first.)');
                } else {
                    parts.push('No tasks exist yet. Generate a daily plan on the Tasks page first.');
                }
            } else {
                parts.push(`Posts: ${stats.attempted} checked, ${stats.succeeded} succeeded, ${stats.failed} failed.`);
                if (stats.skipped > 0) parts.push(`(${stats.skipped} skipped — no post ID)`);
            }

            // Step 4: Take daily snapshot
            try {
                await SnapshotService.takeDailySnapshot();
                parts.push('Snapshot: saved.');
            } catch (e) {
                parts.push('Snapshot: failed (' + e.message + ')');
            }

            // Step 5: Push updated data back to cloud
            if (cloudEnabled) {
                try { await CloudSyncService.pushLocalToCloud(); } catch (e) { /* non-critical */ }
            }

            alert(parts.join('\n'));
            const data = await AnalyticsEngine.getAgencyMetrics();
            setMetrics(data);
            setSyncing(false);
        } catch (err) {
            alert("Sync error: " + err.message);
            setSyncing(false);
        }
    }

    return (
        <>
            {/* Header */}
            <header className="page-header">
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 className="page-title">Dashboard</h1>
                        <Link to="/va" className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Smartphone size={14} /> VA Terminal
                        </Link>
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleSync}
                    disabled={syncing}
                    style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                    <RefreshCw size={14} style={{ marginRight: '6px' }} className={syncing ? 'spin' : ''} />
                    {syncing ? 'Syncing...' : 'Sync All Stats'}
                </button>
            </header>

            <div className="page-content">

                {/* Today's Progress Bar */}
                <div className="card" style={{ marginBottom: '20px', padding: '12px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: '600' }}>Today's Posts</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                            {metrics.executionToday?.completed || 0} / {metrics.executionToday?.total || 0} completed
                        </span>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--surface-color)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                            width: `${metrics.executionToday?.percent || 0}%`,
                            height: '100%',
                            backgroundColor: metrics.executionToday?.percent === 100 ? 'var(--status-success)' : 'var(--primary-color)',
                            transition: 'width 0.5s ease'
                        }} />
                    </div>
                </div>

                {/* KPI Cards - Simple 4-card row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>

                    <div className="card" style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <ArrowUp size={14} /> Total Upvotes
                        </div>
                        <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--primary-color)' }}>
                            {agencyTotalViews.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            ~{agencyAvgViews} avg per post
                        </div>
                    </div>

                    <div className="card" style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <Users size={14} /> Accounts
                        </div>
                        <div style={{ fontSize: '2rem', fontWeight: '700' }}>
                            {activeAccounts}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {totalAccounts} total · {totalModels} model{totalModels !== 1 ? 's' : ''}
                        </div>
                    </div>

                    <div className="card" style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <Shield size={14} /> Account Health
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                            <span style={{ fontSize: '2rem', fontWeight: '700', color: healthCounts.critical > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>
                                {healthCounts.healthy}
                            </span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>healthy</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', marginTop: '4px', display: 'flex', gap: '10px' }}>
                            {healthCounts.warning > 0 && <span style={{ color: '#ff9800' }}>{healthCounts.warning} warning</span>}
                            {healthCounts.critical > 0 && <span style={{ color: '#f44336' }}>{healthCounts.critical} critical</span>}
                            {healthCounts.warning === 0 && healthCounts.critical === 0 && <span style={{ color: 'var(--text-secondary)' }}>All accounts healthy</span>}
                        </div>
                    </div>

                    <div className="card" style={{ padding: '20px', borderColor: agencyRemovalRate > 20 ? 'var(--status-danger)' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <AlertTriangle size={14} /> Removal Rate
                        </div>
                        <div style={{ fontSize: '2rem', fontWeight: '700', color: agencyRemovalRate > 20 ? 'var(--status-danger)' : agencyRemovalRate > 10 ? 'var(--status-warning)' : 'var(--status-success)' }}>
                            {agencyRemovalRate}%
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {agencyRemovalRate > 20 ? 'High risk — review subs' : agencyRemovalRate > 10 ? 'Monitor closely' : 'Looking good'}
                        </div>
                    </div>
                </div>

                {/* 14-Day Trends */}
                {snapshots.length >= 2 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                        {/* Karma Trend */}
                        <div className="card" style={{ padding: '16px 20px' }}>
                            <h2 style={{ fontSize: '1rem', marginBottom: '12px', fontWeight: 600 }}>Karma Trend (14d)</h2>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px' }}>
                                {(() => {
                                    const maxK = Math.max(...snapshots.map(s => s.totalKarma || 0), 1);
                                    return snapshots.map((s, i) => {
                                        const pct = Math.max(4, ((s.totalKarma || 0) / maxK) * 100);
                                        const d = new Date(s.date);
                                        const label = `${d.getMonth() + 1}/${d.getDate()}`;
                                        const prev = i > 0 ? (snapshots[i - 1].totalKarma || 0) : (s.totalKarma || 0);
                                        const diff = (s.totalKarma || 0) - prev;
                                        return (
                                            <div key={s.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                <div
                                                    title={`${label}: ${(s.totalKarma || 0).toLocaleString()} karma${diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff.toLocaleString()})` : ''}`}
                                                    style={{
                                                        width: '100%', maxWidth: '28px',
                                                        height: `${pct}%`,
                                                        backgroundColor: diff >= 0 ? '#6366f1' : '#f44336',
                                                        borderRadius: '3px 3px 0 0',
                                                        transition: 'height 0.3s ease',
                                                        minHeight: '3px'
                                                    }}
                                                />
                                                <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                <span>{(snapshots[0]?.totalKarma || 0).toLocaleString()}</span>
                                <span style={{ fontWeight: 600, color: (snapshots[snapshots.length - 1]?.totalKarma || 0) >= (snapshots[0]?.totalKarma || 0) ? '#4caf50' : '#f44336' }}>
                                    {(snapshots[snapshots.length - 1]?.totalKarma || 0).toLocaleString()}
                                    {(() => {
                                        const diff = (snapshots[snapshots.length - 1]?.totalKarma || 0) - (snapshots[0]?.totalKarma || 0);
                                        return diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff.toLocaleString()})` : '';
                                    })()}
                                </span>
                            </div>
                        </div>

                        {/* Daily Posts Trend */}
                        <div className="card" style={{ padding: '16px 20px' }}>
                            <h2 style={{ fontSize: '1rem', marginBottom: '12px', fontWeight: 600 }}>Daily Posts (14d)</h2>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px' }}>
                                {(() => {
                                    const maxP = Math.max(...snapshots.map(s => s.postsToday || 0), 1);
                                    return snapshots.map(s => {
                                        const pct = Math.max(4, ((s.postsToday || 0) / maxP) * 100);
                                        const d = new Date(s.date);
                                        const label = `${d.getMonth() + 1}/${d.getDate()}`;
                                        const remPct = s.postsToday > 0 ? ((s.removalsToday || 0) / s.postsToday) : 0;
                                        const barColor = remPct > 0.3 ? '#f44336' : remPct > 0.1 ? '#ff9800' : '#4caf50';
                                        return (
                                            <div key={s.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                <div
                                                    title={`${label}: ${s.postsToday || 0} posts, ${s.removalsToday || 0} removed`}
                                                    style={{
                                                        width: '100%', maxWidth: '28px',
                                                        height: `${pct}%`,
                                                        backgroundColor: barColor,
                                                        borderRadius: '3px 3px 0 0',
                                                        transition: 'height 0.3s ease',
                                                        minHeight: '3px'
                                                    }}
                                                />
                                                <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                <span>Green = low removal</span>
                                <span>Red = high removal</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Model Leaderboard - Clean Table */}
                <div className="card" style={{ marginBottom: '20px' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: '600' }}>Models</h2>
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Model</th>
                                    <th>Upvotes</th>
                                    <th>Avg/Post</th>
                                    <th>Removal %</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((model) => {
                                    const m = model.metrics;
                                    const ms = m.managerSignals || { status: 'watch', healthScore: 0 };
                                    return (
                                        <tr key={model.id}>
                                            <td style={{ fontWeight: '600' }}>{model.name}</td>
                                            <td style={{ fontWeight: '600' }}>{m.totalViews.toLocaleString()}</td>
                                            <td>{m.avgViewsPerPost}</td>
                                            <td>
                                                <span style={{ color: m.removalRatePct > 20 ? 'var(--status-danger)' : m.removalRatePct > 10 ? 'var(--status-warning)' : 'var(--status-success)' }}>
                                                    {m.removalRatePct}%
                                                </span>
                                            </td>
                                            <td>
                                                {ms.status === 'critical'
                                                    ? <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><XCircle size={12} /> Risky</span>
                                                    : ms.status === 'healthy'
                                                        ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> Healthy</span>
                                                        : <span className="badge badge-warning">Watch</span>
                                                }
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Score {ms.healthScore}</div>
                                            </td>
                                            <td>
                                                <Link to={`/model/${model.id}`} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                                                    Details
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.05rem', marginBottom: '10px', fontWeight: '600' }}>Account x Subreddit Winners</h2>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                            Shows which account is winning in which subreddit.
                        </div>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Account</th>
                                        <th>Subreddit</th>
                                        <th>Posts</th>
                                        <th>Avg Ups</th>
                                        <th>Removal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountSubredditLeaders.length === 0 && (
                                        <tr><td colSpan="5" style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No synced results yet.</td></tr>
                                    )}
                                    {accountSubredditLeaders.map((row) => (
                                        <tr key={`${row.accountId}-${row.subredditId}`}>
                                            <td>
                                                <Link to={`/account/${row.accountId}`} style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                    {row.accountHandle}
                                                </Link>
                                            </td>
                                            <td>r/{row.subredditName}</td>
                                            <td>{row.posts}</td>
                                            <td style={{ fontWeight: '600' }}>{row.avgUps}</td>
                                            <td style={{ color: row.removalPct > 20 ? 'var(--status-danger)' : 'var(--status-success)' }}>{row.removalPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="card">
                        <h2 style={{ fontSize: '1.05rem', marginBottom: '10px', fontWeight: '600' }}>Account x Niche Winners</h2>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                            Reveals which niche tags perform best per account.
                        </div>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Account</th>
                                        <th>Niche</th>
                                        <th>Posts</th>
                                        <th>Avg Ups</th>
                                        <th>Removal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountNicheLeaders.length === 0 && (
                                        <tr><td colSpan="5" style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No synced results yet.</td></tr>
                                    )}
                                    {accountNicheLeaders.map((row) => (
                                        <tr key={`${row.accountId}-${row.niche}`}>
                                            <td>
                                                <Link to={`/account/${row.accountId}`} style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                    {row.accountHandle}
                                                </Link>
                                            </td>
                                            <td><span className="badge badge-info">{row.niche}</span></td>
                                            <td>{row.posts}</td>
                                            <td style={{ fontWeight: '600' }}>{row.avgUps}</td>
                                            <td style={{ color: row.removalPct > 20 ? 'var(--status-danger)' : 'var(--status-success)' }}>{row.removalPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Top Content */}
                {(() => {
                    if (!tasksAll || !performancesAll || !assetsAll) return null;
                    const perfByTaskId = new Map(performancesAll.map(p => [p.taskId, p]));
                    const assetBucket = new Map();
                    for (const t of tasksAll) {
                        if (!t.assetId) continue;
                        if (!assetBucket.has(t.assetId)) assetBucket.set(t.assetId, { posts: 0, totalViews: 0, removed: 0 });
                        const b = assetBucket.get(t.assetId);
                        const p = perfByTaskId.get(t.id);
                        if (!p) continue;
                        b.posts++;
                        b.totalViews += Number(p.views24h || 0);
                        if (p.removed) b.removed++;
                    }
                    const assetsById = new Map((assetsAll || []).map(a => [a.id, a]));
                    const modelsById = new Map((models || []).map(m => [m.id, m]));
                    const ranked = Array.from(assetBucket.entries())
                        .map(([id, s]) => {
                            const asset = assetsById.get(id);
                            return {
                                id,
                                name: asset?.fileName || asset?.angleTag || `asset-${id}`,
                                niche: asset?.angleTag || '?',
                                modelName: modelsById.get(asset?.modelId)?.name || '?',
                                posts: s.posts,
                                avgViews: s.posts > 0 ? Math.round(s.totalViews / s.posts) : 0,
                                totalViews: s.totalViews,
                                removed: s.removed,
                            };
                        })
                        .filter(r => r.posts >= 1)
                        .sort((a, b) => b.avgViews - a.avgViews)
                        .slice(0, 10);
                    if (ranked.length === 0) return null;
                    return (
                        <div className="card" style={{ marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.05rem', marginBottom: '10px', fontWeight: 600 }}>Top Content by Avg Views</h2>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Asset</th>
                                            <th>Niche</th>
                                            <th>Model</th>
                                            <th>Posts</th>
                                            <th>Avg Views</th>
                                            <th>Total Views</th>
                                            <th>Removed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ranked.map(r => (
                                            <tr key={r.id}>
                                                <td style={{ fontWeight: 500, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                                                <td><span className="badge badge-info">{r.niche}</span></td>
                                                <td>{r.modelName}</td>
                                                <td>{r.posts}</td>
                                                <td style={{ fontWeight: 600, color: 'var(--primary-color)' }}>{r.avgViews.toLocaleString()}</td>
                                                <td>{r.totalViews.toLocaleString()}</td>
                                                <td style={{ color: r.removed > 0 ? '#f44336' : 'var(--text-secondary)' }}>{r.removed}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })()}

                {/* Cloud Sync - Minimal */}
                <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-secondary)' }}>Cloud Backup</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    try {
                                        const { CloudSyncService } = await import('../services/growthEngine');
                                        const enabled = await CloudSyncService.isEnabled();
                                        if (!enabled) {
                                            alert("Cloud sync not configured. Go to Settings and add your Supabase URL and Anon Key.");
                                            return;
                                        }
                                        await CloudSyncService.pushLocalToCloud();
                                        alert("Backed up to cloud.");
                                    } catch (err) {
                                        alert("Backup failed: " + err.message);
                                    }
                                }}
                                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                            >
                                <Cloud size={12} style={{ marginRight: '4px' }} /> Backup
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    if (confirm("Overwrite local data with cloud data?")) {
                                        try {
                                            const { CloudSyncService } = await import('../services/growthEngine');
                                            const enabled = await CloudSyncService.isEnabled();
                                            if (!enabled) {
                                                alert("Cloud sync not configured. Go to Settings and add your Supabase URL and Anon Key.");
                                                return;
                                            }
                                            await CloudSyncService.pullCloudToLocal();
                                            window.location.reload();
                                        } catch (err) {
                                            alert("Restore failed: " + err.message);
                                        }
                                    }
                                }}
                                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                            >
                                <RefreshCcw size={12} style={{ marginRight: '4px' }} /> Restore
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
