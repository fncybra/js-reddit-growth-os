import React, { useState, useEffect, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler } from 'chart.js';
import { OFReportService } from '../services/growthEngine';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler);

export function OFDashboard() {
    const [summary, setSummary] = useState(null);
    const [trends, setTrends] = useState([]);
    const [todayStats, setTodayStats] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [s, t, today] = await Promise.all([
                    OFReportService.getSummary(),
                    OFReportService.getTrends(30),
                    OFReportService.getDailyStatsForDate(new Date().toISOString().split('T')[0]),
                ]);
                setSummary(s);
                setTrends(t);
                setTodayStats(today);
            } catch (e) {
                console.error('OFDashboard load error:', e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    const chartData = useMemo(() => ({
        labels: trends.map(t => t.date.slice(5)),
        datasets: [{
            label: 'New Subs',
            data: trends.map(t => t.newSubs),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
        }]
    }), [trends]);

    const chartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a', font: { size: 10 } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a' }, beginAtZero: true },
        }
    }), []);

    if (loading) return <div className="page-content">Loading...</div>;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">OF Dashboard</h1>
            </header>
            <div className="page-content">
                {/* Metric Cards */}
                <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
                    <div className="metric-card">
                        <div className="metric-label">Total Subs</div>
                        <div className="metric-value">{(summary?.totalSubs || 0).toLocaleString()}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Today's Growth</div>
                        <div className="metric-value" style={{ color: (summary?.todayNewSubs || 0) > 0 ? 'var(--status-success)' : 'var(--text-primary)' }}>
                            +{(summary?.todayNewSubs || 0).toLocaleString()}
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Active Models</div>
                        <div className="metric-value">{summary?.totalModels || 0}</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Active VAs</div>
                        <div className="metric-value">{summary?.totalVAs || 0}</div>
                    </div>
                </div>

                {/* Revenue (private — dashboard only) */}
                {(summary?.totalRevenue > 0 || summary?.todayEarnings > 0) && (
                    <div className="card" style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>Revenue (Private)</h3>
                        <div style={{ display: 'flex', gap: '32px' }}>
                            <div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Total Earnings</span>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--status-success)' }}>${(summary?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Today</span>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--status-success)' }}>${(summary?.todayEarnings || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 30-day Trend Chart */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>New Subs — Last 30 Days</h3>
                    <div style={{ height: '250px' }}>
                        {trends.length > 0 ? <Line data={chartData} options={chartOptions} /> : <div style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center' }}>No data yet. Import XLSX to populate.</div>}
                    </div>
                </div>

                {/* Today's Report Table */}
                <div className="card">
                    <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Today's Report</h3>
                    {todayStats.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>No data for today yet.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr><th>Model</th><th>VA</th><th>New Subs</th></tr>
                                </thead>
                                <tbody>
                                    {todayStats.filter(s => s.newSubs > 0).map((s, i) => (
                                        <tr key={i}>
                                            <td>{s.modelName}</td>
                                            <td>{s.vaName}</td>
                                            <td style={{ fontWeight: 600 }}>{s.newSubs}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
