import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Library() {
    const models = useLiveQuery(() => db.models.toArray());
    const assets = useLiveQuery(() => db.assets.toArray());
    const tasks = useLiveQuery(() => db.tasks.toArray());
    const performances = useLiveQuery(() => db.performances.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');

    React.useEffect(() => {
        // Default to 'all' if no model is selected yet, allowing global view
        if (models && models.length > 0 && selectedModelId === '') {
            setSelectedModelId('all');
        }
    }, [models, selectedModelId]);

    const [nicheFilter, setNicheFilter] = useState('all');

    const [formData, setFormData] = useState({
        angleTag: '', locationTag: '', reuseCooldownSetting: 30
    });

    const [syncing, setSyncing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [redgifsUploadingId, setRedgifsUploadingId] = useState(null);

    async function syncGoogleDrive() {
        if (!selectedModelId) return alert("Select a model first.");
        if (selectedModelId === 'all') return alert("Select one specific model to sync.");
        const targetModel = models.find(m => m.id === Number(selectedModelId));
        if (!targetModel?.driveFolderId) return alert("This model has no Drive Folder ID configured. Go to Models tab to add one.");

        setSyncing(true);
        try {
            const { DriveSyncService } = await import('../services/growthEngine');
            const { newCount, updatedCount } = await DriveSyncService.syncModelFolder(Number(selectedModelId), Number(formData.reuseCooldownSetting));

            if (newCount > 0 || updatedCount > 0) {
                alert(`Sync Complete! Added ${newCount} new assets and updated ${updatedCount} niche tags based on your Drive folders.`);
            } else {
                alert("Everything is already up-to-date.");
            }
        } catch (err) {
            alert("Drive Sync Error: " + err.message + ". Ensure service_account.json is in proxy folder and has access.");
        } finally {
            setSyncing(false);
        }
    }

    const PAGE_SIZE = 12;
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    // Reset pagination when filters change
    React.useEffect(() => { setVisibleCount(PAGE_SIZE); }, [selectedModelId, nicheFilter]);

    // Per-asset performance stats: assetId → { posts, totalViews, removed, avgViews }
    // Placed before early returns to satisfy React hooks ordering rules
    const assetStats = React.useMemo(() => {
        const map = new Map();
        if (!tasks || !performances) return map;
        const perfByTaskId = new Map(performances.map(p => [p.taskId, p]));
        for (const t of tasks) {
            if (!t.assetId) continue;
            if (!map.has(t.assetId)) map.set(t.assetId, { posts: 0, totalViews: 0, removed: 0 });
            const bucket = map.get(t.assetId);
            const perf = perfByTaskId.get(t.id);
            if (!perf) continue;
            bucket.posts += 1;
            bucket.totalViews += Number(perf.views24h || 0);
            if (perf.removed) bucket.removed += 1;
        }
        for (const [id, stats] of map.entries()) {
            stats.avgViews = stats.posts > 0 ? Math.round(stats.totalViews / stats.posts) : 0;
        }
        return map;
    }, [tasks, performances]);

    // useLiveQuery returns undefined while Dexie is loading (e.g. during CloudSync pull)
    // We must NOT show the "no models" message during this loading phase
    if (models === undefined || assets === undefined) {
        return (
            <>
                <header className="page-header">
                    <h1 className="page-title">Visual Content Gallery</h1>
                </header>
                <div className="page-content">
                    <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
                        Loading library data...
                    </div>
                </div>
            </>
        );
    }

    if (models.length === 0) {
        return (
            <>
                <header className="page-header">
                    <h1 className="page-title">Visual Content Gallery</h1>
                </header>
                <div className="page-content">
                    <div className="card">Please create a Model first.</div>
                </div>
            </>
        );
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
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.autoPush(['assets']);
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
        const { CloudSyncService } = await import('../services/growthEngine');
        CloudSyncService.autoPush(['assets']).catch(console.error);
    }

    async function deleteAsset(id) {
        if (window.confirm("Delete this asset? This will also permanently delete any generated Tasks that rely on it across the cloud.")) {
            // Find related tasks
            const relatedTasks = await db.tasks.where('assetId').equals(id).toArray();

            // Delete associated tasks and their performances
            if (relatedTasks.length > 0) {
                const taskIds = relatedTasks.map(t => t.id);
                // Also clean up any performances tied to these tasks
                const perfs = await db.performances.where('taskId').anyOf(taskIds).toArray();
                if (perfs.length > 0) {
                    const perfIds = perfs.map(p => p.id);
                    await db.performances.bulkDelete(perfIds);
                    const { CloudSyncService } = await import('../services/growthEngine');
                    await CloudSyncService.deleteMultipleFromCloud('performances', perfIds);
                }

                await db.tasks.bulkDelete(taskIds);
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.deleteMultipleFromCloud('tasks', taskIds);
            }

            // Finally, delete the asset itself from local and cloud
            await db.assets.delete(id);
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.deleteFromCloud('assets', id);
        }
    }

    async function uploadVideoToRedgifs(asset) {
        if (!asset || asset.assetType !== 'video') return;
        const confirmed = window.confirm(`Upload ${asset.fileName || 'this video'} to RedGifs now?`);
        if (!confirmed) return;

        try {
            setRedgifsUploadingId(asset.id);
            const { SettingsService, CloudSyncService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();
            const model = models?.find(m => Number(m.id) === Number(asset.modelId));
            const modelEndpoint = String(model?.redgifsUploadEndpoint || '').trim();
            const modelToken = String(model?.redgifsApiToken || '').trim();

            if (!modelEndpoint || !modelToken) {
                throw new Error(`RedGifs is not configured for model ${model?.name || asset.modelId}. Add endpoint + token in Models.`);
            }

            const response = await fetch(`/api/redgifs/upload-from-asset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    driveFileId: asset.driveFileId || null,
                    sourceUrl: asset.originalUrl || asset.externalUrl || null,
                    proxyUrl,
                    fileName: asset.fileName || `asset-${asset.id}.mp4`,
                    title: '',
                    tags: [asset.angleTag, 'growthos'].filter(Boolean),
                    redgifsUploadEndpoint: modelEndpoint,
                    redgifsApiToken: modelToken,
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.url) {
                throw new Error(payload?.error || payload?.detail || `Upload failed (${response.status})`);
            }

            await db.assets.update(asset.id, { externalUrl: payload.url });
            await CloudSyncService.autoPush(['assets']);
            alert('Uploaded to RedGifs successfully. Link saved on this asset.');
        } catch (err) {
            alert('RedGifs upload failed: ' + err.message);
        } finally {
            setRedgifsUploadingId(null);
        }
    }

    // Filter assets for the current UI
    const filteredAssets = assets?.filter(a => {
        const matchesModel = selectedModelId === 'all' || a.modelId === Number(selectedModelId);
        const matchesNiche = nicheFilter === 'all' || a.angleTag?.toLowerCase() === nicheFilter.toLowerCase();
        return matchesModel && matchesNiche;
    }) || [];

    // Paginate — only render what's visible
    const displayedAssets = filteredAssets.slice(0, visibleCount);
    const hasMore = visibleCount < filteredAssets.length;

    // Show only niches relevant to the selected model(s) to keep it clean
    const availableNiches = Array.from(new Set(
        assets?.filter(a => selectedModelId === 'all' || a.modelId === Number(selectedModelId))
            .map(a => a.angleTag?.toLowerCase())
            .filter(Boolean) || []
    ));

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
                                onChange={e => {
                                    setSelectedModelId(e.target.value);
                                    setNicheFilter('all'); // Reset niche filter when switching models
                                }}
                            >
                                <option value="all">🌐 Show All Models (Agency View)</option>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Asset Database ({filteredAssets.length})</h2>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Filter by Niche:</span>
                            <select
                                className="input-field"
                                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.85rem' }}
                                value={nicheFilter}
                                onChange={e => setNicheFilter(e.target.value)}
                            >
                                <option value="all">All Content</option>
                                {availableNiches.map(n => (
                                    <option key={n} value={n}>{n.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {selectedModelId === 'all' && (
                        <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#6366f111', border: '1px solid #6366f133', borderRadius: '4px', fontSize: '0.85rem', color: '#818cf8' }}>
                            💡 You are in <strong>Agency View</strong>. You can see content for all models, but you must select a specific model above to sync new content or upload files.
                        </div>
                    )}

                    {displayedAssets.length === 0 ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)' }}>
                            No media files found for this model. Sync Drive or import a folder to begin.
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                                {displayedAssets.map(asset => {
                                    const model = models.find(m => m.id === asset.modelId);
                                    const isHeic = asset.fileName && (asset.fileName.toLowerCase().endsWith('.heic') || asset.fileName.toLowerCase().endsWith('.heif'));

                                    let objectUrl = null;
                                    if (asset.fileBlob) {
                                        objectUrl = URL.createObjectURL(asset.fileBlob);
                                    } else if (asset.driveFileId) {
                                        // Use dedicated thumbnail endpoint — serves tiny cached JPEGs (~10KB)
                                        objectUrl = `https://js-reddit-proxy-production.up.railway.app/api/drive/thumb/${asset.driveFileId}`;
                                    } else {
                                        objectUrl = asset.thumbnailUrl || asset.originalUrl;
                                    }

                                    return (
                                        <div key={asset.id} style={{
                                            border: `1px solid ${asset.approved ? 'var(--border-color)' : 'var(--status-danger)'}`,
                                            borderRadius: 'var(--radius-md)',
                                            overflow: 'hidden',
                                            backgroundColor: 'var(--surface-color)',
                                            opacity: asset.approved ? 1 : 0.7,
                                            position: 'relative',
                                            transition: 'all 0.2s'
                                        }}>
                                            <div style={{ height: '200px', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                {!asset.approved && (
                                                    <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                                                        <span style={{ backgroundColor: 'var(--status-danger)', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                                            REJECTED / DISABLED
                                                        </span>
                                                    </div>
                                                )}
                                                {asset.driveFileId && (
                                                    <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                        ☁️ Drive
                                                    </div>
                                                )}
                                                {selectedModelId === 'all' && (
                                                    <div style={{ position: 'absolute', top: '8px', left: '8px', background: 'var(--primary-color)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                                                        {model?.name?.toUpperCase() || 'MIA'}
                                                    </div>
                                                )}
                                                {asset.assetType === 'image' && objectUrl ? (
                                                    <img src={objectUrl} alt={asset.angleTag} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoad={() => asset.fileBlob && URL.revokeObjectURL(objectUrl)} />
                                                ) : asset.assetType === 'video' ? (
                                                    <video src={objectUrl} loading="lazy" preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <div style={{ color: 'var(--text-secondary)' }}>No Preview</div>
                                                )}
                                            </div>
                                            <div style={{ padding: '12px' }}>
                                                <div style={{ fontWeight: '600', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.fileName}>
                                                    {asset.fileName || asset.angleTag}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                    Niche/Angle:
                                                    <input
                                                        type="text"
                                                        style={{ background: 'none', border: 'none', color: 'var(--primary-color)', fontSize: '0.8rem', width: '80px', marginLeft: '4px', borderBottom: '1px dashed #6366f1' }}
                                                        defaultValue={asset.angleTag}
                                                        onBlur={async (e) => {
                                                            await db.assets.update(asset.id, { angleTag: e.target.value.toLowerCase() });
                                                            const { CloudSyncService } = await import('../services/growthEngine');
                                                            CloudSyncService.autoPush(['assets']).catch(console.error);
                                                        }}
                                                    />
                                                    • Used: {asset.timesUsed}
                                                </div>
                                                {(() => {
                                                    const s = assetStats.get(asset.id);
                                                    if (!s || s.posts === 0) return null;
                                                    return (
                                                        <div style={{ fontSize: '0.75rem', marginBottom: '8px', display: 'flex', gap: '8px', color: 'var(--text-secondary)' }}>
                                                            <span title="Average views per post">👁 {s.avgViews.toLocaleString()} avg</span>
                                                            <span title="Total posts with this asset">📝 {s.posts}</span>
                                                            {s.removed > 0 && <span style={{ color: '#f44336' }} title="Removed posts">🗑 {s.removed}</span>}
                                                        </div>
                                                    );
                                                })()}

                                                {asset.assetType === 'video' && (
                                                    <div style={{ marginBottom: '12px' }}>
                                                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>REDGIFS / EXTERNAL LINK</label>
                                                        <input
                                                            type="text"
                                                            className="input-field"
                                                            style={{ fontSize: '0.75rem', padding: '4px 8px', height: 'auto' }}
                                                            placeholder="Paste RedGifs link..."
                                                            defaultValue={asset.externalUrl}
                                                            onBlur={async (e) => {
                                                                await db.assets.update(asset.id, { externalUrl: e.target.value });
                                                                const { CloudSyncService } = await import('../services/growthEngine');
                                                                CloudSyncService.autoPush(['assets']).catch(console.error);
                                                            }}
                                                        />
                                                        <button
                                                            className="btn btn-outline"
                                                            onClick={() => uploadVideoToRedgifs(asset)}
                                                            disabled={redgifsUploadingId === asset.id}
                                                            style={{ marginTop: '8px', width: '100%', padding: '6px 8px', fontSize: '0.75rem' }}
                                                        >
                                                            {redgifsUploadingId === asset.id ? 'Uploading...' : 'Upload to RedGifs (Confirm)'}
                                                        </button>
                                                    </div>
                                                )}

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
                            {hasMore && (
                                <div style={{ textAlign: 'center', marginTop: '24px' }}>
                                    <button
                                        className="btn btn-outline"
                                        onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                                        style={{ padding: '10px 40px', fontSize: '0.9rem' }}
                                    >
                                        Load More ({filteredAssets.length - visibleCount} remaining)
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div >
        </>
    );
}

