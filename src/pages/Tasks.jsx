import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { DailyPlanGenerator, SubredditLifecycleService, CloudSyncService } from '../services/growthEngine';
import { startOfDay } from 'date-fns';

export function Tasks() {
    const models = useLiveQuery(() => db.models.toArray());
    const [selectedModelId, setSelectedModelId] = useState('');

    useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const activeModelId = Number(selectedModelId);
    const todayStr = startOfDay(new Date()).toISOString();

    const tasks = useLiveQuery(
        () => activeModelId ? db.tasks.where('modelId').equals(activeModelId).filter(t => t.date === todayStr).toArray() : [],
        [activeModelId, todayStr]
    );

    const [generating, setGenerating] = useState(false);

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

    async function handleClearPending() {
        if (!activeModelId || !tasks) return;
        const pendingTasks = tasks.filter(t => t.status !== 'closed');
        if (pendingTasks.length === 0) {
            alert("No pending tasks to clear.");
            return;
        }

        if (window.confirm(`Are you sure you want to permanently delete ${pendingTasks.length} pending tasks?`)) {
            try {
                const ids = pendingTasks.map(t => t.id);
                await db.tasks.bulkDelete(ids);

                // Track down any related performances to delete from cloud
                const perfs = await db.performances.where('taskId').anyOf(ids).toArray();
                if (perfs.length > 0) {
                    const perfIds = perfs.map(p => p.id);
                    await db.performances.bulkDelete(perfIds);
                    await CloudSyncService.deleteMultipleFromCloud('performances', perfIds);
                }

                await CloudSyncService.deleteMultipleFromCloud('tasks', ids);
            } catch (err) {
                console.error("Failed to clear tasks:", err);
                alert("Failed to clear tasks: " + err.message);
            }
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
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        className="btn btn-outline"
                        style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                        onClick={handleClearPending}
                        disabled={generating || !tasks || tasks.length === 0}
                    >
                        Clear Pending
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
                                        <TaskRow key={task.id} task={task} activeModelId={activeModelId} />
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

function TaskRow({ task, activeModelId }) {
    const [outcome, setOutcome] = useState({ views: '', removed: false });
    const [saved, setSaved] = useState(false);

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

        try {
            await db.tasks.delete(task.id);
            await CloudSyncService.deleteFromCloud('tasks', task.id);

            if (performance) {
                await db.performances.delete(performance.id);
                await CloudSyncService.deleteFromCloud('performances', performance.id);
            }
        } catch (err) {
            console.error("Failed to delete task:", err);
            alert("Failed to delete task: " + err.message);
        }
    }

    const objectUrl = asset?.fileBlob ? URL.createObjectURL(asset.fileBlob) : null;

    return (
        <tr style={{ opacity: saved ? 0.7 : 1, transition: 'opacity 0.2s', borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ fontWeight: '500', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '1rem' }}>{task.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Window: {task.postingWindow}</div>
            </td>
            <td style={{ verticalAlign: 'middle', width: '200px' }}>
                {asset ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {asset.assetType === 'image' && objectUrl ? (
                            <img src={objectUrl} alt="asset thumbnail" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} onLoad={() => URL.revokeObjectURL(objectUrl)} />
                        ) : asset.assetType === 'video' && objectUrl ? (
                            <video src={objectUrl} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
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
                    <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }} onClick={handleDeleteTask} title="Delete Task">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    );
}
