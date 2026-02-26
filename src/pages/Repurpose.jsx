import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { SettingsService } from '../services/growthEngine';

export function Repurpose() {
    const models = useLiveQuery(() => db.models.toArray());
    const assets = useLiveQuery(() => db.assets.toArray());
    const tasks = useLiveQuery(() => db.tasks.toArray());
    const [modelFilter, setModelFilter] = useState('all');
    const [cooldownDays, setCooldownDays] = useState(30);

    React.useEffect(() => {
        async function loadSettings() {
            const s = await SettingsService.getSettings();
            if (s?.assetReuseCooldownDays) setCooldownDays(Number(s.assetReuseCooldownDays));
        }
        loadSettings();
    }, []);

    const rows = useMemo(() => {
        if (!assets || !tasks) return [];

        const taskByAsset = new Map();
        tasks.forEach(t => {
            if (!t.assetId) return;
            if (!taskByAsset.has(t.assetId)) taskByAsset.set(t.assetId, []);
            taskByAsset.get(t.assetId).push(t);
        });

        const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
        return assets
            .filter(a => modelFilter === 'all' || String(a.modelId) === String(modelFilter))
            .filter(a => Number(a.timesUsed || 0) > 0)
            .map(asset => {
                const linked = taskByAsset.get(asset.id) || [];
                const lastUsedMs = asset.lastUsedDate ? new Date(asset.lastUsedDate).getTime() : 0;
                const ready = !!lastUsedMs && lastUsedMs <= cutoff;
                return {
                    id: asset.id,
                    modelId: asset.modelId,
                    modelName: models?.find(m => m.id === asset.modelId)?.name || 'Unknown',
                    fileName: asset.fileName || `${asset.assetType || 'asset'}-${asset.id}`,
                    assetType: asset.assetType || 'unknown',
                    angleTag: asset.angleTag || 'general',
                    timesUsed: Number(asset.timesUsed || 0),
                    lastUsedDate: asset.lastUsedDate,
                    subredditCount: new Set(linked.map(t => t.subredditId).filter(Boolean)).size,
                    ready,
                    spoofReady: !!asset.spoofReady,
                };
            })
            .sort((a, b) => {
                if (a.ready !== b.ready) return a.ready ? -1 : 1;
                return (b.timesUsed || 0) - (a.timesUsed || 0);
            });
    }, [assets, tasks, models, modelFilter, cooldownDays]);

    const readyCount = rows.filter(r => r.ready).length;

    return (
        <>
            <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                    <h1 className="page-title">Repurpose Ready</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Assets used before that are now eligible again after cooldown. Mark spoof queue for VA reuse.
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select className="input-field" value={modelFilter} onChange={e => setModelFilter(e.target.value)} style={{ width: 'auto' }}>
                        <option value="all">All Models</option>
                        {models?.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                    </select>
                    <input
                        type="number"
                        className="input-field"
                        value={cooldownDays}
                        onChange={e => setCooldownDays(Number(e.target.value || 0))}
                        style={{ width: '100px' }}
                        min={1}
                    />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>days cooldown</span>
                </div>
            </header>

            <div className="page-content">
                <div className="card" style={{ marginBottom: '16px' }}>
                    <strong style={{ color: 'var(--status-success)' }}>{readyCount}</strong> assets ready to repurpose now.
                </div>

                <div className="card">
                    {rows.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No used assets found yet.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Asset</th>
                                        <th>Model</th>
                                        <th>Tag</th>
                                        <th>Used</th>
                                        <th>Subreddits</th>
                                        <th>Last Used</th>
                                        <th>Status</th>
                                        <th>Spoof Queue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.id}>
                                            <td>{r.fileName}</td>
                                            <td>{r.modelName}</td>
                                            <td><span className="badge badge-info">{r.angleTag}</span></td>
                                            <td>{r.timesUsed}</td>
                                            <td>{r.subredditCount}</td>
                                            <td>{r.lastUsedDate ? new Date(r.lastUsedDate).toLocaleDateString() : '-'}</td>
                                            <td>
                                                <span className={`badge ${r.ready ? 'badge-success' : 'badge-warning'}`}>
                                                    {r.ready ? 'Ready' : 'Cooling'}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className={`btn ${r.spoofReady ? 'btn-primary' : 'btn-outline'}`}
                                                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                                    onClick={async () => {
                                                        await db.assets.update(r.id, { spoofReady: r.spoofReady ? 0 : 1 });
                                                    }}
                                                >
                                                    {r.spoofReady ? 'Queued' : 'Mark'}
                                                </button>
                                            </td>
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
