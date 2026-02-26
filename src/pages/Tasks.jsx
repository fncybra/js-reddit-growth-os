import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudSyncService, DailyPlanGenerator, SettingsService, SubredditLifecycleService } from '../services/growthEngine';
import { startOfDay } from 'date-fns';

export function Tasks() {
    const models = useLiveQuery(() => db.models.toArray());
    const [selectedModelId, setSelectedModelId] = useState('');
    const [proxyUrl, setProxyUrl] = useState('https://js-reddit-proxy-production.up.railway.app');

    useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    useEffect(() => {
        async function loadProxy() {
            const settings = await SettingsService.getSettings();
            if (settings?.proxyUrl) setProxyUrl(settings.proxyUrl);
        }
        loadProxy();
    }, []);

    const activeModelId = Number(selectedModelId);
    const todayStr = startOfDay(new Date()).toISOString();

    const tasks = useLiveQuery(
        () => activeModelId ? db.tasks.where({ modelId: activeModelId, date: todayStr }).toArray() : [],
        [activeModelId, todayStr]
    );

    const [generating, setGenerating] = useState(false);
    const [clearing, setClearing] = useState(false);

    async function handleGenerate() {
        if (!activeModelId) return;
        setGenerating(true);
        try {
            await DailyPlanGenerator.generateDailyPlan(activeModelId);
        } catch (e) {
            alert("Error generating plan: " + e.message);
        } finally {
            setGenerating(false);
        }
    }

    async function handleClearTodayTasks() {
        if (!activeModelId || !tasks || tasks.length === 0) return;
        const confirmed = window.confirm('Clear all tasks for this model and date? This will also remove linked outcomes.');
        if (!confirmed) return;

        try {
            setClearing(true);
            const taskIds = tasks.map(t => t.id);

            if (taskIds.length === 0) {
                alert('No tasks to clear for this date.');
                return;
            }

            const linkedPerformances = await db.performances.where('taskId').anyOf(taskIds).toArray();
            const performanceIds = linkedPerformances.map(p => p.id);

            await db.transaction('rw', db.tasks, db.performances, async () => {
                if (linkedPerformances.length > 0) {
                    await db.performances.bulkDelete(performanceIds);
                }
                await db.tasks.bulkDelete(taskIds);
            });

            const CHUNK_SIZE = 200;
            for (let i = 0; i < performanceIds.length; i += CHUNK_SIZE) {
                const chunk = performanceIds.slice(i, i + CHUNK_SIZE);
                await CloudSyncService.deleteMultipleFromCloud('performances', chunk);
            }
            for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
                const chunk = taskIds.slice(i, i + CHUNK_SIZE);
                await CloudSyncService.deleteMultipleFromCloud('tasks', chunk);
            }

            alert(`Cleared ${taskIds.length} task(s) for today.`);
        } catch (e) {
            alert('Failed to clear tasks: ' + e.message);
        } finally {
            setClearing(false);
        }
    }

    if (!models || models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    return (
        <>
            <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 className="page-title">Daily Operations (Tasks)</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Model:
                        <select
                            className="input-field"
                            style={{ padding: '4px 8px', fontSize: '0.9rem', width: 'auto', display: 'inline-block' }}
                            value={selectedModelId}
                            onChange={e => setSelectedModelId(e.target.value)}
                        >
                            {models?.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        • Date: <strong>{new Date().toLocaleDateString()}</strong>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="btn btn-outline"
                        onClick={handleClearTodayTasks}
                        disabled={generating || clearing || !tasks || tasks.length === 0}
                        style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                    >
                        {clearing ? 'Clearing...' : 'Clear Tasks'}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleGenerate}
                        disabled={generating}
                    >
                        {generating ? 'Generating...' : 'Generate Daily Plan'}
                    </button>
                </div>
            </header>
            <div className="page-content">
                <div className="card">
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Today's Tasks ({tasks?.length || 0})</h2>
                    {tasks?.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No tasks for today. Click "Generate Daily Plan" to begin.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Task Details</th>
                                        <th>Media Asset</th>
                                        <th>Target Subreddit</th>
                                        <th>Status</th>
                                        <th>24h Outcome</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tasks?.map(task => (
                                        <TaskRow key={task.id} task={task} activeModelId={activeModelId} proxyUrl={proxyUrl} />
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

function TaskRow({ task, activeModelId, proxyUrl }) {
    const [outcome, setOutcome] = useState({ views: '', removed: false });
    const [saved, setSaved] = useState(false);
    const [mediaFailed, setMediaFailed] = useState(false);
    const [heicPreviewUrl, setHeicPreviewUrl] = useState('');

    // Load related data
    const subreddit = useLiveQuery(() => db.subreddits.get(task.subredditId), [task.subredditId]);
    const performance = useLiveQuery(() => db.performances.where({ taskId: task.id }).first(), [task.id]);
    const asset = useLiveQuery(() => db.assets.get(task.assetId), [task.assetId]);

    useEffect(() => {
        if (performance) {
            setOutcome({ views: performance.views24h, removed: performance.removed === 1 });
            setSaved(true);
        }
    }, [performance]);

    async function handleSaveOutcome() {
        if (outcome.views === '') return;

        if (performance) {
            await db.performances.update(performance.id, {
                views24h: Number(outcome.views),
                removed: outcome.removed ? 1 : 0
            });
        } else {
            await db.performances.add({
                taskId: task.id,
                views24h: Number(outcome.views),
                removed: outcome.removed ? 1 : 0,
                notes: ''
            });
            await db.tasks.update(task.id, { status: 'closed' });
        }

        // Evaluate subreddits after saving
        await SubredditLifecycleService.evaluateSubreddits(activeModelId);
        setSaved(true);
    }

    async function handleDeleteTask(e) {
        e.preventDefault();
        e.stopPropagation();

        const confirmed = window.confirm('Delete this task and its linked outcome?');
        if (!confirmed) return;

        try {
            await db.tasks.delete(task.id);
            await CloudSyncService.deleteFromCloud('tasks', task.id);

            if (performance) {
                await db.performances.delete(performance.id);
                await CloudSyncService.deleteFromCloud('performances', performance.id);
            }
        } catch (err) {
            alert('Failed to delete task: ' + err.message);
        }
    }

    const objectUrl = useMemo(() => {
        if (!asset?.fileBlob) return null;
        return URL.createObjectURL(asset.fileBlob);
    }, [asset?.id, asset?.fileBlob]);

    const isHeic = !!asset?.fileName && /\.hei[cf]$/i.test(asset.fileName);

    useEffect(() => {
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl]);

    useEffect(() => {
        let cancelled = false;
        let generatedUrl = '';

        async function prepareHeicPreview() {
            setHeicPreviewUrl('');
            if (!asset?.driveFileId || !isHeic) return;

            try {
                const response = await fetch(`${proxyUrl}/api/drive/download/${asset.driveFileId}?convert=true`);
                if (!response.ok) return;
                const blob = await response.blob();
                generatedUrl = URL.createObjectURL(blob);
                if (!cancelled) setHeicPreviewUrl(generatedUrl);
            } catch {
                // leave fallback chain in place
            }
        }

        prepareHeicPreview();

        return () => {
            cancelled = true;
            if (generatedUrl) URL.revokeObjectURL(generatedUrl);
        };
    }, [asset?.id, asset?.driveFileId, isHeic, proxyUrl]);

    useEffect(() => {
        setMediaFailed(false);
    }, [task.id, objectUrl, heicPreviewUrl, asset?.driveFileId, asset?.thumbnailUrl, asset?.originalUrl]);

    const previewUrl = objectUrl
        || (isHeic ? heicPreviewUrl : null)
        || (asset?.assetType === 'image' && asset?.driveFileId ? `${proxyUrl}/api/drive/thumb/${asset.driveFileId}` : null)
        || (asset?.assetType === 'video' && asset?.driveFileId ? `${proxyUrl}/api/drive/view/${asset.driveFileId}` : null)
        || asset?.thumbnailUrl
        || asset?.originalUrl
        || null;

    return (
        <tr style={{ opacity: saved ? 0.7 : 1, transition: 'opacity 0.2s', borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ fontWeight: '500', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '1rem' }}>{task.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Window: {task.postingWindow}</div>
            </td>
            <td style={{ verticalAlign: 'middle', width: '200px' }}>
                {asset ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {asset.assetType === 'image' && previewUrl && !mediaFailed ? (
                            <img src={previewUrl} alt="asset thumbnail" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} onError={() => setMediaFailed(true)} />
                        ) : asset.assetType === 'video' && previewUrl && !mediaFailed ? (
                            <video src={previewUrl} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} onError={() => setMediaFailed(true)} />
                        ) : (
                            <div style={{ width: '60px', height: '60px', backgroundColor: 'var(--surface-color)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No File</div>
                        )}
                        <div style={{ fontSize: '0.85rem', width: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.fileName}>
                            {asset.fileName || asset.angleTag}
                        </div>
                    </div>
                ) : (
                    <span style={{ color: 'var(--status-danger)' }}>Asset Missing</span>
                )}
            </td>
            <td style={{ verticalAlign: 'middle', fontWeight: '500' }}>
                {subreddit ? (
                    <a href={`https://reddit.com/r/${subreddit.name.replace(/^(r\/|\/r\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                        r/{subreddit.name}
                    </a>
                ) : (
                    task.subredditId
                )}
            </td>
            <td style={{ verticalAlign: 'middle' }}>
                <span className={`badge ${saved ? 'badge-success' : 'badge-warning'}`}>
                    {saved ? 'closed' : task.status}
                </span>
            </td>
            <td>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                        type="number"
                        className="input-field"
                        style={{ width: '100px', padding: '6px' }}
                        placeholder="Views"
                        value={outcome.views}
                        onChange={e => { setOutcome({ ...outcome, views: e.target.value }); setSaved(false); }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                        <input
                            type="checkbox"
                            checked={outcome.removed}
                            onChange={e => { setOutcome({ ...outcome, removed: e.target.checked }); setSaved(false); }}
                        />
                        Removed
                    </label>
                    {!saved && (
                        <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={handleSaveOutcome}>
                            Save
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                        onClick={handleDeleteTask}
                        title="Delete task"
                    >
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    );
}
