import React, { useState, useEffect, useRef } from 'react';
import { AirtableService, ThreadsGrowthService, ThreadsPatrolService } from '../services/growthEngine';
import { RefreshCw, AlertTriangle, Shield, Activity, X } from 'lucide-react';

const COLORS = { success: '#10b981', warning: '#f59e0b', danger: '#f43f5e', accent: '#3b82f6', muted: '#6b7280' };
const ThreadsLink = ({ username, style }) => (
    <a href={`https://www.threads.com/@${username}`} target="_blank" rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dashed var(--border-color)', ...style }}
        onClick={e => e.stopPropagation()}>
        @{username}
    </a>
);

export function ThreadsDashboard() {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [devices, setDevices] = useState([]);
    const [vaScorecard, setVAScorecard] = useState([]);
    const [actionItems, setActionItems] = useState([]);
    const [recommendations, setRecommendations] = useState([]);
    const [expandedVA, setExpandedVA] = useState(null);
    const [patrolRunning, setPatrolRunning] = useState(false);
    const [patrolProgress, setPatrolProgress] = useState(null);
    const [patrolResults, setPatrolResults] = useState(null);
    const [patrolError, setPatrolError] = useState(null);
    const [growthDeltas, setGrowthDeltas] = useState({});
    const [fleetAttrition, setFleetAttrition] = useState(null);
    const autoPatrolDone = useRef(false);

    async function handleRunPatrol() {
        if (!ThreadsPatrolService.canRunToday()) {
            setPatrolError('Already ran patrol today.');
            setTimeout(() => setPatrolError(null), 5000);
            return;
        }
        setPatrolRunning(true);
        setPatrolResults(null);
        setPatrolError(null);
        try {
            const results = await ThreadsPatrolService.runPatrol((progress) => {
                setPatrolProgress(progress);
            });
            setPatrolResults(results);
            await loadData(true);
        } catch (e) {
            if (e.message === 'DAILY_LIMIT') {
                setPatrolError('Already ran patrol today.');
                setTimeout(() => setPatrolError(null), 5000);
            } else {
                setPatrolError('Patrol failed: ' + e.message);
            }
        } finally {
            setPatrolRunning(false);
            setPatrolProgress(null);
        }
    }

    async function loadData(forceRefresh = false) {
        try {
            setError(null);
            const accs = await AirtableService.fetchAllAccounts(forceRefresh);
            const devs = await AirtableService.fetchDevices(forceRefresh);
            setAccounts(accs);
            setDevices(devs);
            const [va, ai, recs, deltas, attrition] = await Promise.allSettled([
                AirtableService.getVAScorecard(accs, devs),
                AirtableService.getActionItems(accs),
                ThreadsGrowthService.getRecommendations(accs),
                ThreadsPatrolService.getGrowthDeltas(),
                ThreadsPatrolService.getFleetAttrition(),
            ]);
            if (va.status === 'fulfilled') setVAScorecard(va.value);
            if (ai.status === 'fulfilled') setActionItems(ai.value);
            if (recs.status === 'fulfilled') setRecommendations(recs.value);
            if (deltas.status === 'fulfilled') setGrowthDeltas(deltas.value);
            if (attrition.status === 'fulfilled') setFleetAttrition(attrition.value);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setSyncing(false);
        }
    }

    // Auto-run patrol on mount if it hasn't run today
    useEffect(() => {
        loadData().then(() => {
            if (!autoPatrolDone.current && ThreadsPatrolService.canRunToday()) {
                autoPatrolDone.current = true;
                handleRunPatrol();
            }
        });
    }, []);

    function handleSync() { setSyncing(true); loadData(true); }

    if (loading) return <div className="page-content" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading Threads data from Airtable...</div>;

    if (error) return (
        <div className="page-content" style={{ padding: '48px' }}>
            <div className="card" style={{ border: '1px solid var(--status-danger)', textAlign: 'center', padding: '32px' }}>
                <AlertTriangle size={32} style={{ color: 'var(--status-danger)', marginBottom: '12px' }} />
                <h3 style={{ marginBottom: '8px' }}>Airtable Connection Error</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{error}</p>
                <button className="btn btn-primary" onClick={() => { setLoading(true); loadData(); }}>Retry</button>
            </div>
        </div>
    );

    // Device lookup
    const deviceMap = {};
    devices.forEach(d => { deviceMap[d.id] = d; });

    // Days since last post for an account
    const daysSincePost = (a) => {
        if (!a.lastPostDate) return a.threadCount > 0 ? 999 : -1;
        const diff = Math.floor((Date.now() - new Date(a.lastPostDate).getTime()) / 86400000);
        return diff;
    };

    // Active fleet only
    const activeAccs = accounts.filter(a => a.status === 'Active');
    const warmUpAccs = accounts.filter(a => a.status === 'Warm Up');
    const errorAccs = accounts.filter(a => a.status === 'Login Errors');
    const idleAccs = activeAccs.filter(a => a.threadCount === 0 || (a.lastPostDate && daysSincePost(a) >= 1));
    const postingAccs = activeAccs.filter(a => a.threadCount > 0 && (!a.lastPostDate || daysSincePost(a) < 1));
    const totalThreads = activeAccs.reduce((sum, a) => sum + (a.threadCount || 0), 0);

    // Growth deltas
    const totalFollowerDelta = Object.values(growthDeltas).reduce((sum, d) => sum + (d.followerDelta || 0), 0);
    const totalThreadDelta = Object.values(growthDeltas).reduce((sum, d) => sum + (d.threadDelta || 0), 0);
    const hasDeltas = Object.keys(growthDeltas).length > 0;

    // Fleet attrition
    const deadAccs = accounts.filter(a => a.status === 'Dead/Shadowbanned' || a.status === 'Dead');
    const newAccsThisWeek = accounts.filter(a => a.daysSinceCreation !== undefined && a.daysSinceCreation <= 7);
    const deathsThisWeek = fleetAttrition?.deathsThisWeek || 0;
    const netGrowth = newAccsThisWeek.length - deathsThisWeek;

    // Helper to get VA accounts
    const getVAAccounts = (handler) => accounts.filter(a => {
        const devId = Array.isArray(a.device) && a.device[0];
        const dev = devId ? deviceMap[devId] : null;
        return (dev?.handler || dev?.fullName || 'Unassigned') === handler;
    });

    // VA scorecard
    const enhancedVA = vaScorecard.map(v => {
        const vaAccounts = getVAAccounts(v.handler);
        const vaActive = vaAccounts.filter(a => a.status === 'Active');
        const vaWarmUp = vaAccounts.filter(a => a.status === 'Warm Up');
        const staleAccounts = vaAccounts.filter(a => (a.status === 'Active' || a.status === 'Warm Up') && a.daysSinceLogin >= 3);
        const idleAccounts = vaActive.filter(a => a.threadCount === 0 || (a.lastPostDate && daysSincePost(a) >= 1));
        const vaErrors = vaAccounts.filter(a => a.status === 'Login Errors').length;
        const vaThreads = vaActive.reduce((sum, a) => sum + (a.threadCount || 0), 0);
        const vaPosting = vaActive.filter(a => a.threadCount > 0 && (!a.lastPostDate || daysSincePost(a) < 1));
        const postingPct = vaActive.length > 0 ? Math.round(vaPosting.length / vaActive.length * 100) : 0;
        // Sum follower + thread deltas for this VA's accounts
        let vaFollowerDelta = 0;
        let vaThreadDelta = 0;
        for (const a of vaAccounts) {
            const d = growthDeltas[a.username?.toLowerCase()];
            if (d) {
                vaFollowerDelta += d.followerDelta || 0;
                vaThreadDelta += d.threadDelta || 0;
            }
        }
        const vaDead = vaAccounts.filter(a => a.status === 'Dead/Shadowbanned' || a.status === 'Dead').length;
        return {
            handler: v.handler, phone: v.phone,
            active: vaActive.length, warmUp: vaWarmUp.length,
            idle: idleAccounts.length, idleAccounts,
            stale: staleAccounts.length, staleAccounts,
            errors: vaErrors, threads: vaThreads, postingPct,
            followerDelta: vaFollowerDelta,
            threadDelta: vaThreadDelta,
            dead: vaDead,
        };
    })
    .filter(v => v.active + v.warmUp + v.errors > 0)
    .sort((a, b) => a.postingPct - b.postingPct);

    // Top 10 active by followers
    const topPerformers = [...activeAccs].sort((a, b) => b.followers - a.followers).slice(0, 10);

    // Only critical/warning alerts
    const criticalAlerts = [
        ...actionItems.filter(i => i.severity === 'critical' || i.severity === 'warning'),
        ...recommendations.filter(r => r.severity === 'critical' || r.severity === 'warning').map(r => ({ severity: r.severity, title: r.message })),
    ].slice(0, 6);

    const fmtFollowers = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const fmtThreads = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const fmtDelta = (n) => {
        const abs = Math.abs(n);
        const str = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : String(abs);
        return n > 0 ? `+${str}` : n < 0 ? `-${str}` : '0';
    };
    const postingPctTotal = activeAccs.length > 0 ? Math.round(postingAccs.length / activeAccs.length * 100) : 0;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Threads Dashboard</h1>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-outline" onClick={handleRunPatrol} disabled={patrolRunning || syncing} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Activity size={16} />
                        {patrolRunning ? `Patrol ${patrolProgress?.checked || 0}/${patrolProgress?.total || '?'}` : 'Run Patrol'}
                    </button>
                    <button className="btn btn-primary" onClick={handleSync} disabled={syncing || patrolRunning} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
                        {syncing ? 'Syncing...' : 'Sync'}
                    </button>
                </div>
            </header>
            <div className="page-content">
                {/* Patrol Error Banner */}
                {patrolError && (
                    <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'rgba(244,63,94,0.12)', border: '1px solid var(--status-danger)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertTriangle size={18} style={{ color: COLORS.danger, flexShrink: 0 }} />
                        <span style={{ color: COLORS.danger, fontWeight: 600, flex: 1 }}>{patrolError}</span>
                        <button onClick={() => setPatrolError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.danger, padding: '2px' }}><X size={16} /></button>
                    </div>
                )}

                {/* Patrol Progress */}
                {patrolRunning && (
                    <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                            <span>Scanning {patrolProgress?.total || '...'} accounts...</span>
                            <span style={{ color: 'var(--text-secondary)' }}>
                                {patrolProgress?.alive || 0} alive · {patrolProgress?.dead || 0} dead
                            </span>
                        </div>
                        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-surface-elevated)', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: '3px', background: COLORS.accent,
                                width: patrolProgress?.total ? `${Math.round((patrolProgress.checked / patrolProgress.total) * 100)}%` : '0%',
                                transition: 'width 0.3s ease'
                            }} />
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {patrolProgress?.checked || 0} / {patrolProgress?.total || '?'}
                        </div>
                    </div>
                )}

                {/* Patrol Results */}
                {patrolResults && (
                    <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: patrolResults.updated.length > 0 ? '12px' : 0 }}>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '0.9rem' }}>
                                <span style={{ color: COLORS.success }}><strong>{patrolResults.alive}</strong> alive</span>
                                <span style={{ color: COLORS.warning }}><strong>{patrolResults.dead - (patrolResults.confirmed_dead || 0)}</strong> suspect</span>
                                <span style={{ color: COLORS.danger }}><strong>{patrolResults.confirmed_dead || 0}</strong> confirmed dead</span>
                                {patrolResults.errors > 0 && <span style={{ color: COLORS.warning }}><strong>{patrolResults.errors}</strong> errors</span>}
                                {patrolResults.rateLimited > 0 && <span style={{ color: COLORS.warning }}><strong>{patrolResults.rateLimited}</strong> rate limited</span>}
                            </div>
                            <button onClick={() => setPatrolResults(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={16} /></button>
                        </div>
                        {patrolResults.updated.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {patrolResults.updated.map(u => (
                                    <span key={u.username} style={{
                                        display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem',
                                        background: u.newStatus === 'Dead/Shadowbanned' ? 'rgba(244,63,94,0.12)' : u.newStatus.includes('suspect') ? 'rgba(251,191,36,0.12)' : 'rgba(16,185,129,0.12)',
                                        color: u.newStatus === 'Dead/Shadowbanned' ? COLORS.danger : u.newStatus.includes('suspect') ? COLORS.warning : COLORS.success,
                                    }}>
                                        @{u.username} <span style={{ opacity: 0.7 }}>({u.newStatus})</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Row 1: Active Fleet Strip */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <span style={{ color: COLORS.success }}><strong>{activeAccs.length}</strong> <span style={{ fontSize: '0.85rem' }}>Active</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: COLORS.accent }}><strong>{warmUpAccs.length}</strong> <span style={{ fontSize: '0.85rem' }}>Warming</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: postingPctTotal >= 70 ? COLORS.success : postingPctTotal >= 40 ? COLORS.warning : COLORS.danger }}>
                        <strong>{postingPctTotal}%</strong> <span style={{ fontSize: '0.85rem' }}>Posting</span>
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: idleAccs.length > 0 ? COLORS.danger : COLORS.success }}><strong>{idleAccs.length}</strong> <span style={{ fontSize: '0.85rem' }}>Idle</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: errorAccs.length > 0 ? '#f97316' : COLORS.muted }}><strong>{errorAccs.length}</strong> <span style={{ fontSize: '0.85rem' }}>Errors</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span><strong>{fmtThreads(totalThreads)}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total Posts</span></span>
                    {hasDeltas && totalThreadDelta > 0 && (
                        <>
                            <span style={{ color: 'var(--border-color)' }}>|</span>
                            <span style={{ color: COLORS.success, fontWeight: 600 }}>
                                +{totalThreadDelta} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>New Posts</span>
                            </span>
                        </>
                    )}
                    {hasDeltas && totalFollowerDelta !== 0 && (
                        <>
                            <span style={{ color: 'var(--border-color)' }}>|</span>
                            <span style={{ color: totalFollowerDelta > 0 ? COLORS.success : COLORS.danger, fontWeight: 600 }}>
                                {fmtDelta(totalFollowerDelta)} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>Followers</span>
                            </span>
                        </>
                    )}
                </div>

                {/* Row 1b: Fleet Attrition Strip */}
                {(deathsThisWeek > 0 || newAccsThisWeek.length > 0 || deadAccs.length > 0) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '10px 16px', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '16px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                        <span style={{ color: COLORS.danger }}><strong>{deathsThisWeek}</strong> Deaths This Week</span>
                        <span style={{ color: 'var(--border-color)' }}>|</span>
                        <span style={{ color: COLORS.accent }}><strong>{newAccsThisWeek.length}</strong> New Accounts This Week</span>
                        <span style={{ color: 'var(--border-color)' }}>|</span>
                        <span style={{ color: netGrowth >= 0 ? COLORS.success : COLORS.danger, fontWeight: 600 }}>
                            {netGrowth >= 0 ? '+' : ''}{netGrowth} Net Growth
                        </span>
                        <span style={{ color: 'var(--border-color)' }}>|</span>
                        <span style={{ color: COLORS.muted }}><strong>{deadAccs.length}</strong> Total Dead</span>
                    </div>
                )}

                {/* Row 2: VA Scorecard */}
                <div className="card" style={{ marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>VA Performance</h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                    <th style={thStyle}>VA</th>
                                    <th style={thStyle}>Phone</th>
                                    <th style={thStyleNum}>Active</th>
                                    <th style={thStyleNum}>Warm Up</th>
                                    <th style={thStyleNum}>Idle</th>
                                    <th style={thStyleNum}>Stale</th>
                                    <th style={thStyleNum}>Errors</th>
                                    <th style={thStyleNum}>Posts</th>
                                    {hasDeltas && <th style={thStyleNum}>New Posts</th>}
                                    <th style={thStyleNum}>Posting %</th>
                                    <th style={thStyleNum}>Dead</th>
                                    {hasDeltas && <th style={thStyleNum}>Growth</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {enhancedVA.map(v => {
                                    const borderColor = v.idle > 0 ? COLORS.danger : v.stale > 5 ? COLORS.warning : 'transparent';
                                    const colSpan = hasDeltas ? 12 : 10;
                                    return (
                                        <React.Fragment key={v.handler}>
                                        <tr style={{ borderBottom: '1px solid var(--border-color)', borderLeft: `3px solid ${borderColor}` }}>
                                            <td style={tdStyle}>{v.handler}</td>
                                            <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{v.phone || '—'}</td>
                                            <td style={{ ...tdStyleNum, color: COLORS.success }}>{v.active}</td>
                                            <td style={{ ...tdStyleNum, color: COLORS.accent }}>{v.warmUp}</td>
                                            <td style={{ ...tdStyleNum, color: v.idle > 0 ? COLORS.danger : 'inherit', cursor: v.idle > 0 ? 'pointer' : 'default', textDecoration: v.idle > 0 ? 'underline' : 'none' }}
                                                onClick={() => v.idle > 0 && setExpandedVA(expandedVA === v.handler + ':idle' ? null : v.handler + ':idle')}>
                                                {v.idle}{v.idle > 0 && (expandedVA === v.handler + ':idle' ? ' ▴' : ' ▾')}
                                            </td>
                                            <td style={{ ...tdStyleNum, color: v.stale > 0 ? COLORS.warning : 'inherit', cursor: v.stale > 0 ? 'pointer' : 'default', textDecoration: v.stale > 0 ? 'underline' : 'none' }}
                                                onClick={() => v.stale > 0 && setExpandedVA(expandedVA === v.handler + ':stale' ? null : v.handler + ':stale')}>
                                                {v.stale}{v.stale > 0 && (expandedVA === v.handler + ':stale' ? ' ▴' : ' ▾')}
                                            </td>
                                            <td style={{ ...tdStyleNum, color: v.errors > 0 ? '#f97316' : 'inherit' }}>{v.errors}</td>
                                            <td style={tdStyleNum}>{fmtThreads(v.threads)}</td>
                                            {hasDeltas && (
                                                <td style={{ ...tdStyleNum, color: v.threadDelta > 0 ? COLORS.success : 'var(--text-secondary)', fontWeight: v.threadDelta > 0 ? 600 : 400 }}>
                                                    {v.threadDelta > 0 ? `+${v.threadDelta}` : v.threadDelta === 0 ? '—' : v.threadDelta}
                                                </td>
                                            )}
                                            <td style={tdStyleNum}>
                                                <span style={{
                                                    display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600,
                                                    background: v.postingPct >= 70 ? 'rgba(16,185,129,0.15)' : v.postingPct >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                                    color: v.postingPct >= 70 ? COLORS.success : v.postingPct >= 40 ? COLORS.warning : COLORS.danger,
                                                }}>
                                                    {v.postingPct}%
                                                </span>
                                            </td>
                                            <td style={{ ...tdStyleNum, color: v.dead > 0 ? COLORS.danger : 'var(--text-secondary)' }}>
                                                {v.dead > 0 ? v.dead : '—'}
                                            </td>
                                            {hasDeltas && (
                                                <td style={{ ...tdStyleNum, color: v.followerDelta > 0 ? COLORS.success : v.followerDelta < 0 ? COLORS.danger : 'inherit', fontWeight: v.followerDelta !== 0 ? 600 : 400 }}>
                                                    {fmtDelta(v.followerDelta)}
                                                </td>
                                            )}
                                        </tr>
                                        {expandedVA === v.handler + ':idle' && v.idleAccounts.length > 0 && (
                                            <tr style={{ background: 'rgba(244,63,94,0.05)' }}>
                                                <td colSpan={colSpan} style={{ padding: '8px 12px 8px 24px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: COLORS.danger, marginBottom: '4px', fontWeight: 600 }}>
                                                        Not posting:
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                        {v.idleAccounts.sort((a, b) => daysSincePost(b) - daysSincePost(a)).map(a => {
                                                            const dsp = daysSincePost(a);
                                                            const label = a.threadCount === 0 ? '0 posts' : dsp === 999 ? 'no date' : `${dsp}d since post`;
                                                            return (
                                                                <span key={a.id} style={{
                                                                    display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem',
                                                                    background: a.threadCount === 0 ? 'rgba(244,63,94,0.12)' : dsp >= 3 ? 'rgba(244,63,94,0.12)' : 'rgba(245,158,11,0.12)',
                                                                    color: a.threadCount === 0 ? COLORS.danger : dsp >= 3 ? COLORS.danger : COLORS.warning,
                                                                }}>
                                                                    <ThreadsLink username={a.username} /> <span style={{ opacity: 0.7 }}>({label})</span>
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        {expandedVA === v.handler + ':stale' && v.staleAccounts.length > 0 && (
                                            <tr style={{ background: 'rgba(245,158,11,0.05)' }}>
                                                <td colSpan={colSpan} style={{ padding: '8px 12px 8px 24px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: COLORS.warning, marginBottom: '4px', fontWeight: 600 }}>
                                                        Not logged in 3+ days:
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                        {v.staleAccounts.sort((a, b) => b.daysSinceLogin - a.daysSinceLogin).map(a => (
                                                            <span key={a.id} style={{
                                                                display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem',
                                                                background: a.daysSinceLogin >= 7 ? 'rgba(244,63,94,0.12)' : 'rgba(245,158,11,0.12)',
                                                                color: a.daysSinceLogin >= 7 ? COLORS.danger : COLORS.warning,
                                                            }}>
                                                                <ThreadsLink username={a.username} /> <span style={{ opacity: 0.7 }}>({a.daysSinceLogin}d)</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Row 3: Top Performers + Login Errors */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Top Performers</h2>
                        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                            {topPerformers.length === 0 ? (
                                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>No active accounts</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                    <tbody>
                                        {topPerformers.map(a => {
                                            const delta = growthDeltas[a.username?.toLowerCase()]?.followerDelta || 0;
                                            return (
                                                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={tdStyle}><ThreadsLink username={a.username} /></td>
                                                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{a.model}</td>
                                                    <td style={{ ...tdStyleNum, fontWeight: 600 }}>{fmtFollowers(a.followers)}</td>
                                                    {hasDeltas && (
                                                        <td style={{ ...tdStyleNum, color: delta > 0 ? COLORS.success : delta < 0 ? COLORS.danger : 'var(--text-secondary)', fontSize: '0.78rem' }}>
                                                            {fmtDelta(delta)}
                                                        </td>
                                                    )}
                                                    <td style={{ ...tdStyleNum, color: 'var(--text-secondary)' }}>{a.threadCount || 0} posts</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Login Errors */}
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>
                            Login Errors
                            {errorAccs.length > 0 && <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#f97316', marginLeft: '8px' }}>{errorAccs.length} need fixing</span>}
                        </h2>
                        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                            {errorAccs.length === 0 ? (
                                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>All clear</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                    <tbody>
                                        {errorAccs.map(a => {
                                            const devId = Array.isArray(a.device) && a.device[0];
                                            const dev = devId ? deviceMap[devId] : null;
                                            const vaName = dev?.handler || dev?.fullName || 'Unassigned';
                                            return (
                                                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={tdStyle}><ThreadsLink username={a.username} /></td>
                                                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{a.model}</td>
                                                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{vaName}</td>
                                                    <td style={{ ...tdStyleNum, color: 'var(--text-secondary)' }}>{a.daysSinceLogin}d</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>

                {/* Row 4: Alerts */}
                <div className="card">
                    {criticalAlerts.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.success }}>
                            <Shield size={16} />
                            <span style={{ fontWeight: 600 }}>Fleet healthy — no critical alerts</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {criticalAlerts.map((a, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 10px', borderRadius: '6px',
                                    background: a.severity === 'critical' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                                }}>
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: a.severity === 'critical' ? COLORS.danger : COLORS.warning }} />
                                    <span>{a.title}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

const thStyle = { padding: '8px 12px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.8rem' };
const thStyleNum = { ...thStyle, textAlign: 'right' };
const tdStyle = { padding: '8px 12px' };
const tdStyleNum = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
