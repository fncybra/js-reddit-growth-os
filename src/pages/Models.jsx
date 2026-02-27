import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Models() {
    const buildVoiceSummary = (input = {}) => {
        const archetype = input.voiceArchetype || 'general';
        const tone = input.voiceTone || 'teasing';
        const energy = input.voiceEnergy || 'medium';
        const noGo = input.voiceNoGo || 'no-cta';
        const age = String(input.identityAge || '').trim();
        const hair = String(input.identityHairColor || '').trim();
        const body = String(input.identityBodyType || '').trim();
        const ethnicity = String(input.identityEthnicity || '').trim();
        const state = String(input.identityCurrentState || '').trim();
        const nicheKeywords = String(input.identityNicheKeywords || '').trim();
        const note = String(input.voiceNotes || '').trim();

        const anchors = [];
        if (age) anchors.push(`Age: ${age}`);
        if (hair) anchors.push(`Hair: ${hair}`);
        if (body) anchors.push(`Body: ${body}`);
        if (ethnicity) anchors.push(`Ethnicity/Vibe: ${ethnicity}`);
        if (state) anchors.push(`Current state: ${state}`);
        if (nicheKeywords) anchors.push(`Niche keywords: ${nicheKeywords}`);

        const line = `Archetype: ${archetype}; Tone: ${tone}; Energy: ${energy}; No-go: ${noGo}; Anchors: ${anchors.length > 0 ? anchors.join(' | ') : 'none provided'}.`;
        return note ? `${line} Note: ${note}` : line;
    };

    const models = useLiveQuery(() => db.models.toArray());
    const [formData, setFormData] = useState({
        name: '', primaryNiche: '', weeklyViewTarget: 50000, weeklyPostTarget: 50, driveFolderId: '', usedFolderId: '', redgifsProfile: '', redgifsUploadEndpoint: '', redgifsApiToken: '', proxyInfo: '', vaPin: '',
        voiceArchetype: 'general', voiceTone: 'teasing', voiceEnergy: 'medium', voiceNoGo: 'no-cta', voiceNotes: '',
        identityAge: '', identityHairColor: '', identityBodyType: '', identityEthnicity: '', identityCurrentState: '', identityNicheKeywords: ''
    });
    const [editingModel, setEditingModel] = useState(null); // { id, name, primaryNiche, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!formData.name) return;

        const newModelId = await db.models.add({
            ...formData,
            voiceProfile: buildVoiceSummary(formData),
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

        setFormData({
            name: '', primaryNiche: '', weeklyViewTarget: 50000, weeklyPostTarget: 50, driveFolderId: '', usedFolderId: '', redgifsProfile: '', redgifsUploadEndpoint: '', redgifsApiToken: '', proxyInfo: '', vaPin: '',
            voiceArchetype: 'general', voiceTone: 'teasing', voiceEnergy: 'medium', voiceNoGo: 'no-cta', voiceNotes: '',
            identityAge: '', identityHairColor: '', identityBodyType: '', identityEthnicity: '', identityCurrentState: '', identityNicheKeywords: ''
        });
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
            redgifsUploadEndpoint: model.redgifsUploadEndpoint || '',
            redgifsApiToken: model.redgifsApiToken || '',
            proxyInfo: model.proxyInfo || '',
            vaPin: model.vaPin || '',
            voiceArchetype: model.voiceArchetype || 'general',
            voiceTone: model.voiceTone || 'teasing',
            voiceEnergy: model.voiceEnergy || 'medium',
            voiceNoGo: model.voiceNoGo || 'no-cta',
            voiceNotes: model.voiceNotes || '',
            identityAge: model.identityAge || '',
            identityHairColor: model.identityHairColor || '',
            identityBodyType: model.identityBodyType || '',
            identityEthnicity: model.identityEthnicity || '',
            identityCurrentState: model.identityCurrentState || '',
            identityNicheKeywords: model.identityNicheKeywords || ''
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
            redgifsUploadEndpoint: editingModel.redgifsUploadEndpoint,
            redgifsApiToken: editingModel.redgifsApiToken,
            proxyInfo: editingModel.proxyInfo,
            vaPin: editingModel.vaPin,
            voiceArchetype: editingModel.voiceArchetype,
            voiceTone: editingModel.voiceTone,
            voiceEnergy: editingModel.voiceEnergy,
            voiceNoGo: editingModel.voiceNoGo,
            voiceNotes: editingModel.voiceNotes,
            identityAge: editingModel.identityAge,
            identityHairColor: editingModel.identityHairColor,
            identityBodyType: editingModel.identityBodyType,
            identityEthnicity: editingModel.identityEthnicity,
            identityCurrentState: editingModel.identityCurrentState,
            identityNicheKeywords: editingModel.identityNicheKeywords,
            voiceProfile: buildVoiceSummary(editingModel)
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
            try {
                const { CloudSyncService } = await import('../services/growthEngine');
                const modelId = Number(id);
                const [accounts, subreddits, assets, tasks] = await Promise.all([
                    db.accounts.where('modelId').equals(modelId).toArray(),
                    db.subreddits.where('modelId').equals(modelId).toArray(),
                    db.assets.where('modelId').equals(modelId).toArray(),
                    db.tasks.where('modelId').equals(modelId).toArray(),
                ]);

                const taskIds = tasks.map(t => t.id);
                const performances = taskIds.length > 0
                    ? await db.performances.where('taskId').anyOf(taskIds).toArray()
                    : [];

                const performanceIds = performances.map(p => p.id);
                const accountIds = accounts.map(a => a.id);
                const subredditIds = subreddits.map(s => s.id);
                const assetIds = assets.map(a => a.id);

                await db.transaction('rw', db.performances, db.tasks, db.assets, db.subreddits, db.accounts, db.models, async () => {
                    if (performanceIds.length > 0) await db.performances.bulkDelete(performanceIds);
                    if (taskIds.length > 0) await db.tasks.bulkDelete(taskIds);
                    if (assetIds.length > 0) await db.assets.bulkDelete(assetIds);
                    if (subredditIds.length > 0) await db.subreddits.bulkDelete(subredditIds);
                    if (accountIds.length > 0) await db.accounts.bulkDelete(accountIds);
                    await db.models.delete(modelId);
                });

                const CHUNK_SIZE = 200;
                for (let i = 0; i < performanceIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('performances', performanceIds.slice(i, i + CHUNK_SIZE));
                }
                for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('tasks', taskIds.slice(i, i + CHUNK_SIZE));
                }
                for (let i = 0; i < assetIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('assets', assetIds.slice(i, i + CHUNK_SIZE));
                }
                for (let i = 0; i < subredditIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('subreddits', subredditIds.slice(i, i + CHUNK_SIZE));
                }
                for (let i = 0; i < accountIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('accounts', accountIds.slice(i, i + CHUNK_SIZE));
                }
                await CloudSyncService.deleteFromCloud('models', modelId);
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
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div className="input-group">
                                        <label className="input-label">RedGifs Upload Endpoint</label>
                                        <input className="input-field" value={formData.redgifsUploadEndpoint} onChange={e => setFormData({ ...formData, redgifsUploadEndpoint: e.target.value })} placeholder="https://.../redgifs/upload" />
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">RedGifs API Token</label>
                                        <input type="password" className="input-field" value={formData.redgifsApiToken} onChange={e => setFormData({ ...formData, redgifsApiToken: e.target.value })} placeholder="Model-specific token" />
                                    </div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-color)', margin: '16px 0', paddingTop: '16px' }}>
                                <h3 style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>AI Persona Builder (Brain-Dead Inputs)</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div className="input-group"><label className="input-label">Archetype</label><select className="input-field" value={formData.voiceArchetype} onChange={e => setFormData({ ...formData, voiceArchetype: e.target.value })}><option value="general">General</option><option value="milf">MILF</option><option value="pregnant">Pregnant</option><option value="girl-next-door">Girl Next Door</option><option value="alt">Alt</option></select></div>
                                    <div className="input-group"><label className="input-label">Tone</label><select className="input-field" value={formData.voiceTone} onChange={e => setFormData({ ...formData, voiceTone: e.target.value })}><option value="teasing">Teasing</option><option value="sweet">Sweet</option><option value="bratty">Bratty</option><option value="dominant">Dominant</option></select></div>
                                    <div className="input-group"><label className="input-label">Energy</label><select className="input-field" value={formData.voiceEnergy} onChange={e => setFormData({ ...formData, voiceEnergy: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
                                    <div className="input-group"><label className="input-label">Hard No Style</label><select className="input-field" value={formData.voiceNoGo} onChange={e => setFormData({ ...formData, voiceNoGo: e.target.value })}><option value="no-cta">No CTA bait</option><option value="no-swipe">No swipe/carousel text</option><option value="no-promo">No promo wording</option></select></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div className="input-group"><label className="input-label">Age</label><input className="input-field" value={formData.identityAge} onChange={e => setFormData({ ...formData, identityAge: e.target.value })} placeholder="e.g. 33" /></div>
                                    <div className="input-group"><label className="input-label">Hair Color</label><input className="input-field" value={formData.identityHairColor} onChange={e => setFormData({ ...formData, identityHairColor: e.target.value })} placeholder="e.g. blonde / redhead" /></div>
                                    <div className="input-group"><label className="input-label">Body Type</label><input className="input-field" value={formData.identityBodyType} onChange={e => setFormData({ ...formData, identityBodyType: e.target.value })} placeholder="e.g. petite, curvy, athletic" /></div>
                                    <div className="input-group"><label className="input-label">Ethnicity/Vibe</label><input className="input-field" value={formData.identityEthnicity} onChange={e => setFormData({ ...formData, identityEthnicity: e.target.value })} placeholder="optional" /></div>
                                    <div className="input-group"><label className="input-label">Current State</label><input className="input-field" value={formData.identityCurrentState} onChange={e => setFormData({ ...formData, identityCurrentState: e.target.value })} placeholder="e.g. 38 weeks pregnant" /></div>
                                    <div className="input-group"><label className="input-label">Niche Keywords</label><input className="input-field" value={formData.identityNicheKeywords} onChange={e => setFormData({ ...formData, identityNicheKeywords: e.target.value })} placeholder="e.g. milf, pregnant, tanlines" /></div>
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Optional One-Line Note</label>
                                    <input className="input-field" value={formData.voiceNotes} onChange={e => setFormData({ ...formData, voiceNotes: e.target.value })} placeholder="e.g. keep titles short and playful" />
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
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>📡 RedGifs Upload Endpoint</label>
                                                                <input className="input-field" value={editingModel.redgifsUploadEndpoint || ''} onChange={e => setEditingModel({ ...editingModel, redgifsUploadEndpoint: e.target.value })} placeholder="https://.../redgifs/upload" />
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>🔑 RedGifs API Token</label>
                                                                <input type="password" className="input-field" value={editingModel.redgifsApiToken || ''} onChange={e => setEditingModel({ ...editingModel, redgifsApiToken: e.target.value })} placeholder="Model-specific token" />
                                                            </div>
                                                        </div>
                                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '12px' }}>
                                                            <h4 style={{ fontSize: '0.85rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>AI Persona Builder</h4>
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Archetype</label><select className="input-field" value={editingModel.voiceArchetype} onChange={e => setEditingModel({ ...editingModel, voiceArchetype: e.target.value })}><option value="general">General</option><option value="milf">MILF</option><option value="pregnant">Pregnant</option><option value="girl-next-door">Girl Next Door</option><option value="alt">Alt</option></select></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Tone</label><select className="input-field" value={editingModel.voiceTone} onChange={e => setEditingModel({ ...editingModel, voiceTone: e.target.value })}><option value="teasing">Teasing</option><option value="sweet">Sweet</option><option value="bratty">Bratty</option><option value="dominant">Dominant</option></select></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Energy</label><select className="input-field" value={editingModel.voiceEnergy} onChange={e => setEditingModel({ ...editingModel, voiceEnergy: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Hard No Style</label><select className="input-field" value={editingModel.voiceNoGo} onChange={e => setEditingModel({ ...editingModel, voiceNoGo: e.target.value })}><option value="no-cta">No CTA bait</option><option value="no-swipe">No swipe/carousel text</option><option value="no-promo">No promo wording</option></select></div>
                                                            </div>
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Age</label><input className="input-field" value={editingModel.identityAge || ''} onChange={e => setEditingModel({ ...editingModel, identityAge: e.target.value })} placeholder="e.g. 33" /></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Hair Color</label><input className="input-field" value={editingModel.identityHairColor || ''} onChange={e => setEditingModel({ ...editingModel, identityHairColor: e.target.value })} placeholder="e.g. blonde" /></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Body Type</label><input className="input-field" value={editingModel.identityBodyType || ''} onChange={e => setEditingModel({ ...editingModel, identityBodyType: e.target.value })} placeholder="e.g. petite" /></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Ethnicity/Vibe</label><input className="input-field" value={editingModel.identityEthnicity || ''} onChange={e => setEditingModel({ ...editingModel, identityEthnicity: e.target.value })} placeholder="optional" /></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Current State</label><input className="input-field" value={editingModel.identityCurrentState || ''} onChange={e => setEditingModel({ ...editingModel, identityCurrentState: e.target.value })} placeholder="e.g. 38 weeks pregnant" /></div>
                                                                <div className="input-group"><label className="input-label" style={{ fontSize: '0.8rem' }}>Niche Keywords</label><input className="input-field" value={editingModel.identityNicheKeywords || ''} onChange={e => setEditingModel({ ...editingModel, identityNicheKeywords: e.target.value })} placeholder="e.g. milf,pregnant" /></div>
                                                            </div>
                                                            <div className="input-group">
                                                                <label className="input-label" style={{ fontSize: '0.8rem' }}>Optional One-Line Note</label>
                                                                <input className="input-field" value={editingModel.voiceNotes || ''} onChange={e => setEditingModel({ ...editingModel, voiceNotes: e.target.value })} placeholder="e.g. playful but not spammy" />
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

