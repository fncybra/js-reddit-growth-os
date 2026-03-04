import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { OFVAPatternService } from '../services/growthEngine';
import { useLiveQuery } from 'dexie-react-hooks';

export function OFConfig() {
    const [tab, setTab] = useState('models');

    const models = useLiveQuery(() => db.ofModels.toArray()) || [];
    const vas = useLiveQuery(() => db.ofVas.toArray()) || [];
    const links = useLiveQuery(() => db.ofTrackingLinks.toArray()) || [];
    const latestImport = useLiveQuery(() => db.ofBulkImports.orderBy('id').reverse().first());

    const [unmapped, setUnmapped] = useState([]);
    const [newModel, setNewModel] = useState({ name: '', ofUsername: '' });
    const [newVA, setNewVA] = useState({ name: '' });
    const [newLink, setNewLink] = useState({ label: '', ofModelId: '', ofVaId: '', platform: '' });

    // Load unmapped labels from latest import
    useEffect(() => {
        if (!latestImport) return;
        db.ofLinkSnapshots.where('importId').equals(latestImport.id).toArray().then(snaps => {
            const unmappedSnaps = snaps.filter(s => s.sourceCategory === 'unknown' || (!s.ofVaId || s.ofVaId < 0));
            const seen = new Set();
            const unique = unmappedSnaps.filter(s => {
                const key = `${s.ofModelId}||${s.label}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            setUnmapped(unique);
        });
    }, [latestImport]);

    const addModel = async () => {
        if (!newModel.name.trim()) return;
        await db.ofModels.add({ id: generateId(), name: newModel.name.trim(), ofUsername: newModel.ofUsername.trim(), active: 1 });
        setNewModel({ name: '', ofUsername: '' });
    };

    const addVA = async () => {
        if (!newVA.name.trim()) return;
        await db.ofVas.add({ id: generateId(), name: newVA.name.trim(), active: 1 });
        setNewVA({ name: '' });
    };

    const addLink = async () => {
        if (!newLink.label.trim() || !newLink.ofModelId) return;
        await db.ofTrackingLinks.add({
            id: generateId(), label: newLink.label.trim(),
            ofModelId: Number(newLink.ofModelId), ofVaId: newLink.ofVaId ? Number(newLink.ofVaId) : null,
            platform: newLink.platform || null,
        });
        setNewLink({ label: '', ofModelId: '', ofVaId: '', platform: '' });
    };

    const deleteModel = async (id) => {
        if (!confirm('Delete this model?')) return;
        await db.ofModels.delete(id);
        // Also delete from cloud so sync doesn't pull it back
        try {
            const { getSupabaseClient } = await import('../db/supabase');
            const supabase = await getSupabaseClient();
            if (supabase) await supabase.from('ofModels').delete().eq('id', id);
        } catch (e) { console.warn('Cloud delete failed:', e); }
    };
    const deleteVA = async (id) => {
        if (!confirm('Delete this VA?')) return;
        await db.ofVas.delete(id);
        try {
            const { getSupabaseClient } = await import('../db/supabase');
            const supabase = await getSupabaseClient();
            if (supabase) await supabase.from('ofVas').delete().eq('id', id);
        } catch (e) { console.warn('Cloud delete failed:', e); }
    };
    const deleteLink = async (id) => {
        if (!confirm('Delete this link?')) return;
        await db.ofTrackingLinks.delete(id);
        try {
            const { getSupabaseClient } = await import('../db/supabase');
            const supabase = await getSupabaseClient();
            if (supabase) await supabase.from('ofTrackingLinks').delete().eq('id', id);
        } catch (e) { console.warn('Cloud delete failed:', e); }
    };

    const assignVA = async (snap, vaId) => {
        if (!vaId) return;
        // Create tracking link
        const existing = await db.ofTrackingLinks.where('label').equals(snap.label).and(r => r.ofModelId === snap.ofModelId).first();
        if (!existing) {
            await db.ofTrackingLinks.add({
                id: generateId(), label: snap.label, ofModelId: snap.ofModelId,
                ofVaId: Number(vaId), platform: OFVAPatternService.detectPlatform(snap.label, snap.source || ''),
            });
        } else {
            await db.ofTrackingLinks.update(existing.id, { ofVaId: Number(vaId) });
        }
        // Update snapshot
        await db.ofLinkSnapshots.update(snap.id, { ofVaId: Number(vaId), sourceCategory: 'va' });
        // Refresh unmapped
        setUnmapped(prev => prev.filter(u => u.id !== snap.id));
    };

    const modelMap = new Map(models.map(m => [m.id, m.name]));

    const tabStyle = (t) => ({
        padding: '8px 20px', border: 'none', borderRadius: '6px 6px 0 0', cursor: 'pointer',
        backgroundColor: tab === t ? 'var(--bg-surface-elevated)' : 'transparent',
        color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: tab === t ? 600 : 400, fontSize: '0.9rem',
    });

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">OF Configuration</h1>
            </header>
            <div className="page-content">
                {/* Tab buttons */}
                <div style={{ display: 'flex', gap: '4px', marginBottom: '0', borderBottom: '1px solid var(--border-light)' }}>
                    <button style={tabStyle('models')} onClick={() => setTab('models')}>Models</button>
                    <button style={tabStyle('vas')} onClick={() => setTab('vas')}>VAs</button>
                    <button style={tabStyle('links')} onClick={() => setTab('links')}>Tracking Links</button>
                    <button style={tabStyle('unmapped')} onClick={() => setTab('unmapped')}>
                        Unmapped {unmapped.length > 0 && <span className="badge badge-warning" style={{ marginLeft: '4px', fontSize: '0.7rem' }}>{unmapped.length}</span>}
                    </button>
                </div>

                <div className="card" style={{ borderTopLeftRadius: 0 }}>
                    {/* Models Tab */}
                    {tab === 'models' && (
                        <>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                <input className="input-field" placeholder="Model name" value={newModel.name} onChange={e => setNewModel({ ...newModel, name: e.target.value })} style={{ flex: 1 }} />
                                <input className="input-field" placeholder="OF username (optional)" value={newModel.ofUsername} onChange={e => setNewModel({ ...newModel, ofUsername: e.target.value })} style={{ flex: 1 }} />
                                <button className="btn btn-primary" onClick={addModel}>Add</button>
                            </div>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead><tr><th>Name</th><th>OF Username</th><th>Active</th><th></th></tr></thead>
                                    <tbody>
                                        {models.map(m => (
                                            <tr key={m.id}>
                                                <td style={{ fontWeight: 600 }}>{m.name}</td>
                                                <td>{m.ofUsername || '-'}</td>
                                                <td><span className={`badge ${m.active ? 'badge-success' : 'badge-danger'}`}>{m.active ? 'Yes' : 'No'}</span></td>
                                                <td>
                                                    <button onClick={() => db.ofModels.update(m.id, { active: m.active ? 0 : 1 })} className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', marginRight: '4px' }}>Toggle</button>
                                                    <button onClick={() => deleteModel(m.id)} className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--status-danger)' }}>Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* VAs Tab */}
                    {tab === 'vas' && (
                        <>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                <input className="input-field" placeholder="VA name" value={newVA.name} onChange={e => setNewVA({ name: e.target.value })} style={{ flex: 1 }} />
                                <button className="btn btn-primary" onClick={addVA}>Add</button>
                            </div>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead><tr><th>Name</th><th>Active</th><th></th></tr></thead>
                                    <tbody>
                                        {vas.map(v => (
                                            <tr key={v.id}>
                                                <td style={{ fontWeight: 600 }}>{v.name}</td>
                                                <td><span className={`badge ${v.active ? 'badge-success' : 'badge-danger'}`}>{v.active ? 'Yes' : 'No'}</span></td>
                                                <td>
                                                    <button onClick={() => db.ofVas.update(v.id, { active: v.active ? 0 : 1 })} className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', marginRight: '4px' }}>Toggle</button>
                                                    <button onClick={() => deleteVA(v.id)} className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--status-danger)' }}>Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* Tracking Links Tab */}
                    {tab === 'links' && (
                        <>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                <input className="input-field" placeholder="Label" value={newLink.label} onChange={e => setNewLink({ ...newLink, label: e.target.value })} style={{ flex: 2, minWidth: '150px' }} />
                                <select className="input-field" value={newLink.ofModelId} onChange={e => setNewLink({ ...newLink, ofModelId: e.target.value })} style={{ flex: 1, minWidth: '120px' }}>
                                    <option value="">Model...</option>
                                    {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                                <select className="input-field" value={newLink.ofVaId} onChange={e => setNewLink({ ...newLink, ofVaId: e.target.value })} style={{ flex: 1, minWidth: '120px' }}>
                                    <option value="">VA (optional)...</option>
                                    {vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                                <button className="btn btn-primary" onClick={addLink}>Add</button>
                            </div>
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead><tr><th>Label</th><th>Model</th><th>VA</th><th>Platform</th><th></th></tr></thead>
                                    <tbody>
                                        {links.map(l => (
                                            <tr key={l.id}>
                                                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</td>
                                                <td>{modelMap.get(l.ofModelId) || '-'}</td>
                                                <td>{vas.find(v => v.id === l.ofVaId)?.name || '-'}</td>
                                                <td>{l.platform || '-'}</td>
                                                <td><button onClick={() => deleteLink(l.id)} className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--status-danger)' }}>Delete</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* Unmapped Tab */}
                    {tab === 'unmapped' && (
                        <>
                            {unmapped.length === 0 ? (
                                <div style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center' }}>No unmapped labels. All good!</div>
                            ) : (
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead><tr><th>Label</th><th>Model</th><th>Assign VA</th></tr></thead>
                                        <tbody>
                                            {unmapped.map(u => (
                                                <tr key={u.id}>
                                                    <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.label}</td>
                                                    <td>{modelMap.get(u.ofModelId) || '-'}</td>
                                                    <td>
                                                        <select className="input-field" style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                            onChange={e => assignVA(u, e.target.value)} defaultValue="">
                                                            <option value="">Select VA...</option>
                                                            {vas.filter(v => v.active).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                        </select>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
