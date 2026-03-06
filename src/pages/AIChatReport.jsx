import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AIChatReportService } from '../services/growthEngine';

// Tier 1 (rules) + Tier 2 (AI) event types
const CRITICAL_TYPES = ['GENERIC_OPENER','BAD_TONE','MISSED_BUY_SIGNAL','VISIBLE_TRANSITION','NO_LOCATION_MATCH','OBJECTION_FAILURE','GF_EXPERIENCE','SOLD_TOO_EARLY','SLOW_REPLY_SELLING'];
const POSITIVE_TYPES = ['GOOD_OPENER','GOOD_LOCATION_MATCH','GOOD_HUMANIZING','GOOD_RAPPORT','GOOD_PROFILING','GOOD_TRANSITION','GOOD_SCENARIO_SEXT','GOOD_TONE','GOOD_OBJECTION_HANDLING','GOOD_ENERGY_MATCH','GOOD_PPV_LOOPING','FAST_RESPONSE','SUCCESSFUL_SALE'];

const EVENT_COLOR = (type) => CRITICAL_TYPES.includes(type) ? 'danger' : POSITIVE_TYPES.includes(type) ? 'success' : 'warning';

const EVENT_LABELS = {
    // AI-detected critical
    GENERIC_OPENER: 'Generic Opener', BAD_TONE: 'Bad Tone',
    MISSED_BUY_SIGNAL: 'Missed Buy Signal', VISIBLE_TRANSITION: 'Visible Transition',
    NO_LOCATION_MATCH: 'No Location Match', OBJECTION_FAILURE: 'Objection Failure',
    GF_EXPERIENCE: 'GF Experience',
    // AI-detected warning
    DRY_CONVERSATION: 'Dry Conversation', INTERVIEW_MODE: 'Interview Mode',
    NO_HUMANIZING: 'No Humanizing', STAGE_SKIP: 'Stage Skip',
    REAL_TIME_SEXT: 'Generic Sexting', WEAK_PPV_CAPTION: 'Weak PPV Caption',
    // AI-detected positive
    GOOD_OPENER: 'Good Opener', GOOD_LOCATION_MATCH: 'Good Location Match',
    GOOD_HUMANIZING: 'Good Humanizing', GOOD_RAPPORT: 'Good Rapport',
    GOOD_PROFILING: 'Good Profiling', GOOD_TRANSITION: 'Smooth Transition',
    GOOD_SCENARIO_SEXT: 'Good Scenario Sext', GOOD_TONE: 'Good Tone',
    GOOD_OBJECTION_HANDLING: 'Good Objection Handling', GOOD_ENERGY_MATCH: 'Good Energy Match',
    // Rule-detected
    SOLD_TOO_EARLY: 'Sold Too Early', BAD_PRICING: 'Bad Pricing',
    SLOW_REPLY_SELLING: 'Slow Reply (Selling)', FAST_RESPONSE: 'Fast Response',
    SPAMMING: 'Spamming', NO_AFTERCARE: 'No Aftercare',
    NO_FOLLOWUP: 'No Follow-Up', IDLE_TIME: 'Idle Gap',
    SUCCESSFUL_SALE: 'Successful Sale', FAILED_CLOSE: 'Failed Close',
    GOOD_PPV_LOOPING: 'Good PPV Looping'
};

export function AIChatReport() {
    const { chatterId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [report, setReport] = useState(null);
    const [importDates, setImportDates] = useState([]);
    const [selectedImportId, setSelectedImportId] = useState(null);
    const [expandedEvent, setExpandedEvent] = useState(null);
    const [eventSamples, setEventSamples] = useState({});
    const [loadingSamples, setLoadingSamples] = useState(false);

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

    const handleEventClick = useCallback(async (eventType) => {
        if (expandedEvent === eventType) {
            setExpandedEvent(null);
            return;
        }
        setExpandedEvent(eventType);
        if (!eventSamples[eventType]) {
            setLoadingSamples(true);
            const samples = await AIChatReportService.getEventSamples(selectedImportId, Number(chatterId), eventType);
            setEventSamples(prev => ({ ...prev, [eventType]: samples }));
            setLoadingSamples(false);
        }
    }, [expandedEvent, eventSamples, selectedImportId, chatterId]);

    const formatTime = (sec) => {
        if (sec == null) return '--';
        if (sec < 60) return `${Math.round(sec)}s`;
        return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
    };

    const formatDiff = (val, avg, suffix = '', isTime = false) => {
        if (val == null || avg == null || avg === 0) return '--';
        const diff = val - avg;
        const pct = ((diff / avg) * 100).toFixed(1);
        const sign = diff > 0 ? '+' : '';
        const isGood = isTime ? diff < 0 : diff > 0;
        const color = isGood ? 'var(--status-success)' : diff === 0 ? 'var(--text-secondary)' : 'var(--status-danger)';
        return <span style={{ color, fontSize: '0.8rem', fontWeight: 600 }}>{sign}{isTime ? formatTime(Math.abs(diff)) : (suffix === '$' ? `$${Math.abs(diff).toFixed(2)}` : `${Math.abs(pct)}%`)} ({pct}%) {isGood ? '↑' : '↓'}</span>;
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
    const team = report.teamAverages || {};

    // Derived metrics
    const totalSales = report.totalPPVPurchased || 0;
    const failedCloses = (report.totalPPVSent || 0) - totalSales;
    const totalOffers = report.totalPPVSent || 0;
    const offerRate = (report.totalConversations || 0) > 0 ? totalOffers / report.totalConversations : 0;
    const avgOfferValue = totalSales > 0 ? (report.totalRevenue || 0) / totalSales : 0;

    // Sort events: critical first, then warnings, then positive
    const sortedEvents = Object.entries(eventCounts)
        .filter(([, v]) => v > 0)
        .map(([type, count]) => ({ type, count, color: EVENT_COLOR(type) }))
        .sort((a, b) => {
            const order = { danger: 0, warning: 1, success: 2 };
            return (order[a.color] ?? 1) - (order[b.color] ?? 1) || b.count - a.count;
        });

    const tierBadge = (tier) => {
        const map = { top: 'success', average: 'info', at_risk: 'danger' };
        const labels = { top: 'TOP PERFORMER', average: 'AVERAGE', at_risk: 'AT RISK' };
        return <span className={`badge badge-${map[tier] || 'info'}`} style={{ fontSize: '0.85rem', padding: '4px 12px' }}>{labels[tier] || tier}</span>;
    };

    // Team comparison rows
    const teamRows = [
        { label: 'Conversion Rate', yours: `${((report.conversionRate || 0) * 100).toFixed(1)}%`, team: `${((team.conversionRate || 0) * 100).toFixed(1)}%`, diff: formatDiff((report.conversionRate || 0) * 100, (team.conversionRate || 0) * 100, '%') },
        { label: 'Response Time', yours: formatTime(report.avgReplyTimeSec), team: formatTime(team.avgReplyTimeSec), diff: formatDiff(report.avgReplyTimeSec, team.avgReplyTimeSec, '', true) },
        { label: 'Revenue', yours: `$${(report.totalRevenue || 0).toFixed(2)}`, team: `$${(team.totalRevenue || 0).toFixed(2)}`, diff: formatDiff(report.totalRevenue || 0, team.totalRevenue || 0, '$') },
        { label: 'SOP Score', yours: report.avgSopScore != null ? report.avgSopScore.toFixed(0) : '--', team: team.avgSopScore ? team.avgSopScore.toFixed(0) : '--', diff: formatDiff(report.avgSopScore, team.avgSopScore, '') },
        { label: 'Offer Rate', yours: `${(offerRate * 100).toFixed(1)}%`, team: `${((team.offerRate || 0) * 100).toFixed(1)}%`, diff: formatDiff(offerRate * 100, (team.offerRate || 0) * 100, '%') },
    ];

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

                {/* ═══ Performance Summary ═══ */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Performance Summary</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px' }}>
                        <MetricCard label="Total Revenue" value={`$${(report.totalRevenue || 0).toFixed(2)}`} color="var(--status-success)" />
                        <MetricCard label="Conversion Rate" value={`${((report.conversionRate || 0) * 100).toFixed(1)}%`} />
                        <MetricCard label="Avg Response Time" value={formatTime(report.avgReplyTimeSec)} />
                        <MetricCard label="SOP Score" value={report.avgSopScore != null ? `${report.avgSopScore.toFixed(0)}/100` : '--'} color={(report.avgSopScore || 0) >= 75 ? 'var(--status-success)' : (report.avgSopScore || 0) >= 50 ? 'var(--status-warning)' : 'var(--status-danger)'} />
                        <MetricCard label="Total Messages" value={(report.totalMessages || 0).toLocaleString()} />
                        <MetricCard label="Total Conversations" value={report.totalConversations || 0} />
                        <MetricCard label="Total Sales" value={totalSales} color="var(--status-success)" />
                        <MetricCard label="Failed Closes" value={failedCloses} color={failedCloses > 0 ? 'var(--status-danger)' : undefined} />
                        <MetricCard label="Total Offers" value={totalOffers} />
                        <MetricCard label="Offer Rate" value={`${(offerRate * 100).toFixed(1)}%`} />
                        <MetricCard label="Avg Offer Value" value={avgOfferValue > 0 ? `$${avgOfferValue.toFixed(2)}` : '--'} />
                    </div>
                </div>

                {/* ═══ Detected Events ═══ */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Detected Events</h3>
                    {sortedEvents.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No events detected</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                            {sortedEvents.map(({ type, count, color }) => (
                                <div
                                    key={type}
                                    onClick={() => handleEventClick(type)}
                                    style={{
                                        padding: '12px 16px',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        border: `1px solid ${expandedEvent === type ? `var(--status-${color})` : 'var(--border-primary)'}`,
                                        background: expandedEvent === type ? `var(--bg-surface-elevated)` : 'transparent',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{EVENT_LABELS[type] || type.replace(/_/g, ' ')}</span>
                                        <span className={`badge badge-${color}`} style={{ fontSize: '0.8rem', padding: '2px 8px', minWidth: '28px', textAlign: 'center' }}>{count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Event Drill-Down */}
                    {expandedEvent && (
                        <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={`badge badge-${EVENT_COLOR(expandedEvent)}`} style={{ padding: '2px 8px' }}>
                                    {EVENT_LABELS[expandedEvent] || expandedEvent.replace(/_/g, ' ')}
                                </span>
                                Sample Conversations
                            </h4>
                            {loadingSamples ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading samples...</div>
                            ) : (eventSamples[expandedEvent] || []).length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No conversation samples found</div>
                            ) : (
                                (eventSamples[expandedEvent] || []).map((sample, si) => (
                                    <div
                                        key={si}
                                        style={{
                                            marginBottom: '16px',
                                            border: '1px solid var(--border-primary)',
                                            borderRadius: '8px',
                                            overflow: 'hidden',
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => navigate(`/of/ai-chat-replay/${sample.conversationId}`)}
                                    >
                                        {/* Sample header */}
                                        <div style={{ padding: '10px 16px', background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-primary)' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{EVENT_LABELS[expandedEvent] || expandedEvent}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                {sample.description}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                Fan: {sample.fanName} | {sample.messageCount} messages
                                            </div>
                                        </div>
                                        {/* Message excerpt */}
                                        <div style={{ padding: '8px 16px' }}>
                                            {sample.messages.map((msg, mi) => (
                                                <div key={mi} style={{ padding: '4px 0', fontSize: '0.8rem' }}>
                                                    <span style={{ fontWeight: 600, color: msg.sender === 'fan' ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                                        {msg.sender === 'fan' ? sample.fanName : report.chatterName}
                                                    </span>
                                                    {msg.timestamp && (
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    )}
                                                    {msg.price > 0 && (
                                                        <span className={`badge badge-${msg.purchased ? 'success' : 'danger'}`} style={{ fontSize: '0.65rem', marginLeft: '6px', padding: '1px 5px' }}>
                                                            PPV ${msg.price} {msg.purchased ? '✓' : '✗'}
                                                        </span>
                                                    )}
                                                    <div style={{ color: 'var(--text-secondary)', paddingLeft: '4px', marginTop: '2px' }}>
                                                        {(msg.content || '').slice(0, 150)}{(msg.content || '').length > 150 ? '...' : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* ═══ Team Comparison ═══ */}
                {report.teamCount > 1 && (
                    <div className="card" style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Team Comparison</h3>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Metric</th>
                                        <th>Your Performance</th>
                                        <th>Team Average</th>
                                        <th>Difference</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teamRows.map(row => (
                                        <tr key={row.label}>
                                            <td style={{ fontWeight: 500 }}>{row.label}</td>
                                            <td>{row.yours}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{row.team}</td>
                                            <td>{row.diff}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ═══ Coaching ═══ */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Coaching Feedback</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: strengths.length > 0 && weaknesses.length > 0 ? '1fr 1fr' : '1fr', gap: '16px' }}>
                        {strengths.length > 0 && (
                            <div>
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                    <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>Strength</span>
                                </div>
                                {strengths.map((s, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '6px 0 6px 12px', borderLeft: '2px solid var(--status-success)', marginBottom: '4px' }}>
                                        {s}
                                    </div>
                                ))}
                            </div>
                        )}
                        {weaknesses.length > 0 && (
                            <div>
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                    <span className="badge badge-danger" style={{ fontSize: '0.75rem' }}>Needs Work</span>
                                </div>
                                {weaknesses.map((w, i) => (
                                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '6px 0 6px 12px', borderLeft: '2px solid var(--status-danger)', marginBottom: '4px' }}>
                                        {w}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {report.coachingFeedback && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, marginTop: '16px', padding: '12px', background: 'var(--bg-surface-elevated)', borderRadius: '8px' }}>
                            {report.coachingFeedback}
                        </div>
                    )}
                </div>

                {/* ═══ Conversations Table ═══ */}
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
                                                    <span key={i} className={`badge badge-${EVENT_COLOR(e.type)}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                                        {(EVENT_LABELS[e.type] || e.type).slice(0, 15)}
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

function MetricCard({ label, value, color }) {
    return (
        <div style={{
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-primary)',
            background: 'var(--bg-surface)'
        }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
        </div>
    );
}
