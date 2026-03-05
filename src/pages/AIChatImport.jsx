import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIChatImportService, AIChatGradingService } from '../services/growthEngine';

export function AIChatImport() {
    const navigate = useNavigate();
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [history, setHistory] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        AIChatImportService.getImportHistory().then(setHistory);
    }, []);

    const handleFile = useCallback(async (file) => {
        if (!file) return;

        // Large XLSX files crash the browser — xlsx library needs 10-30x file size in RAM
        // A 44MB XLSX needs ~1.4GB RAM which exceeds Chrome's tab limit
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const MAX_XLSX_MB = 10;
        if (isExcel && file.size > MAX_XLSX_MB * 1024 * 1024) {
            setError(`Excel file too large (${(file.size / 1024 / 1024).toFixed(0)}MB). Excel files over ${MAX_XLSX_MB}MB crash the browser.\n\nFix: In Inflow, export as CSV instead of Excel. Or open this file in Excel/Google Sheets and Save As → CSV.`);
            return;
        }

        setImporting(true);
        setResult(null);
        setError(null);
        setCostEstimate(null);
        try {
            // Pass File object directly — streaming CSV parser reads in chunks, never loads full file
            const res = await AIChatImportService.processFile(file, file.name, setProgress);
            setResult(res);
            // Auto-grade with rules (instant, free)
            setProgress({ phase: 'grading', current: 0, total: res.totalConversations, label: 'Analyzing conversations...' });
            await AIChatGradingService.ruleBasedGradeImport(res.importId, setProgress);
            setProgress({ phase: 'done', label: 'Import & analysis complete! View the leaderboard.' });
            AIChatImportService.getImportHistory().then(setHistory);
        } catch (e) {
            setError(e.message);
        } finally {
            setImporting(false);
        }
    }, []);

    const handleDelete = useCallback(async (importId) => {
        if (!confirm('Delete this import and all associated grades/reports?')) return;
        await AIChatImportService.deleteImport(importId);
        AIChatImportService.getImportHistory().then(setHistory);
        if (result?.importId === importId) {
            setResult(null);
            setCostEstimate(null);
        }
    }, [result]);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) handleFile(file);
    }, [handleFile]);

    const onFileSelect = useCallback((e) => {
        handleFile(e.target.files?.[0]);
    }, [handleFile]);

    const formatReplyTime = (sec) => {
        if (sec == null) return '--';
        if (sec < 60) return `${sec}s`;
        return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    };

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">AI Chat Import</h1>
            </header>
            <div className="page-content">
                {/* Drop zone */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => document.getElementById('ai-chat-input').click()}
                    style={{
                        border: `2px dashed ${dragOver ? '#6366f1' : 'var(--border-light)'}`,
                        borderRadius: '12px', padding: '48px', textAlign: 'center', cursor: 'pointer',
                        backgroundColor: dragOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                        marginBottom: '24px', transition: 'all 0.2s',
                    }}
                >
                    <input id="ai-chat-input" type="file" accept=".xlsx,.xls,.csv" onChange={onFileSelect} style={{ display: 'none' }} />
                    {importing ? (
                        <div>
                            <div style={{ color: 'var(--accent-primary)', fontSize: '1.1rem', marginBottom: '8px' }}>
                                {progress?.label || 'Processing...'}
                            </div>
                            {progress?.total > 0 && (
                                <div style={{ maxWidth: '400px', margin: '0 auto' }}>
                                    <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                        <div style={{ background: '#6366f1', height: '100%', width: `${Math.round((progress.current / progress.total) * 100)}%`, transition: 'width 0.3s' }} />
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '4px' }}>
                                        {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💬</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>Drop Inflow export here</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>CSV recommended for large exports. Small Excel files (.xlsx) also accepted.</div>
                        </>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="card" style={{ borderColor: 'var(--status-danger)', marginBottom: '24px' }}>
                        <div style={{ color: 'var(--status-danger)', fontSize: '0.9rem', whiteSpace: 'pre-line' }}>{error}</div>
                    </div>
                )}

                {/* Import Result */}
                {result && !result.errors?.length && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* KPIs */}
                        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                            <div className="metric-card">
                                <div className="metric-label">Import Date</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>{result.importDate}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Messages</div>
                                <div className="metric-value">{result.totalMessages.toLocaleString()}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Conversations</div>
                                <div className="metric-value">{result.totalConversations.toLocaleString()}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Chatters</div>
                                <div className="metric-value">{result.totalChatters}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Revenue</div>
                                <div className="metric-value" style={{ color: 'var(--status-success)' }}>${result.totalRevenue.toFixed(2)}</div>
                            </div>
                        </div>

                        {/* Result actions */}
                        <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
                            {progress?.phase === 'done' ? (
                                <div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>Analysis Complete!</div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => navigate('/of/ai-chat-leaderboard')}
                                        style={{ padding: '12px 32px', fontSize: '1rem' }}
                                    >
                                        View Leaderboard →
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>
                                        {result.totalConversations} conversations analyzed across {result.totalChatters} chatters
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => navigate('/of/ai-chat-leaderboard')}
                                        style={{ padding: '12px 32px', fontSize: '1rem' }}
                                    >
                                        View Leaderboard →
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Import History */}
                {history.length > 0 && (
                    <div className="card" style={{ marginTop: '24px' }}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Import History</h3>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>File</th>
                                        <th>Messages</th>
                                        <th>Conversations</th>
                                        <th>Chatters</th>
                                        <th>Revenue</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map(h => (
                                        <tr key={h.id}>
                                            <td>{h.importDate}</td>
                                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.filename}</td>
                                            <td>{(h.totalMessages || 0).toLocaleString()}</td>
                                            <td>{(h.totalConversations || 0).toLocaleString()}</td>
                                            <td>{h.totalChatters || 0}</td>
                                            <td style={{ color: 'var(--status-success)' }}>${(h.totalRevenue || 0).toFixed(2)}</td>
                                            <td>
                                                <span className={`badge badge-${h.status === 'complete' ? 'success' : h.status === 'imported' ? 'info' : h.status === 'failed' ? 'danger' : 'warning'}`}>
                                                    {h.status || 'unknown'}
                                                </span>
                                            </td>
                                            <td style={{ display: 'flex', gap: '8px' }}>
                                                {h.status === 'complete' && (
                                                    <button
                                                        className="btn btn-outline"
                                                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                                        onClick={() => navigate('/of/ai-chat-leaderboard')}
                                                    >
                                                        View
                                                    </button>
                                                )}
                                                <button
                                                    className="btn"
                                                    style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--status-danger)', background: 'transparent', border: '1px solid var(--status-danger)' }}
                                                    onClick={() => handleDelete(h.id)}
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
