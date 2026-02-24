import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Shield, AlertTriangle, CheckCircle, XCircle, User } from 'lucide-react';

export function ModelDetail() {
    const { id } = useParams();
    const modelId = Number(id);
    const [metrics, setMetrics] = useState(null);
    const model = useLiveQuery(() => db.models.get(modelId), [modelId]);

    useEffect(() => {
        async function fetchMetrics() {
            if (modelId) {
                const data = await AnalyticsEngine.getMetrics(modelId);
                setMetrics(data);
            }
        }
        fetchMetrics();
    }, [modelId]);

    if (!model) return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading model...</div>;

    const {
        totalViews = 0,
        avgViewsPerPost = 0,
        removalRatePct = 0,
        provenSubs = 0,
        testingSubs = 0,
        topSubreddits = [],
        worstSubreddits = [],
        accountRankings = [],
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
            </header>

            <div className="page-content">

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
