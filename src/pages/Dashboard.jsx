import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { AnalyticsEngine, SnapshotService, SettingsService } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowUp, Users, Shield, AlertTriangle, Cloud, RefreshCcw, Smartphone, CheckCircle, XCircle, Sparkles, Trophy } from 'lucide-react';
import { ManagerActionItems } from '../components/ManagerActionItems';

export function Dashboard() {
    const [metrics, setMetrics] = useState(null);
    const [snapshots, setSnapshots] = useState([]);
    const [hideWarming, setHideWarming] = useState(false);
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
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link to="/models" className="btn btn-primary">Go to Models</Link>
                        <button className="btn btn-outline" onClick={async () => {
                            try {
                                setSyncing(true);
                                const { CloudSyncService } = await import('../services/growthEngine');
                                await CloudSyncService.pullCloudToLocal();
                                alert('Cloud restore complete! Reloading...');
                                window.location.reload();
                            } catch (err) {
                                alert('Restore failed: ' + err.message);
                            } finally {
                                setSyncing(false);
                            }
                        }} disabled={syncing}>
                            {syncing ? 'Restoring...' : 'Restore from Cloud'}
                        </button>
                        <button className="btn btn-outline" onClick={async () => {
                            try {
                                const modelId = generateId();
                                await db.models.add({
                                    id: modelId, name: 'Mia pregnant', primaryNiche: 'Fitness', weeklyViewTarget: 50000, weeklyPostTarget: 50, status: 'active'
                                });
                                await db.accounts.add({
                                    id: generateId(), modelId, handle: 'u/miapreggo', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: 'Auto-seeded'
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
                                subsToInsert.forEach(s => { s.id = generateId(); });
                                await db.subreddits.bulkAdd(subsToInsert);
                                await db.assets.add({
                                    id: generateId(), modelId, assetType: 'image', angleTag: 'auto_seeded_asset', locationTag: '', reuseCooldownSetting: 30, approved: 1, lastUsedDate: null, timesUsed: 0, fileBlob: null, fileName: 'mia_seeded.png'
                                });
                                alert(`Success! Created Model, Account, and imported ${subsToInsert.length} Subreddits.`);
                            } catch (err) {
                                alert("Failed to seed: " + err.message);
                            }
                        }}>
                            Auto-Seed Demo Data
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!metrics) return <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading Analytics...</div>;

    const {
        totalModels,
        agencyTotalViews, agencyAvgViews, agencyRemovalRate, leaderboard
    } = metrics;

    // Filtered accounts (exclude warming when toggle is on)
    const warmingIds = new Set((accountsAll || []).filter(a => {
        const phase = (a.phase || '').toLowerCase();
        return phase === 'warming' || (!phase && !a.lastSyncDate);
    }).map(a => a.id));
    const filteredAccounts = hideWarming ? (accountsAll || []).filter(a => !warmingIds.has(a.id)) : (accountsAll || []);

    // Account counts derived from live data + warming filter
    const activeAccounts = filteredAccounts.filter(a => a.status === 'active').length;
    const totalAccounts = filteredAccounts.length;

    // Health score breakdown -- exclude burned/suspended from "healthy" count
    const healthCounts = (() => {
        if (!filteredAccounts.length) return { healthy: 0, warning: 0, critical: 0, burned: 0 };
        let healthy = 0, warning = 0, critical = 0, burned = 0;
        for (const acc of filteredAccounts) {
            if (acc.isSuspended || (acc.phase || '').toLowerCase() === 'burned') {
                burned++;
                continue;
            }
            const score = AnalyticsEngine.computeAccountHealthScore(acc);
            if (score >= 80) healthy++;
            else if (score >= 50) warning++;
            else critical++;
        }
        return { healthy, warning, critical, burned };
    })();

    const accountSubredditLeaders = (() => {
        if (!tasksAll || !performancesAll || !accountsAll || !subredditsAll) return [];
        const perfByTaskId = new Map(performancesAll.map(p => [p.taskId, p]));
        const accountsById = new Map(accountsAll.map(a => [a.id, a]));
        const subsById = new Map(subredditsAll.map(s => [s.id, s]));
        const bucket = new Map();

        for (const task of tasksAll) {
            if (!task.accountId || !task.subredditId) continue;
            if (hideWarming && warmingIds.has(task.accountId)) continue;
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
            if (hideWarming && warmingIds.has(task.accountId)) continue;
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

    const accountFlightDeck = (() => {
        if (!leaderboard || !accountsAll) return [];

        const accountsById = new Map((accountsAll || []).map((account) => [account.id, account]));
        const bestSubByAccount = new Map();
        const bestNicheByAccount = new Map();
        const lastPostByAccount = new Map();

        for (const row of accountSubredditLeaders) {
            if (!bestSubByAccount.has(row.accountId)) bestSubByAccount.set(row.accountId, row);
        }
        for (const row of accountNicheLeaders) {
            if (!bestNicheByAccount.has(row.accountId)) bestNicheByAccount.set(row.accountId, row);
        }
        for (const task of tasksAll || []) {
            if (!task.accountId) continue;
            if (hideWarming && warmingIds.has(task.accountId)) continue;
            const stamp = task.postedAt || task.date || '';
            if (!stamp) continue;
            const previous = lastPostByAccount.get(task.accountId);
            if (!previous || stamp > previous) lastPostByAccount.set(task.accountId, stamp);
        }

        const rows = [];
        for (const model of leaderboard) {
            for (const ranking of model.metrics?.accountRankings || []) {
                const account = accountsById.get(ranking.id);
                if (!account) continue;

                const status = String(account.status || '').toLowerCase();
                const shadow = String(account.shadowBanStatus || '').toLowerCase();
                const isDead = status === 'dead'
                    || status === 'burned'
                    || account.isSuspended
                    || shadow === 'shadow_banned'
                    || shadow === 'suspended';
                if (isDead) continue;
                if (hideWarming && warmingIds.has(account.id)) continue;

                const healthScore = AnalyticsEngine.computeAccountHealthScore(account);
                const profileScore = AnalyticsEngine.computeProfileScore(account);
                const signalScore = Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(
                            Math.min(45, ranking.avgUpsPerPost * 0.45)
                            + Math.min(20, ranking.totalPosts * 2)
                            + Math.min(20, (100 - ranking.removalRate) * 0.2)
                            + Math.min(15, healthScore * 0.15)
                            + Math.min(10, profileScore * 0.1)
                        )
                    )
                );

                rows.push({
                    ...ranking,
                    modelName: model.name,
                    signalScore,
                    healthScore,
                    profileScore,
                    bestSubreddit: bestSubByAccount.get(account.id)?.subredditName || 'No winner yet',
                    bestNiche: bestNicheByAccount.get(account.id)?.niche || 'No niche data',
                    lastPost: lastPostByAccount.get(account.id) || '',
                });
            }
        }

        return rows.sort((a, b) => {
            if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
            if (b.avgUpsPerPost !== a.avgUpsPerPost) return b.avgUpsPerPost - a.avgUpsPerPost;
            return b.totalUps - a.totalUps;
        }).slice(0, 12);
    })();

    const hottestAccount = accountFlightDeck[0] || null;
    const hottestSubreddit = accountSubredditLeaders[0] || null;
    const hottestNiche = accountNicheLeaders[0] || null;

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
                    onClick={() => setHideWarming(h => !h)}
                    className="btn btn-outline"
                    style={{ padding: '6px 12px', fontSize: '0.75rem', backgroundColor: hideWarming ? '#6366f122' : 'transparent', borderColor: hideWarming ? '#6366f1' : undefined }}
                >
                    {hideWarming ? 'Warming Hidden' : 'Showing All'}
                </button>
            </header>

            <div className="page-content">
                <section className="dashboard-hero" style={{ marginBottom: '20px' }}>
                    <div>
                        <div className="subtle-kicker">Growth Radar</div>
                        <h2 style={{ fontSize: '2rem', lineHeight: 1.02, marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
                            See what is winning, what is slipping, and where to scale next.
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', maxWidth: '62ch' }}>
                            This view is now account-first: performance, removals, best subreddit lanes, and best niche patterns all in one place.
                        </p>
                    </div>
                    <div className="dashboard-hero__grid">
                        <div className="glass-panel">
                            <div className="subtle-kicker">Hottest Account</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <Trophy size={16} color="var(--status-success)" />
                                <strong>{hottestAccount ? hottestAccount.handle : 'No ranking yet'}</strong>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                {hottestAccount ? `${hottestAccount.avgUpsPerPost} avg views | ${hottestAccount.bestSubreddit}` : 'Sync performance to unlock rankings'}
                            </div>
                        </div>
                        <div className="glass-panel">
                            <div className="subtle-kicker">Winning Subreddit Pair</div>
                            <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                                {hottestSubreddit ? `${hottestSubreddit.accountHandle} x r/${hottestSubreddit.subredditName}` : 'No winner yet'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                {hottestSubreddit ? `${hottestSubreddit.avgUps} avg views | ${hottestSubreddit.posts} posts tested` : 'Need more synced posts'}
                            </div>
                        </div>
                        <div className="glass-panel">
                            <div className="subtle-kicker">Winning Niche Pair</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <Sparkles size={16} color="var(--status-info)" />
                                <strong>{hottestNiche ? `${hottestNiche.accountHandle} x ${hottestNiche.niche}` : 'No niche data yet'}</strong>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                {hottestNiche ? `${hottestNiche.avgUps} avg views | ${hottestNiche.removalPct}% removal` : 'Tag more assets to reveal patterns'}
                            </div>
                        </div>
                    </div>
                </section>

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
                            {totalAccounts}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {activeAccounts} active | {totalModels} model{totalModels !== 1 ? 's' : ''}
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
                        <div style={{ fontSize: '0.8rem', marginTop: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {healthCounts.warning > 0 && <span style={{ color: '#ff9800' }}>{healthCounts.warning} warning</span>}
                            {healthCounts.critical > 0 && <span style={{ color: '#f44336' }}>{healthCounts.critical} critical</span>}
                            {healthCounts.burned > 0 && <span style={{ color: '#9e9e9e' }}>{healthCounts.burned} burned</span>}
                            {healthCounts.warning === 0 && healthCounts.critical === 0 && healthCounts.burned === 0 && <span style={{ color: 'var(--text-secondary)' }}>All accounts healthy</span>}
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
                            {agencyRemovalRate > 20 ? 'High risk - review subs' : agencyRemovalRate > 10 ? 'Monitor closely' : 'Looking good'}
                        </div>
                    </div>
                </div>

                <ManagerActionItems accounts={filteredAccounts} />

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

                {accountFlightDeck.length > 0 && (
                    <div className="card" style={{ marginBottom: '20px' }}>
                        <div className="section-heading">
                            <div>
                                <div className="subtle-kicker">Account Performance</div>
                                <h2 style={{ fontSize: '1.1rem' }}>Account Flight Deck</h2>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                Click into an account to see what is winning and what is not.
                            </div>
                        </div>
                        <div className="data-table-container" style={{ marginTop: '14px' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Account</th>
                                        <th>Model</th>
                                        <th>Signal</th>
                                        <th>Posts</th>
                                        <th>Avg / Post</th>
                                        <th>Removal</th>
                                        <th>Best Sub</th>
                                        <th>Best Niche</th>
                                        <th>Last Post</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountFlightDeck.map((row, index) => (
                                        <tr key={row.id}>
                                            <td style={{ fontWeight: 700, color: index === 0 ? '#f59e0b' : 'var(--text-secondary)' }}>{index + 1}</td>
                                            <td>
                                                <Link to={`/account/${row.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>
                                                    {row.handle}
                                                </Link>
                                            </td>
                                            <td>{row.modelName}</td>
                                            <td>
                                                <span className="badge" style={{
                                                    backgroundColor: row.signalScore >= 75 ? 'var(--status-success-bg)' : row.signalScore >= 55 ? 'var(--status-warning-bg)' : 'var(--status-danger-bg)',
                                                    color: row.signalScore >= 75 ? 'var(--status-success)' : row.signalScore >= 55 ? 'var(--status-warning)' : 'var(--status-danger)',
                                                }}>
                                                    {row.signalScore}
                                                </span>
                                            </td>
                                            <td>{row.totalPosts}</td>
                                            <td style={{ fontWeight: 600 }}>{row.avgUpsPerPost.toLocaleString()}</td>
                                            <td style={{ color: row.removalRate > 20 ? 'var(--status-danger)' : row.removalRate > 10 ? 'var(--status-warning)' : 'var(--status-success)' }}>
                                                {row.removalRate}%
                                            </td>
                                            <td>r/{row.bestSubreddit}</td>
                                            <td><span className="badge badge-info">{row.bestNiche}</span></td>
                                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                                {row.lastPost ? new Date(row.lastPost).toLocaleDateString() : 'Never'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
                                                {m.tasksCompleted === 0
                                                    ? <span className="badge" style={{ backgroundColor: 'var(--surface-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>New</span>
                                                    : ms.status === 'critical'
                                                        ? <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><XCircle size={12} /> Risky</span>
                                                        : ms.status === 'healthy'
                                                            ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> Healthy</span>
                                                            : <span className="badge badge-warning">Watch</span>
                                                }
                                                {m.tasksCompleted > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Score {ms.healthScore}</div>}
                                            </td>
                                            <td>
                                                <Link to="/models" className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                                                    Open Models
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
                                                <Link to={`/account/${row.accountId}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
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
                                                <Link to="/accounts" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
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
                        if (hideWarming && warmingIds.has(t.accountId)) continue;
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

                {/* VA Leaderboard */}
                {(() => {
                    if (!tasksAll || tasksAll.length === 0) return null;
                    const closedTasks = tasksAll.filter(t => (t.status === 'closed' || t.status === 'failed') && t.vaName && !(hideWarming && warmingIds.has(t.accountId)));
                    if (closedTasks.length === 0) return null;

                    const vaMap = new Map();
                    const perfMap = new Map();
                    (performancesAll || []).forEach(p => perfMap.set(p.taskId, p));

                    closedTasks.forEach(t => {
                        const name = t.vaName;
                        if (!vaMap.has(name)) vaMap.set(name, { posts: 0, failed: 0, removed: 0, totalViews: 0, firstPost: t.postedAt || '', lastPost: t.postedAt || '' });
                        const s = vaMap.get(name);
                        if (t.status === 'closed') {
                            s.posts++;
                            const perf = perfMap.get(t.id);
                            if (perf) {
                                s.totalViews += (perf.views24h || 0);
                                if (perf.removed) s.removed++;
                            }
                        } else {
                            s.failed++;
                        }
                        if (t.postedAt) {
                            if (!s.firstPost || t.postedAt < s.firstPost) s.firstPost = t.postedAt;
                            if (!s.lastPost || t.postedAt > s.lastPost) s.lastPost = t.postedAt;
                        }
                    });

                    const ranked = Array.from(vaMap.entries())
                        .map(([name, s]) => ({
                            name,
                            posts: s.posts,
                            failed: s.failed,
                            removed: s.removed,
                            totalViews: s.totalViews,
                            avgViews: s.posts > 0 ? Math.round(s.totalViews / s.posts) : 0,
                            removalPct: s.posts > 0 ? Math.round((s.removed / s.posts) * 100) : 0,
                            lastPost: s.lastPost,
                        }))
                        .sort((a, b) => b.posts - a.posts);

                    return (
                        <div className="card" style={{ marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.05rem', marginBottom: '10px', fontWeight: 600 }}>VA Leaderboard</h2>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>VA Name</th>
                                            <th>Posts</th>
                                            <th>Failed</th>
                                            <th>Removed</th>
                                            <th>Removal %</th>
                                            <th>Avg Views</th>
                                            <th>Total Views</th>
                                            <th>Last Active</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ranked.map((va, i) => (
                                            <tr key={va.name}>
                                                <td style={{ fontWeight: 700, color: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : 'var(--text-secondary)' }}>{i + 1}</td>
                                                <td style={{ fontWeight: 600 }}>{va.name}</td>
                                                <td style={{ fontWeight: 600, color: 'var(--primary-color)' }}>{va.posts}</td>
                                                <td style={{ color: va.failed > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{va.failed}</td>
                                                <td style={{ color: va.removed > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{va.removed}</td>
                                                <td>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: va.removalPct > 30 ? '#ef444422' : va.removalPct > 15 ? '#fbbf2422' : '#10b98122', color: va.removalPct > 30 ? '#ef4444' : va.removalPct > 15 ? '#fbbf24' : '#10b981' }}>
                                                        {va.removalPct}%
                                                    </span>
                                                </td>
                                                <td>{va.avgViews.toLocaleString()}</td>
                                                <td>{va.totalViews.toLocaleString()}</td>
                                                <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{va.lastPost ? new Date(va.lastPost).toLocaleDateString() : '--'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })()}

                {/* Full Sync + Cloud Backup */}
                <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-secondary)' }}>Sync &amp; Backup</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                                className="btn btn-primary"
                                disabled={syncing}
                                onClick={async () => {
                                    setSyncing(true);
                                    const parts = [];
                                    try {
                                        const { CloudSyncService, AccountLifecycleService, AccountSyncService, PerformanceSyncService, SnapshotService } = await import('../services/growthEngine');

                                        // 1. Acquire lock
                                        const locked = await CloudSyncService.acquireLock({ waitMs: 12000, pollMs: 300 });
                                        if (!locked) { alert('Sync already running. Try again in a moment.'); return; }

                                        try {
                                            // 2. Cloud Pull
                                            try {
                                                const enabled = await CloudSyncService.isEnabled();
                                                if (enabled) {
                                                    await CloudSyncService.pullCloudToLocal();
                                                    parts.push('Cloud pull complete');
                                                }
                                            } catch (e) { parts.push('Cloud pull failed: ' + e.message); }

                                            // 3. Evaluate Phases
                                            try {
                                                await AccountLifecycleService.evaluateAccountPhases();
                                                parts.push('Phases evaluated');
                                            } catch (e) { parts.push('Phase eval failed: ' + e.message); }

                                            // 4. Sync Account Health (Reddit)
                                            try {
                                                const syncResult = await AccountSyncService.syncAllAccounts();
                                                const syncSummary = [
                                                    `${syncResult?.succeeded ?? 0} synced`,
                                                    `${syncResult?.failed ?? 0} failed`,
                                                ];
                                                if ((syncResult?.retired ?? 0) > 0) {
                                                    syncSummary.push(`${syncResult.retired} marked dead`);
                                                }
                                                if ((syncResult?.skippedDead ?? 0) > 0) {
                                                    syncSummary.push(`${syncResult.skippedDead} dead skipped`);
                                                }
                                                if ((syncResult?.deduped ?? 0) > 0) {
                                                    syncSummary.push(`${syncResult.deduped} duplicate${syncResult.deduped === 1 ? '' : 's'} merged`);
                                                }
                                                parts.push(`Account sync: ${syncSummary.join(', ')}`);
                                                if ((syncResult?.retiredHandles || []).length > 0) {
                                                    parts.push(`Marked dead: ${syncResult.retiredHandles.join(', ')}`);
                                                }
                                                if ((syncResult?.failedHandles || []).length > 0) {
                                                    parts.push(`Failed handles: ${syncResult.failedHandles.join(', ')}`);
                                                }
                                                // Re-evaluate phases after sync
                                                await AccountLifecycleService.evaluateAccountPhases();
                                            } catch (e) { parts.push('Account sync failed: ' + e.message); }

                                            // 5. Sync Post Performance
                                            try {
                                                const perfResult = await PerformanceSyncService.syncAllPendingPerformance();
                                                parts.push(`Perf sync: ${perfResult?.succeeded ?? 0} synced`);
                                            } catch (e) { parts.push('Perf sync failed: ' + e.message); }

                                            // 6. Take Snapshot
                                            try {
                                                await SnapshotService.takeDailySnapshot();
                                                parts.push('Snapshot taken');
                                            } catch (e) { parts.push('Snapshot failed: ' + e.message); }

                                            // 7. Cloud Push
                                            try {
                                                const enabled = await CloudSyncService.isEnabled();
                                                if (enabled) {
                                                    await CloudSyncService.pushLocalToCloud();
                                                    parts.push('Cloud push complete');
                                                }
                                            } catch (e) { parts.push('Cloud push failed: ' + e.message); }
                                        } finally {
                                            await CloudSyncService.releaseLock();
                                        }
                                    } catch (e) {
                                        parts.push('Sync error: ' + e.message);
                                    } finally {
                                        setSyncing(false);
                                    }
                                    alert(parts.join('\n'));
                                }}
                                style={{ padding: '4px 14px', fontSize: '0.8rem' }}
                            >
                                <RefreshCcw size={12} style={{ marginRight: '4px' }} className={syncing ? 'spin' : ''} />
                                {syncing ? 'Syncing...' : 'Sync All'}
                            </button>
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

