import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, User, CheckCircle, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

export function AccountDetail() {
    const { id } = useParams();
    const accountId = Number(id);
    const [stats, setStats] = useState(null);

    const account = useLiveQuery(() => db.accounts.get(accountId), [accountId]);
    const model = useLiveQuery(
        () => account ? db.models.get(account.modelId) : null,
        [account]
    );

    useEffect(() => {
        async function buildStats() {
            if (!accountId) return;
            const acc = await db.accounts.get(accountId);
            if (!acc) return;

            // Get all closed tasks for this account
            const tasks = await db.tasks
                .where('modelId').equals(acc.modelId)
                .filter(t => t.accountId === accountId && t.status === 'closed')
                .toArray();

            // Get performances for those tasks
            const subBreakdown = {};
            let totalUps = 0;
            let removedCount = 0;
            let syncedPosts = 0;
            const recentPosts = [];

            for (const task of tasks) {
                const perf = await db.performances.where('taskId').equals(task.id).first();
                const ups = perf?.views24h || 0;
                const removed = perf?.removed ? true : false;

                if (perf) {
                    totalUps += ups;
                    if (removed) removedCount++;
                    syncedPosts++;
                }

                // Extract subreddit from URL
                let subName = 'Unknown';
                if (task.redditUrl) {
                    const match = task.redditUrl.match(/\/r\/([^\/]+)/i);
                    if (match) subName = match[1];
                }

                // Build per-sub breakdown
                if (!subBreakdown[subName]) {
                    subBreakdown[subName] = { posts: 0, ups: 0, removed: 0 };
                }
                subBreakdown[subName].posts++;
                subBreakdown[subName].ups += ups;
                if (removed) subBreakdown[subName].removed++;

                // Build recent posts list
                recentPosts.push({
                    id: task.id,
                    subreddit: subName,
                    date: task.date,
                    url: task.redditUrl,
                    ups,
                    removed,
                    removedCategory: perf?.notes || ''
                });
            }

            // Convert sub breakdown to sorted array
            const subreddits = Object.entries(subBreakdown)
                .map(([name, data]) => ({
                    name,
                    posts: data.posts,
                    totalUps: data.ups,
                    avgUps: data.posts > 0 ? Math.round(data.ups / data.posts) : 0,
                    removalRate: data.posts > 0 ? Number(((data.removed / data.posts) * 100).toFixed(1)) : 0
                }))
                .sort((a, b) => b.totalUps - a.totalUps);

            // Sort posts by date desc
            recentPosts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

            setStats({
                totalPosts: tasks.length,
                totalUps,
                syncedPosts,
                avgUpsPerPost: syncedPosts > 0 ? Math.round(totalUps / syncedPosts) : 0,
                removalRate: syncedPosts > 0 ? Number(((removedCount / syncedPosts) * 100).toFixed(1)) : 0,
                removedCount,
                subreddits,
                recentPosts
            });
        }
        buildStats();
    }, [accountId]);

    if (!account) return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading account...</div>;

    return (
        <>
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <Link to={model ? `/model/${model.id}` : '/'} className="btn btn-outline" style={{ padding: '6px 12px' }}>
                        <ArrowLeft size={14} style={{ marginRight: '4px' }} /> {model?.name || 'Back'}
                    </Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <User size={20} style={{ color: 'var(--primary-color)' }} />
                        <h1 className="page-title">u/{account.handle?.replace(/^u\//i, '')}</h1>
                        {account.isSuspended ? (
                            <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <XCircle size={10} /> Suspended
                            </span>
                        ) : (
                            <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <CheckCircle size={10} /> Active
                            </span>
                        )}
                    </div>
                </div>
            </header>

            <div className="page-content">

                {/* KPI Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '24px' }}>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Karma</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: '700' }}>{(account.totalKarma || 0).toLocaleString()}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Total Upvotes</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: '700', color: 'var(--primary-color)' }}>{(stats?.totalUps || 0).toLocaleString()}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Posts</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: '700' }}>{stats?.totalPosts || 0}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Avg / Post</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: '700' }}>{stats?.avgUpsPerPost || 0}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Removal Rate</div>
                        <div style={{
                            fontSize: '1.6rem', fontWeight: '700',
                            color: (stats?.removalRate || 0) > 20 ? 'var(--status-danger)' : 'var(--status-success)'
                        }}>{stats?.removalRate || 0}%</div>
                    </div>
                </div>

                {/* Subreddit Breakdown for THIS account */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: '600' }}>Subreddits This Account Posts To</h2>
                    {(!stats?.subreddits || stats.subreddits.length === 0) ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>No posts yet</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Subreddit</th>
                                        <th>Posts</th>
                                        <th>Total Ups</th>
                                        <th>Avg / Post</th>
                                        <th>Removal %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.subreddits.map(sub => (
                                        <tr key={sub.name}>
                                            <td style={{ fontWeight: '500' }}>
                                                <a href={`https://reddit.com/r/${sub.name}`} target="_blank" rel="noreferrer"
                                                    style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                    r/{sub.name}
                                                </a>
                                            </td>
                                            <td>{sub.posts}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--primary-color)' }}>{sub.totalUps}</td>
                                            <td>{sub.avgUps}</td>
                                            <td style={{
                                                color: sub.removalRate > 30 ? 'var(--status-danger)' : sub.removalRate > 10 ? 'var(--status-warning)' : 'var(--status-success)'
                                            }}>{sub.removalRate}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Recent Posts */}
                <div className="card">
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: '600' }}>Recent Posts</h2>
                    {(!stats?.recentPosts || stats.recentPosts.length === 0) ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>No posts yet</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Subreddit</th>
                                        <th>Upvotes</th>
                                        <th>Status</th>
                                        <th>Link</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.recentPosts.map(post => (
                                        <tr key={post.id}>
                                            <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                {post.date ? new Date(post.date).toLocaleDateString() : '—'}
                                            </td>
                                            <td style={{ fontWeight: '500' }}>r/{post.subreddit}</td>
                                            <td style={{ fontWeight: '600' }}>{post.ups}</td>
                                            <td>
                                                {post.removed ? (
                                                    <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <XCircle size={10} /> Removed
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <CheckCircle size={10} /> Live
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                {post.url ? (
                                                    <a href={post.url} target="_blank" rel="noreferrer"
                                                        style={{ color: 'var(--primary-color)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <ExternalLink size={12} /> View
                                                    </a>
                                                ) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
