import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { extractRedditPostIdFromUrl, SubredditGuardService, TitleGeneratorService } from '../services/growthEngine';

const vaResponsiveCss = `
.va-root {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
}

.va-main {
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
}

.va-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.va-auth-card {
    width: min(360px, 92vw);
}

.va-pin-input {
    font-size: 1.5rem;
    letter-spacing: 8px;
}

.va-task-body {
    padding: 24px;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.va-task-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 24px;
}

.va-meta-grid {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 8px;
    margin-bottom: 16px;
}

.va-rules-panel {
    border-left: 1px solid #2d313a;
    padding-left: 24px;
}

.va-actions-row {
    display: flex;
    gap: 12px;
    margin-top: 24px;
    border-top: 1px solid #2d313a;
    padding-top: 24px;
}

@media (max-width: 920px) {
    .va-header-wrap {
        padding: 14px;
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
    }

    .va-header-left select {
        width: 100%;
        min-width: 0;
    }

    .va-header-stats {
        justify-content: space-between;
        gap: 8px;
    }

    .va-main {
        padding: 14px;
    }

    .va-card-container {
        flex-direction: column;
    }

    .va-media-sidebar {
        width: 100%;
        max-width: none;
        border-right: none;
        border-bottom: 1px solid #2d313a;
        margin: 0;
    }

    .va-media-preview {
        height: 240px;
    }

    .va-task-body {
        padding: 14px;
    }

    .va-task-grid {
        grid-template-columns: 1fr;
        gap: 16px;
    }

    .va-meta-grid {
        grid-template-columns: 1fr;
        gap: 4px;
    }

    .va-rules-panel {
        border-left: none;
        border-top: 1px solid #2d313a;
        padding-top: 14px;
        padding-left: 0;
    }

    .va-actions-row {
        flex-direction: column;
        margin-top: 16px;
        padding-top: 16px;
    }

    .va-actions-row button {
        width: 100%;
        font-size: 1rem;
        padding: 14px;
    }

    .va-pin-input {
        font-size: 1.35rem;
        letter-spacing: 6px;
    }
}
`;

export function VADashboard() {
    const [selectedModelId, setSelectedModelId] = useState('');
    const [authenticated, setAuthenticated] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [error, setError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [clearingQueue, setClearingQueue] = useState(false);
    const [cooldownUntil, setCooldownUntil] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);
    const [authorizedModels, setAuthorizedModels] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState('ALL');

    const models = useLiveQuery(() => db.models.toArray());
    const postInterval = useLiveQuery(async () => {
        const s = await db.settings.where({ key: 'postInterval' }).first();
        return s ? Number(s.value) : 3; // Default 3 minutes
    }, []);

    // Timer logic
    useEffect(() => {
        if (cooldownUntil > Date.now()) {
            const timer = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
                setTimeLeft(remaining);
                if (remaining === 0) clearInterval(timer);
            }, 1000);
            return () => clearInterval(timer);
        } else {
            setTimeLeft(0);
        }
    }, [cooldownUntil]);

    const vaPin = useLiveQuery(async () => {
        const s = await db.settings.where({ key: 'vaPin' }).first();
        return s ? s.value : '1234';
    }, []);

    // Pull cloud data when VA authenticates
    useEffect(() => {
        if (authenticated) {
            (async () => {
                setSyncing(true);
                try {
                    const { CloudSyncService } = await import('../services/growthEngine');
                    const enabled = await CloudSyncService.isEnabled();
                    if (enabled) {
                        console.log("[VA] Pulling latest data from cloud...");
                        await CloudSyncService.pullCloudToLocal();
                        console.log("[VA] Cloud sync complete.");
                    }
                } catch (err) {
                    console.error("[VA] Cloud sync error:", err);
                } finally {
                    setSyncing(false);
                }
            })();
        }
    }, [authenticated]);

    useEffect(() => {
        if (authorizedModels && authorizedModels.length > 0 && !selectedModelId) {
            setSelectedModelId(authorizedModels[0].id);
        }
    }, [authorizedModels, selectedModelId]);

    const activeModelId = selectedModelId ? Number(selectedModelId) : null;

    const accounts = useLiveQuery(
        () => activeModelId ? db.accounts.where('modelId').equals(activeModelId).toArray() : [],
        [activeModelId]
    );

    // Fetch all pending tasks to avoid Timezone strict-equality blocking overseas VAs
    // Added filter by selected account if not ALL
    const tasks = useLiveQuery(
        () => {
            if (!activeModelId) return [];
            let query = db.tasks.where('modelId').equals(activeModelId).filter(t => t.status !== 'closed' && t.status !== 'failed');
            if (selectedAccountId !== 'ALL') {
                const acctId = Number(selectedAccountId);
                query = query.filter(t => t.accountId === acctId);
            }

            return query.toArray().then(rows => {
                if (!rows || rows.length === 0) return [];

                const datedRows = rows.filter(r => !!r.date);
                if (datedRows.length === 0) return rows;

                const latestDate = datedRows
                    .map(r => r.date)
                    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0];

                return rows.filter(r => !r.date || r.date === latestDate);
            });
        },
        [activeModelId, selectedAccountId]
    );

    function handleAuth() {
        if (!models) return;

        // 1. Master/Manager PIN (Global Setting)
        if (pinInput === vaPin) {
            setAuthorizedModels(models);
            if (models.length > 0) setSelectedModelId(models[0].id);
            setAuthenticated(true);
            setError('');
            return;
        }

        // 2. VA-Specific PIN (Assigned to one or more Models)
        const matchingModels = models.filter(m => m.vaPin && m.vaPin.trim() === pinInput);

        if (matchingModels.length > 0) {
            setAuthorizedModels(matchingModels);
            setSelectedModelId(matchingModels[0].id);
            setAuthenticated(true);
            setError('');
        } else {
            setError('Invalid access PIN');
        }
    }

    async function handleClearQueue() {
        if (!tasks || tasks.length === 0) return;
        const confirmed = window.confirm(`Clear ${tasks.length} task(s) from this queue? This removes linked outcomes too.`);
        if (!confirmed) return;

        try {
            setClearingQueue(true);
            const taskIds = tasks.map(t => t.id);
            const linkedPerformances = await db.performances.where('taskId').anyOf(taskIds).toArray();
            const performanceIds = linkedPerformances.map(p => p.id);

            await db.transaction('rw', db.tasks, db.performances, async () => {
                if (performanceIds.length > 0) await db.performances.bulkDelete(performanceIds);
                await db.tasks.bulkDelete(taskIds);
            });

            const { CloudSyncService } = await import('../services/growthEngine');
            const CHUNK_SIZE = 200;
            for (let i = 0; i < performanceIds.length; i += CHUNK_SIZE) {
                await CloudSyncService.deleteMultipleFromCloud('performances', performanceIds.slice(i, i + CHUNK_SIZE));
            }
            for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
                await CloudSyncService.deleteMultipleFromCloud('tasks', taskIds.slice(i, i + CHUNK_SIZE));
            }

            alert(`Cleared ${taskIds.length} task(s).`);
        } catch (e) {
            alert('Failed to clear queue: ' + e.message);
        } finally {
            setClearingQueue(false);
        }
    }

    if (!authenticated) {
        return (
            <div className="va-root" style={{ minHeight: '100vh', backgroundColor: '#0f1115', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
                <style>{vaResponsiveCss}</style>
                <div className="va-auth-card" style={{ backgroundColor: '#1a1d24', padding: '40px', borderRadius: '12px', border: '1px solid #2d313a' }}>
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔐</div>
                        <h2 style={{ fontSize: '1.2rem' }}>VA Terminal Access</h2>
                        <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Enter access PIN to continue</p>
                    </div>
                    <input
                        type="password"
                        className="input-field va-pin-input"
                        style={{ textAlign: 'center', marginBottom: '16px', backgroundColor: '#0f1115' }}
                        maxLength={4}
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAuth()}
                        autoFocus
                    />
                    {error && <div style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}
                    <button
                        onClick={handleAuth}
                        style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        Unlock Terminal
                    </button>
                </div>
            </div>
        );
    }

    if (!models || models.length === 0) {
        if (syncing) {
            return (
                <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>☁️</div>
                        <h3>Syncing campaigns from cloud...</h3>
                        <p style={{ color: '#9ca3af' }}>This takes a few seconds on first load.</p>
                    </div>
                </div>
            );
        }
        return <div style={{ padding: '2rem', textAlign: 'center', minHeight: '100vh', backgroundColor: '#0f1115', color: '#e5e7eb', fontFamily: 'sans-serif' }}>No campaigns available. Ask your manager to generate a daily plan.</div>;
    }

    return (
        <div className="va-root" style={{ minHeight: '100vh', backgroundColor: '#0f1115', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
            <style>{vaResponsiveCss}</style>
            <header className="va-header-wrap" style={{ backgroundColor: '#1a1d24', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2d313a' }}>
                <div className="va-header-left">
                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#6366f1' }}>VA Operations Terminal</div>
                    {syncing && <span style={{ color: '#fbbf24', fontSize: '0.8rem' }}>☁️ Syncing...</span>}
                    <select
                        style={{ padding: '8px', backgroundColor: '#2d313a', color: '#fff', border: 'none', borderRadius: '4px', outline: 'none' }}
                        value={selectedModelId || ''}
                        onChange={e => setSelectedModelId(e.target.value)}
                    >
                        {authorizedModels?.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>

                    <select
                        style={{ padding: '8px', backgroundColor: '#2d313a', color: '#fff', border: 'none', borderRadius: '4px', outline: 'none' }}
                        value={selectedAccountId}
                        onChange={e => setSelectedAccountId(e.target.value)}
                    >
                        <option value="ALL">All Accounts Queue</option>
                        {accounts?.map(a => (
                            <option key={a.id} value={a.id}>u/{a.handle}</option>
                        ))}
                    </select>
                </div>
                <div className="va-header-stats" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.9rem', color: '#9ca3af' }}>
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                    {timeLeft > 0 && (
                        <div style={{ padding: '4px 12px', backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold', animation: 'pulse 1s infinite' }}>
                            ⏳ BREAK: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                        </div>
                    )}
                    <div style={{ padding: '4px 12px', backgroundColor: '#10b98122', color: '#10b981', border: '1px solid #10b98144', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                        {tasks?.filter(t => t.status === 'closed').length} / {tasks?.length} COMPLETED
                    </div>
                    <button
                        onClick={handleClearQueue}
                        disabled={clearingQueue || !tasks || tasks.length === 0}
                        style={{ backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', opacity: (clearingQueue || !tasks || tasks.length === 0) ? 0.5 : 1 }}
                    >
                        {clearingQueue ? 'Clearing...' : 'Clear Queue'}
                    </button>
                    <button
                        onClick={async () => {
                            setSyncing(true);
                            try {
                                const { CloudSyncService } = await import('../services/growthEngine');
                                await CloudSyncService.pullCloudToLocal();
                                alert("Refreshed from cloud!");
                            } catch (e) { console.error(e); }
                            finally { setSyncing(false); }
                        }}
                        style={{ backgroundColor: 'transparent', color: '#6366f1', border: '1px solid #6366f1', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                        🔄 Refresh
                    </button>
                    <button onClick={() => { setAuthenticated(false); setAuthorizedModels([]); setSelectedModelId(''); setPinInput(''); }} style={{ backgroundColor: 'transparent', color: '#9ca3af', border: '1px solid #2d313a', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Lock</button>
                </div>
            </header>

            <main className="va-main">
                <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Today's Queue</h2>
                <p style={{ color: '#9ca3af', marginBottom: '24px' }}>Execute the following posts linearly. Mark them done as you go.</p>

                {tasks?.length === 0 ? (
                    <div style={{ backgroundColor: '#1a1d24', padding: '48px', textAlign: 'center', borderRadius: '8px', border: '1px solid #2d313a' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px' }}>🎉</div>
                        <h3 style={{ marginBottom: '8px' }}>Queue Empty</h3>
                        <p style={{ color: '#9ca3af' }}>No tasks assigned for this model today, or you've completed them all.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {tasks?.map((task, index) => (
                            <VATaskCard key={task.id} task={task} index={index + 1} onPosted={() => setCooldownUntil(0)} cooldownActive={false} />
                        ))}
                    </div>
                )}
            </main>
        </div >
    );
}

function VATaskCard({ task, index, onPosted, cooldownActive }) {
    const asset = useLiveQuery(() => db.assets.get(task.assetId), [task.assetId]);
    const subreddit = useLiveQuery(() => db.subreddits.get(task.subredditId), [task.subredditId]);
    const account = useLiveQuery(() => db.accounts.get(task.accountId), [task.accountId]);
    const model = useLiveQuery(() => db.models.get(task.modelId), [task.modelId]);
    const performance = useLiveQuery(() => db.performances.where({ taskId: task.id }).first(), [task.id]);

    const [redditUrl, setRedditUrl] = useState('');
    const [mediaFailed, setMediaFailed] = useState(false);
    const [heicPreviewUrl, setHeicPreviewUrl] = useState('');
    const [heicLoading, setHeicLoading] = useState(false);
    const [regeneratingTitle, setRegeneratingTitle] = useState(false);
    const proxyBase = 'https://js-reddit-proxy-production.up.railway.app';

    const isDone = task.status === 'closed' || performance;

    const isHeic = asset?.fileName && (asset.fileName.toLowerCase().endsWith('.heic') || asset.fileName.toLowerCase().endsWith('.heif'));
    const localBlobUrl = useMemo(() => {
        if (!asset?.fileBlob) return null;
        return URL.createObjectURL(asset.fileBlob);
    }, [asset?.id, asset?.fileBlob]);

    useEffect(() => {
        return () => {
            if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
        };
    }, [localBlobUrl]);

    useEffect(() => {
        let cancelled = false;
        let generatedUrl = '';

        async function prepareHeicPreview() {
            setHeicPreviewUrl('');
            if (!asset?.driveFileId || !isHeic) return;

            try {
                setHeicLoading(true);
                const response = await fetch(`${proxyBase}/api/drive/download/${asset.driveFileId}?convert=true`);
                if (!response.ok) throw new Error(`Preview conversion failed (${response.status})`);
                const blob = await response.blob();
                generatedUrl = URL.createObjectURL(blob);
                if (!cancelled) setHeicPreviewUrl(generatedUrl);
            } catch (err) {
                console.warn('[VA] HEIC preview conversion failed:', err?.message || err);
            } finally {
                if (!cancelled) setHeicLoading(false);
            }
        }

        prepareHeicPreview();

        return () => {
            cancelled = true;
            if (generatedUrl) URL.revokeObjectURL(generatedUrl);
        };
    }, [asset?.id, asset?.driveFileId, isHeic]);

    const mediaUrl = localBlobUrl
        || (isHeic ? heicPreviewUrl : null)
        || (asset?.assetType === 'image' && asset?.driveFileId ? `${proxyBase}/api/drive/thumb/${asset.driveFileId}` : null)
        || (asset?.assetType === 'video' && asset?.driveFileId ? `${proxyBase}/api/drive/view/${asset.driveFileId}` : null)
        || asset?.thumbnailUrl
        || asset?.originalUrl
        || null;

    async function handleDownloadMedia() {
        if (!asset) return;

        const performDownload = (url, fallbackName) => {
            const a = document.createElement('a');
            a.href = url;
            a.download = asset.fileName || fallbackName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        try {
            if (asset.fileBlob) {
                // Not typical with Drive sync, but handled locally
                performDownload(URL.createObjectURL(asset.fileBlob), 'media');
            } else if (asset.driveFileId || asset.originalUrl) {
                // If it's an HEIC/HEIF file from iPhone, convert it before downloading
                const isHeic = asset.fileName && (asset.fileName.toLowerCase().endsWith('.heic') || asset.fileName.toLowerCase().endsWith('.heif'));

                if (!asset.driveFileId) {
                    // Fallback for non-drive external URLs
                    performDownload(asset.originalUrl, asset.fileName || 'media');
                } else {
                    if (isHeic) {
                        alert("Converting iPhone HEIC photo to JPEG via secure cloud tunnel... please wait. This can take up to 5-10 seconds.");
                    }

                    // Force ALL Google Drive downloads through our Vercel Serverless Function.
                    // This prevents Android phones from intercepting the Google Drive URL and forcing the VA to login to a Google Account.
                    const fetchUrl = `${proxyBase}/api/drive/download/${asset.driveFileId}${isHeic ? '?convert=true' : ''}`;

                    const response = await fetch(fetchUrl);
                    if (!response.ok) throw new Error("Network request failed. " + response.statusText);
                    const blob = await response.blob();
                    const contentType = (response.headers.get('content-type') || '').toLowerCase();

                    let downloadName = asset.fileName || 'media';
                    if (isHeic && contentType.includes('image/jpeg')) {
                        downloadName = downloadName.replace(/\.hei[cf]$/i, '.jpg');
                    }

                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = downloadName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
            } else {
                alert('No media available to download.');
            }
        } catch (err) {
            console.error("Download Error:", err);
            alert("Error downloading or converting file: " + err.message);
        }
    }

    async function handleMarkPosted() {
        if (!redditUrl || (!redditUrl.includes('reddit.com') && !redditUrl.includes('redd.it'))) {
            return alert("Please paste the actual Reddit Post URL first so stats can be tracked.");
        }

        const redditPostId = extractRedditPostIdFromUrl(redditUrl);

        if (!redditPostId) {
            console.warn("Could not extract a valid Reddit Post ID from URL: " + redditUrl);
        }

        // 1. Update Task
        await db.tasks.update(task.id, {
            status: 'closed',
            redditUrl: redditUrl,
            redditPostId: redditPostId
        });

        // 2. Add Performance Record
        await db.performances.add({
            taskId: task.id,
            views24h: 0,
            removed: 0,
            notes: 'Awaiting automated sync...'
        });

        // 3. Update Asset Tracking (Usage count + Last used date)
        if (task.assetId) {
            const asset = await db.assets.get(task.assetId);
            const targetModel = await db.models.get(task.modelId);
            const { SettingsService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();

            if (asset) {
                const nextTimesUsed = (asset.timesUsed || 0) + 1;
                const assetUpdate = {
                    timesUsed: nextTimesUsed,
                    lastUsedDate: new Date().toISOString()
                };
                await db.assets.update(asset.id, assetUpdate);

                if (nextTimesUsed >= 5 && asset.driveFileId && targetModel?.usedFolderId && !asset.movedToUsed) {
                    try {
                        let cleanUsedFolderId = targetModel.usedFolderId;
                        if (cleanUsedFolderId.includes('drive.google.com')) {
                            const match = cleanUsedFolderId.match(/folders\/([a-zA-Z0-9_-]+)/);
                            if (match) cleanUsedFolderId = match[1];
                        }

                        console.log(`Moving Drive file ${asset.driveFileId} to Used folder ${cleanUsedFolderId}...`);
                        const moveRes = await fetch(`${proxyUrl}/api/drive/move`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fileId: asset.driveFileId,
                                targetFolderId: cleanUsedFolderId
                            })
                        });
                        if (!moveRes.ok) {
                            console.error("Failed to move file in Drive");
                        } else {
                            await db.assets.update(asset.id, { movedToUsed: 1 });
                        }
                    } catch (err) {
                        console.error("Error during Drive move:", err);
                    }
                }

                // Cloud Sync Push (Native)
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.autoPush(['tasks', 'performances', 'assets']);

                if (redditPostId) {
                    try {
                        const { PerformanceSyncService } = await import('../services/growthEngine');
                        await PerformanceSyncService.syncPostPerformance(task.id);
                    } catch (syncErr) {
                        console.warn('[VA] Immediate performance sync failed:', syncErr?.message || syncErr);
                    }
                }
            }
        }
        onPosted(); // Move onto next task instantly
    }

    async function handleMarkError() {
        const reason = window.prompt("Why couldn't you post this? (e.g., account banned, banned from sub, filter block)");
        if (reason) {
            const taskUpdate = { status: 'failed' };
            await db.tasks.update(task.id, taskUpdate);

            const perfInsert = {
                taskId: task.id,
                views24h: 0,
                removed: 1,
                notes: reason
            };
            await db.performances.add(perfInsert);

            try {
                await SubredditGuardService.recordPostingError(task.subredditId, reason, {
                    accountHandle: account?.handle || '',
                    modelName: model?.name || '',
                    taskId: task.id,
                });
            } catch (guardErr) {
                console.warn('[VA] Failed to store subreddit posting guard:', guardErr?.message || guardErr);
            }

            // Cloud Sync Push (Native)
            try {
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.autoPush(['tasks', 'performances', 'subreddits']);
            } catch (err) { }
        }
    }

    async function copyToClipboard(text, label) {
        navigator.clipboard.writeText(text);
        alert(`${label} copied to clipboard!`);
    }

    async function handleRegenerateTitle() {
        if (!subreddit?.name) return;
        setRegeneratingTitle(true);
        try {
            const siblingTasks = await db.tasks.where('modelId').equals(task.modelId).toArray();
            const previousTitles = siblingTasks
                .filter(t => t.subredditId === task.subredditId && t.id !== task.id && !!t.title)
                .map(t => t.title);

            const newTitle = await TitleGeneratorService.generateTitle(
                subreddit.name,
                subreddit.rulesSummary || '',
                subreddit.requiredFlair || '',
                previousTitles,
                { assetType: asset?.assetType || 'image', angleTag: asset?.angleTag || '' }
            );

            if (!newTitle || /\[\s*api\s*error\s*\]/i.test(newTitle)) {
                alert('Title regeneration failed. Try again in a moment.');
                return;
            }

            await db.tasks.update(task.id, { title: newTitle });
            try {
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.autoPush(['tasks']);
            } catch (err) {
                console.warn('[VA] Task title cloud sync failed:', err?.message || err);
            }
            alert('Title regenerated and synced.');
        } catch (err) {
            alert('Failed to regenerate title: ' + err.message);
        } finally {
            setRegeneratingTitle(false);
        }
    }

    useEffect(() => {
        setMediaFailed(false);
    }, [task.id, mediaUrl]);

    if (isDone) {
        return (
            <div style={{ padding: '16px', backgroundColor: '#0f1115', border: '1px dashed #2d313a', borderRadius: '8px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '16px', opacity: 0.6 }}>
                <span style={{ backgroundColor: '#10b98122', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>COMPLETED</span>
                <span>Task #{index} - r/{subreddit?.name} executed. {task.redditUrl && "Post ID: " + task.redditPostId}</span>
            </div>
        );
    }

    return (
        <div className="va-card-container" style={{ backgroundColor: '#1a1d24', border: '1px solid #2d313a', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
            {/* Media Area */}
            <div className="va-media-sidebar" style={{ width: '100%', maxWidth: '280px', backgroundColor: '#000', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', margin: '0 auto', borderRight: '1px solid #2d313a' }}>
                <div className="va-media-preview" style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {asset ? (
                        asset.assetType === 'image' && mediaUrl && !mediaFailed ? (
                            <img src={mediaUrl} alt="task media" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setMediaFailed(true)} />
                        ) : asset.assetType === 'video' && mediaUrl && !mediaFailed ? (
                            <video src={mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} controls onError={() => setMediaFailed(true)} />
                        ) : asset.assetType === 'image' && isHeic && heicLoading ? (
                            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '12px' }}>
                                <div>Converting HEIC preview...</div>
                            </div>
                        ) : (
                            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '12px' }}>
                                <div>Media preview unavailable</div>
                                {asset?.driveFileId && (
                                    <a
                                        href={`${proxyBase}/api/drive/view/${asset.driveFileId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: '#6366f1', textDecoration: 'underline', fontSize: '0.85rem' }}
                                    >
                                        Open media directly
                                    </a>
                                )}
                            </div>
                        )
                    ) : (
                        <div style={{ color: '#ef4444' }}>Missing Asset</div>
                    )}
                </div>
                <div style={{ padding: '12px', backgroundColor: '#0f1115', fontSize: '0.8rem', borderTop: '1px solid #2d313a' }}>
                    <div style={{ color: '#9ca3af' }}>Asset Name:</div>
                    <div style={{ color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset?.fileName || asset?.angleTag}>{asset?.fileName || asset?.angleTag}</div>

                    <div style={{ marginTop: '4px', fontSize: '0.7rem' }}>
                        <span style={{ color: '#9ca3af' }}>Niche: </span>
                        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{asset?.angleTag?.toUpperCase() || 'GENERAL'}</span>
                    </div>

                    <button
                        onClick={handleDownloadMedia}
                        style={{ marginTop: '12px', width: '100%', padding: '10px 8px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                        ⬇️ Download Media
                    </button>

                    {asset?.assetType === 'video' && asset?.externalUrl && (
                        <button
                            onClick={() => copyToClipboard(asset.externalUrl, 'RedGifs Link')}
                            style={{ marginTop: '8px', width: '100%', padding: '10px 8px', backgroundColor: '#fbbf24', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        >
                            🔗 Copy RedGifs Link
                        </button>
                    )}

                    {asset?.assetType === 'video' && !asset?.externalUrl && (
                        <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#ef444422', borderRadius: '4px', border: '1px solid #ef444444' }}>
                            <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 'bold', marginBottom: '4px' }}>NO REDGIFS LINK STORED</div>
                            <a
                                href={model?.redgifsProfile || 'https://www.redgifs.com/'}
                                target="_blank"
                                rel="noreferrer"
                                className="btn"
                                style={{ display: 'block', textAlign: 'center', fontSize: '0.7rem', padding: '4px', backgroundColor: '#ef4444', color: '#fff', borderRadius: '2px' }}
                            >
                                Upload to RedGifs ↗
                            </a>
                            <input
                                type="text"
                                placeholder="Paste Link & Save..."
                                style={{ width: '100%', marginTop: '6px', fontSize: '0.7rem', padding: '4px', backgroundColor: '#0f1115', border: '1px solid #2d313a', color: '#fff' }}
                                onBlur={async (e) => {
                                    if (e.target.value) {
                                        await db.assets.update(asset.id, { externalUrl: e.target.value });
                                        alert("Link saved to this video forever!");
                                    }
                                }}
                            />
                        </div>
                    )}

                    <div style={{ marginTop: '8px', color: '#9ca3af', textAlign: 'center', fontSize: '0.75rem' }}>Used <span style={{ color: '#6366f1', fontWeight: 'bold' }}>{asset?.timesUsed || 0}</span> times</div>
                </div>
                <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: 'rgba(99, 102, 241, 0.9)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    TASK #{index}
                </div>
            </div>

            {/* Details & Actions Area */}
            <div className="va-task-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
                    {/* Posting Instructions */}
                    <div className="va-task-grid">
                        <div>
                            <div className="va-meta-grid">
                                <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Account:</div>
                                <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#6366f1' }}>u/{account?.handle}</div>

                                <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Subreddit:</div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <a href={`https://reddit.com/r/${subreddit?.name.replace(/^(r\/|\/r\/)/i, '')}/submit`} target="_blank" rel="noreferrer" style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff', textDecoration: 'underline' }}>
                                        r/{subreddit?.name} ↗
                                    </a>
                                    <button onClick={() => copyToClipboard(subreddit?.name, 'Subreddit Name')} style={{ backgroundColor: '#2d313a', color: '#ccc', border: 'none', padding: '8px 12px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>Copy</button>
                                    <span style={{ fontSize: '0.8rem', backgroundColor: '#3b82f644', color: '#3b82f6', padding: '4px 8px', borderRadius: '4px' }}>
                                        {subreddit?.status?.toUpperCase()}
                                    </span>
                                </div>

                                <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Proxy Info:</div>
                                <div style={{ color: '#fbbf24', fontSize: '1rem', fontWeight: 'bold', fontFamily: 'monospace', wordBreak: 'break-all', backgroundColor: '#fbbf2411', padding: '8px', borderRadius: '4px' }}>
                                    {account?.proxyInfo || model?.proxyInfo || 'USE DEFAULT PROXY'}
                                </div>

                                <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Title:</div>
                                <div style={{ position: 'relative' }}>
                                    <div style={{ color: '#e5e7eb', backgroundColor: '#0f1115', padding: '16px', borderRadius: '4px', border: '1px solid #2d313a', fontSize: '1rem', lineHeight: '1.4' }}>
                                        {task.title}
                                    </div>
                                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', display: 'flex', gap: '8px' }}>
                                        <button
                                            onClick={handleRegenerateTitle}
                                            disabled={regeneratingTitle}
                                            style={{ backgroundColor: 'transparent', color: '#fbbf24', border: '1px solid #fbbf24', padding: '6px 10px', borderRadius: '4px', fontSize: '0.8rem', cursor: regeneratingTitle ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: regeneratingTitle ? 0.7 : 1 }}
                                        >
                                            {regeneratingTitle ? 'Regenerating...' : 'Regen Title'}
                                        </button>
                                        <button onClick={() => copyToClipboard(task.title, 'Title')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>Copy Title</button>
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '24px' }}>
                                <div style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>Post Verification URL:</div>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="https://www.reddit.com/r/..."
                                    style={{ backgroundColor: '#0f1115', border: '2px solid #6366f1', color: '#fff', padding: '16px', fontSize: '1rem' }}
                                    value={redditUrl}
                                    onChange={e => setRedditUrl(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Rules & Compliance */}
                        <div className="va-rules-panel">
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '8px' }}>REQUIRED FLAIR:</div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {subreddit?.flairRequired ? (
                                        <span style={{ backgroundColor: '#fbbf2422', color: '#fbbf24', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', border: '1px solid #fbbf24' }}>
                                            {subreddit.requiredFlair || 'FLAIR REQUIRED'}
                                        </span>
                                    ) : (
                                        <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>None specified</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '8px' }}>SUBREDDIT RULES HIGHLIGHTS:</div>
                                <div style={{ backgroundColor: '#0f1115', padding: '12px', borderRadius: '4px', fontSize: '0.8rem', color: '#d1d5db', maxHeight: '180px', overflowY: 'auto', border: '1px solid #2d313a' }}>
                                    {subreddit?.rulesSummary ? (
                                        <div style={{ whiteSpace: 'pre-wrap' }}>{subreddit.rulesSummary}</div>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>
                                            No rules summary stored. Check the subreddit sidebar before posting!
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Final Actions */}
                    <div className="va-actions-row">
                        <button
                            onClick={handleMarkPosted}
                            disabled={!redditUrl || cooldownActive}
                            style={{ flex: 2, backgroundColor: cooldownActive ? '#374151' : '#10b981', color: '#fff', border: 'none', padding: '16px', borderRadius: '8px', fontWeight: 'bold', cursor: cooldownActive ? 'not-allowed' : 'pointer', fontSize: '1.1rem', transition: 'all 0.2s', opacity: (redditUrl && !cooldownActive) ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        >
                            <span>{cooldownActive ? '⏳' : '✓'}</span> {cooldownActive ? 'Anti-Ban Breaking...' : 'I Have Posted This Live'}
                        </button>
                        <button
                            onClick={handleMarkError}
                            style={{ flex: 1, backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.1rem', transition: 'all 0.2s' }}
                        >
                            ✕ Issue / Failed
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
