import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AIChatReportService } from '../services/growthEngine';

const SEVERITY_STYLES = {
    positive: { border: 'var(--status-success)', bg: 'rgba(34, 197, 94, 0.08)' },
    critical: { border: 'var(--status-danger)', bg: 'rgba(239, 68, 68, 0.08)' },
    warning: { border: 'var(--status-warning)', bg: 'rgba(245, 158, 11, 0.08)' }
};

export function AIChatReplay() {
    const { conversationId } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);

    useEffect(() => {
        if (conversationId) {
            AIChatReportService.getConversationReplay(Number(conversationId)).then(setData);
        }
    }, [conversationId]);

    const formatTime = (ts) => {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return ''; }
    };

    const formatReplyTime = (sec) => {
        if (sec == null) return null;
        if (sec < 60) return `${sec}s`;
        return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    };

    if (!data) {
        return (
            <>
                <header className="page-header"><h1 className="page-title">Conversation Replay</h1></header>
                <div className="page-content"><div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div></div>
            </>
        );
    }

    const { conversation, chatterName, modelName, messages, grade } = data;
    const stages = grade?.stageProgression || [];

    return (
        <>
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button className="btn btn-outline" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>← Back</button>
                    <h1 className="page-title" style={{ margin: 0 }}>
                        {chatterName} → {modelName} → {conversation.fanName}
                    </h1>
                </div>
            </header>
            <div className="page-content">
                {/* Summary bar */}
                <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '24px' }}>
                    <div className="metric-card">
                        <div className="metric-label">SOP Score</div>
                        <div className="metric-value" style={{
                            color: (grade?.sopScore || 0) >= 75 ? 'var(--status-success)' : (grade?.sopScore || 0) >= 50 ? 'var(--status-warning)' : 'var(--status-danger)'
                        }}>
                            {grade?.sopScore ?? '--'}/100
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Messages</div>
                        <div className="metric-value">{messages.length}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Revenue</div>
                        <div className="metric-value" style={{ color: (conversation.ppvRevenue || 0) > 0 ? 'var(--status-success)' : 'var(--text-secondary)' }}>
                            {conversation.ppvRevenue > 0 ? `$${conversation.ppvRevenue.toFixed(2)}` : '$0'}
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Events</div>
                        <div className="metric-value">{(grade?.events || []).length}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Stages</div>
                        <div className="metric-value" style={{ fontSize: '0.8rem' }}>{stages.join(' → ') || '--'}</div>
                    </div>
                </div>

                {/* Summary */}
                {grade?.summary && (
                    <div className="card" style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg-surface-elevated)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>AI Summary</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{grade.summary}</div>
                    </div>
                )}

                {/* Chat replay */}
                <div className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '8px' }}>
                        {messages.map((msg, idx) => {
                            const isFan = msg.sender === 'fan';
                            const annotation = msg.annotation;
                            const isPPV = msg.price > 0;

                            return (
                                <React.Fragment key={msg.id || idx}>
                                    {/* Message bubble */}
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: isFan ? 'flex-start' : 'flex-end',
                                    }}>
                                        <div style={{
                                            maxWidth: '70%',
                                            padding: '10px 14px',
                                            borderRadius: isFan ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                                            backgroundColor: isFan
                                                ? 'var(--bg-surface-elevated)'
                                                : isPPV
                                                    ? 'rgba(245, 158, 11, 0.15)'
                                                    : 'rgba(99, 102, 241, 0.15)',
                                            border: isPPV ? '1px solid rgba(245, 158, 11, 0.3)' : 'none',
                                        }}>
                                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>
                                                {isFan ? conversation.fanName : chatterName}
                                            </div>
                                            <div style={{ fontSize: '0.9rem', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                                                {msg.content}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                {formatTime(msg.timestamp) && <span>{formatTime(msg.timestamp)}</span>}
                                                {!isFan && msg.replyTimeSec != null && <span>reply: {formatReplyTime(msg.replyTimeSec)}</span>}
                                                {isPPV && <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>PPV ${msg.price}{msg.purchased ? ' ✅ PURCHASED' : ' ❌'}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Inline annotation */}
                                    {annotation && (
                                        <div style={{
                                            margin: '4px 0',
                                            padding: '8px 12px',
                                            borderLeft: `3px solid ${SEVERITY_STYLES[annotation.severity]?.border || 'var(--border-color)'}`,
                                            backgroundColor: SEVERITY_STYLES[annotation.severity]?.bg || 'transparent',
                                            borderRadius: '0 6px 6px 0',
                                            fontSize: '0.8rem',
                                        }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.8 }}>
                                                {annotation.type?.replace(/_/g, ' ')}
                                            </span>
                                            <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>{annotation.text}</span>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>
        </>
    );
}
