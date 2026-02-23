import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Library() {
    const models = useLiveQuery(() => db.models.toArray());
    const assets = useLiveQuery(() => db.assets.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        angleTag: '', locationTag: '', reuseCooldownSetting: 30
    });

    const [syncing, setSyncing] = useState(false);

    async function syncGoogleDrive() {
        if (!selectedModelId) return alert("Select a model first.");
        const targetModel = models.find(m => m.id === Number(selectedModelId));
        if (!targetModel?.driveFolderId) return alert("This model has no Drive Folder ID configured. Go to Models tab to add one.");

        setSyncing(true);
        try {
            const { SettingsService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();
            const res = await fetch(`/api/drive/list/${targetModel.driveFolderId}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to fetch from Drive");
            }
            const driveFiles = await res.json();

            const assetsToAdd = [];
            for (const file of driveFiles) {
                // Check if already in DB
                const exists = await db.assets.where('driveFileId').equals(file.id).first();
                if (!exists) {
                    assetsToAdd.push({
                        modelId: Number(selectedModelId),
                        assetType: file.mimeType.startsWith('image/') ? 'image' : 'video',
                        angleTag: file.mappedTag || 'general',
                        locationTag: '',
                        reuseCooldownSetting: Number(formData.reuseCooldownSetting),
                        approved: 1,
                        lastUsedDate: null,
                        timesUsed: 0,
                        driveFileId: file.id,
                        fileName: file.name,
                        thumbnailUrl: file.thumbnailLink,
                        originalUrl: file.webContentLink
                    });
                }
            }

            if (assetsToAdd.length > 0) {
                await db.assets.bulkAdd(assetsToAdd);
                alert(`Synced ${assetsToAdd.length} new files from Google Drive!`);
            } else {
                alert("Everything is already up-to-date.");
            }
        } catch (err) {
            alert("Drive Sync Error: " + err.message + ". Ensure service_account.json is in proxy folder and has access.");
        } finally {
            setSyncing(false);
        }
    }

    if (!models || models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    // Handles bulk folder or multiple files upload
    async function handleFileUpload(e) {
        if (!selectedModelId) return alert("Select a model first.");

        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setUploading(true);

        const validFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));

        const assetsToAdd = [];

        for (const file of validFiles) {
            // Default Angle Tag can be the parent folder name or file base name
            const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [];
            const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
            const defaultTag = formData.angleTag || folderName || file.name.split('.')[0] || 'untagged';

            assetsToAdd.push({
                modelId: Number(selectedModelId),
                assetType: file.type.startsWith('image/') ? 'image' : 'video',
                angleTag: defaultTag,
                locationTag: formData.locationTag,
                reuseCooldownSetting: Number(formData.reuseCooldownSetting),
                approved: 1,
                lastUsedDate: null,
                timesUsed: 0,
                fileBlob: file, // Store the native File object (Blob) directly into Dexie
                fileName: file.name
            });
        }

        if (assetsToAdd.length > 0) {
            try {
                await db.assets.bulkAdd(assetsToAdd);
                alert(`Successfully imported ${assetsToAdd.length} media files into the Asset Library!`);
            } catch (err) {
                alert("Error saving files: " + err.message);
            }
        } else {
            alert("No valid images or videos found in the selected folder.");
        }

        setUploading(false);
        // Reset file input
        e.target.value = '';
    }

    async function toggleApprove(id, current) {
        await db.assets.update(id, { approved: current ? 0 : 1 });
    }

    async function deleteAsset(id) {
        if (window.confirm("Delete this asset?")) {
            await db.assets.delete(id);
        }
    }

    // Filter assets for the current UI
    const displayedAssets = assets?.filter(a => selectedModelId === '' || a.modelId === Number(selectedModelId)) || [];

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Visual Content Gallery</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Import and manage media assets for your models.
                    </div>
                </div>
            </header>

            <div className="page-content">
                <div className="card mb-6" style={{ marginBottom: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                            <h2 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Content Source Manager</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Connect to Google Drive or upload manual files.
                            </p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={syncGoogleDrive}
                            disabled={syncing}
                        >
                            {syncing ? 'Syncing...' : '🔄 Sync from Google Drive'}
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label">Assign to Model</label>
                            <select
                                className="input-field"
                                value={selectedModelId}
                                onChange={e => setSelectedModelId(e.target.value)}
                            >
                                <option value="" disabled>Select a Model</option>
                                {models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label">Override Default Cooldown (Days)</label>
                            <input type="number" className="input-field" value={formData.reuseCooldownSetting} onChange={e => setFormData({ ...formData, reuseCooldownSetting: e.target.value })} />
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '16px' }}>
                        <label className="input-label" style={{ marginBottom: '8px' }}>Manual Local Upload</label>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            {/* Folder Picker */}
                            <div style={{ position: 'relative', overflow: 'hidden', display: 'inline-block' }}>
                                <button className="btn btn-outline" disabled={uploading}>
                                    {uploading ? 'Processing...' : '📁 Browse Folder'}
                                </button>
                                <input
                                    type="file"
                                    webkitdirectory="true"
                                    directory="true"
                                    multiple
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                    style={{
                                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'
                                    }}
                                />
                            </div>
                            {/* Individual Multi-File Picker */}
                            <div style={{ position: 'relative', overflow: 'hidden', display: 'inline-block' }}>
                                <button className="btn btn-outline" disabled={uploading}>
                                    📄 Or Select Files
                                </button>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*,video/*"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                    style={{
                                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Asset Database ({displayedAssets.length})</h2>
                    </div>

                    {displayedAssets.length === 0 ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)' }}>
                            No media files found for this model. Sync Drive or import a folder to begin.
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                            {displayedAssets.map(asset => {
                                const model = models.find(m => m.id === asset.modelId);
                                const objectUrl = asset.fileBlob ? URL.createObjectURL(asset.fileBlob) : (asset.thumbnailUrl || asset.originalUrl);

                                return (
                                    <div key={asset.id} style={{
                                        border: `1px solid ${asset.approved ? 'var(--border-color)' : 'var(--status-danger)'}`,
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        backgroundColor: 'var(--surface-color)',
                                        opacity: asset.approved ? 1 : 0.6
                                    }}>
                                        <div style={{ height: '200px', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                            {asset.driveFileId && (
                                                <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', padding: '4px', borderRadius: '4px', fontSize: '10px' }}>
                                                    ☁️ Drive
                                                </div>
                                            )}
                                            {asset.assetType === 'image' && objectUrl ? (
                                                <img src={objectUrl} alt={asset.angleTag} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoad={() => asset.fileBlob && URL.revokeObjectURL(objectUrl)} />
                                            ) : asset.assetType === 'video' ? (
                                                <video src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : (
                                                <div style={{ color: 'var(--text-secondary)' }}>No Preview</div>
                                            )}
                                        </div>
                                        <div style={{ padding: '12px' }}>
                                            <div style={{ fontWeight: '600', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.fileName}>
                                                {asset.fileName || asset.angleTag}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                Tag: {asset.angleTag} • Used: {asset.timesUsed}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => toggleApprove(asset.id, asset.approved)}
                                                    style={{ flex: 1, padding: '4px 0', fontSize: '0.8rem', border: 'none', borderRadius: '4px', cursor: 'pointer', background: asset.approved ? 'var(--btn-outline-bg)' : 'var(--status-danger)', color: asset.approved ? 'var(--text-primary)' : '#fff' }}
                                                >
                                                    {asset.approved ? 'Disable' : 'Enable'}
                                                </button>
                                                <button
                                                    onClick={() => deleteAsset(asset.id)}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent', color: 'var(--status-danger)' }}
                                                >
                                                    Trash
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

