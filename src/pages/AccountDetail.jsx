import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    ArrowLeft,
    CheckCircle,
    ExternalLink,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Trophy,
    XCircle,
    AlertTriangle,
} from 'lucide-react';
import { db } from '../db/db';
import { AnalyticsEngine, AccountSyncService, CloudSyncService } from '../services/growthEngine';

const PROFILE_CHECKS = [
    { key: 'hasAvatar', label: 'Custom avatar', points: 15 },
    { key: 'hasBanner', label: 'Profile banner', points: 10 },
    { key: 'hasBio', label: 'Bio / description', points: 15 },
    { key: 'hasDisplayName', label: 'Display name', points: 10 },
    { key: 'hasVerifiedEmail', label: 'Verified email', points: 10 },
    { key: 'hasProfileLink', label: 'Deep link in bio', points: 10 },
];

function statusTone(account) {
    const shadow = String(account?.shadowBanStatus || '').toLowerCase();
    if (account?.isSuspended || shadow === 'suspended') {
        return { label: 'Suspended', className: 'badge badge-danger' };
    }
    if (String(account?.status || '').toLowerCase() === 'dead' || shadow === 'shadow_banned') {
        return { label: 'Burned', className: 'badge badge-danger' };
    }
    return { label: 'Operational', className: 'badge badge-success' };
}

function scoreTone(score) {
    if (score >= 80) return 'var(--status-success)';
    if (score >= 50) return 'var(--status-warning)';
    return 'var(--status-danger)';
}

function formatDay(value) {
    if (!value) return 'Never';
    return new Date(value).toLocaleDateString();
}

export function AccountDetail() {
    const { id } = useParams();
    const accountId = Number(id);
    const [insights, setInsights] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [checkingShadow, setCheckingShadow] = useState(false);

    const account = useLiveQuery(() => db.accounts.get(accountId), [accountId]);
    const model = useLiveQuery(() => {
        if (!account?.modelId) return null;
        return db.models.get(account.modelId);
    }, [account?.modelId]);
    const analyticsTrigger = useLiveQuery(async () => {
        if (!accountId) return '';
        const tasks = await db.tasks.filter((task) => Number(task.accountId) === Number(accountId)).toArray();
        const taskIds = tasks.map((task) => task.id);
        const perfs = taskIds.length > 0
            ? await db.performances.where('taskId').anyOf(taskIds).toArray()
            : [];
        return `${tasks.map((task) => `${task.id}:${task.status}:${task.postedAt || task.date || ''}`).join('|')}::${perfs.map((perf) => `${perf.taskId}:${perf.views24h || 0}:${perf.removed ? 1 : 0}`).join('|')}`;
    }, [accountId]);

    useEffect(() => {
        let cancelled = false;

        async function loadInsights() {
            if (!account?.modelId || !accountId) return;
            setLoading(true);

            const metrics = await AnalyticsEngine.getMetrics(account.modelId, 90, accountId);
            const taskRows = await db.tasks
                .filter((task) => Number(task.accountId) === Number(accountId) && (task.status === 'closed' || task.status === 'failed'))
                .toArray();
            const perfMap = new Map();
            if (taskRows.length > 0) {
                const perfs = await db.performances.where('taskId').anyOf(taskRows.map((task) => task.id)).toArray();
                perfs.forEach((perf) => perfMap.set(perf.taskId, perf));
            }

            const assetIds = [...new Set(taskRows.map((task) => task.assetId).filter(Boolean))];
            const assets = assetIds.length > 0 ? await db.assets.where('id').anyOf(assetIds).toArray() : [];
            const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

            const recentPosts = taskRows
                .slice()
                .sort((a, b) => String(b.postedAt || b.date || '').localeCompare(String(a.postedAt || a.date || '')))
                .slice(0, 12)
                .map((task) => {
                    const perf = perfMap.get(task.id);
                    const asset = assetMap.get(task.assetId);
                    const subredditName = task.redditUrl?.match(/\/r\/([^/]+)/i)?.[1]
                        || task.title?.match(/\br\/([A-Za-z0-9_]+)/)?.[1]
                        || 'unknown';
                    return {
                        id: task.id,
                        title: task.title || 'Untitled task',
                        date: task.postedAt || task.date || '',
                        subreddit: subredditName,
                        url: task.redditUrl || '',
                        views: Number(perf?.views24h || 0),
                        removed: !!perf?.removed,
                        niche: asset?.angleTag || 'general',
                    };
                });

            if (!cancelled) {
                setInsights({
                    ...metrics,
                    bestSubreddit: metrics.topSubreddits?.[0] || null,
                    bestNiche: metrics.nichePerformance?.[0] || null,
                    bestAsset: metrics.topAssets?.[0] || null,
                    recentPosts,
                });
                setLoading(false);
            }
        }

        loadInsights().catch((err) => {
            console.error('[AccountDetail] Failed loading insights:', err);
            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [account?.modelId, accountId, analyticsTrigger]);

    if (account === undefined || loading) {
        return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading account...</div>;
    }

    if (!account) {
        return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Account not found.</div>;
    }

    const handle = String(account.handle || '').replace(/^u\//i, '');
    const profileScore = AnalyticsEngine.computeProfileScore(account);
    const healthBreakdown = AnalyticsEngine.computeAccountHealthBreakdown(account);
    const healthScore = healthBreakdown.score;
    const profileColor = scoreTone(profileScore);
    const healthColor = scoreTone(healthScore);
    const tone = statusTone(account);
    const ageDays = account.createdUtc
        ? Math.floor((Date.now() - Number(account.createdUtc) * 1000) / 86400000)
        : 0;

    async function handleToggleProfileField(field, currentValue) {
        await db.accounts.update(accountId, { [field]: currentValue ? 0 : 1 });
        try {
            await CloudSyncService.autoPush(['accounts']);
        } catch (err) {
            console.warn('[AccountDetail] Profile toggle sync failed:', err.message);
        }
    }

    return (
        <>
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    <Link to="/accounts" className="btn btn-outline">
                        <ArrowLeft size={14} />
                        Back to Accounts
                    </Link>
                    <div>
                        <div className="subtle-kicker">Account Flight Deck</div>
                        <h1 className="page-title" style={{ marginTop: '4px' }}>u/{handle}</h1>
                    </div>
                    <span className={tone.className}>{tone.label}</span>
                    {account.shadowBanStatus && account.shadowBanStatus !== 'clean' && (
                        <span className="badge badge-warning">{String(account.shadowBanStatus).replace(/_/g, ' ')}</span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <a href={`https://reddit.com/user/${handle}`} target="_blank" rel="noreferrer" className="btn btn-outline">
                        <ExternalLink size={14} />
                        Open Reddit
                    </a>
                    <button
                        className="btn btn-outline"
                        disabled={refreshing}
                        onClick={async () => {
                            setRefreshing(true);
                            try {
                                const result = await AccountSyncService.syncAccountHealth(accountId);
                                const fresh = await db.accounts.get(accountId);
                                if (!result) {
                                    alert(`Sync failed.\n${fresh?.lastSyncError || 'Unknown scrape error'}`);
                                } else if (result.outcome === 'dead_marked') {
                                    alert(`Marked dead during sync.\nReason: ${fresh?.deadReason || fresh?.shadowBanStatus || 'missing_from_reddit'}`);
                                } else {
                                    alert(`Sync complete for u/${handle}.`);
                                }
                            } catch (err) {
                                alert(`Sync failed: ${err.message}`);
                            }
                            setRefreshing(false);
                        }}
                    >
                        <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
                        {refreshing ? 'Syncing...' : 'Sync Stats'}
                    </button>
                    <button
                        className="btn btn-outline"
                        disabled={checkingShadow}
                        onClick={async () => {
                            setCheckingShadow(true);
                            try {
                                const result = await AccountSyncService.checkShadowBan(accountId);
                                const labels = {
                                    clean: 'Clean - no shadow ban detected.',
                                    shadow_banned: 'Shadow-ban detected. Account moved to burned.',
                                    suspended: 'Account is suspended.',
                                    error: 'Shadow-ban check failed.',
                                };
                                alert(labels[result] || result);
                            } catch (err) {
                                alert(`Shadow check failed: ${err.message}`);
                            }
                            setCheckingShadow(false);
                        }}
                    >
                        <ShieldCheck size={14} className={checkingShadow ? 'spinning' : ''} />
                        {checkingShadow ? 'Checking...' : 'Check Shadow Ban'}
                    </button>
                </div>
            </header>

            <div className="page-content page-stack">
                <section className="dashboard-hero" style={{ marginBottom: '24px' }}>
                    <div>
                        <div className="subtle-kicker">Winning Summary</div>
                        <h2 style={{ fontSize: '1.95rem', lineHeight: 1.05, marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
                            {insights?.bestSubreddit
                                ? `Best lane: r/${insights.bestSubreddit.name} is carrying this account.`
                                : 'This account needs more synced post data to rank cleanly.'}
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', maxWidth: '62ch' }}>
                            Use this page to decide whether to scale the handle, repair the profile, or cut weak posting angles.
                        </p>
                    </div>
                    <div className="dashboard-hero__grid">
                        <div className="glass-panel">
                            <div className="subtle-kicker">Model</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{model?.name || 'Unassigned'}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '6px' }}>
                                {ageDays > 0 ? `${ageDays} days old` : 'Age not synced yet'}
                            </div>
                        </div>
                        <div className="glass-panel">
                            <div className="subtle-kicker">Best Subreddit</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                                {insights?.bestSubreddit ? `r/${insights.bestSubreddit.name}` : 'No winner yet'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '6px' }}>
                                {insights?.bestSubreddit ? `${insights.bestSubreddit.avgViews} avg views | ${insights.bestSubreddit.removalPct}% removal` : 'Run more synced posts'}
                            </div>
                        </div>
                        <div className="glass-panel">
                            <div className="subtle-kicker">Best Niche</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                                {insights?.bestNiche ? insights.bestNiche.tag : 'No niche data'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '6px' }}>
                                {insights?.bestNiche ? `${insights.bestNiche.avgViews} avg views | ${insights.bestNiche.removalRate}% removal` : 'Sync more assets'}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="dashboard-metric-grid" style={{ marginBottom: '24px' }}>
                    <div className="metric-card metric-card--accent">
                        <div className="metric-label">Health Score</div>
                        <div className="metric-value" style={{ color: healthColor }}>{healthScore}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Posting readiness + safety</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Profile Score</div>
                        <div className="metric-value" style={{ color: profileColor }}>{profileScore}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>How complete the profile looks</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Total Views</div>
                        <div className="metric-value">{(insights?.totalViews || 0).toLocaleString()}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{insights?.tasksCompleted || 0} synced posts</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Avg / Post</div>
                        <div className="metric-value">{(insights?.avgViewsPerPost || 0).toLocaleString()}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Current view efficiency</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Removal Rate</div>
                        <div className="metric-value" style={{ color: scoreTone(100 - Number(insights?.removalRatePct || 0)) }}>
                            {insights?.removalRatePct || 0}%
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{insights?.removedCount || 0} removals</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Karma</div>
                        <div className="metric-value">{(account.totalKarma || 0).toLocaleString()}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Profile trust signal</div>
                    </div>
                </section>

                <section className="card" style={{ marginBottom: '24px' }}>
                    <div className="section-heading">
                        <div>
                            <div className="subtle-kicker">Operating Readout</div>
                            <h2 style={{ fontSize: '1.1rem' }}>Why this account scores the way it does</h2>
                        </div>
                        <div style={{ color: healthColor, fontWeight: 700 }}>{healthBreakdown.status}</div>
                    </div>
                    <div className="glass-panel" style={{ marginTop: '14px', marginBottom: '14px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '6px' }}>Next move</div>
                        <div style={{ color: 'var(--text-secondary)' }}>{healthBreakdown.nextAction}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                        {healthBreakdown.components.slice(0, 6).map((item) => (
                            <div key={`${item.label}-${item.detail}`} className="glass-panel">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                                    <strong style={{ fontSize: '0.88rem' }}>{item.label}</strong>
                                    <span style={{ fontWeight: 700, color: item.delta >= 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
                                        {item.delta >= 0 ? `+${item.delta}` : item.delta}
                                    </span>
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{item.detail}</div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="spotlight-grid" style={{ marginBottom: '24px' }}>
                    <div className="card">
                        <div className="section-heading">
                            <div>
                                <div className="subtle-kicker">Profile Audit</div>
                                <h2 style={{ fontSize: '1.1rem' }}>Fix what blocks scaling</h2>
                            </div>
                            <div style={{ color: profileColor, fontWeight: 700 }}>{profileScore}/100</div>
                        </div>
                        <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
                            {PROFILE_CHECKS.map((item) => {
                                const done = !!account[item.key];
                                return (
                                    <label key={item.key} className="activity-row" style={{ justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {done ? <CheckCircle size={16} color="var(--status-success)" /> : <XCircle size={16} color="var(--text-muted)" />}
                                            <span style={{ color: done ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{item.label}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>+{item.points}</span>
                                            <input
                                                type="checkbox"
                                                checked={done}
                                                onChange={() => handleToggleProfileField(item.key, done)}
                                                style={{ accentColor: 'var(--accent-primary)' }}
                                            />
                                        </div>
                                    </label>
                                );
                            })}
                            <div className="activity-row" style={{ justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {ageDays >= 15 ? <CheckCircle size={16} color="var(--status-success)" /> : <XCircle size={16} color="var(--text-muted)" />}
                                    <span>Account age 15+ days</span>
                                </div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>+15</span>
                            </div>
                            <div className="activity-row" style={{ justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {Number(account.totalKarma || 0) >= 100 ? <CheckCircle size={16} color="var(--status-success)" /> : <XCircle size={16} color="var(--text-muted)" />}
                                    <span>Karma 100+</span>
                                </div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>+15</span>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="section-heading">
                            <div>
                                <div className="subtle-kicker">Winning Signals</div>
                                <h2 style={{ fontSize: '1.1rem' }}>What is actually working</h2>
                            </div>
                            <Sparkles size={16} color="var(--accent-primary)" />
                        </div>
                        <div style={{ display: 'grid', gap: '12px', marginTop: '14px' }}>
                            <div className="glass-panel">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <Trophy size={15} color="var(--status-success)" />
                                    <strong>Best subreddit</strong>
                                </div>
                                <div>{insights?.bestSubreddit ? `r/${insights.bestSubreddit.name}` : 'No clear winner yet'}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                                    {insights?.bestSubreddit ? `${insights.bestSubreddit.avgViews} avg views over ${insights.bestSubreddit.totalTests} posts` : 'Need more synced performance data'}
                                </div>
                            </div>
                            <div className="glass-panel">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <Sparkles size={15} color="var(--status-info)" />
                                    <strong>Best niche</strong>
                                </div>
                                <div>{insights?.bestNiche ? insights.bestNiche.tag : 'No asset pattern yet'}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                                    {insights?.bestNiche ? `${insights.bestNiche.avgViews} avg views | ${insights.bestNiche.totalViews} total views` : 'Need more posts with tagged assets'}
                                </div>
                            </div>
                            <div className="glass-panel">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <ExternalLink size={15} color="var(--accent-primary)" />
                                    <strong>Strongest asset</strong>
                                </div>
                                <div>{insights?.bestAsset ? (insights.bestAsset.fileName || insights.bestAsset.angleTag) : 'No asset data yet'}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                                    {insights?.bestAsset ? `${insights.bestAsset.avgViews} avg views | ${insights.bestAsset.posts} posts` : 'Need synced asset history'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="section-heading">
                            <div>
                                <div className="subtle-kicker">Risk Signals</div>
                                <h2 style={{ fontSize: '1.1rem' }}>What is not working</h2>
                            </div>
                            <AlertTriangle size={16} color="var(--status-warning)" />
                        </div>
                        {insights?.worstSubreddits?.length ? (
                            <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
                                {insights.worstSubreddits.slice(0, 4).map((sub) => (
                                    <div key={sub.name} className="activity-row" style={{ justifyContent: 'space-between' }}>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>r/{sub.name}</div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{sub.totalTests} tests | {sub.avgUps} avg views</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ color: 'var(--status-danger)', fontWeight: 700 }}>{sub.removalPct}%</div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{sub.action}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', marginTop: '14px' }}>
                                No meaningful weak subreddit pattern yet. Keep testing and syncing.
                            </div>
                        )}
                    </div>
                </section>

                <section className="card">
                    <div className="section-heading">
                        <div>
                            <div className="subtle-kicker">Execution Trail</div>
                            <h2 style={{ fontSize: '1.1rem' }}>Recent post outcomes</h2>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            Last {insights?.recentPosts?.length || 0} synced tasks
                        </div>
                    </div>
                    {(!insights?.recentPosts || insights.recentPosts.length === 0) ? (
                        <div style={{ color: 'var(--text-secondary)', paddingTop: '14px' }}>No recent posts yet.</div>
                    ) : (
                        <div className="data-table-container" style={{ marginTop: '14px' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Subreddit</th>
                                        <th>Title</th>
                                        <th>Niche</th>
                                        <th>Views</th>
                                        <th>Status</th>
                                        <th>Link</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {insights.recentPosts.map((post) => (
                                        <tr key={post.id}>
                                            <td>{formatDay(post.date)}</td>
                                            <td>r/{post.subreddit}</td>
                                            <td style={{ maxWidth: '260px' }}>
                                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={post.title}>
                                                    {post.title}
                                                </div>
                                            </td>
                                            <td><span className="badge badge-info">{post.niche}</span></td>
                                            <td style={{ fontWeight: 600 }}>{post.views.toLocaleString()}</td>
                                            <td>
                                                <span className={post.removed ? 'badge badge-danger' : 'badge badge-success'}>
                                                    {post.removed ? 'Removed' : 'Live'}
                                                </span>
                                            </td>
                                            <td>
                                                {post.url ? (
                                                    <a href={post.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>
                                                        Open
                                                    </a>
                                                ) : '--'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </>
    );
}

