import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { startOfDay } from 'date-fns';

export function VADashboard() {
    const [selectedModelId, setSelectedModelId] = useState('');
    const [authenticated, setAuthenticated] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [error, setError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [cooldownUntil, setCooldownUntil] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);

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
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const activeModelId = selectedModelId ? Number(selectedModelId) : null;

    // Fetch all pending tasks to avoid Timezone strict-equality blocking overseas VAs
    const tasks = useLiveQuery(
        () => activeModelId ? db.tasks.where('modelId').equals(activeModelId).filter(t => t.status !== 'closed' && t.status !== 'failed').toArray() : [],
        [activeModelId]
    );

    function handleAuth() {
        if (pinInput === vaPin) {
            setAuthenticated(true);
            setError('');
        } else {
            setError('Invalid PIN');
        }
    }

    if (!authenticated) {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
                <div style={{ backgroundColor: '#1a1d24', padding: '40px', borderRadius: '12px', border: '1px solid #2d313a', width: '320px' }}>
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔐</div>
                        <h2 style={{ fontSize: '1.2rem' }}>VA Terminal Access</h2>
                        <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Enter access PIN to continue</p>
                    </div>
                    <input
                        type="password"
                        className="input-field"
                        style={{ fontSize: '1.5rem', textAlign: 'center', letterSpacing: '8px', marginBottom: '16px', backgroundColor: '#0f1115' }}
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
        <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', color: '#e5e7eb', fontFamily: 'sans-serif' }}>
            <header style={{ backgroundColor: '#1a1d24', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2d313a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#6366f1' }}>VA Operations Terminal</div>
                    {syncing && <span style={{ color: '#fbbf24', fontSize: '0.8rem' }}>☁️ Syncing...</span>}
                    <select
                        style={{ padding: '8px', backgroundColor: '#2d313a', color: '#fff', border: 'none', borderRadius: '4px', outline: 'none' }}
                        value={selectedModelId}
                        onChange={e => setSelectedModelId(e.target.value)}
                    >
                        {models?.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
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
                    <button onClick={() => setAuthenticated(false)} style={{ backgroundColor: 'transparent', color: '#9ca3af', border: '1px solid #2d313a', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Lock</button>
                </div>
            </header>

            <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
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
                            <VATaskCard key={task.id} task={task} index={index + 1} onPosted={() => setCooldownUntil(Date.now() + (postInterval * 60000))} cooldownActive={timeLeft > 0} />
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

    const isDone = task.status === 'closed' || performance;
    const objectUrl = asset?.fileBlob ? URL.createObjectURL(asset.fileBlob) : (asset?.originalUrl || asset?.thumbnailUrl);

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
            } else if (asset.originalUrl) {
                // If it's an HEIC/HEIF file from iPhone, convert it before downloading
                const isHeic = asset.fileName && (asset.fileName.toLowerCase().endsWith('.heic') || asset.fileName.toLowerCase().endsWith('.heif'));

                if (isHeic) {
                    alert("Converting iPhone HEIC photo to JPEG for Reddit... please wait a few seconds.");
                    const heic2any = (await import('heic2any')).default;

                    // Route through Vercel serverless function to bypass Google Drive CORS without relying on Railway proxy
                    const fetchUrl = asset.driveFileId ? `/api/drive/download/${asset.driveFileId}` : asset.originalUrl;

                    const response = await fetch(fetchUrl);
                    if (!response.ok) throw new Error("Network request failed");
                    const blob = await response.blob();

                    const jpegBlob = await heic2any({
                        blob,
                        toType: "image/jpeg",
                        quality: 0.9
                    });

                    const newFileName = (asset.fileName || 'converted').replace(/\.hei[cf]$/i, '.jpg');

                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(jpegBlob);
                    a.download = newFileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                } else {
                    // Standard Download (JPEG, PNG, MP4, etc)
                    performDownload(asset.originalUrl, 'media');
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
        if (!redditUrl.includes('reddit.com/r/')) {
            return alert("Please paste the actual Reddit Post URL first so stats can be tracked.");
        }

        const idMatch = redditUrl.match(/\/comments\/([a-z0-9]+)\//i);
        const redditPostId = idMatch ? idMatch[1] : '';

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
                const assetUpdate = {
                    timesUsed: (asset.timesUsed || 0) + 1,
                    lastUsedDate: new Date().toISOString()
                };
                await db.assets.update(asset.id, assetUpdate);

                // If it's a Drive-linked asset and model has a 'Used' folder, move it there
                if (asset.driveFileId && targetModel?.usedFolderId) {
                    try {
                        console.log(`Moving Drive file ${asset.driveFileId} to Used folder ${targetModel.usedFolderId}...`);
                        const moveRes = await fetch(`/api/drive/move`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fileId: asset.driveFileId,
                                targetFolderId: targetModel.usedFolderId
                            })
                        });
                        if (!moveRes.ok) {
                            console.error("Failed to move file in Drive");
                        }
                    } catch (err) {
                        console.error("Error during Drive move:", err);
                    }
                }

                // Cloud Sync Push
                const { getSupabaseClient } = await import('../db/supabase');
                const supabase = await getSupabaseClient();
                if (supabase) {
                    console.log("Pushing task completion to cloud...");
                    await supabase.from('tasks').upsert({
                        id: task.id,
                        status: 'closed',
                        reddit_url: redditUrl,
                        reddit_post_id: redditPostId
                    });
                    await supabase.from('assets').upsert({
                        id: asset.id,
                        ...assetUpdate
                    });
                    // Performance entry
                    await supabase.from('performances').upsert({
                        task_id: task.id,
                        views_24h: 0,
                        removed: false,
                        notes: 'Awaiting automated sync...'
                    });
                }
            }
        }
        onPosted(); // Trigger cooldown
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

            // Cloud Sync Push
            const { getSupabaseClient } = await import('../db/supabase');
            const supabase = await getSupabaseClient();
            if (supabase) {
                await supabase.from('tasks').upsert({ id: task.id, ...taskUpdate });
                await supabase.from('performances').upsert({
                    task_id: task.id,
                    views_24h: 0,
                    removed: true,
                    notes: reason
                });
            }
        }
    }

    async function copyToClipboard(text, label) {
        navigator.clipboard.writeText(text);
        alert(`${label} copied to clipboard!`);
    }

    if (isDone) {
        return (
            <div style={{ padding: '16px', backgroundColor: '#0f1115', border: '1px dashed #2d313a', borderRadius: '8px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '16px', opacity: 0.6 }}>
                <span style={{ backgroundColor: '#10b98122', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>COMPLETED</span>
                <span>Task #{index} - r/{subreddit?.name} executed. {task.redditUrl && "Post ID: " + task.redditPostId}</span>
            </div>
        );
    }

    return (
        <div style={{ backgroundColor: '#1a1d24', border: '1px solid #2d313a', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
            {/* Media Area */}
            <div style={{ width: '100%', maxWidth: '280px', backgroundColor: '#000', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', margin: '0 auto' }}>
                <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {asset ? (
                        asset.assetType === 'image' && objectUrl ? (
                            <img src={objectUrl} alt="task media" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onLoad={() => URL.revokeObjectURL(objectUrl)} />
                        ) : asset.assetType === 'video' && objectUrl ? (
                            <video src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} controls />
                        ) : (
                            <div style={{ color: '#9ca3af' }}>No File</div>
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
            <div style={{ padding: '24px', flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
                    {/* Posting Instructions */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px', marginBottom: '16px' }}>
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
                                    <button onClick={() => copyToClipboard(task.title, 'Title')} style={{ position: 'absolute', bottom: '8px', right: '8px', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>Copy Title</button>
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
                        <div style={{ borderLeft: '1px solid #2d313a', paddingLeft: '24px', borderTop: '1px solid #2d313a', paddingTop: '24px', borderLeftColor: 'transparent', marginLeft: '-24px', paddingLeft: '24px' }}>
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
                    <div style={{ display: 'flex', gap: '12px', marginTop: '24px', borderTop: '1px solid #2d313a', paddingTop: '24px' }}>
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
