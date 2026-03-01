import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudSyncService, DailyPlanGenerator, SettingsService, SubredditLifecycleService, TitleGeneratorService } from '../services/growthEngine';

const ACCOUNT_COLORS = [
    '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
    '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#a855f7',
    '#10b981', '#e11d48',
];

export function Tasks() {
    const models = useLiveQuery(() => db.models.toArray());
    const [selectedModelId, setSelectedModelId] = useState('');
    const [proxyUrl, setProxyUrl] = useState('https://js-reddit-proxy-production.up.railway.app');
    const [selectedAccountId, setSelectedAccountId] = useState('ALL');
    const [groupByAccount, setGroupByAccount] = useState(true);
    const [collapsedGroups, setCollapsedGroups] = useState(new Set());

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

    // Reset account filter when model changes
    useEffect(() => {
        setSelectedAccountId('ALL');
        setCollapsedGroups(new Set());
    }, [activeModelId]);

    const modelAccounts = useLiveQuery(
        () => activeModelId ? db.accounts.where('modelId').equals(activeModelId).toArray() : [],
        [activeModelId]
    );

    const taskBundle = useLiveQuery(
        async () => {
            if (!activeModelId) return { queueDate: null, tasks: [] };
            const rows = await db.tasks.where('modelId').equals(activeModelId).toArray();
            if (!rows || rows.length === 0) return { queueDate: null, tasks: [] };

            const datedRows = rows.filter(r => !!r.date);
            if (datedRows.length === 0) return { queueDate: null, tasks: rows };

            const latestDate = datedRows
                .map(r => r.date)
                .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0];

            return {
                queueDate: latestDate,
                tasks: rows.filter(r => !r.date || r.date === latestDate)
            };
        },
        [activeModelId]
    );

    const allTasks = taskBundle?.tasks || [];
    const tasks = selectedAccountId === 'ALL'
        ? allTasks
        : allTasks.filter(t => Number(t.accountId) === Number(selectedAccountId));

    const queueDateLabel = taskBundle?.queueDate
        ? new Date(taskBundle.queueDate).toLocaleDateString()
        : new Date().toLocaleDateString();

    const [generating, setGenerating] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [fixingTitles, setFixingTitles] = useState(false);
    const [postTarget, setPostTarget] = useState('');

    const planCapacity = useLiveQuery(
        async () => {
            if (!activeModelId) return null;

            const [settings, accounts, subreddits, modelTasks] = await Promise.all([
                SettingsService.getSettings(),
                db.accounts.where('modelId').equals(activeModelId).toArray(),
                db.subreddits.where('modelId').equals(activeModelId).toArray(),
                db.tasks.where('modelId').equals(activeModelId).toArray(),
            ]);

            const activeAccounts = accounts.filter(a => a.status === 'active');
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const todayIso = start.toISOString();
            const tasksToday = modelTasks.filter(t => t.date === todayIso);
            const postTasksToday = tasksToday.filter(t => t.taskType === 'post' || !t.taskType);

            const perAccountBreakdown = activeAccounts.map(account => {
                const already = tasksToday.filter(t => Number(t.accountId) === Number(account.id)).length;
                const cap = Number(account.dailyCap || settings.dailyPostCap || 0);
                const remaining = Math.max(0, cap - already);

                const accountSubs = subreddits.filter(s => {
                    if (s.status === 'rejected') return false;
                    return !s.accountId || Number(s.accountId) === Number(account.id);
                });
                const provenSubs = accountSubs.filter(s => s.status === 'proven').length;
                const testingSubs = accountSubs.filter(s => s.status === 'testing').length;

                return {
                    accountId: account.id,
                    handle: account.handle || `Account #${account.id}`,
                    cap,
                    already,
                    remaining,
                    provenSubs,
                    testingSubs,
                };
            });

            // Use user's target if set, otherwise sum of per-account remaining
            const targetNum = postTarget !== '' ? Number(postTarget) : null;
            const desiredRemaining = targetNum != null
                ? Math.max(0, targetNum - postTasksToday.length)
                : perAccountBreakdown.reduce((sum, a) => sum + a.remaining, 0);

            const usedSubIdsToday = new Set(tasksToday.map(t => Number(t.subredditId)).filter(Boolean));
            const candidateSubs = subreddits.filter(s => {
                if (s.status === 'rejected') return false;
                if (s.cooldownUntil && new Date(s.cooldownUntil) > new Date()) return false;
                if (usedSubIdsToday.has(Number(s.id))) return false;

                const attachedAll = !s.accountId;
                const attachedToActive = activeAccounts.some(a => Number(a.id) === Number(s.accountId));
                return attachedAll || attachedToActive;
            });

            const repeatsEnabled = Number(settings.allowSubredditRepeatsInQueue || 0) === 1;
            const perSubCap = Math.max(1, Number(settings.maxPostsPerSubPerDay || 5));
            const uniqueCapacity = candidateSubs.length;
            const repeatedCapacity = candidateSubs.length * perSubCap;
            const estimatedMax = repeatsEnabled ? repeatedCapacity : uniqueCapacity;

            return {
                desiredRemaining,
                existingPosts: postTasksToday.length,
                activeAccounts: activeAccounts.length,
                candidateSubreddits: candidateSubs.length,
                repeatsEnabled,
                perSubCap,
                estimatedMax,
                willShortfall: desiredRemaining > estimatedMax,
                shortfallBy: Math.max(0, desiredRemaining - estimatedMax),
                perAccountBreakdown,
            };
        },
        [activeModelId, allTasks?.length, postTarget]
    );

    const isBadTitle = (title) => {
        const t = String(title || '').toLowerCase();
        return t.includes('[api error]') || t.includes('api error') || t.includes('user not found') || t.includes('generated title failed');
    };

    async function handleGenerate() {
        if (!activeModelId) return;

        if (planCapacity?.willShortfall) {
            const msg = `Warning: requested remaining posts is ${planCapacity.desiredRemaining}, but current attached subreddit capacity is about ${planCapacity.estimatedMax}. Short by ~${planCapacity.shortfallBy}. Generate anyway?`;
            const ok = window.confirm(msg);
            if (!ok) return;
        }

        setGenerating(true);
        try {
            const target = postTarget !== '' ? Number(postTarget) : undefined;
            await DailyPlanGenerator.generateDailyPlan(activeModelId, new Date(), target != null ? { totalTarget: target } : {});
        } catch (e) {
            alert("Error generating plan: " + e.message);
        } finally {
            setGenerating(false);
        }
    }

    async function handleClearTodayTasks() {
        if (!activeModelId) return;
        const confirmed = window.confirm('Clear ALL tasks for this model? This will also remove linked outcomes.');
        if (!confirmed) return;

        try {
            setClearing(true);
            // Clear ALL tasks for this model (not just latest date) to prevent stale tasks piling up
            const allModelTasks = await db.tasks.where('modelId').equals(activeModelId).toArray();
            const taskIds = allModelTasks.map(t => t.id);

            if (taskIds.length === 0) {
                alert('No tasks to clear.');
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

            alert(`Cleared ${taskIds.length} task(s).`);
        } catch (e) {
            alert('Failed to clear tasks: ' + e.message);
        } finally {
            setClearing(false);
        }
    }

    async function handleFixBadTitles() {
        const badTasks = (allTasks || []).filter(t => isBadTitle(t.title));
        if (badTasks.length === 0) {
            alert('No API-error titles found in this queue.');
            return;
        }

        try {
            setFixingTitles(true);
            for (const task of badTasks) {
                const [subreddit, asset, siblingTasks] = await Promise.all([
                    task.subredditId ? db.subreddits.get(task.subredditId) : null,
                    task.assetId ? db.assets.get(task.assetId) : null,
                    db.tasks.where('modelId').equals(task.modelId).toArray(),
                ]);

                if (!subreddit?.name) continue;
                const previousTitles = siblingTasks
                    .filter(t => t.subredditId === task.subredditId && t.id !== task.id && !!t.title)
                    .map(t => t.title);

                let newTitle = await TitleGeneratorService.generateTitle(
                    subreddit.name,
                    subreddit.rulesSummary || '',
                    subreddit.requiredFlair || '',
                    previousTitles,
                    { assetType: asset?.assetType || 'image', angleTag: asset?.angleTag || '' }
                );

                if (isBadTitle(newTitle) || !newTitle) {
                    newTitle = 'honest opinion on this one?';
                }

                await db.tasks.update(task.id, { title: newTitle });
            }

            try {
                await CloudSyncService.autoPush(['tasks']);
            } catch (err) {
                console.warn('[Tasks] Cloud sync after title fix failed:', err.message);
            }

            alert(`Regenerated ${badTasks.length} bad title(s).`);
        } catch (err) {
            alert('Failed to regenerate titles: ' + err.message);
        } finally {
            setFixingTitles(false);
        }
    }

    function toggleGroup(accountId) {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(accountId)) next.delete(accountId);
            else next.add(accountId);
            return next;
        });
    }

    // Group tasks by accountId for grouped view
    const groupedTasks = useMemo(() => {
        if (!tasks || tasks.length === 0) return [];
        const groups = {};
        for (const task of tasks) {
            const key = task.accountId || 0;
            if (!groups[key]) groups[key] = [];
            groups[key].push(task);
        }
        return Object.entries(groups).map(([accountId, tasks]) => ({
            accountId: Number(accountId),
            tasks: tasks.sort((a, b) => (a.scheduledTime || '99:99').localeCompare(b.scheduledTime || '99:99')),
        }));
    }, [tasks]);

    if (!models || models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    const sortedTasks = [...(tasks || [])].sort((a, b) => (a.scheduledTime || '99:99').localeCompare(b.scheduledTime || '99:99'));
    const showGrouped = groupByAccount && selectedAccountId === 'ALL' && groupedTasks.length > 1;

    return (
        <>
            <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 className="page-title">Daily Operations (Tasks)</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                        Account:
                        <select
                            className="input-field"
                            style={{ padding: '4px 8px', fontSize: '0.9rem', width: 'auto', display: 'inline-block' }}
                            value={selectedAccountId}
                            onChange={e => setSelectedAccountId(e.target.value)}
                        >
                            <option value="ALL">All Accounts</option>
                            {(modelAccounts || []).map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.handle || `Account #${acc.id}`}
                                </option>
                            ))}
                        </select>
                        <button
                            className="btn btn-outline"
                            style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                            onClick={() => setGroupByAccount(g => !g)}
                        >
                            {groupByAccount ? 'Grouped' : 'Flat'}
                        </button>
                        {' '} Queue Date: <strong>{queueDateLabel}</strong>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="btn btn-outline"
                        onClick={handleFixBadTitles}
                        disabled={generating || clearing || fixingTitles || !allTasks || allTasks.length === 0}
                        style={{ color: '#fbbf24', borderColor: '#fbbf24' }}
                    >
                        {fixingTitles ? 'Fixing Titles...' : 'Fix API Titles'}
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={handleClearTodayTasks}
                        disabled={generating || clearing || !allTasks || allTasks.length === 0}
                        style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                    >
                        {clearing ? 'Clearing...' : 'Clear Tasks'}
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Total Posts:</label>
                        <input
                            type="number"
                            min="1"
                            max="200"
                            className="input-field"
                            style={{ width: '65px', padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }}
                            value={postTarget}
                            onChange={e => setPostTarget(e.target.value)}
                            placeholder={String(allTasks?.filter(t => t.taskType === 'post' || !t.taskType).length || 0)}
                        />
                        {postTarget !== '' && allTasks && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                ({allTasks.filter(t => t.taskType === 'post' || !t.taskType).length} exist{Number(postTarget) > allTasks.filter(t => t.taskType === 'post' || !t.taskType).length ? `, +${Number(postTarget) - allTasks.filter(t => t.taskType === 'post' || !t.taskType).length} new` : ''})
                            </span>
                        )}
                    </div>
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
                {planCapacity && (
                    <div className="card" style={{ marginBottom: '16px', borderColor: planCapacity.willShortfall ? 'var(--status-warning)' : 'var(--border-color)' }}>
                        <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div><strong>Plan Capacity Check</strong></div>
                            <div>Active Accounts: <strong>{planCapacity.activeAccounts}</strong></div>
                            <div>Remaining Target Posts: <strong>{planCapacity.desiredRemaining}</strong></div>
                            <div>Usable Subreddits: <strong>{planCapacity.candidateSubreddits}</strong></div>
                            <div>Estimated Max New Tasks: <strong>{planCapacity.estimatedMax}</strong></div>
                            {planCapacity.repeatsEnabled && <div>Repeat Mode: <strong>ON</strong> (cap {planCapacity.perSubCap}/sub)</div>}
                            {!planCapacity.repeatsEnabled && <div>Repeat Mode: <strong>OFF</strong></div>}
                        </div>
                        {planCapacity.willShortfall && (
                            <div style={{ marginTop: '10px', color: 'var(--status-warning)' }}>
                                Not enough attached subreddit capacity to fill all requested posts. Attach more subreddits or reduce caps.
                            </div>
                        )}
                        {planCapacity.perAccountBreakdown && planCapacity.perAccountBreakdown.length > 0 && (
                            <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>Per-Account Breakdown:</div>
                                {planCapacity.perAccountBreakdown.map(a => (
                                    <div key={a.accountId} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: ACCOUNT_COLORS[a.accountId % ACCOUNT_COLORS.length],
                                        }} />
                                        <span style={{ fontWeight: 500 }}>{a.handle}</span>
                                        {' '}&mdash; {a.remaining} remaining (cap {a.cap}, {a.already} existing) &bull; {a.provenSubs} proven + {a.testingSubs} testing subs
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {showGrouped ? (
                    // Grouped view: one card per account
                    groupedTasks.map(group => {
                        const acc = (modelAccounts || []).find(a => Number(a.id) === group.accountId);
                        const handle = acc?.handle || `Account #${group.accountId}`;
                        const color = ACCOUNT_COLORS[group.accountId % ACCOUNT_COLORS.length];
                        const isCollapsed = collapsedGroups.has(group.accountId);

                        return (
                            <div className="card" key={group.accountId} style={{ marginBottom: '12px' }}>
                                <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
                                    onClick={() => toggleGroup(group.accountId)}
                                >
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {isCollapsed ? '\u25B6' : '\u25BC'}
                                    </span>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '2px 10px',
                                        borderRadius: '12px',
                                        backgroundColor: color,
                                        color: '#fff',
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                    }}>
                                        {handle}
                                    </span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                {!isCollapsed && (
                                    <div className="data-table-container" style={{ marginTop: '10px' }}>
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Time</th>
                                                    <th>Type</th>
                                                    <th>Task Details</th>
                                                    <th>Media Asset</th>
                                                    <th>Target Subreddit</th>
                                                    <th>Status</th>
                                                    <th>24h Outcome</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.tasks.map(task => (
                                                    <TaskRow key={task.id} task={task} activeModelId={activeModelId} proxyUrl={proxyUrl} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })
                ) : (
                    // Flat view or single-account selected
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Today's Tasks ({tasks?.length || 0})</h2>
                        {tasks?.length === 0 ? (
                            <div style={{ color: 'var(--text-secondary)' }}>No tasks for today. Click "Generate Daily Plan" to begin.</div>
                        ) : (
                            <div className="data-table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Account</th>
                                            <th>Type</th>
                                            <th>Task Details</th>
                                            <th>Media Asset</th>
                                            <th>Target Subreddit</th>
                                            <th>Status</th>
                                            <th>24h Outcome</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedTasks.map(task => (
                                            <TaskRow key={task.id} task={task} activeModelId={activeModelId} proxyUrl={proxyUrl} showAccount />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

const TASK_TYPE_ICONS = {
    post: { icon: '\uD83D\uDCDD', label: 'Post' },
    comment: { icon: '\uD83D\uDCAC', label: 'Comment' },
    upvote: { icon: '\uD83D\uDC4D', label: 'Upvote' },
    engage: { icon: '\uD83E\uDD1D', label: 'Engage' },
    warmup: { icon: '\uD83E\uDDCA', label: 'Warmup' },
};

function TaskRow({ task, activeModelId, proxyUrl, showAccount }) {
    const [outcome, setOutcome] = useState({ views: '', removed: false });
    const [saved, setSaved] = useState(false);
    const [mediaFailed, setMediaFailed] = useState(false);
    const [heicPreviewUrl, setHeicPreviewUrl] = useState('');

    // Load related data
    const subreddit = useLiveQuery(() => task.subredditId ? db.subreddits.get(task.subredditId) : null, [task.subredditId]);
    const performance = useLiveQuery(() => task.id ? db.performances.where({ taskId: task.id }).first() : null, [task.id]);
    const asset = useLiveQuery(() => task.assetId ? db.assets.get(task.assetId) : null, [task.assetId]);
    const account = useLiveQuery(() => task.accountId ? db.accounts.get(task.accountId) : null, [task.accountId]);

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
                id: generateId(),
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

    const isEngagement = (task.taskType && task.taskType !== 'post') || /^(Engage|Warmup):/i.test(task.title);
    const typeInfo = TASK_TYPE_ICONS[task.taskType] || TASK_TYPE_ICONS.post;

    const accountColor = task.accountId ? ACCOUNT_COLORS[task.accountId % ACCOUNT_COLORS.length] : '#666';

    return (
        <tr style={{ opacity: saved ? 0.7 : 1, transition: 'opacity 0.2s', borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ verticalAlign: 'middle', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-color)', whiteSpace: 'nowrap' }}>
                {task.scheduledTime || '\u2014'}
            </td>
            {showAccount && (
                <td style={{ verticalAlign: 'middle' }}>
                    <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        backgroundColor: accountColor,
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                    }}>
                        {account?.handle || (task.accountId ? `#${task.accountId}` : '\u2014')}
                    </span>
                </td>
            )}
            <td style={{ verticalAlign: 'middle', textAlign: 'center', fontSize: '1.1rem' }} title={typeInfo.label}>
                <div>{typeInfo.icon}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{typeInfo.label}</div>
            </td>
            <td style={{ fontWeight: '500', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '1rem' }}>{task.title}</div>
            </td>
            <td style={{ verticalAlign: 'middle', width: '200px' }}>
                {asset ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {asset.assetType === 'image' && previewUrl && !mediaFailed ? (
                            <img src={previewUrl} alt="asset thumbnail" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} onError={() => setMediaFailed(true)} />
                        ) : asset.assetType === 'video' && previewUrl && !mediaFailed ? (
                            <video src={previewUrl} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} onError={() => setMediaFailed(true)} />
                        ) : (
                            <div style={{ width: '60px', height: '60px', backgroundColor: 'var(--surface-color)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.6rem', textAlign: 'center', padding: '4px' }}>{isHeic ? 'HEIC' : (asset.assetType === 'video' ? 'VID' : 'IMG')}</div>
                        )}
                        <div style={{ fontSize: '0.85rem', width: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={asset.fileName}>
                            {asset.fileName || asset.angleTag}
                        </div>
                    </div>
                ) : isEngagement ? (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>N/A</span>
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
                {isEngagement ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {task.status !== 'closed' ? (
                            <button
                                className="btn btn-primary"
                                style={{ padding: '4px 16px', fontSize: '0.8rem' }}
                                onClick={async () => {
                                    await db.tasks.update(task.id, { status: 'closed' });
                                    try { await CloudSyncService.autoPush(['tasks']); } catch {}
                                    setSaved(true);
                                }}
                            >
                                Done
                            </button>
                        ) : (
                            <span style={{ color: 'var(--status-success)', fontSize: '0.8rem', fontWeight: 600 }}>Completed</span>
                        )}
                        <button
                            type="button"
                            className="btn btn-outline"
                            style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                            onClick={handleDeleteTask}
                            title="Delete task"
                        >
                            {'\uD83D\uDDD1\uFE0F'}
                        </button>
                    </div>
                ) : (
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
                            {'\uD83D\uDDD1\uFE0F'}
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
}
