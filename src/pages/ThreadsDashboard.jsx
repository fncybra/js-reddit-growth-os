import React, { useState, useEffect } from 'react';
import { AirtableService, SettingsService, ThreadsHealthService, ThreadsGrowthService } from '../services/growthEngine';
import { RefreshCw, AlertTriangle, Zap, Shield } from 'lucide-react';

const COLORS = { success: '#10b981', warning: '#f59e0b', danger: '#f43f5e', accent: '#3b82f6', muted: '#6b7280' };

export function ThreadsDashboard() {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);
    const [error, setError] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [devices, setDevices] = useState([]);
    const [vaScorecard, setVAScorecard] = useState([]);
    const [actionItems, setActionItems] = useState([]);
    const [recommendations, setRecommendations] = useState([]);
    const [patrolStatus, setPatrolStatus] = useState(null);
    const [expandedVA, setExpandedVA] = useState(null);

    async function loadData(forceRefresh = false) {
        try {
            setError(null);
            const accs = await AirtableService.fetchAllAccounts(forceRefresh);
            const devs = await AirtableService.fetchDevices(forceRefresh);
            setAccounts(accs);
            setDevices(devs);
            const [va, ai, recs] = await Promise.allSettled([
                AirtableService.getVAScorecard(accs, devs),
                AirtableService.getActionItems(accs),
                ThreadsGrowthService.getRecommendations(accs),
            ]);
            if (va.status === 'fulfilled') setVAScorecard(va.value);
            if (ai.status === 'fulfilled') setActionItems(ai.value);
            if (recs.status === 'fulfilled') setRecommendations(recs.value);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setSyncing(false);
        }
    }

    async function loadPatrolStatus() {
        try {
            const settings = await SettingsService.getSettings();
            const raw = settings.lastThreadsPatrol;
            if (raw) setPatrolStatus(JSON.parse(raw));
        } catch (_) {}
    }

    useEffect(() => { loadData(); loadPatrolStatus(); }, []);

    function handleSync() { setSyncing(true); loadData(true); }

    async function handleFullScan() {
        if (!window.confirm('This will scan ALL checkable accounts. Continue?')) return;
        setScanning(true);
        setScanProgress({ current: 0, total: 0, username: '' });
        try {
            const result = await ThreadsHealthService.runFullScan((progress) => setScanProgress(progress));
            alert(`Scan complete! Checked: ${result.total}, Healthy: ${result.healthy}, Dead: ${result.dead}, Errors: ${result.errors}`);
            loadData(true);
            loadPatrolStatus();
        } catch (err) {
            alert('Scan failed: ' + err.message);
        } finally {
            setScanning(false);
            setScanProgress(null);
        }
    }

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

    // Active fleet only — this is what matters
    const activeAccs = accounts.filter(a => a.status === 'Active');
    const warmUpAccs = accounts.filter(a => a.status === 'Warm Up');
    const errorAccs = accounts.filter(a => a.status === 'Login Errors');
    const idleAccs = activeAccs.filter(a => a.threadCount === 0);
    const postingAccs = activeAccs.filter(a => a.threadCount > 0);
    const totalThreads = activeAccs.reduce((sum, a) => sum + (a.threadCount || 0), 0);

    // VA scorecard — active fleet focus
    const enhancedVA = vaScorecard.map(v => {
        const vaAccounts = accounts.filter(a => {
            const devId = Array.isArray(a.device) && a.device[0];
            const dev = devId ? deviceMap[devId] : null;
            return (dev?.handler || dev?.fullName || 'Unassigned') === v.handler;
        });
        const vaActive = vaAccounts.filter(a => a.status === 'Active');
        const vaWarmUp = vaAccounts.filter(a => a.status === 'Warm Up');
        const staleAccounts = vaAccounts.filter(a => (a.status === 'Active' || a.status === 'Warm Up') && a.daysSinceLogin >= 3);
        const idleAccounts = vaActive.filter(a => a.threadCount === 0);
        const vaErrors = vaAccounts.filter(a => a.status === 'Login Errors').length;
        const vaDevice = devices.find(d => (d.handler || d.fullName) === v.handler);
        const accsPerPhone = vaDevice?.numberOfAccounts || v.total;
        const vaThreads = vaActive.reduce((sum, a) => sum + (a.threadCount || 0), 0);
        // Posting % = what % of their active accounts are actually posting
        const postingPct = vaActive.length > 0 ? Math.round(vaActive.filter(a => a.threadCount > 0).length / vaActive.length * 100) : 0;
        return {
            handler: v.handler, phone: v.phone,
            active: vaActive.length, warmUp: vaWarmUp.length,
            idle: idleAccounts.length, idleAccounts,
            stale: staleAccounts.length, staleAccounts,
            errors: vaErrors, accsPerPhone, threads: vaThreads, postingPct,
        };
    })
    .filter(v => v.active + v.warmUp + v.errors > 0) // hide VAs with only dead accounts
    .sort((a, b) => a.postingPct - b.postingPct); // worst posters first

    // Top 10 active by followers
    const topPerformers = activeAccs.sort((a, b) => b.followers - a.followers).slice(0, 10);

    // Only critical/warning alerts
    const criticalAlerts = [
        ...actionItems.filter(i => i.severity === 'critical' || i.severity === 'warning'),
        ...recommendations.filter(r => r.severity === 'critical' || r.severity === 'warning').map(r => ({ severity: r.severity, title: r.message })),
    ].slice(0, 6);

    // Patrol time
    const patrolTimeLabel = (() => {
        if (!patrolStatus?.timestamp) return null;
        const minAgo = Math.round((Date.now() - new Date(patrolStatus.timestamp).getTime()) / 60000);
        return minAgo < 1 ? 'just now' : minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;
    })();

    const fmtFollowers = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const fmtThreads = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const postingPctTotal = activeAccs.length > 0 ? Math.round(postingAccs.length / activeAccs.length * 100) : 0;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Threads Dashboard</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {patrolTimeLabel && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Last patrol: {patrolTimeLabel}</span>}
                    <button className="btn btn-outline" onClick={handleFullScan} disabled={scanning} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                        <Zap size={14} />
                        {scanning ? `Scanning ${scanProgress?.current || 0}/${scanProgress?.total || '...'}` : 'Full Fleet Scan'}
                    </button>
                    <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
                        {syncing ? 'Syncing...' : 'Sync from Airtable'}
                    </button>
                </div>
            </header>
            <div className="page-content">
                {/* Scan Progress */}
                {scanning && scanProgress && (
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <span>Scanning: @{scanProgress.username}</span>
                            <span>{scanProgress.current}/{scanProgress.total}</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar__fill" style={{ width: `${scanProgress.total ? (scanProgress.current / scanProgress.total * 100) : 0}%`, background: COLORS.accent }} />
                        </div>
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
                </div>

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
                                    <th style={thStyleNum}>Posting %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {enhancedVA.map(v => {
                                    const borderColor = v.idle > 0 ? COLORS.danger : v.stale > 5 ? COLORS.warning : 'transparent';
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
                                            <td style={tdStyleNum}>
                                                <span style={{
                                                    display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600,
                                                    background: v.postingPct >= 70 ? 'rgba(16,185,129,0.15)' : v.postingPct >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                                    color: v.postingPct >= 70 ? COLORS.success : v.postingPct >= 40 ? COLORS.warning : COLORS.danger,
                                                }}>
                                                    {v.postingPct}%
                                                </span>
                                            </td>
                                        </tr>
                                        {expandedVA === v.handler + ':idle' && v.idleAccounts.length > 0 && (
                                            <tr style={{ background: 'rgba(244,63,94,0.05)' }}>
                                                <td colSpan={9} style={{ padding: '8px 12px 8px 24px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: COLORS.danger, marginBottom: '4px', fontWeight: 600 }}>
                                                        Active but 0 posts — not posting:
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                        {v.idleAccounts.map(a => (
                                                            <span key={a.id} style={{
                                                                display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem',
                                                                background: 'rgba(244,63,94,0.12)', color: COLORS.danger,
                                                            }}>
                                                                @{a.username} <span style={{ opacity: 0.7 }}>({a.daysSinceCreation}d old)</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        {expandedVA === v.handler + ':stale' && v.staleAccounts.length > 0 && (
                                            <tr style={{ background: 'rgba(245,158,11,0.05)' }}>
                                                <td colSpan={9} style={{ padding: '8px 12px 8px 24px' }}>
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
                                                                @{a.username} <span style={{ opacity: 0.7 }}>({a.daysSinceLogin}d)</span>
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
                                        {topPerformers.map(a => (
                                            <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={tdStyle}>@{a.username}</td>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{a.model}</td>
                                                <td style={{ ...tdStyleNum, fontWeight: 600 }}>{fmtFollowers(a.followers)}</td>
                                                <td style={{ ...tdStyleNum, color: 'var(--text-secondary)' }}>{a.threadCount || 0} posts</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Login Errors — need fixing now */}
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
                                                    <td style={tdStyle}>@{a.username}</td>
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
