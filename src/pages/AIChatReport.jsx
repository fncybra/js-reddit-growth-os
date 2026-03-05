import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AIChatReportService } from '../services/growthEngine';

const EVENT_COLORS = {
    POOR_OPENER: 'danger', PREMATURE_PITCH: 'danger', MISSED_BUY_SIGNAL: 'danger', OBJECTION_FAILURE: 'danger',
    SPAMMY_BEHAVIOR: 'warning', CAPTION_VIOLATION: 'warning', PRICING_VIOLATION: 'warning',
    SUCCESSFUL_UPSELL: 'success', GOOD_OPENER: 'success', GOOD_RAPPORT: 'success', GOOD_TRANSITION: 'success'
};

export function AIChatReport() {
    const { chatterId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [report, setReport] = useState(null);
    const [importDates, setImportDates] = useState([]);
    const [selectedImportId, setSelectedImportId] = useState(null);

    useEffect(() => {
        AIChatReportService.getImportDates().then(dates => {
            setImportDates(dates);
            const fromUrl = searchParams.get('importId');
            const id = fromUrl ? Number(fromUrl) : dates.find(d => d.status === 'complete')?.id;
            if (id) setSelectedImportId(id);
        });
    }, [searchParams]);

    useEffect(() => {
        if (selectedImportId && chatterId) {
            AIChatReportService.getChatterReport(selectedImportId, Number(chatterId)).then(setReport);
        }
    }, [selectedImportId, chatterId]);

    const formatTime = (sec) => {
        if (sec == null) return '--';
        if (sec < 60) return `${sec}s`;
        return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    };

    if (!report) {
        return (
            <>
                <header className="page-header"><h1 className="page-title">Chatter Report</h1></header>
                <div className="page-content"><div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div></div>
            </>
        );
    }

    const eventCounts = report.eventCounts || {};
    const strengths = report.strengths || [];
    const weaknesses = report.weaknesses || [];

    const tierBadge = (tier) => {
        const map = { top: 'success', average: 'info', at_risk: 'danger' };
        const labels = { top: 'TOP PERFORMER', average: 'AVERAGE', at_risk: 'AT RISK' };
        return <span className={`badge badge-${map[tier] || 'info'}`} style={{ fontSize: '0.85rem', padding: '4px 12px' }}>{labels[tier] || tier}</span>;
    };

    return (
        <>
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button className="btn btn-outline" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>← Back</button>
                    <h1 className="page-title" style={{ margin: 0 }}>{report.chatterName}</h1>
                    {tierBadge(report.tier)}
                </div>
                <select
                    className="input-field"
                    style={{ width: 'auto', minWidth: '200px' }}
                    value={selectedImportId || ''}
                    onChange={e => setSelectedImportId(Number(e.target.value))}
                >
                    {importDates.filter(d => d.status === 'complete').map(d => (
                        <option key={d.id} value={d.id}>{d.date}</option>
                    ))}
                </select>
            </header>
            <div className="page-content">
                {/* KPI Grid */}
                <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: '24px' }}>
                    <div className="metric-card">
                        <div className="metric-label">Revenue</div>
                        <div className="metric-value" style={{ color: 'var(--status-success)' }}>${(report.totalRevenue || 0).toFixed(2)}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Conversations</div>
                        <div className="metric-value">{report.totalConversations || 0}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Conv. Rate</div>
                        <div className="metric-value">{((report.conversionRate || 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">SOP Score</div>
                        <div className="metric-value" style={{
                            color: (report.avgSopScore || 0) >= 75 ? 'var(--status-success)' : (report.avgSopScore || 0) >= 50 ? 'var(--status-warning)' : 'var(--status-danger)'
                        }}>
                            {report.avgSopScore != null ? report.avgSopScore.toFixed(0) : '--'}/100
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Reply Time</div>
                        <div className="metric-value">{formatTime(report.avgReplyTimeSec)}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">PPV Sent</div>
                        <div className="metric-value">{report.totalPPVSent || 0}</div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                    {/* Detected Events */}
                    <div className="card">
                        <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Detected Events</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {Object.entries(eventCounts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                                <span
                                    key={type}
                                    className={`badge badge-${EVENT_COLORS[type] || 'info'}`}
                                    style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                                >
                                    {type.replace(/_/g, ' ')} x{count}
                                </span>
                            ))}
                            {Object.keys(eventCounts).length === 0 && (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No events detected</div>
                            )}
                        </div>
                    </div>

                    {/* Coaching Feedback */}
                    <div className="card">
                        <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Coaching Feedback</h3>
                        {strengths.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--status-success)', fontSize: '0.85rem', marginBottom: '6px' }}>Strengths</div>
                                {strengths.map((s, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '2px 0', paddingLeft: '12px', borderLeft: '2px solid var(--status-success)' }}>
                                        {s}
                                    </div>
                                ))}
                            </div>
                        )}
                        {weaknesses.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--status-danger)', fontSize: '0.85rem', marginBottom: '6px' }}>Weaknesses</div>
                                {weaknesses.map((w, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '2px 0', paddingLeft: '12px', borderLeft: '2px solid var(--status-danger)' }}>
                                        {w}
                                    </div>
                                ))}
                            </div>
                        )}
                        {report.coachingFeedback && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, marginTop: '8px', padding: '12px', background: 'var(--bg-surface-elevated)', borderRadius: '8px' }}>
                                {report.coachingFeedback}
                            </div>
                        )}
                    </div>
                </div>

                {/* Conversations Table */}
                <div className="card">
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Conversations ({report.conversations?.length || 0})</h3>
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Fan</th>
                                    <th>Model</th>
                                    <th>Messages</th>
                                    <th>Revenue</th>
                                    <th>SOP Score</th>
                                    <th>Events</th>
                                    <th>Stage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(report.conversations || []).map(c => (
                                    <tr
                                        key={c.id}
                                        onClick={() => navigate(`/of/ai-chat-replay/${c.id}`)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <td style={{ fontWeight: 500 }}>{c.fanName || c.fanUserId}</td>
                                        <td>{c.modelName}</td>
                                        <td>{c.messageCount}</td>
                                        <td style={{ color: c.ppvRevenue > 0 ? 'var(--status-success)' : 'var(--text-secondary)' }}>
                                            {c.ppvRevenue > 0 ? `$${c.ppvRevenue.toFixed(2)}` : '--'}
                                        </td>
                                        <td>
                                            <span style={{
                                                color: (c.sopScore || 0) >= 75 ? 'var(--status-success)' : (c.sopScore || 0) >= 50 ? 'var(--status-warning)' : c.sopScore != null ? 'var(--status-danger)' : 'var(--text-secondary)'
                                            }}>
                                                {c.sopScore != null ? c.sopScore : '--'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                {(c.events || []).slice(0, 3).map((e, i) => (
                                                    <span key={i} className={`badge badge-${EVENT_COLORS[e.type] || 'info'}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                                        {e.type.replace(/_/g, ' ')}
                                                    </span>
                                                ))}
                                                {(c.events || []).length > 3 && (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>+{c.events.length - 3}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            {(c.stageProgression || []).slice(-1)[0] || '--'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
}
