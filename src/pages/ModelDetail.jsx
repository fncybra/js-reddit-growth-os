import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine, SettingsService } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Shield, AlertTriangle, CheckCircle, XCircle, User } from 'lucide-react';

export function ModelDetail() {
    const { id } = useParams();
    const modelId = Number(id);
    const [metrics, setMetrics] = useState(null);
    const [lookbackDays, setLookbackDays] = useState(30);
    const [proxyUrl, setProxyUrl] = useState('https://js-reddit-proxy-production.up.railway.app');
    const model = useLiveQuery(() => db.models.get(modelId), [modelId]);
    const analyticsTrigger = useLiveQuery(async () => {
        if (!modelId) return '';
        const tasks = await db.tasks.where('modelId').equals(modelId).toArray();
        const taskIds = tasks.map(t => t.id);
        const perfs = taskIds.length > 0 ? await db.performances.where('taskId').anyOf(taskIds).toArray() : [];
        const taskSig = tasks.map(t => `${t.id}:${t.status}:${t.redditPostId || ''}`).join('|');
        const perfSig = perfs.map(p => `${p.taskId}:${p.views24h || 0}:${p.removed ? 1 : 0}`).join('|');
        return `${taskSig}::${perfSig}`;
    }, [modelId]);

    useEffect(() => {
        async function fetchMetrics() {
            if (modelId) {
                const data = await AnalyticsEngine.getMetrics(modelId, lookbackDays || null);
                setMetrics(data);
            }
        }
        fetchMetrics();
    }, [modelId, lookbackDays, analyticsTrigger]);

    useEffect(() => {
        async function loadProxy() {
            const settings = await SettingsService.getSettings();
            if (settings?.proxyUrl) setProxyUrl(settings.proxyUrl);
        }
        loadProxy();
    }, []);

    async function handleExportCsv() {
        const tasks = await db.tasks.where('modelId').equals(modelId).toArray();
        const cutoffIso = lookbackDays ? new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString() : null;
        const filteredTasks = cutoffIso ? tasks.filter(t => !t.date || t.date >= cutoffIso) : tasks;
        const taskIds = filteredTasks.map(t => t.id);
        const performances = taskIds.length > 0 ? await db.performances.where('taskId').anyOf(taskIds).toArray() : [];

        const perfByTaskId = new Map(performances.map(p => [p.taskId, p]));
        const subreddits = await db.subreddits.where('modelId').equals(modelId).toArray();
        const accounts = await db.accounts.where('modelId').equals(modelId).toArray();
        const subById = new Map(subreddits.map(s => [s.id, s]));
        const accountById = new Map(accounts.map(a => [a.id, a]));

        const rows = filteredTasks.map(t => {
            const p = perfByTaskId.get(t.id);
            const sub = subById.get(t.subredditId);
            const acc = accountById.get(t.accountId);
            return {
                date: t.date || '',
                account: acc?.handle || '',
                subreddit: sub?.name || '',
                title: (t.title || '').replace(/\"/g, '""'),
                redditUrl: t.redditUrl || '',
                redditPostId: t.redditPostId || '',
                status: t.status || '',
                upvotes: p?.views24h ?? '',
                removed: p?.removed ? 'yes' : 'no',
                notes: (p?.notes || '').replace(/\"/g, '""')
            };
        });

        const header = ['date', 'account', 'subreddit', 'title', 'redditUrl', 'redditPostId', 'status', 'upvotes', 'removed', 'notes'];
        const csvLines = [header.join(',')].concat(rows.map(r => header.map(k => `"${String(r[k] ?? '')}"`).join(',')));
        const csv = csvLines.join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const rangeLabel = lookbackDays ? `${lookbackDays}d` : 'all';
        a.href = url;
        a.download = `${model?.name || 'model'}-posts-${rangeLabel}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    if (!model) return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading model...</div>;

    const {
        totalViews = 0,
        avgViewsPerPost = 0,
        removalRatePct = 0,
        provenSubs = 0,
        testingSubs = 0,
        topAssets = [],
        topSubreddits = [],
        worstSubreddits = [],
        accountRankings = [],
        managerSignals = null,
    } = metrics || {};

    return (
        <>
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <Link to="/" className="btn btn-outline" style={{ padding: '6px 12px' }}>
                        <ArrowLeft size={14} style={{ marginRight: '4px' }} /> Back
                    </Link>
                    <div>
                        <h1 className="page-title">{model.name}</h1>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select className="input-field" value={String(lookbackDays)} onChange={e => setLookbackDays(Number(e.target.value))} style={{ width: 'auto', minWidth: '120px' }}>
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                        <option value="180">Last 180 days</option>
                        <option value="365">Last 365 days</option>
                        <option value="0">All time</option>
                    </select>
                    <button className="btn btn-outline" onClick={handleExportCsv}>Export CSV</button>
                </div>
            </header>

            <div className="page-content">

                {/* Manager Scoreboard */}
                <div className="card" style={{ marginBottom: '16px', borderColor: managerSignals?.status === 'critical' ? 'var(--status-danger)' : managerSignals?.status === 'watch' ? 'var(--status-warning)' : 'var(--status-success)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                        <h2 style={{ fontSize: '1rem', fontWeight: '600' }}>Manager Scoreboard</h2>
                        <span className={`badge ${managerSignals?.status === 'critical' ? 'badge-danger' : managerSignals?.status === 'watch' ? 'badge-warning' : 'badge-success'}`}>
                            {managerSignals?.status === 'critical' ? 'Critical' : managerSignals?.status === 'watch' ? 'Watch' : 'Healthy'}
                        </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Health Score</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: '700' }}>{managerSignals?.healthScore ?? 0}</div>
                        </div>
                        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Confidence</div>
                            <div style={{ fontSize: '1rem', fontWeight: '600', textTransform: 'capitalize' }}>{managerSignals?.confidence || 'low'}</div>
                        </div>
                        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Posts Sampled</div>
                            <div style={{ fontSize: '1rem', fontWeight: '600' }}>{metrics?.tasksCompleted || 0}</div>
                        </div>
                        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Flagged Subs</div>
                            <div style={{ fontSize: '1rem', fontWeight: '600' }}>{worstSubreddits?.length || 0}</div>
                        </div>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>Next action:</strong> {managerSignals?.primaryAction || 'Gather more data and run sync.'}
                    </div>
                </div>

                {/* Model Summary - 4 cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Total Upvotes</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: 'var(--primary-color)' }}>{totalViews.toLocaleString()}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Avg / Post</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700' }}>{avgViewsPerPost}</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Removal Rate</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: removalRatePct > 20 ? 'var(--status-danger)' : 'var(--status-success)' }}>{removalRatePct}%</div>
                    </div>
                    <div className="card" style={{ padding: '16px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Subreddits</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700' }}>{provenSubs}<span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: '400' }}> proven</span></div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{testingSubs} testing</div>
                    </div>
                </div>

                {/* Top Performing Assets */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '1.05rem', marginBottom: '10px', fontWeight: '600' }}>Top Performing Photos / Videos</h2>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                        Use this to replicate winners. Ranked by average upvotes in the selected date range.
                    </div>
                    {topAssets.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '18px' }}>No asset performance data yet.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Preview</th>
                                        <th>Asset</th>
                                        <th>Type</th>
                                        <th>Tag</th>
                                        <th>Posts</th>
                                        <th>Avg Ups</th>
                                        <th>Total Ups</th>
                                        <th>Removal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topAssets.map(asset => (
                                        <tr key={asset.assetId}>
                                            <td style={{ width: '56px' }}>
                                                {asset.driveFileId ? (
                                                    <img
                                                        src={`${proxyUrl}/api/drive/thumb/${asset.driveFileId}`}
                                                        alt={asset.fileName}
                                                        style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                                    />
                                                ) : asset.thumbnailUrl ? (
                                                    <img
                                                        src={asset.thumbnailUrl}
                                                        alt={asset.fileName}
                                                        style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                                    />
                                                ) : (
                                                    <div style={{ width: '40px', height: '40px', borderRadius: '6px', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)' }} />
                                                )}
                                            </td>
                                            <td style={{ maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.fileName}>{asset.fileName}</td>
                                            <td>{asset.assetType}</td>
                                            <td><span className="badge badge-info">{asset.angleTag}</span></td>
                                            <td>{asset.syncedPosts} / {asset.posts}</td>
                                            <td style={{ fontWeight: '600' }}>{asset.avgViews}</td>
                                            <td style={{ color: 'var(--primary-color)', fontWeight: '600' }}>{asset.totalViews}</td>
                                            <td style={{ color: asset.removalRate >= 25 ? 'var(--status-danger)' : 'var(--status-success)' }}>{asset.removalRate}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Accounts Section - THE KEY SECTION */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: '600' }}>Reddit Accounts</h2>

                    {accountRankings.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>No accounts linked to this model yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {accountRankings.map(acc => (
                                <Link to={`/account/${acc.id}`} key={acc.handle} style={{
                                    padding: '16px 20px',
                                    backgroundColor: 'var(--surface-color)',
                                    borderRadius: 'var(--radius-md)',
                                    border: `1px solid ${acc.isSuspended ? 'var(--status-danger)' : 'var(--border-color)'}`,
                                    textDecoration: 'none',
                                    color: 'inherit',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.2s ease',
                                }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = acc.isSuspended ? 'var(--status-danger)' : 'var(--border-color)'}
                                >
                                    {/* Account Header Row */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <User size={16} style={{ color: 'var(--text-secondary)' }} />
                                            <span style={{ fontWeight: '600', fontSize: '1rem' }}>u/{acc.handle.replace(/^u\//i, '')}</span>
                                            {acc.isSuspended ? (
                                                <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <XCircle size={10} /> Suspended
                                                </span>
                                            ) : (
                                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <CheckCircle size={10} /> Active
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            CQS: <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{acc.cqs}</span>
                                        </div>
                                    </div>

                                    {/* Account Stats Row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>Karma</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>{acc.karma.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>Upvotes</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--primary-color)' }}>{acc.totalUps.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>Posts</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>{acc.totalPosts}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>Avg / Post</div>
                                            <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>{acc.avgUpsPerPost}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>Removals</div>
                                            <div style={{
                                                fontSize: '1.2rem', fontWeight: '600',
                                                color: acc.removalRate > 20 ? 'var(--status-danger)' : acc.removalRate > 10 ? 'var(--status-warning)' : 'var(--status-success)'
                                            }}>
                                                {acc.removalRate}%
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>

                {/* Two columns: Top Subs + DO NOT POST */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>

                    {/* Top Subreddits */}
                    <div className="card">
                        <h2 style={{ fontSize: '1rem', marginBottom: '12px', fontWeight: '600' }}>Top Subreddits</h2>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '10px' }}>Based on synced posts in the selected date range.</div>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Subreddit</th>
                                        <th>Status</th>
                                        <th>Avg Ups</th>
                                        <th>Removal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topSubreddits?.length === 0 && (
                                        <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No data yet</td></tr>
                                    )}
                                    {topSubreddits?.map(sub => (
                                        <tr key={sub.name}>
                                            <td style={{ fontWeight: '500' }}>r/{sub.name}</td>
                                            <td>
                                                <span className={`badge ${sub.status === 'proven' ? 'badge-success' : 'badge-info'}`}>
                                                    {sub.status}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: '600' }}>{sub.avgViews?.toLocaleString()}</td>
                                            <td style={{ color: sub.removalPct > 20 ? 'var(--status-danger)' : 'inherit' }}>{sub.removalPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* DO NOT POST */}
                    <div className="card" style={{ borderColor: worstSubreddits?.length > 0 ? 'var(--status-danger)' : undefined }}>
                        <h2 style={{ fontSize: '1rem', marginBottom: '12px', fontWeight: '600', color: worstSubreddits?.length > 0 ? 'var(--status-danger)' : 'inherit' }}>
                            ⛔ Do Not Post
                        </h2>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '10px' }}>Only shown when a subreddit has at least 3 tests and 40%+ removals in the selected date range.</div>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Subreddit</th>
                                        <th>Issue</th>
                                        <th>Removal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {worstSubreddits?.length === 0 && (
                                        <tr><td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>None detected — looking clean</td></tr>
                                    )}
                                    {worstSubreddits?.map(sub => (
                                        <tr key={sub.name}>
                                            <td style={{ fontWeight: '500' }}>r/{sub.name}</td>
                                            <td><span className="badge badge-danger">{sub.action}</span></td>
                                            <td style={{ fontWeight: '600', color: 'var(--status-danger)' }}>{sub.removalPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Alerts */}
                {(removalRatePct > 20 || testingSubs === 0) && (
                    <div className="card" style={{ borderColor: 'var(--status-danger)' }}>
                        <h2 style={{ fontSize: '1rem', marginBottom: '12px', fontWeight: '600' }}>⚠️ Alerts</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {removalRatePct > 20 && (
                                <div style={{ display: 'flex', gap: '8px', padding: '10px', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '6px', fontSize: '0.9rem' }}>
                                    <AlertTriangle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0, marginTop: '2px' }} />
                                    <span>High removal rate ({removalRatePct}%) — review subreddit rules and posting style.</span>
                                </div>
                            )}
                            {testingSubs === 0 && (
                                <div style={{ display: 'flex', gap: '8px', padding: '10px', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: '6px', fontSize: '0.9rem' }}>
                                    <AlertTriangle size={16} style={{ color: 'var(--status-warning)', flexShrink: 0, marginTop: '2px' }} />
                                    <span>No subreddits in testing pipeline — add new subs to keep growth discovery alive.</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>
        </>
    );
}
