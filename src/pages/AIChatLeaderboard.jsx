import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIChatReportService } from '../services/growthEngine';

export function AIChatLeaderboard() {
    const navigate = useNavigate();
    const [importDates, setImportDates] = useState([]);
    const [selectedImportId, setSelectedImportId] = useState(null);
    const [leaderboard, setLeaderboard] = useState(null);
    const [sortField, setSortField] = useState('revenue');
    const [sortAsc, setSortAsc] = useState(false);

    useEffect(() => {
        AIChatReportService.getImportDates().then(dates => {
            setImportDates(dates);
            const complete = dates.find(d => d.status === 'complete');
            if (complete) setSelectedImportId(complete.id);
        });
    }, []);

    useEffect(() => {
        if (selectedImportId) {
            AIChatReportService.getLeaderboard(selectedImportId).then(setLeaderboard);
        }
    }, [selectedImportId]);

    const handleSort = (field) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    const sortedChatters = leaderboard?.chatters?.slice().sort((a, b) => {
        let aVal = a[sortField] ?? 0;
        let bVal = b[sortField] ?? 0;
        return sortAsc ? aVal - bVal : bVal - aVal;
    }) || [];

    const tierBadge = (tier) => {
        const map = { top: 'success', average: 'info', at_risk: 'danger' };
        const labels = { top: 'TOP', average: 'OK', at_risk: 'AT RISK' };
        return <span className={`badge badge-${map[tier] || 'info'}`}>{labels[tier] || tier}</span>;
    };

    const formatTime = (sec) => {
        if (sec == null) return '--';
        if (sec < 60) return `${sec}s`;
        return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    };

    const SortHeader = ({ field, label }) => (
        <th onClick={() => handleSort(field)} style={{ cursor: 'pointer', userSelect: 'none' }}>
            {label} {sortField === field ? (sortAsc ? '▲' : '▼') : ''}
        </th>
    );

    if (!leaderboard && importDates.length === 0) {
        return (
            <>
                <header className="page-header"><h1 className="page-title">AI Chat Leaderboard</h1></header>
                <div className="page-content">
                    <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📊</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>No reports yet</div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>Import an Inflow CSV and run AI grading first.</div>
                        <button className="btn btn-primary" onClick={() => navigate('/of/ai-chat-import')}>Go to Import</button>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">AI Chat Leaderboard</h1>
                <select
                    className="input-field"
                    style={{ width: 'auto', minWidth: '200px' }}
                    value={selectedImportId || ''}
                    onChange={e => setSelectedImportId(Number(e.target.value))}
                >
                    {importDates.filter(d => d.status === 'complete').map(d => (
                        <option key={d.id} value={d.id}>{d.date} — {d.filename}</option>
                    ))}
                </select>
            </header>
            <div className="page-content">
                {leaderboard && (
                    <>
                        {/* Global KPIs */}
                        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
                            <div className="metric-card">
                                <div className="metric-label">Total Revenue</div>
                                <div className="metric-value" style={{ color: 'var(--status-success)' }}>${leaderboard.globalStats.totalRevenue.toFixed(2)}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Avg Conversion</div>
                                <div className="metric-value">{(leaderboard.globalStats.avgConversionRate * 100).toFixed(1)}%</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Total Conversations</div>
                                <div className="metric-value">{leaderboard.globalStats.totalConversations.toLocaleString()}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Chatters Active</div>
                                <div className="metric-value">{leaderboard.globalStats.totalChatters}</div>
                            </div>
                        </div>

                        {/* Needs Attention */}
                        {leaderboard.needsAttention.length > 0 && (
                            <div className="card" style={{ borderLeft: '3px solid var(--status-warning)', marginBottom: '24px' }}>
                                <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--status-warning)' }}>
                                    Needs Attention ({leaderboard.needsAttention.length})
                                </h3>
                                {leaderboard.needsAttention.map((c, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '4px 0' }}>
                                        <strong>{c.name}</strong>: {c.reason}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Ranking Table */}
                        <div className="card">
                            <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Chatter Rankings</h3>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Chatter</th>
                                            <SortHeader field="revenue" label="Revenue" />
                                            <SortHeader field="conversionRate" label="Conv. Rate" />
                                            <SortHeader field="avgSopScore" label="SOP Score" />
                                            <SortHeader field="avgReplyTimeSec" label="Reply Speed" />
                                            <SortHeader field="conversationCount" label="Convos" />
                                            <th>Tier</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedChatters.map((c, i) => (
                                            <tr
                                                key={c.chatterId}
                                                onClick={() => navigate(`/of/ai-chat-report/${c.chatterId}?importId=${selectedImportId}`)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <td style={{ color: 'var(--text-secondary)' }}>{i + 1}</td>
                                                <td style={{ fontWeight: 600 }}>{c.name}</td>
                                                <td style={{ color: 'var(--status-success)' }}>${c.revenue.toFixed(2)}</td>
                                                <td>{(c.conversionRate * 100).toFixed(1)}%</td>
                                                <td>
                                                    <span style={{
                                                        color: c.avgSopScore >= 75 ? 'var(--status-success)' : c.avgSopScore >= 50 ? 'var(--status-warning)' : 'var(--status-danger)'
                                                    }}>
                                                        {c.avgSopScore != null ? c.avgSopScore.toFixed(0) : '--'}
                                                    </span>
                                                </td>
                                                <td>{formatTime(c.avgReplyTimeSec)}</td>
                                                <td>{c.conversationCount}</td>
                                                <td>{tierBadge(c.tier)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
