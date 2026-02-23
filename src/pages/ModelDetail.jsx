import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { AnalyticsEngine } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, Link } from 'react-router-dom';

export function ModelDetail() {
    const { id } = useParams();
    const modelId = Number(id);

    const [metrics, setMetrics] = useState(null);
    const model = useLiveQuery(() => db.models.get(modelId), [modelId]);

    useEffect(() => {
        async function fetchMetrics() {
            if (modelId) {
                const data = await AnalyticsEngine.getMetrics(modelId);
                setMetrics(data);
            }
        }
        fetchMetrics();
    }, [modelId]);

    if (!model) return <div className="page-content">Loading model...</div>;

    const {
        totalViews = 0,
        avgViewsPerPost = 0,
        removalRatePct = 0,
        provenSubs = 0,
        testingSubs = 0
    } = metrics || {};

    const viewTarget = model.weeklyViewTarget || 0;
    const isBelowTarget = totalViews < viewTarget && viewTarget > 0;
    const isHighRemoval = removalRatePct > 20;

    return (
        <>
            <header className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <Link to="/" className="btn" style={{ padding: '6px 12px', backgroundColor: 'var(--surface-color)', color: 'var(--text-secondary)' }}>
                    ← Back to Agency
                </Link>
                <div>
                    <h1 className="page-title">{model.name} Drill-Down</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Growth Pressure Dashboard
                    </div>
                </div>
            </header>
            <div className="page-content">
                <div className="grid-cards mb-6" style={{ marginBottom: '24px' }}>
                    <div className={`card metric-card ${isBelowTarget ? 'danger-border' : ''}`} style={isBelowTarget ? { borderColor: 'var(--status-danger)' } : {}}>
                        <span className="metric-label">Total Views (All Time)</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <span className="metric-value" style={isBelowTarget ? { color: 'var(--status-danger)' } : {}}>
                                {totalViews.toLocaleString()}
                            </span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                / {viewTarget.toLocaleString()} weekly target
                            </span>
                        </div>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label">Avg Views per Post</span>
                        <span className="metric-value">{avgViewsPerPost}</span>
                    </div>

                    <div className={`card metric-card`} style={isHighRemoval ? { borderColor: 'var(--status-danger)' } : {}}>
                        <span className="metric-label">Removal Rate</span>
                        <span className="metric-value" style={isHighRemoval ? { color: 'var(--status-danger)' } : {}}>
                            {removalRatePct}%
                        </span>
                    </div>

                    <div className="card metric-card">
                        <span className="metric-label">Proven Subreddits</span>
                        <span className="metric-value">{provenSubs}</span>
                    </div>
                </div>

                <div className="grid-cards">
                    <div className="card" style={{ gridColumn: 'span 2' }}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Pressure Indicators</h2>
                        <ul style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <PressureItem
                                active={isBelowTarget}
                                title="Below Weekly View Target"
                                description="Increase daily post cap or find new proven subreddits to hit the target."
                            />
                            <PressureItem
                                active={isHighRemoval}
                                title="High Removal Rate Detected"
                                description="Your recent posts are being removed frequently. Check subreddit rules or asset risk."
                            />
                            <PressureItem
                                active={testingSubs === 0}
                                title="Testing Pipeline Empty"
                                description="Add more subreddits to the testing pool to find new proven growth vectors."
                            />
                        </ul>
                    </div>
                </div>
            </div>
        </>
    );
}

function PressureItem({ active, title, description }) {
    if (!active) return null;
    return (
        <li style={{ display: 'flex', gap: '12px', padding: '12px', backgroundColor: 'var(--status-danger-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--status-danger)' }}>
            <div style={{ color: 'var(--status-danger)', marginTop: '2px' }}>⚠️</div>
            <div>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>{title}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{description}</div>
            </div>
        </li>
    );
}
