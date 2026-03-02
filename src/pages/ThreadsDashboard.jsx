import React, { useState, useEffect } from 'react';
import { AirtableService, SettingsService } from '../services/growthEngine';
import { RefreshCw, AlertTriangle, AlertCircle, Info, Shield } from 'lucide-react';

export function ThreadsDashboard() {
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [modelBreakdown, setModelBreakdown] = useState([]);
    const [vaScorecard, setVAScorecard] = useState([]);
    const [actionItems, setActionItems] = useState([]);
    const [patrolStatus, setPatrolStatus] = useState(null);

    async function loadData(forceRefresh = false) {
        try {
            setError(null);
            const accounts = await AirtableService.fetchAllAccounts(forceRefresh);
            const devices = await AirtableService.fetchDevices(forceRefresh);
            const [m, mb, va, ai] = await Promise.all([
                AirtableService.getThreadsMetrics(accounts),
                AirtableService.getModelBreakdown(accounts),
                AirtableService.getVAScorecard(accounts, devices),
                AirtableService.getActionItems(accounts),
            ]);
            setMetrics(m);
            setModelBreakdown(mb);
            setVAScorecard(va);
            setActionItems(ai);
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
        } catch (_) { /* ignore parse errors */ }
    }

    useEffect(() => { loadData(); loadPatrolStatus(); }, []);

    function handleSync() {
        setSyncing(true);
        loadData(true);
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

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Threads Dashboard</h1>
                <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
                    {syncing ? 'Syncing...' : 'Sync from Airtable'}
                </button>
            </header>
            <div className="page-content">
                {/* Health Patrol Status */}
                <PatrolBanner status={patrolStatus} />
                {/* KPI Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '24px' }}>
                    <KPICard label="Total Accounts" value={metrics.total} />
                    <KPICard label="Active" value={metrics.active} color="var(--status-success)" />
                    <KPICard label="Warm Up" value={metrics.warmUp} color="var(--status-info)" />
                    <KPICard label="Suspended" value={metrics.suspended} color="var(--status-warning)" />
                    <KPICard label="Dead / Banned" value={metrics.dead} color="var(--status-danger)" />
                    <KPICard label="Login Errors" value={metrics.loginErrors} color="#f97316" />
                </div>

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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
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
                                        <th style={thStyleNum}>Warm Up</th>
                                        <th style={thStyleNum}>Suspended</th>
                                        <th style={thStyleNum}>Dead</th>
                                        <th style={thStyleNum}>Active %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {modelBreakdown.map(m => (
                                        <tr key={m.model} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={tdStyle}>{m.model}</td>
                                            <td style={tdStyleNum}>{m.total}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-success)' }}>{m.active}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-info)' }}>{m.warmUp}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-warning)' }}>{m.suspended}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-danger)' }}>{m.dead}</td>
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
                                        <th style={thStyle}>Phone</th>
                                        <th style={thStyleNum}>Accounts</th>
                                        <th style={thStyleNum}>Active</th>
                                        <th style={thStyleNum}>Suspended</th>
                                        <th style={thStyleNum}>Dead</th>
                                        <th style={thStyleNum}>Errors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vaScorecard.map(v => (
                                        <tr key={v.handler} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={tdStyle}>{v.handler}</td>
                                            <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{v.phone}</td>
                                            <td style={tdStyleNum}>{v.total}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-success)' }}>{v.active}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-warning)' }}>{v.suspended}</td>
                                            <td style={{ ...tdStyleNum, color: 'var(--status-danger)' }}>{v.dead}</td>
                                            <td style={{ ...tdStyleNum, color: v.loginErrors > 0 ? '#f97316' : 'inherit' }}>{v.loginErrors}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Status distribution summary */}
                {metrics.statusCounts && (
                    <div className="card" style={{ marginTop: '24px' }}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Status Distribution</h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                            {Object.entries(metrics.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                                <div key={status} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '12px 16px', minWidth: '140px' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{status}</div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: '700' }}>{count.toLocaleString()}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0}%</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

function KPICard({ label, value, color }) {
    return (
        <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: '700', color: color || 'var(--text-primary)' }}>{(value || 0).toLocaleString()}</div>
        </div>
    );
}

function ActionItem({ item }) {
    const severityConfig = {
        critical: { color: 'var(--status-danger)', bg: 'rgba(239,68,68,0.1)', icon: AlertTriangle },
        warning: { color: 'var(--status-warning)', bg: 'rgba(245,158,11,0.1)', icon: AlertCircle },
        info: { color: 'var(--status-info)', bg: 'rgba(59,130,246,0.1)', icon: Info },
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', background: 'var(--bg-secondary)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <Shield size={16} />
                <span>Health Patrol: starting...</span>
            </div>
        );
    }

    const ts = new Date(status.timestamp);
    const minAgo = Math.round((Date.now() - ts.getTime()) / 60000);
    const timeLabel = minAgo < 1 ? 'just now' : `${minAgo} min ago`;
    const healthy = (status.totalAccounts || 0) - (status.dead || 0);
    const hasDead = status.dead > 0;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', background: hasDead ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', fontSize: '0.85rem', color: hasDead ? 'var(--status-danger)' : 'var(--status-success)' }}>
            <Shield size={16} />
            <span>
                Last patrol: {timeLabel} — {healthy}/{status.totalAccounts} healthy
                {hasDead ? `, ${status.dead} dead detected` : ''}
                {status.sessionProgress != null ? ` (${status.sessionProgress}/${status.sessionTotal} checked this session)` : ''}
            </span>
        </div>
    );
}

const thStyle = { padding: '8px 12px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.8rem' };
const thStyleNum = { ...thStyle, textAlign: 'right' };
const tdStyle = { padding: '8px 12px' };
const tdStyleNum = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
