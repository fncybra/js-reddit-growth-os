import React, { useState, useEffect, useCallback } from 'react';
import { OFImportService } from '../services/growthEngine';
import { db } from '../db/db';

export function OFImport() {
    const [result, setResult] = useState(null);
    const [importing, setImporting] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [history, setHistory] = useState([]);
    const [expandedModels, setExpandedModels] = useState(new Set());
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        OFImportService.getImportHistory().then(setHistory);
    }, []);

    const handleFile = useCallback(async (file) => {
        if (!file) return;
        setImporting(true);
        setResult(null);
        try {
            const buffer = await file.arrayBuffer();
            const res = await OFImportService.processXLSX(buffer, file.name);
            setResult(res);
            OFImportService.getImportHistory().then(setHistory);
        } catch (e) {
            setResult({ errors: [e.message] });
        } finally {
            setImporting(false);
        }
    }, []);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) handleFile(file);
    }, [handleFile]);

    const onFileSelect = useCallback((e) => {
        handleFile(e.target.files?.[0]);
    }, [handleFile]);

    const toggleModel = (name) => {
        setExpandedModels(prev => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    };

    const catLabel = { va: 'VA', ads: 'Paid Ads', sfs: 'SFS', reddit: 'Reddit', unknown: 'Unknown' };

    const resetAllOFData = useCallback(async () => {
        if (!confirm('This will DELETE all OF import data, snapshots, daily stats, models, VAs, and tracking links. Are you sure?')) return;
        if (!confirm('FINAL WARNING: This cannot be undone. All OF Tracker data will be wiped. Continue?')) return;
        setResetting(true);
        try {
            // Clear local Dexie tables (dependency order)
            await db.ofDailyStats.clear();
            await db.ofLinkSnapshots.clear();
            await db.ofTrackingLinks.clear();
            await db.ofBulkImports.clear();
            await db.ofVas.clear();
            await db.ofModels.clear();
            // Clear cloud Supabase tables
            try {
                const { supabase } = await import('../db/supabase');
                if (supabase) {
                    const tables = ['ofDailyStats', 'ofLinkSnapshots', 'ofTrackingLinks', 'ofBulkImports', 'ofVas', 'ofModels'];
                    for (const t of tables) {
                        await supabase.from(t).delete().gte('id', 0);
                    }
                }
            } catch (e) { console.warn('Cloud reset failed:', e); }
            setResult(null);
            setHistory([]);
            alert('All OF data has been reset. You can now import a fresh XLSX as the new baseline.');
        } catch (e) {
            alert('Reset failed: ' + e.message);
        } finally {
            setResetting(false);
        }
    }, []);

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Import XLSX</h1>
                <button
                    onClick={resetAllOFData}
                    disabled={resetting}
                    className="btn"
                    style={{ backgroundColor: 'var(--status-danger)', color: '#fff', opacity: resetting ? 0.6 : 1 }}
                >
                    {resetting ? 'Resetting...' : 'Reset All OF Data'}
                </button>
            </header>
            <div className="page-content">
                {/* Drop zone */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => document.getElementById('xlsx-input').click()}
                    style={{
                        border: `2px dashed ${dragOver ? '#6366f1' : 'var(--border-light)'}`,
                        borderRadius: '12px', padding: '48px', textAlign: 'center', cursor: 'pointer',
                        backgroundColor: dragOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                        marginBottom: '24px', transition: 'all 0.2s',
                    }}
                >
                    <input id="xlsx-input" type="file" accept=".xlsx,.xls" onChange={onFileSelect} style={{ display: 'none' }} />
                    {importing ? (
                        <div style={{ color: 'var(--accent-primary)', fontSize: '1.1rem' }}>Processing...</div>
                    ) : (
                        <>
                            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📊</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>Drop XLSX file here</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>or click to browse. Filename should contain date (YYYY-MM-DD).</div>
                        </>
                    )}
                </div>

                {/* Import Result */}
                {result && !result.errors?.length && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* KPIs */}
                        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                            <div className="metric-card">
                                <div className="metric-label">Import Date</div>
                                <div className="metric-value" style={{ fontSize: '1.1rem' }}>{result.importDate}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Total Links</div>
                                <div className="metric-value">{result.totalLinks}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">New Subs</div>
                                <div className="metric-value" style={{ color: 'var(--status-success)' }}>+{result.totalNewSubs}</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-label">Models</div>
                                <div className="metric-value">{result.sheetCount}</div>
                            </div>
                        </div>

                        {/* Source Breakdown */}
                        {result.sourceBreakdown.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Source Breakdown</h3>
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead>
                                            <tr><th>Source</th><th>New Subs</th><th>Cumulative</th><th>Links</th></tr>
                                        </thead>
                                        <tbody>
                                            {result.sourceBreakdown.map((s, i) => (
                                                <tr key={i}>
                                                    <td><span className={`badge badge-${s.category === 'va' ? 'success' : s.category === 'ads' ? 'info' : s.category === 'sfs' ? 'warning' : 'danger'}`}>{catLabel[s.category] || s.category}</span></td>
                                                    <td style={{ fontWeight: 600 }}>{s.subs}</td>
                                                    <td>{s.cumulativeSubs.toLocaleString()}</td>
                                                    <td>{s.linkCount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Per-Model Breakdown */}
                        {result.models.length > 0 && (
                            <div className="card">
                                <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Per-Model Breakdown</h3>
                                {result.models.map((m) => (
                                    <div key={m.name} style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '12px', marginBottom: '12px' }}>
                                        <div
                                            onClick={() => toggleModel(m.name)}
                                            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                        >
                                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                {m.links} links | +{m.newSubs} subs | {m.cumulativeSubs.toLocaleString()} total
                                            </span>
                                        </div>
                                        {expandedModels.has(m.name) && m.vaBreakdown.length > 0 && (
                                            <div style={{ marginTop: '8px', paddingLeft: '16px' }}>
                                                {m.vaBreakdown.map((v, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        <span>{v.va}</span>
                                                        <span>+{v.subs} subs ({v.cumulativeSubs.toLocaleString()} total)</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Unmapped Labels Warning */}
                        {result.unmappedLabels.length > 0 && (
                            <div className="card" style={{ borderColor: 'var(--status-warning)' }}>
                                <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--status-warning)' }}>
                                    Unmapped Labels ({result.unmappedLabels.length})
                                </h3>
                                <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                                    {result.unmappedLabels.map((u, i) => (
                                        <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '2px 0' }}>
                                            <strong>{u.model}</strong>: {u.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Errors */}
                {result?.errors?.length > 0 && (
                    <div className="card" style={{ borderColor: 'var(--status-danger)', marginBottom: '24px' }}>
                        <h3 style={{ color: 'var(--status-danger)', marginBottom: '8px' }}>Errors</h3>
                        {result.errors.map((e, i) => <div key={i} style={{ color: 'var(--status-danger)', fontSize: '0.85rem' }}>{e}</div>)}
                    </div>
                )}

                {/* Import History */}
                {history.length > 0 && (
                    <div className="card" style={{ marginTop: '24px' }}>
                        <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Import History</h3>
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr><th>Date</th><th>File</th><th>Sheets</th><th>Links</th><th>New Subs</th></tr>
                                </thead>
                                <tbody>
                                    {history.map(h => (
                                        <tr key={h.id}>
                                            <td>{h.importDate}</td>
                                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.filename}</td>
                                            <td>{h.sheetCount}</td>
                                            <td>{h.totalLinks}</td>
                                            <td style={{ fontWeight: 600, color: 'var(--status-success)' }}>+{h.totalNewSubs}</td>
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
