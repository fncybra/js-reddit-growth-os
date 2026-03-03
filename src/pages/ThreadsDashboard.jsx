import React, { useState, useEffect } from 'react';
import { AirtableService, SettingsService, ThreadsHealthService, ThreadsGrowthService } from '../services/growthEngine';
import { RefreshCw, AlertTriangle, AlertCircle, Info, Shield, TrendingUp, Zap, Users, Activity } from 'lucide-react';
import { StatusDoughnut, BarChart, TrendLine, COLORS } from '../components/charts';

export function ThreadsDashboard() {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);
    const [error, setError] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [modelBreakdown, setModelBreakdown] = useState([]);
    const [vaScorecard, setVAScorecard] = useState([]);
    const [actionItems, setActionItems] = useState([]);
    const [patrolStatus, setPatrolStatus] = useState(null);
    const [fleetHealth, setFleetHealth] = useState(null);
    const [recommendations, setRecommendations] = useState([]);
    const [ageAnalysis, setAgeAnalysis] = useState([]);
    const [followerDist, setFollowerDist] = useState([]);
    const [modelPerformance, setModelPerformance] = useState([]);

    async function loadData(forceRefresh = false) {
        try {
            setError(null);
            const accounts = await AirtableService.fetchAllAccounts(forceRefresh);
            const devices = await AirtableService.fetchDevices(forceRefresh);
            const [m, mb, va, ai, fh, recs, age, fd, mp] = await Promise.allSettled([
                AirtableService.getThreadsMetrics(accounts),
                AirtableService.getModelBreakdown(accounts),
                AirtableService.getVAScorecard(accounts, devices),
                AirtableService.getActionItems(accounts),
                ThreadsGrowthService.getFleetHealth(accounts),
                ThreadsGrowthService.getRecommendations(accounts),
                ThreadsGrowthService.getAccountAgeAnalysis(accounts),
                ThreadsGrowthService.getFollowerDistribution(accounts),
                ThreadsGrowthService.getModelPerformance(accounts),
            ]);
            if (m.status === 'fulfilled') setMetrics(m.value);
            if (mb.status === 'fulfilled') setModelBreakdown(mb.value);
            if (va.status === 'fulfilled') setVAScorecard(va.value);
            if (ai.status === 'fulfilled') setActionItems(ai.value);
            if (fh.status === 'fulfilled') setFleetHealth(fh.value);
            if (recs.status === 'fulfilled') setRecommendations(recs.value);
            if (age.status === 'fulfilled') setAgeAnalysis(age.value);
            if (fd.status === 'fulfilled') setFollowerDist(fd.value);
            if (mp.status === 'fulfilled') setModelPerformance(mp.value);
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
            if (raw) {
                setPatrolStatus(JSON.parse(raw));
            }
        } catch (_) {}
    }

    useEffect(() => { loadData(); loadPatrolStatus(); }, []);

    function handleSync() {
        setSyncing(true);
        loadData(true);
    }

    async function handleFullScan() {
        if (!window.confirm('This will scan ALL checkable accounts. For 2k accounts this takes ~1-2 hours. Continue?')) return;
        setScanning(true);
        setScanProgress({ current: 0, total: 0, username: '' });
        try {
            const result = await ThreadsHealthService.runFullScan((progress) => {
                setScanProgress(progress);
            });
            alert(`Full scan complete!\n\nChecked: ${result.total}\nHealthy: ${result.healthy}\nDead: ${result.dead}\nErrors: ${result.errors}`);
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

    // Prepare chart data
    const statusLabels = metrics?.statusCounts ? Object.keys(metrics.statusCounts) : [];
    const statusValues = statusLabels.map(k => metrics.statusCounts[k]);
    const statusColors = statusLabels.map(s => {
        const lower = s.toLowerCase();
        if (lower === 'active') return COLORS.success;
        if (lower === 'warm up') return COLORS.info;
        if (lower.includes('suspend')) return COLORS.warning;
        if (lower.includes('dead')) return COLORS.danger;
        if (lower.includes('error')) return '#f97316';
        if (lower.includes('setting')) return '#8b5cf6';
        if (lower.includes('added')) return '#06b6d4';
        return COLORS.muted;
    });

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Threads Dashboard</h1>
                <div style={{ display: 'flex', gap: '8px' }}>
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
                {/* Health Patrol Status + Fleet Health Score */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', marginBottom: '16px', alignItems: 'center' }}>
                    <PatrolBanner status={patrolStatus} />
                    {fleetHealth && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderRadius: '8px', background: 'var(--bg-surface)' }}>
                            <div className="grade-badge" style={{
                                background: fleetHealth.grade === 'A' ? 'rgba(16,185,129,0.15)' : fleetHealth.grade === 'B' ? 'rgba(59,130,246,0.15)' : fleetHealth.grade === 'C' ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                color: fleetHealth.grade === 'A' ? COLORS.success : fleetHealth.grade === 'B' ? COLORS.accent : fleetHealth.grade === 'C' ? COLORS.warning : COLORS.danger,
                            }}>
                                {fleetHealth.grade}
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Fleet Health</div>
                                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{fleetHealth.score}/100</div>
                            </div>
                            <div style={{ marginLeft: '12px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Survival Rate</div>
                                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: fleetHealth.survivalRate >= 70 ? COLORS.success : fleetHealth.survivalRate >= 50 ? COLORS.warning : COLORS.danger }}>
                                    {fleetHealth.survivalRate}%
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Scan Progress Bar */}
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

                {/* KPI Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '24px' }}>
                    <div className="metric-card metric-card--blue" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Total Accounts</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700' }}>{(metrics?.total || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card metric-card--green" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Active</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: COLORS.success }}>{(metrics?.active || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card metric-card--cyan" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Warm Up</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: COLORS.info }}>{(metrics?.warmUp || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card metric-card--yellow" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Suspended</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: COLORS.warning }}>{(metrics?.suspended || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card metric-card--red" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Dead / Banned</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: COLORS.danger }}>{(metrics?.dead || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card metric-card--purple" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Login Errors</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#f97316' }}>{(metrics?.loginErrors || 0).toLocaleString()}</div>
                    </div>
                </div>

                {/* Growth Recommendations */}
                {recommendations.length > 0 && (
                    <div className="card" style={{ marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TrendingUp size={18} /> Growth Intelligence
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {recommendations.map((rec, i) => (
                                <ActionItem key={i} item={{ severity: rec.severity, title: rec.message }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Action Items */}
                {actionItems.length > 0 && (
                    <div className="card" style={{ marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Action Items</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {actionItems.map((item, i) => (
                                <ActionItem key={i} item={item} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Charts Row: Status Doughnut + Model Bar Chart */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Status Distribution</h2>
                        {statusLabels.length > 0 ? (
                            <StatusDoughnut labels={statusLabels} values={statusValues} colors={statusColors} />
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', padding: '24px', textAlign: 'center' }}>No data</div>
                        )}
                    </div>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Model Comparison</h2>
                        {modelBreakdown.length > 0 ? (
                            <BarChart
                                labels={modelBreakdown.slice(0, 10).map(m => m.model)}
                                datasets={[
                                    { label: 'Active', data: modelBreakdown.slice(0, 10).map(m => m.active), color: COLORS.success },
                                    { label: 'Suspended', data: modelBreakdown.slice(0, 10).map(m => m.suspended), color: COLORS.warning },
                                    { label: 'Dead', data: modelBreakdown.slice(0, 10).map(m => m.dead), color: COLORS.danger },
                                    { label: 'Warm Up', data: modelBreakdown.slice(0, 10).map(m => m.warmUp), color: COLORS.info },
                                ]}
                                stacked
                            />
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', padding: '24px', textAlign: 'center' }}>No data</div>
                        )}
                    </div>
                </div>

                {/* Charts Row: Account Age Survival + Follower Distribution */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Account Age vs Survival</h2>
                        {ageAnalysis.length > 0 ? (
                            <BarChart
                                labels={ageAnalysis.map(a => a.label)}
                                datasets={[
                                    { label: 'Active', data: ageAnalysis.map(a => a.active), color: COLORS.success },
                                    { label: 'Suspended', data: ageAnalysis.map(a => a.suspended), color: COLORS.warning },
                                    { label: 'Dead', data: ageAnalysis.map(a => a.dead), color: COLORS.danger },
                                ]}
                                stacked
                            />
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', padding: '24px', textAlign: 'center' }}>No data</div>
                        )}
                    </div>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Follower Distribution (Active Accounts)</h2>
                        {followerDist.length > 0 ? (
                            <BarChart
                                labels={followerDist.map(f => f.label)}
                                datasets={[{ label: 'Accounts', data: followerDist.map(f => f.count), color: COLORS.accent }]}
                            />
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', padding: '24px', textAlign: 'center' }}>No data</div>
                        )}
                    </div>
                </div>

                {/* Model Leaderboard + VA Scorecard */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                    {/* Model Leaderboard */}
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Model Leaderboard</h2>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                        <th style={thStyle}>Model</th>
                                        <th style={thStyleNum}>Total</th>
                                        <th style={thStyleNum}>Active</th>
                                        <th style={thStyleNum}>Followers</th>
                                        <th style={thStyleNum}>Survival</th>
                                        <th style={thStyleNum}>Active %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(modelPerformance.length > 0 ? modelPerformance : modelBreakdown).map(m => (
                                        <tr key={m.model} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={tdStyle}>{m.model}</td>
                                            <td style={tdStyleNum}>{m.total}</td>
                                            <td style={{ ...tdStyleNum, color: COLORS.success }}>{m.active}</td>
                                            <td style={tdStyleNum}>{(m.activeFollowers || m.totalFollowers || 0).toLocaleString()}</td>
                                            <td style={{ ...tdStyleNum, color: (m.survivalRate || 0) >= 70 ? COLORS.success : (m.survivalRate || 0) >= 50 ? COLORS.warning : COLORS.danger }}>
                                                {m.survivalRate || (m.total > 0 ? Math.round((m.active / m.total) * 100) : 0)}%
                                            </td>
                                            <td style={tdStyleNum}>{m.total > 0 ? Math.round((m.active / m.total) * 100) : 0}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* VA Scorecard */}
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>VA Scorecard</h2>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                        <th style={thStyle}>Handler</th>
                                        <th style={thStyleNum}>Accounts</th>
                                        <th style={thStyleNum}>Active</th>
                                        <th style={thStyleNum}>Suspended</th>
                                        <th style={thStyleNum}>Dead</th>
                                        <th style={thStyleNum}>Errors</th>
                                        <th style={thStyleNum}>Health</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vaScorecard.map(v => {
                                        const atRisk = v.active + (v.dead || 0) + (v.suspended || 0);
                                        const survival = atRisk > 0 ? Math.round((v.active / atRisk) * 100) : 100;
                                        return (
                                            <tr key={v.handler} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={tdStyle}>{v.handler}</td>
                                                <td style={tdStyleNum}>{v.total}</td>
                                                <td style={{ ...tdStyleNum, color: COLORS.success }}>{v.active}</td>
                                                <td style={{ ...tdStyleNum, color: COLORS.warning }}>{v.suspended}</td>
                                                <td style={{ ...tdStyleNum, color: COLORS.danger }}>{v.dead}</td>
                                                <td style={{ ...tdStyleNum, color: v.loginErrors > 0 ? '#f97316' : 'inherit' }}>{v.loginErrors}</td>
                                                <td style={tdStyleNum}>
                                                    <span style={{
                                                        display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600,
                                                        background: survival >= 70 ? 'rgba(16,185,129,0.15)' : survival >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)',
                                                        color: survival >= 70 ? COLORS.success : survival >= 50 ? COLORS.warning : COLORS.danger,
                                                    }}>
                                                        {survival}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

function ActionItem({ item }) {
    const severityConfig = {
        critical: { color: 'var(--status-danger)', bg: 'rgba(239,68,68,0.1)', icon: AlertTriangle },
        warning: { color: 'var(--status-warning)', bg: 'rgba(245,158,11,0.1)', icon: AlertCircle },
        info: { color: 'var(--status-info)', bg: 'rgba(59,130,246,0.1)', icon: Info },
        success: { color: 'var(--status-success)', bg: 'rgba(16,185,129,0.1)', icon: Activity },
    };
    const cfg = severityConfig[item.severity] || severityConfig.info;
    const Icon = cfg.icon;
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px', borderRadius: '8px', background: cfg.bg }}>
            <Icon size={18} style={{ color: cfg.color, flexShrink: 0, marginTop: '2px' }} />
            <div>
                <div style={{ fontWeight: '600', fontSize: '0.9rem', color: cfg.color }}>{item.title}</div>
                {item.detail && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{item.detail}</div>}
            </div>
        </div>
    );
}

function PatrolBanner({ status }) {
    if (!status) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-secondary)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <Shield size={16} />
                <span>Health Patrol: starting...</span>
            </div>
        );
    }

    const ts = new Date(status.timestamp);
    const minAgo = Math.round((Date.now() - ts.getTime()) / 60000);
    const timeLabel = minAgo < 1 ? 'just now' : minAgo < 60 ? `${minAgo}m ago` : `${Math.round(minAgo / 60)}h ago`;
    const hasDead = status.dead > 0;
    const hasRateLimit = status.rateLimited;
    const pct = status.sessionTotal > 0 ? Math.round((status.sessionProgress / status.sessionTotal) * 100) : 0;

    return (
        <div style={{ borderRadius: '8px', background: hasDead ? 'rgba(239,68,68,0.08)' : hasRateLimit ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)', padding: '12px 16px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: hasDead ? 'var(--status-danger)' : hasRateLimit ? 'var(--status-warning)' : 'var(--status-success)', marginBottom: '6px' }}>
                <Shield size={16} />
                <span>
                    Last patrol: {timeLabel} — {status.checked} checked, {status.healthy} healthy
                    {hasDead ? `, ${status.dead} dead detected` : ''}
                    {hasRateLimit ? ' (rate limited)' : ''}
                    {status.followerUpdates > 0 ? `, ${status.followerUpdates} follower updates` : ''}
                </span>
            </div>
            {status.sessionTotal > 0 && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        <span>Rotation: {status.sessionProgress}/{status.sessionTotal} accounts</span>
                        <span>{pct}% — ETA ~{status.etaMinutes || '?'}min remaining</span>
                    </div>
                    <div className="progress-bar">
                        <div className="progress-bar__fill" style={{ width: `${pct}%`, background: hasDead ? COLORS.danger : COLORS.success }} />
                    </div>
                </div>
            )}
        </div>
    );
}

const thStyle = { padding: '8px 12px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.8rem' };
const thStyleNum = { ...thStyle, textAlign: 'right' };
const tdStyle = { padding: '8px 12px' };
const tdStyleNum = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
