import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, BarChart2, Copy, Check } from 'lucide-react';

export function LinkTracker() {
    const models = useLiveQuery(() => db.models.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());
    const tasks = useLiveQuery(() => db.tasks.toArray());
    const performances = useLiveQuery(() => db.performances.toArray());
    const subreddits = useLiveQuery(() => db.subreddits.toArray());

    const [modelFilter, setModelFilter] = useState('');
    const [accountFilter, setAccountFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [copiedId, setCopiedId] = useState(null);

    React.useEffect(() => {
        if (models && models.length > 0 && !modelFilter) {
            setModelFilter(String(models[0].id));
        }
    }, [models, modelFilter]);

    // Build enriched link rows from closed tasks that have a redditUrl
    const linkRows = React.useMemo(() => {
        if (!tasks || !performances) return [];
        const perfByTaskId = new Map((performances || []).map(p => [p.taskId, p]));
        const modelMap = new Map((models || []).map(m => [m.id, m]));
        const accountMap = new Map((accounts || []).map(a => [a.id, a]));
        const subMap = new Map((subreddits || []).map(s => [s.id, s]));

        return tasks
            .filter(t => t.redditUrl || t.redditPostId)
            .filter(t => !modelFilter || String(t.modelId) === modelFilter)
            .filter(t => accountFilter === 'all' || String(t.accountId) === accountFilter)
            .map(t => {
                const perf = perfByTaskId.get(t.id);
                const model = modelMap.get(t.modelId);
                const account = accountMap.get(t.accountId);
                const sub = subMap.get(t.subredditId);
                const url = t.redditUrl || (t.redditPostId ? `https://reddit.com/comments/${t.redditPostId}` : '');
                const subredditName = sub?.name || (() => {
                    const m = url.match(/\/r\/([^/]+)/i);
                    return m ? m[1] : '?';
                })();
                return {
                    id: t.id,
                    date: t.date,
                    postedAt: t.postedAt || t.scheduledTime || '',
                    modelName: model?.name || '?',
                    accountHandle: account?.handle || '?',
                    subreddit: subredditName,
                    url,
                    views: perf?.views24h || 0,
                    removed: perf?.removed ? true : false,
                    status: t.status,
                    taskType: t.taskType || 'post',
                };
            })
            .filter(r => {
                if (statusFilter === 'live') return !r.removed;
                if (statusFilter === 'removed') return r.removed;
                return true;
            })
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }, [tasks, performances, models, accounts, subreddits, modelFilter, accountFilter, statusFilter]);

    // Summary stats
    const totalLinks = linkRows.length;
    const liveLinks = linkRows.filter(r => !r.removed).length;
    const removedLinks = linkRows.filter(r => r.removed).length;
    const totalViews = linkRows.reduce((sum, r) => sum + r.views, 0);

    const visibleAccounts = (accounts || []).filter(a => !modelFilter || String(a.modelId) === modelFilter);

    async function copyToClipboard(text, id) {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1500);
        } catch (e) {
            // fallback
        }
    }

    if (!models) {
        return <div className="page-content" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>Loading...</div>;
    }

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Link Tracker</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        All posted Reddit URLs in one place with performance stats.
                    </div>
                </div>
            </header>
            <div className="page-content">
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Total Links</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{totalLinks}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Live</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#4caf50' }}>{liveLinks}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Removed</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f44336' }}>{removedLinks}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Total Views</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--primary-color)' }}>{totalViews.toLocaleString()}</div>
                    </div>
                </div>

                {/* Filters + Table */}
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Posted Links ({linkRows.length})</h2>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                                className="input-field"
                                value={modelFilter}
                                onChange={e => setModelFilter(e.target.value)}
                                style={{ width: 'auto', minWidth: '160px', padding: '6px 10px' }}
                            >
                                {models?.map(m => (
                                    <option key={m.id} value={String(m.id)}>{m.name}</option>
                                ))}
                            </select>
                            <select
                                className="input-field"
                                value={accountFilter}
                                onChange={e => setAccountFilter(e.target.value)}
                                style={{ width: 'auto', minWidth: '160px', padding: '6px 10px' }}
                            >
                                <option value="all">All Accounts</option>
                                {visibleAccounts.map(acc => (
                                    <option key={acc.id} value={String(acc.id)}>{acc.handle}</option>
                                ))}
                            </select>
                            <select
                                className="input-field"
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value)}
                                style={{ width: 'auto', minWidth: '120px', padding: '6px 10px' }}
                            >
                                <option value="all">All Status</option>
                                <option value="live">Live Only</option>
                                <option value="removed">Removed Only</option>
                            </select>
                        </div>
                    </div>
                    {linkRows.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '32px' }}>
                            No posted links found. Links appear here after tasks are closed with a Reddit URL.
                        </div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Account</th>
                                        <th>Subreddit</th>
                                        <th>Views</th>
                                        <th>Status</th>
                                        <th>Link</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {linkRows.map(row => (
                                        <tr key={row.id}>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                {row.date ? new Date(row.date).toLocaleDateString() : '—'}
                                                {row.postedAt && (
                                                    <span style={{ marginLeft: '4px', fontSize: '0.7rem' }}>{row.postedAt}</span>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '0.85rem' }}>{row.accountHandle}</td>
                                            <td style={{ fontWeight: 500 }}>
                                                <a
                                                    href={`https://reddit.com/r/${row.subreddit}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    style={{ color: 'var(--primary-color)', textDecoration: 'none' }}
                                                >
                                                    r/{row.subreddit}
                                                </a>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{row.views.toLocaleString()}</td>
                                            <td>
                                                {row.removed ? (
                                                    <span className="badge badge-danger">Removed</span>
                                                ) : (
                                                    <span className="badge badge-success">Live</span>
                                                )}
                                            </td>
                                            <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                                                {row.url ? (
                                                    <a href={row.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }} title={row.url}>
                                                        {row.url.replace('https://www.reddit.com', '').replace('https://reddit.com', '').slice(0, 50)}
                                                    </a>
                                                ) : '—'}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {row.url && (
                                                        <>
                                                            <button
                                                                className="btn btn-outline"
                                                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                                                onClick={() => window.open(row.url, '_blank')}
                                                                title="Open on Reddit"
                                                            >
                                                                <ExternalLink size={12} />
                                                            </button>
                                                            <button
                                                                className="btn btn-outline"
                                                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                                                onClick={() => copyToClipboard(row.url, row.id)}
                                                                title="Copy URL"
                                                            >
                                                                {copiedId === row.id ? <Check size={12} style={{ color: '#4caf50' }} /> : <Copy size={12} />}
                                                            </button>
                                                            <button
                                                                className="btn btn-outline"
                                                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                                                onClick={() => {
                                                                    const postId = row.url.match(/comments\/([a-z0-9]+)/i)?.[1];
                                                                    if (postId) window.open(`https://www.reveddit.com/v/r/${row.subreddit}/comments/${postId}/`, '_blank');
                                                                    else window.open(`https://www.reveddit.com/y/${row.accountHandle.replace(/^u\//i, '')}/`, '_blank');
                                                                }}
                                                                title="Check on Reveddit (removal detector)"
                                                            >
                                                                <BarChart2 size={12} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
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
