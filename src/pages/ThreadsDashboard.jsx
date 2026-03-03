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
    const [metrics, setMetrics] = useState(null);
    const [vaScorecard, setVAScorecard] = useState([]);
    const [actionItems, setActionItems] = useState([]);
    const [fleetHealth, setFleetHealth] = useState(null);
    const [recommendations, setRecommendations] = useState([]);
    const [patrolStatus, setPatrolStatus] = useState(null);

    async function loadData(forceRefresh = false) {
        try {
            setError(null);
            const accs = await AirtableService.fetchAllAccounts(forceRefresh);
            const devs = await AirtableService.fetchDevices(forceRefresh);
            setAccounts(accs);
            setDevices(devs);
            const [m, va, ai, fh, recs] = await Promise.allSettled([
                AirtableService.getThreadsMetrics(accs),
                AirtableService.getVAScorecard(accs, devs),
                AirtableService.getActionItems(accs),
                ThreadsGrowthService.getFleetHealth(accs),
                ThreadsGrowthService.getRecommendations(accs),
            ]);
            if (m.status === 'fulfilled') setMetrics(m.value);
            if (va.status === 'fulfilled') setVAScorecard(va.value);
            if (ai.status === 'fulfilled') setActionItems(ai.value);
            if (fh.status === 'fulfilled') setFleetHealth(fh.value);
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

    // Device lookup map
    const deviceMap = {};
    devices.forEach(d => { deviceMap[d.id] = d; });

    // Replace list: dead + suspended + login error accounts
    const replaceList = accounts
        .filter(a => ['Dead', 'Dead/Shadowbanned', 'Suspended', 'Login Errors'].includes(a.status))
        .map(a => {
            const devId = Array.isArray(a.device) && a.device[0];
            const dev = devId ? deviceMap[devId] : null;
            return { ...a, vaName: dev?.handler || dev?.fullName || 'Unassigned' };
        })
        .sort((a, b) => {
            const order = { 'Dead': 0, 'Dead/Shadowbanned': 0, 'Suspended': 1, 'Login Errors': 2 };
            return (order[a.status] ?? 3) - (order[b.status] ?? 3);
        });

    // Top 10 active accounts by followers
    const topPerformers = accounts.filter(a => a.status === 'Active').sort((a, b) => b.followers - a.followers).slice(0, 10);

    // Enhanced VA scorecard: add stale count + accs/phone, sort worst health first
    const enhancedVA = vaScorecard.map(v => {
        const vaAccounts = accounts.filter(a => {
            const devId = Array.isArray(a.device) && a.device[0];
            const dev = devId ? deviceMap[devId] : null;
            return (dev?.handler || dev?.fullName || 'Unassigned') === v.handler;
        });
        const stale = vaAccounts.filter(a => (a.status === 'Active' || a.status === 'Warm Up') && a.daysSinceLogin >= 3).length;
        const vaDevice = devices.find(d => (d.handler || d.fullName) === v.handler);
        const accsPerPhone = vaDevice?.numberOfAccounts || v.total;
        const atRisk = v.active + (v.dead || 0) + (v.suspended || 0);
        const health = atRisk > 0 ? Math.round((v.active / atRisk) * 100) : 100;
        return { ...v, stale, accsPerPhone, health };
    }).sort((a, b) => a.health - b.health);

    // Critical + warning alerts only (from both action items and recommendations)
    const criticalAlerts = [
        ...actionItems.filter(i => i.severity === 'critical' || i.severity === 'warning'),
        ...recommendations.filter(r => r.severity === 'critical' || r.severity === 'warning').map(r => ({ severity: r.severity, title: r.message })),
    ].slice(0, 6);

    // Patrol time label
    const patrolTimeLabel = (() => {
        if (!patrolStatus?.timestamp) return null;
        const minAgo = Math.round((Date.now() - new Date(patrolStatus.timestamp).getTime()) / 60000);
        return minAgo < 1 ? 'just now' : minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;
    })();

    const fmtFollowers = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const bd = fleetHealth?.breakdown || {};

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

                {/* Row 1: Health Strip */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-surface)', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {fleetHealth && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                            Fleet:
                            <span style={{
                                display: 'inline-block', padding: '2px 10px', borderRadius: '4px', fontWeight: 700,
                                background: fleetHealth.grade === 'A' ? 'rgba(16,185,129,0.15)' : fleetHealth.grade === 'B' ? 'rgba(59,130,246,0.15)' : fleetHealth.grade === 'C' ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                color: fleetHealth.grade === 'A' ? COLORS.success : fleetHealth.grade === 'B' ? COLORS.accent : fleetHealth.grade === 'C' ? COLORS.warning : COLORS.danger,
                            }}>
                                {fleetHealth.grade} ({fleetHealth.score})
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{fleetHealth.survivalRate}% survival</span>
                        </span>
                    )}
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span><strong>{(bd.total || metrics?.total || 0).toLocaleString()}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: COLORS.success }}><strong>{(bd.active || metrics?.active || 0).toLocaleString()}</strong> <span style={{ fontSize: '0.85rem' }}>Active</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: COLORS.danger }}><strong>{(bd.dead || metrics?.dead || 0).toLocaleString()}</strong> <span style={{ fontSize: '0.85rem' }}>Dead</span></span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: COLORS.warning }}><strong>{(bd.suspended || metrics?.suspended || 0).toLocaleString()}</strong> <span style={{ fontSize: '0.85rem' }}>Suspended</span></span>
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
                                    <th style={thStyleNum}>Accs</th>
                                    <th style={thStyleNum}>Active</th>
                                    <th style={thStyleNum}>Dead</th>
                                    <th style={thStyleNum}>Errors</th>
                                    <th style={thStyleNum}>Stale</th>
                                    <th style={thStyleNum}>Accs/Phone</th>
                                    <th style={thStyleNum}>Health</th>
                                </tr>
                            </thead>
                            <tbody>
                                {enhancedVA.map(v => {
                                    const borderColor = v.health < 60 ? COLORS.danger : v.stale > 5 ? COLORS.warning : 'transparent';
                                    return (
                                        <tr key={v.handler} style={{ borderBottom: '1px solid var(--border-color)', borderLeft: `3px solid ${borderColor}` }}>
                                            <td style={tdStyle}>{v.handler}</td>
                                            <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{v.phone || '—'}</td>
                                            <td style={tdStyleNum}>{v.total}</td>
                                            <td style={{ ...tdStyleNum, color: v.total > 0 && v.active / v.total > 0.7 ? COLORS.success : 'inherit' }}>{v.active}</td>
                                            <td style={{ ...tdStyleNum, color: v.dead > 0 ? COLORS.danger : 'inherit' }}>{v.dead}</td>
                                            <td style={{ ...tdStyleNum, color: v.loginErrors > 0 ? '#f97316' : 'inherit' }}>{v.loginErrors}</td>
                                            <td style={{ ...tdStyleNum, color: v.stale > 5 ? COLORS.warning : 'inherit' }}>{v.stale}</td>
                                            <td style={tdStyleNum}>
                                                {v.accsPerPhone}
                                                {v.accsPerPhone > 30 && <span style={{ color: COLORS.danger, marginLeft: '4px' }} title="Over 30 accounts per phone">⚠</span>}
                                            </td>
                                            <td style={tdStyleNum}>
                                                <span style={{
                                                    display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600,
                                                    background: v.health >= 80 ? 'rgba(16,185,129,0.15)' : v.health >= 60 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                                    color: v.health >= 80 ? COLORS.success : v.health >= 60 ? COLORS.warning : COLORS.danger,
                                                }}>
                                                    {v.health}%
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Row 3: Replace Now + Top Performers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    {/* Replace Now */}
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>
                            Replace Now
                            <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                {replaceList.length} need replacing
                            </span>
                        </h2>
                        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                            {replaceList.length === 0 ? (
                                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>No accounts need replacing</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                    <tbody>
                                        {replaceList.map(a => (
                                            <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={tdStyle}>@{a.username}</td>
                                                <td style={tdStyle}>
                                                    <span style={{
                                                        display: 'inline-block', padding: '1px 6px', borderRadius: '3px', fontSize: '0.75rem',
                                                        background: a.status.includes('Dead') ? 'rgba(244,63,94,0.15)' : a.status === 'Suspended' ? 'rgba(245,158,11,0.15)' : 'rgba(249,115,22,0.15)',
                                                        color: a.status.includes('Dead') ? COLORS.danger : a.status === 'Suspended' ? COLORS.warning : '#f97316',
                                                    }}>
                                                        {a.status}
                                                    </span>
                                                </td>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{a.model}</td>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{a.vaName}</td>
                                                <td style={{ ...tdStyleNum, color: 'var(--text-secondary)' }}>{a.daysSinceCreation}d</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Top Performers */}
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
                                                <td style={{ ...tdStyleNum, color: 'var(--text-secondary)' }}>{a.daysSinceCreation}d</td>
                                            </tr>
                                        ))}
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
