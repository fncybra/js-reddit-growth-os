import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowUp, Users, Shield, AlertTriangle, RefreshCw, Cloud, RefreshCcw, Smartphone, CheckCircle, XCircle } from 'lucide-react';

export function Dashboard() {
    const [metrics, setMetrics] = useState(null);
    const [syncing, setSyncing] = useState(false);
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

    const accountSubredditLeaders = useMemo(() => {
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
    }, [tasksAll, performancesAll, accountsAll, subredditsAll]);

    const accountNicheLeaders = useMemo(() => {
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
    }, [tasksAll, performancesAll, accountsAll, assetsAll]);

    async function handleSync() {
        setSyncing(true);
        try {
            const { PerformanceSyncService, AccountSyncService } = await import('../services/growthEngine');
            await AccountSyncService.syncAllAccounts();
            const stats = await PerformanceSyncService.syncAllPendingPerformance();
            alert(`Stats sync finished. Attempted ${stats.attempted}, succeeded ${stats.succeeded}, failed ${stats.failed}.`);
            window.location.reload();
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
                        <div style={{ fontSize: '2rem', fontWeight: '700', color: suspendedAccounts > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>
                            {suspendedAccounts > 0 ? `${suspendedAccounts} ⚠️` : `${healthyAccounts} ✓`}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {suspendedAccounts > 0 ? `${suspendedAccounts} suspended` : 'All healthy'}
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

                {/* Cloud Sync - Minimal */}
                <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-secondary)' }}>Cloud Backup</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    const { CloudSyncService } = await import('../services/growthEngine');
                                    await CloudSyncService.pushLocalToCloud();
                                    alert("Backed up to cloud.");
                                }}
                                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                            >
                                <Cloud size={12} style={{ marginRight: '4px' }} /> Backup
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={async () => {
                                    if (confirm("Overwrite local data with cloud data?")) {
                                        const { CloudSyncService } = await import('../services/growthEngine');
                                        await CloudSyncService.pullCloudToLocal();
                                        window.location.reload();
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
