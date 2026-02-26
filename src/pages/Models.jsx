import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Models() {
    const models = useLiveQuery(() => db.models.toArray());
    const [formData, setFormData] = useState({
        name: '', primaryNiche: '', weeklyViewTarget: 50000, weeklyPostTarget: 50, driveFolderId: '', usedFolderId: '', redgifsProfile: '', proxyInfo: '', vaPin: ''
    });
    const [editingModel, setEditingModel] = useState(null); // { id, name, primaryNiche, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!formData.name) return;

        const newModelId = await db.models.add({
            ...formData,
            weeklyViewTarget: Number(formData.weeklyViewTarget),
            weeklyPostTarget: Number(formData.weeklyPostTarget),
            status: 'active'
        });

        // Immediately push to cloud so the model survives CloudSync pulls
        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['models']);
        } catch (e) { console.error('Auto-push after model add failed:', e); }

        // If Drive folder is provided, auto-sync assets for the new model immediately
        if (formData.driveFolderId && String(formData.driveFolderId).trim()) {
            try {
                const { DriveSyncService } = await import('../services/growthEngine');
                const { newCount } = await DriveSyncService.syncModelFolder(Number(newModelId), 30);
                if (newCount > 0) {
                    alert(`Model created and ${newCount} Drive assets synced.`);
                }
            } catch (e) {
                console.error('Auto Drive sync after model add failed:', e);
                alert(`Model created, but Drive sync failed: ${e.message}`);
            }
        }

        setFormData({ name: '', primaryNiche: '', weeklyViewTarget: 50000, weeklyPostTarget: 50, driveFolderId: '', usedFolderId: '', redgifsProfile: '', proxyInfo: '', vaPin: '' });
    }

    async function toggleStatus(id, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'paused' : 'active';
        await db.models.update(id, { status: newStatus });
        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['models']);
        } catch (e) { console.error('Auto-push after toggle failed:', e); }
    }

    function startEditing(model) {
        setEditingModel({
            id: model.id,
            name: model.name || '',
            primaryNiche: model.primaryNiche || '',
            driveFolderId: model.driveFolderId || '',
            usedFolderId: model.usedFolderId || '',
            redgifsProfile: model.redgifsProfile || '',
            proxyInfo: model.proxyInfo || '',
            vaPin: model.vaPin || ''
        });
    }

    async function saveEdit() {
        if (!editingModel) return;
        await db.models.update(editingModel.id, {
            name: editingModel.name,
            primaryNiche: editingModel.primaryNiche,
            driveFolderId: editingModel.driveFolderId,
            usedFolderId: editingModel.usedFolderId,
            redgifsProfile: editingModel.redgifsProfile,
            proxyInfo: editingModel.proxyInfo,
            vaPin: editingModel.vaPin
        });
        // Push edit to cloud immediately
        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['models']);
        } catch (e) { console.error('Auto-push after edit failed:', e); }
        setEditingModel(null);
    }

    async function handleDelete(id, name) {
        if (window.confirm(`Delete model "${name}"? This cannot be undone.`)) {
            await db.models.delete(id);
            try {
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.deleteFromCloud('models', id);
            } catch (e) { console.error('Cloud delete failed:', e); }
        }
    }

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Models</h1>
            </header>
            <div className="page-content">
                <div className="grid-cards mb-6" style={{ marginBottom: '32px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Add New Model</h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div className="input-group">
                                    <label className="input-label">Model Name</label>
                                    <input className="input-field" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Jane Doe" required />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Primary Niche</label>
                                    <input className="input-field" value={formData.primaryNiche} onChange={e => setFormData({ ...formData, primaryNiche: e.target.value })} placeholder="e.g. Fitness" />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div className="input-group">
                                    <label className="input-label">Weekly View Target</label>
                                    <input type="number" className="input-field" value={formData.weeklyViewTarget} onChange={e => setFormData({ ...formData, weeklyViewTarget: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Weekly Post Target</label>
                                    <input type="number" className="input-field" value={formData.weeklyPostTarget} onChange={e => setFormData({ ...formData, weeklyPostTarget: e.target.value })} />
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-color)', margin: '16px 0', paddingTop: '16px' }}>
                                <h3 style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>Google Drive Integration (Optional)</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div className="input-group">
                                        <label className="input-label">Source Folder ID</label>
                                        <input className="input-field" value={formData.driveFolderId} onChange={e => setFormData({ ...formData, driveFolderId: e.target.value })} placeholder="Google Drive Folder ID" />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">"Used" Folder ID</label>
                                        <input className="input-field" value={formData.usedFolderId} onChange={e => setFormData({ ...formData, usedFolderId: e.target.value })} placeholder="Google Drive Folder ID" />
                                    </div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-color)', margin: '16px 0', paddingTop: '16px' }}>
                                <h3 style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>Scaling Optimization & Access</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div className="input-group">
                                        <label className="input-label">Dedicated VA Login PIN</label>
                                        <input className="input-field" value={formData.vaPin} onChange={e => setFormData({ ...formData, vaPin: e.target.value })} placeholder="e.g. 5555" />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">RedGifs Profile URL</label>
                                        <input className="input-field" value={formData.redgifsProfile} onChange={e => setFormData({ ...formData, redgifsProfile: e.target.value })} placeholder="https://www.redgifs.com/users/your_name" />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">Default Proxy (IP:Port:User:Pass)</label>
                                        <input className="input-field" value={formData.proxyInfo} onChange={e => setFormData({ ...formData, proxyInfo: e.target.value })} placeholder="Optional defaults for VA" />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>Create Model</button>
                        </form>
                    </div>
                </div>

                <div className="card">
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Managed Models</h2>
                    {models?.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No models found.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Niche</th>
                                        <th>Drive Linked?</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {models?.map(model => (
                                        <React.Fragment key={model.id}>
                                            <tr>
                                                <td style={{ fontWeight: '500' }}>{model.name}</td>
                                                <td>{model.primaryNiche}</td>
                                                <td>{model.driveFolderId ? '✅ Connected' : '❌ No'}</td>
                                                <td>
                                                    <span className={`badge ${model.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                                                        {model.status}
                                                    </span>
                                                </td>
                                                <td style={{ display: 'flex', gap: '8px' }}>
                                                    <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => toggleStatus(model.id, model.status)}>
                                                        {model.status === 'active' ? 'Pause' : 'Activate'}
                                                    </button>
                                                    <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem', color: 'var(--primary-color)', borderColor: 'var(--primary-color)' }} onClick={() => startEditing(model)}>
                                                        ✏️ Edit
                                                    </button>
                                                    <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }} onClick={() => handleDelete(model.id, model.name)}>
                                                        🗑️
                                                    </button>
                                                </td>
                                            </tr>
                                            {editingModel?.id === model.id && (
                                                <tr>
                                                    <td colSpan="5" style={{ padding: '16px', backgroundColor: 'rgba(99, 102, 241, 0.05)', borderTop: '2px solid var(--primary-color)' }}>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>Model Name</label>
                                                                <input className="input-field" value={editingModel.name} onChange={e => setEditingModel({ ...editingModel, name: e.target.value })} />
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>Primary Niche</label>
                                                                <input className="input-field" value={editingModel.primaryNiche} onChange={e => setEditingModel({ ...editingModel, primaryNiche: e.target.value })} />
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>📁 APPROVED Folder ID (Source)</label>
                                                                <input className="input-field" value={editingModel.driveFolderId} onChange={e => setEditingModel({ ...editingModel, driveFolderId: e.target.value })} placeholder="Paste folder ID from Google Drive URL" />
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>🗑️ USED Folder ID (Graveyard)</label>
                                                                <input className="input-field" value={editingModel.usedFolderId} onChange={e => setEditingModel({ ...editingModel, usedFolderId: e.target.value })} placeholder="Paste folder ID from Google Drive URL" />
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>🔐 VA Login PIN</label>
                                                                <input className="input-field" value={editingModel.vaPin} onChange={e => setEditingModel({ ...editingModel, vaPin: e.target.value })} placeholder="e.g 5555" />
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>📼 RedGifs Profile URL</label>
                                                                <input className="input-field" value={editingModel.redgifsProfile} onChange={e => setEditingModel({ ...editingModel, redgifsProfile: e.target.value })} />
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>🌐 Default Proxy</label>
                                                                <input className="input-field" value={editingModel.proxyInfo} onChange={e => setEditingModel({ ...editingModel, proxyInfo: e.target.value })} />
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button className="btn btn-primary" style={{ padding: '8px 20px' }} onClick={saveEdit}>💾 Save Changes</button>
                                                            <button className="btn btn-outline" style={{ padding: '8px 20px' }} onClick={() => setEditingModel(null)}>Cancel</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
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

