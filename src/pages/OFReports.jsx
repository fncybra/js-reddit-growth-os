import React, { useState, useEffect, useCallback } from 'react';
import { OFReportService } from '../services/growthEngine';

export function OFReports() {
    const [period, setPeriod] = useState('day');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [expandedModels, setExpandedModels] = useState(new Set());

    const loadReport = useCallback(async () => {
        setLoading(true);
        try {
            let r;
            if (period === 'day') {
                r = await OFReportService.getDailyReport(date);
            } else if (period === 'week') {
                r = await OFReportService.getWeeklyReport(date);
            } else {
                const [y, m] = date.split('-');
                r = await OFReportService.getMonthlyReport(Number(y), Number(m));
            }
            setReport(r);
        } catch (e) {
            console.error('Report load error:', e);
        } finally {
            setLoading(false);
        }
    }, [period, date]);

    useEffect(() => { loadReport(); }, [loadReport]);

    const navigate = (dir) => {
        const d = new Date(date + 'T00:00:00');
        if (period === 'day') d.setDate(d.getDate() + dir);
        else if (period === 'week') d.setDate(d.getDate() + dir * 7);
        else d.setMonth(d.getMonth() + dir);
        setDate(d.toISOString().split('T')[0]);
    };

    const toggleModel = (name) => {
        setExpandedModels(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
    };

    const copyReport = async () => {
        if (!report) return;
        const text = await OFReportService.buildPlaintextReport(report);
        await navigator.clipboard.writeText(text);
        alert('Report copied to clipboard!');
    };

    const getVAStatus = (va, report) => {
        if (va.subs === 0) return { label: 'ZERO', cls: 'badge-danger' };
        const allSubs = report.vaRanking.map(v => v.subs).sort((a, b) => b - a);
        const top = allSubs[0] || 1;
        if (va.subs >= top * 0.7) return { label: 'TOP', cls: 'badge-success' };
        return { label: 'OK', cls: 'badge-info' };
    };

    const getModelStatus = (model, report) => {
        if (model.subs === 0) return { label: 'ZERO', cls: 'badge-danger' };
        const modelSubsArr = report.modelRanking.filter(m => m.subs > 0).map(m => m.subs).sort((a, b) => a - b);
        const median = modelSubsArr.length >= 3 ? modelSubsArr[Math.floor(modelSubsArr.length / 2)] : 0;
        const top = report.modelRanking[0]?.subs || 1;
        if (model.subs >= top * 0.7) return { label: 'TOP', cls: 'badge-success' };
        if (median > 0 && model.subs < Math.max(Math.floor(median * 0.3), 1)) return { label: 'LOW', cls: 'badge-warning' };
        return { label: 'OK', cls: 'badge-info' };
    };

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">OF Reports</h1>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-outline" onClick={copyReport} style={{ fontSize: '0.8rem' }}>Copy Report</button>
                </div>
            </header>
            <div className="page-content">
                {/* Period Toggle + Navigation */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-surface)', borderRadius: '8px', padding: '4px' }}>
                        {['day', 'week', 'month'].map(p => (
                            <button key={p} onClick={() => setPeriod(p)}
                                style={{
                                    padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    backgroundColor: period === p ? 'var(--accent-primary)' : 'transparent',
                                    color: period === p ? '#fff' : 'var(--text-secondary)',
                                    fontWeight: period === p ? 600 : 400, fontSize: '0.85rem',
                                }}>
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-outline" onClick={() => navigate(-1)} style={{ padding: '6px 12px' }}>&larr;</button>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px 12px', color: 'var(--text-primary)' }} />
                    <button className="btn btn-outline" onClick={() => navigate(1)} style={{ padding: '6px 12px' }}>&rarr;</button>
                </div>

                {loading && <div style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center' }}>Loading...</div>}

                {report && !loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* KPI Cards */}
                        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                            <div className="metric-card">
                                <div className="metric-label">Total Subs</div>
                                <div className="metric-value">{report.totalSubs}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">vs Previous</div>
                                <div className="metric-value" style={{ color: report.comparison.delta >= 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
                                    {report.comparison.delta >= 0 ? '+' : ''}{report.comparison.delta}
                                </div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">VAs Producing</div>
                                <div className="metric-value">{report.producingVAs}/{report.activeVAs}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Models Active</div>
                                <div className="metric-value">{report.modelRanking.length}</div>
                            </div>
                        </div>

                        {/* Needs Attention */}
                        {report.needsAttention?.length > 0 && (
                            <div className="card" style={{ borderLeft: '3px solid var(--status-warning)' }}>
                                <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: 'var(--status-warning)' }}>Needs Attention</h3>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {report.needsAttention.map((m, i) => (
                                        <div key={i}>{m.model}: {m.subs} subs (below median threshold)</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* VA Performance Table */}
                        {report.vaRanking.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>VA Performance</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead>
                                            <tr><th>VA</th><th>Subs</th><th>Models</th><th>Bar</th><th>Status</th></tr>
                                        </thead>
                                        <tbody>
                                            {report.vaRanking.map((v, i) => {
                                                const maxSubs = report.vaRanking[0]?.subs || 1;
                                                const pct = Math.round((v.subs / maxSubs) * 100);
                                                const status = getVAStatus(v, report);
                                                return (
                                                    <tr key={i}>
                                                        <td style={{ fontWeight: 600 }}>{v.va}</td>
                                                        <td>{v.subs}</td>
                                                        <td>{v.modelCount}</td>
                                                        <td style={{ width: '30%' }}>
                                                            <div style={{ background: 'var(--bg-surface-hover)', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
                                                            </div>
                                                        </td>
                                                        <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Model Ranking */}
                        {report.modelRanking.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Model Subscribers</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead><tr><th>Model</th><th>New Subs</th><th>Bar</th><th>Status</th></tr></thead>
                                        <tbody>
                                            {report.modelRanking.map((m, i) => {
                                                const maxSubs = report.modelRanking[0]?.subs || 1;
                                                const pct = Math.round((m.subs / maxSubs) * 100);
                                                const status = getModelStatus(m, report);
                                                return (
                                                    <tr key={i}>
                                                        <td style={{ fontWeight: 600 }}>{m.model}</td>
                                                        <td>{m.subs}</td>
                                                        <td style={{ width: '30%' }}>
                                                            <div style={{ background: 'var(--bg-surface-hover)', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
                                                            </div>
                                                        </td>
                                                        <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Subs by Model (per-VA breakdown) */}
                        {report.vaByModel.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Subs by Model</h3>
                                {report.vaByModel.map(m => (
                                    <div key={m.model} style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '12px', marginBottom: '12px' }}>
                                        <div onClick={() => toggleModel(m.model)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontWeight: 600 }}>{m.model}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{m.totalSubs} subs</span>
                                        </div>
                                        {expandedModels.has(m.model) && (
                                            <div style={{ marginTop: '8px', paddingLeft: '16px' }}>
                                                {m.vas.map((v, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        <span>{v.va}</span><span>{v.subs}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Ad Platforms */}
                        {report.adPlatforms.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Ad Platforms</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead><tr><th>Platform</th><th>Subs</th><th>Bar</th></tr></thead>
                                        <tbody>
                                            {report.adPlatforms.map((p, i) => {
                                                const maxSubs = report.adPlatforms[0]?.subs || 1;
                                                const pct = Math.round((p.subs / maxSubs) * 100);
                                                return (
                                                    <tr key={i}>
                                                        <td>{p.platform}</td>
                                                        <td>{p.subs}</td>
                                                        <td style={{ width: '30%' }}>
                                                            <div style={{ background: 'var(--bg-surface-hover)', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--status-info)', borderRadius: '4px', transition: 'width 0.3s' }} />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* SFS Sources */}
                        {report.sfsSources.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>SFS Sources</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead><tr><th>Source</th><th>Subs</th><th>Bar</th></tr></thead>
                                        <tbody>
                                            {report.sfsSources.map((s, i) => {
                                                const maxSubs = report.sfsSources[0]?.subs || 1;
                                                const pct = Math.round((s.subs / maxSubs) * 100);
                                                return (
                                                    <tr key={i}>
                                                        <td>{s.platform}</td>
                                                        <td>{s.subs}</td>
                                                        <td style={{ width: '30%' }}>
                                                            <div style={{ background: 'var(--bg-surface-hover)', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${pct}%`, height: '100%', background: '#a855f7', borderRadius: '4px', transition: 'width 0.3s' }} />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Compensation */}
                        {report.compensation.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Compensation</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead><tr><th>VA</th><th>Subs</th><th>Amount</th></tr></thead>
                                        <tbody>
                                            {report.compensation.map((c, i) => (
                                                <tr key={i}>
                                                    <td style={{ fontWeight: 600 }}>{c.va}</td>
                                                    <td>{c.subs}</td>
                                                    <td style={{ color: c.amount > 0 ? 'var(--status-success)' : 'var(--text-muted)' }}>${c.amount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Tiers: 600+ subs = $10 | 1200+ = $15 | 2000+ = $20
                                </div>
                            </div>
                        )}

                        {/* Period Comparison */}
                        <div className="card">
                            <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Period Comparison</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', textAlign: 'center' }}>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Current</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{report.comparison.current}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Previous</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{report.comparison.previous}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Delta</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: report.comparison.delta >= 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
                                        {report.comparison.delta >= 0 ? '+' : ''}{report.comparison.delta}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
