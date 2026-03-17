import React, { useState } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnalyticsEngine, canUseStore, getAssignmentAccountRoster, SubredditAssignmentService, SubredditGuardService, VerificationService } from '../services/growthEngine';

const STANDING_STYLES = {
    success: { bg: '#10b98122', color: '#10b981', border: '#10b98144' },
    info: { bg: '#3b82f622', color: '#60a5fa', border: '#3b82f644' },
    warning: { bg: '#f59e0b22', color: '#fbbf24', border: '#f59e0b44' },
    danger: { bg: '#ef444422', color: '#f87171', border: '#ef444444' },
    muted: { bg: '#6b728022', color: '#9ca3af', border: '#6b728044' },
};

function getStandingStyle(tone) {
    return STANDING_STYLES[tone] || STANDING_STYLES.info;
}

export function Subreddits() {
    const models = useLiveQuery(() => db.models.toArray());
    const subreddits = useLiveQuery(() => db.subreddits.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());
    const tasks = useLiveQuery(() => db.tasks.toArray());
    const performances = useLiveQuery(() => db.performances.toArray());
    const verificationStoreAvailable = useLiveQuery(
        async () => canUseStore('verifications'),
        []
    );
    const verifications = useLiveQuery(
        async () => {
            if (verificationStoreAvailable === false) return [];
            if (verificationStoreAvailable === undefined) return undefined;
            return db.verifications.toArray();
        },
        [verificationStoreAvailable]
    );

    const [selectedModelId, setSelectedModelId] = useState('');
    const [tableModelFilter, setTableModelFilter] = useState('');
    const [tableAccountFilter, setTableAccountFilter] = useState('');
    const [searchText, setSearchText] = useState('');
    const [historySubredditId, setHistorySubredditId] = useState(null);
    const cleanupSignatureRef = React.useRef('');

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        name: '', url: '', nicheTag: '', riskLevel: 'low', contentComplexity: 'general', accountId: 'all'
    });

    const formAccounts = React.useMemo(
        () => getAssignmentAccountRoster(
            (accounts || []).filter(a => String(a.modelId) === String(selectedModelId))
        ),
        [accounts, selectedModelId]
    );

    async function handleSubmit(e) {
        e.preventDefault();
        if (!formData.name || !selectedModelId) return;

        let rulesSummary = '';
        let flairRequired = 0;

        try {
            const cleanName = formData.name.replace(/^(r\/|\/r\/)/i, '');
            const { SettingsService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();
            const { getProxyHeaders } = await import('../services/growthEngine');
            const res = await fetch(`${proxyUrl}/api/scrape/subreddit/${cleanName}`, { headers: await getProxyHeaders() });
            if (res.ok) {
                const deepData = await res.json();
                rulesSummary = deepData.rules?.map(r => `• ${r.title}: ${r.description}`).join('\n\n') || '';
                flairRequired = deepData.flairRequired ? 1 : 0;
            }
        } catch {
            console.error("Failed to fetch deep metadata for", formData.name);
        }

        await db.subreddits.add({
            id: generateId(),
            ...formData,
            name: formData.name.replace(/^(r\/|\/r\/)/i, ''),
            modelId: Number(selectedModelId),
            accountId: formData.accountId === 'all' ? null : Number(formData.accountId),
            status: 'testing',
            totalTests: 0,
            avg24hViews: 0,
            removalPct: 0,
            lastTestedDate: null,
            rulesSummary,
            flairRequired,
            requiredFlair: ''
        });

        setFormData({ name: '', url: '', nicheTag: '', riskLevel: 'low', contentComplexity: 'general', accountId: 'all' });
    }

    const filteredSubreddits = (subreddits || [])
        .filter(sub => !tableModelFilter || String(sub.modelId) === String(tableModelFilter))
        .filter(sub => {
            if (!tableAccountFilter || tableAccountFilter === 'all') return true;
            return !sub.accountId || String(sub.accountId) === String(tableAccountFilter);
        })
        .filter(sub => {
            if (!searchText.trim()) return true;
            const q = searchText.toLowerCase();
            return (
                String(sub.name || '').toLowerCase().includes(q)
                || String(sub.nicheTag || '').toLowerCase().includes(q)
            );
        })
        .sort((a, b) => {
            const modelA = models?.find(m => m.id === a.modelId)?.name || '';
            const modelB = models?.find(m => m.id === b.modelId)?.name || '';
            if (modelA !== modelB) return modelA.localeCompare(modelB);
            return (b.avg24hViews || 0) - (a.avg24hViews || 0);
        });

    const visibleAccounts = React.useMemo(
        () => getAssignmentAccountRoster(
            (accounts || []).filter(a => !tableModelFilter || String(a.modelId) === String(tableModelFilter))
        ),
        [accounts, tableModelFilter]
    );

    React.useEffect(() => {
        if (accounts === undefined || subreddits === undefined) return;

        const signature = JSON.stringify({
            accounts: (accounts || [])
                .map(account => `${account.id}:${account.modelId}:${account.handle || ''}:${account.status || ''}:${account.phase || ''}:${account.shadowBanStatus || ''}:${account.isSuspended ? 1 : 0}`)
                .sort(),
            subreddits: (subreddits || [])
                .filter(subreddit => subreddit?.accountId)
                .map(subreddit => `${subreddit.id}:${subreddit.modelId}:${subreddit.accountId}`)
                .sort(),
        });

        if (signature === cleanupSignatureRef.current) return;
        cleanupSignatureRef.current = signature;

        let cancelled = false;
        (async () => {
            const result = await SubredditAssignmentService.cleanupInvalidAccountLinks();
            if (!cancelled && result.cleaned > 0) {
                console.info(`[Subreddits] Cleaned ${result.cleaned} stale subreddit account links.`);
            }
        })().catch(err => {
            console.warn('[Subreddits] Failed to clean stale subreddit account links:', err.message);
        });

        return () => {
            cancelled = true;
        };
    }, [accounts, subreddits]);

    React.useEffect(() => {
        if (!models || models.length === 0) return;
        if (!tableModelFilter) {
            setTableModelFilter(String(models[0].id));
        }
    }, [models, tableModelFilter]);

    React.useEffect(() => {
        if (!visibleAccounts || visibleAccounts.length === 0) {
            setTableAccountFilter('all');
            return;
        }
        const exists = visibleAccounts.some(a => String(a.id) === String(tableAccountFilter));
        if (!tableAccountFilter || !exists) {
            setTableAccountFilter(String(visibleAccounts[0].id));
        }
    }, [tableModelFilter, tableAccountFilter, visibleAccounts]);

    React.useEffect(() => {
        const exists = formAccounts.some(a => String(a.id) === String(formData.accountId));
        if (formData.accountId !== 'all' && !exists) {
            setFormData(prev => ({ ...prev, accountId: 'all' }));
        }
    }, [selectedModelId, formAccounts, formData.accountId]);

    const scopedStatsBySubreddit = React.useMemo(() => {
        const map = new Map();
        if (!tasks || !performances) return map;

        const perfByTaskId = new Map((performances || []).map(p => [p.taskId, p]));
        const relevantTasks = (tasks || []).filter(t => {
            if (tableModelFilter && String(t.modelId) !== String(tableModelFilter)) return false;
            if (tableAccountFilter !== 'all' && String(t.accountId) !== String(tableAccountFilter)) return false;
            return true;
        });

        for (const task of relevantTasks) {
            if (!task.subredditId) continue;
            if (!map.has(task.subredditId)) map.set(task.subredditId, { tests: 0, totalViews: 0, removed: 0 });
            const bucket = map.get(task.subredditId);
            const perf = perfByTaskId.get(task.id);
            if (!perf) continue;
            bucket.tests += 1;
            bucket.totalViews += Number(perf.views24h || 0);
            if (perf.removed) bucket.removed += 1;
        }

        for (const [subredditId, stats] of map.entries()) {
            const avg24h = stats.tests > 0 ? Math.round(stats.totalViews / stats.tests) : 0;
            const removalPct = stats.tests > 0 ? Number(((stats.removed / stats.tests) * 100).toFixed(1)) : 0;
            map.set(subredditId, { tests: stats.tests, avg24h, removalPct });
        }

        return map;
    }, [tasks, performances, tableModelFilter, tableAccountFilter]);

    // Build verification lookup: "accountId:subredditId" → true/false
    const verificationMap = React.useMemo(() => {
        const map = new Map();
        for (const v of (verifications || [])) {
            if (v.verified) map.set(`${v.accountId}:${v.subredditId}`, true);
        }
        return map;
    }, [verifications]);

    const subredditIntelRows = React.useMemo(() => {
        return filteredSubreddits.map((sub) => {
            const scoped = scopedStatsBySubreddit.get(sub.id);
            const tests = scoped ? scoped.tests : Number(sub.totalTests || 0);
            const avg24h = scoped ? scoped.avg24h : Number(sub.avg24hViews || 0);
            const removalPct = scoped ? scoped.removalPct : Number(sub.removalPct || 0);
            const standing = AnalyticsEngine.getSubredditStanding(sub, {
                totalTests: tests,
                avgViews: avg24h,
                avg24h,
                removalPct,
            });
            const intelligence = AnalyticsEngine.getRemovalIntelligence(sub, {
                totalTests: tests,
                avgViews: avg24h,
                avg24h,
                removalPct,
            });

            return {
                sub,
                tests,
                avg24h,
                removalPct,
                standing,
                intelligence,
            };
        });
    }, [filteredSubreddits, scopedStatsBySubreddit]);

    const pulseCounts = React.useMemo(() => {
        return subredditIntelRows.reduce((acc, row) => {
            const label = row.standing.label;
            if (label === 'Scale') acc.scale += 1;
            else if (label === 'Promising' || label === 'Stable') acc.working += 1;
            else if (label === 'Watch' || label === 'Blocked') acc.watch += 1;
            else if (label === 'Stop' || label === 'No-post') acc.stop += 1;
            else acc.unproven += 1;
            return acc;
        }, { scale: 0, working: 0, watch: 0, stop: 0, unproven: 0 });
    }, [subredditIntelRows]);

    const topScaleLane = React.useMemo(() => {
        return subredditIntelRows
            .filter((row) => row.standing.label === 'Scale' || row.standing.label === 'Promising')
            .sort((a, b) => {
                if (b.standing.score !== a.standing.score) return b.standing.score - a.standing.score;
                return b.avg24h - a.avg24h;
            })[0] || null;
    }, [subredditIntelRows]);

    async function handleAttachUnassignedToSelectedAccount() {
        if (!tableModelFilter || tableAccountFilter === 'all' || !tableAccountFilter) return;

        const unassigned = (subreddits || []).filter(
            s => String(s.modelId) === String(tableModelFilter) && !s.accountId
        );

        if (unassigned.length === 0) {
            alert('No unassigned subreddits for this model.');
            return;
        }

        const account = (accounts || []).find(a => String(a.id) === String(tableAccountFilter));
        const confirmed = window.confirm(`Attach ${unassigned.length} unassigned subreddits to ${account?.handle || tableAccountFilter}?`);
        if (!confirmed) return;

        try {
            await db.subreddits.bulkPut(unassigned.map(s => ({ ...s, accountId: Number(tableAccountFilter) })));
        } catch (err) {
            alert('Failed to attach subreddits locally: ' + err.message);
            return;
        }

        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['subreddits']);
        } catch (err) {
            console.warn('[Subreddits] Cloud push failed after local attach:', err.message);
        }

        alert(`Attached ${unassigned.length} subreddits to ${account?.handle || tableAccountFilter}.`);
    }

    async function handleDeleteSubreddit(sub) {
        if (!window.confirm(`Delete r/${sub.name}?`)) return;

        try {
            const tasksForSub = await db.tasks.where('subredditId').equals(sub.id).toArray();
            const taskIds = tasksForSub.map(t => t.id);
            const linkedPerformances = taskIds.length > 0
                ? await db.performances.where('taskId').anyOf(taskIds).toArray()
                : [];
            const performanceIds = linkedPerformances.map(p => p.id);

            // Mark pending deletes BEFORE local delete
            const { markPendingDelete } = await import('../services/growthEngine');
            for (const id of performanceIds) await markPendingDelete('performances', id);
            for (const id of taskIds) await markPendingDelete('tasks', id);
            await markPendingDelete('subreddits', sub.id);

            await db.transaction('rw', db.performances, db.tasks, db.subreddits, async () => {
                if (performanceIds.length > 0) await db.performances.bulkDelete(performanceIds);
                if (taskIds.length > 0) await db.tasks.bulkDelete(taskIds);
                await db.subreddits.delete(sub.id);
            });

            try {
                const { CloudSyncService } = await import('../services/growthEngine');
                const CHUNK_SIZE = 200;
                for (let i = 0; i < performanceIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('performances', performanceIds.slice(i, i + CHUNK_SIZE));
                }
                for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
                    await CloudSyncService.deleteMultipleFromCloud('tasks', taskIds.slice(i, i + CHUNK_SIZE));
                }
                await CloudSyncService.deleteFromCloud('subreddits', sub.id);
            } catch (cloudErr) {
                console.warn('[Subreddits] Cloud delete failed:', cloudErr.message);
            }
        } catch (err) {
            console.error('Failed to delete subreddit', err);
            alert('Delete failed: ' + err.message);
        }
    }

    if (models === undefined) {
        return <div className="page-content" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>Loading...</div>;
    }
    if (models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Agency Subreddits</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Focus flow: model to account to subreddits attached to that account.
                    </div>
                </div>
            </header>
            <div className="page-content">
                <div className="grid-cards mb-6" style={{ marginBottom: '32px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Add New Subreddit</h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Subreddit Name</label>
                                    <input className="input-field" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. funny" required />
                                </div>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Assign to Model</label>
                                    <select
                                        className="input-field"
                                        value={selectedModelId}
                                        onChange={e => setSelectedModelId(e.target.value)}
                                        required
                                    >
                                        <option value="" disabled>Select a Model</option>
                                        {models?.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Attach to Account</label>
                                    <select
                                        className="input-field"
                                        value={String(formData.accountId)}
                                        onChange={e => setFormData({ ...formData, accountId: e.target.value })}
                                    >
                                        <option value="all">All model accounts</option>
                                        {formAccounts.map(acc => (
                                            <option key={acc.id} value={String(acc.id)}>{acc.handle}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
                                <div className="input-group">
                                    <label className="input-label">URL (Optional)</label>
                                    <input className="input-field" value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} placeholder="reddit.com/r/..." />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Niche Tag</label>
                                    <input className="input-field" value={formData.nicheTag} onChange={e => setFormData({ ...formData, nicheTag: e.target.value })} placeholder="e.g. gaming" />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Risk Level</label>
                                    <select className="input-field" value={formData.riskLevel} onChange={e => setFormData({ ...formData, riskLevel: e.target.value })}>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Content Complexity</label>
                                    <select className="input-field" value={formData.contentComplexity} onChange={e => setFormData({ ...formData, contentComplexity: e.target.value })}>
                                        <option value="general">General</option>
                                        <option value="niche specific">Niche Specific</option>
                                    </select>
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>Add Subreddit</button>
                        </form>
                    </div>
                </div>

                <div className="dashboard-metric-grid" style={{ marginBottom: '20px' }}>
                    <div className="metric-card metric-card--accent">
                        <div className="metric-label">Scale Lanes</div>
                        <div className="metric-value">{pulseCounts.scale}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Clean enough to push harder</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Working Lanes</div>
                        <div className="metric-value">{pulseCounts.working}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Promising or stable channels</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Watch List</div>
                        <div className="metric-value" style={{ color: 'var(--status-warning)' }}>{pulseCounts.watch}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Mixed performance or cooldown risk</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-label">Stop / No-post</div>
                        <div className="metric-value" style={{ color: 'var(--status-danger)' }}>{pulseCounts.stop}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Keep these out of normal rotation</div>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: '24px' }}>
                    <div className="section-heading">
                        <div>
                            <div className="subtle-kicker">Subreddit Pulse</div>
                            <h2 style={{ fontSize: '1.05rem' }}>What to scale, what to watch, and what to stop</h2>
                        </div>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>
                        {topScaleLane
                            ? `Best lane right now: r/${topScaleLane.sub.name} is ${topScaleLane.standing.label.toLowerCase()} with ${topScaleLane.avg24h.toLocaleString()} avg 24h views across ${topScaleLane.tests} tests.`
                            : 'No clear scale lane yet. Keep testing until you have enough clean data.'}
                    </div>
                </div>

                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Managed Subreddits ({subredditIntelRows.length})</h2>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                                className="input-field"
                                value={tableModelFilter}
                                onChange={e => setTableModelFilter(e.target.value)}
                                style={{ width: 'auto', minWidth: '160px', padding: '6px 10px' }}
                            >
                                {models?.map(m => (
                                    <option key={m.id} value={String(m.id)}>{m.name}</option>
                                ))}
                            </select>
                            <input
                                className="input-field"
                                placeholder="Search subreddit/tag"
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                style={{ minWidth: '220px', padding: '6px 10px' }}
                            />
                            <select
                                className="input-field"
                                value={tableAccountFilter}
                                onChange={e => setTableAccountFilter(e.target.value)}
                                style={{ width: 'auto', minWidth: '180px', padding: '6px 10px' }}
                            >
                                <option value="all">All Accounts (this model)</option>
                                {visibleAccounts.map(acc => (
                                    <option key={acc.id} value={String(acc.id)}>{acc.handle}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={handleAttachUnassignedToSelectedAccount}
                                disabled={!tableModelFilter || tableAccountFilter === 'all' || !tableAccountFilter}
                                style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                            >
                                Attach Unassigned to Account
                            </button>
                        </div>
                    </div>
                    {subredditIntelRows.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No subreddits added.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Account</th>
                                        <th>Standing</th>
                                        <th>Status</th>
                                        <th>Tag</th>
                                        <th>Tests</th>
                                        <th>Avg 24h</th>
                                        <th>Rem %</th>
                                        <th>Next Move</th>
                                        <th>Verified</th>
                                        <th style={{ width: '48px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {subredditIntelRows.map(({ sub, tests, avg24h, removalPct, standing, intelligence }) => {
                                        const attachedAccount = sub.accountId ? (accounts || []).find(a => Number(a.id) === Number(sub.accountId)) : null;
                                        const standingStyle = getStandingStyle(standing.tone);
                                        const gateTitle = [
                                            sub.peakPostHour != null ? `Peak: ${String(sub.peakPostHour).padStart(2, '0')}:00` : null,
                                            sub.minRequiredKarma ? `Karma ${sub.minRequiredKarma}+` : null,
                                            sub.minAccountAgeDays ? `Age ${sub.minAccountAgeDays}d+` : null,
                                            sub.cooldownUntil && new Date(sub.cooldownUntil) > new Date() ? `Cooldown until ${new Date(sub.cooldownUntil).toLocaleDateString()}` : null,
                                        ].filter(Boolean).join(' | ') || 'Open';
                                        return (
                                            <tr key={sub.id} title={gateTitle}>
                                                <td style={{ fontWeight: '500' }}>
                                                    <a href={`https://reddit.com/r/${sub.name.replace(/^(r\/|\/r\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                        r/{sub.name}
                                                    </a>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                        {standing.reasons[0] || 'No intel yet'}
                                                    </div>
                                                    {sub.crossModelWarning && (
                                                        <span style={{ fontSize: '0.6rem', color: 'var(--status-warning)', marginLeft: '6px' }} title={sub.crossModelWarning}>cross</span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {attachedAccount ? attachedAccount.handle : <span style={{ color: 'var(--text-muted)' }}>all</span>}
                                                </td>
                                                <td>
                                                    <div
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            padding: '4px 10px',
                                                            borderRadius: '999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            border: `1px solid ${standingStyle.border}`,
                                                            backgroundColor: standingStyle.bg,
                                                            color: standingStyle.color,
                                                        }}
                                                        title={`${intelligence.cause} ${intelligence.action}`}
                                                    >
                                                        <span>{standing.label}</span>
                                                        <span style={{ opacity: 0.85 }}>{standing.score}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`badge ${sub.status === 'proven' ? 'badge-success' :
                                                        sub.status === 'testing' ? 'badge-info' :
                                                            sub.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                                                        }`}>
                                                        {sub.status.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{sub.nicheTag || '--'}</td>
                                                <td>{tests}</td>
                                                <td>{avg24h?.toLocaleString() || 0}</td>
                                                <td style={{ color: removalPct > 20 ? 'var(--status-danger)' : 'inherit' }}>{Number(removalPct || 0).toFixed(1)}%</td>
                                                <td style={{ minWidth: '220px' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{intelligence.action}</div>
                                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', marginTop: '4px' }}>{intelligence.cause}</div>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {(() => {
                                                        if (verificationStoreAvailable === false) {
                                                            return <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>store unavailable</span>;
                                                        }
                                                        if (!sub.requiresVerified) {
                                                            return <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>;
                                                        }
                                                        const selectedAccId = tableAccountFilter !== 'all' ? Number(tableAccountFilter) : null;
                                                        if (!selectedAccId) {
                                                            const verifiedCount = (verifications || []).filter(v => v.subredditId === sub.id && v.verified).length;
                                                            const totalAccounts = (accounts || []).filter(a => a.modelId === sub.modelId).length;
                                                            return (
                                                                <span style={{ fontSize: '0.75rem', color: verifiedCount > 0 ? '#4caf50' : '#f44336' }}>
                                                                    {verifiedCount}/{totalAccounts}
                                                                </span>
                                                            );
                                                        }
                                                        const isVerified = verificationMap.has(`${selectedAccId}:${sub.id}`);
                                                        return (
                                                            <button
                                                                type="button"
                                                                className="btn btn-outline"
                                                                style={{
                                                                    padding: '2px 8px', fontSize: '0.75rem',
                                                                    color: isVerified ? '#4caf50' : '#f44336',
                                                                    borderColor: isVerified ? '#4caf50' : '#f44336'
                                                                }}
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    if (isVerified) {
                                                                        await VerificationService.markUnverified(selectedAccId, sub.id);
                                                                    } else {
                                                                        await VerificationService.markVerified(selectedAccId, sub.id);
                                                                    }
                                                                }}
                                                            >
                                                                {isVerified ? '✓' : '✗'}
                                                            </button>
                                                        );
                                                    })()}
                                                </td>
                                                <td>
                                                    <SubredditActionMenu sub={sub} onEditRules={async () => {
                                                        const currentRules = sub.rulesSummary || '';
                                                        const newRules = window.prompt(`Custom AI prompt rules for r/${sub.name}:`, currentRules);
                                                        if (newRules !== null && newRules !== currentRules) {
                                                            try { await db.subreddits.update(sub.id, { rulesSummary: newRules }); } catch (err) { alert("Failed: " + err.message); }
                                                        }
                                                    }} onErrors={() => setHistorySubredditId(sub.id)} onUnblock={async () => {
                                                        if (!window.confirm(`Move r/${sub.name} from cooldown back to testing?`)) return;
                                                        await SubredditGuardService.moveCooldownToTesting(sub.id);
                                                    }} onDelete={() => handleDeleteSubreddit(sub)} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {historySubredditId && (
                    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div className="card" style={{ width: 'min(720px, 95vw)', maxHeight: '80vh', overflow: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h2 style={{ fontSize: '1.05rem' }}>Posting Error History - r/{(subreddits || []).find(s => s.id === historySubredditId)?.name}</h2>
                                <button className="btn btn-outline" onClick={() => setHistorySubredditId(null)}>Close</button>
                            </div>
                            {Array.isArray((subreddits || []).find(s => s.id === historySubredditId)?.postErrorHistory) && (subreddits || []).find(s => s.id === historySubredditId)?.postErrorHistory.length > 0 ? (
                                <div className="data-table-container">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Account</th>
                                                <th>Model</th>
                                                <th>Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {((subreddits || []).find(s => s.id === historySubredditId)?.postErrorHistory || []).map((entry, idx) => (
                                                <tr key={`${entry.at}-${idx}`}>
                                                    <td>{entry.at ? new Date(entry.at).toLocaleString() : '-'}</td>
                                                    <td>{entry.accountHandle || '-'}</td>
                                                    <td>{entry.modelName || '-'}</td>
                                                    <td style={{ maxWidth: '360px', whiteSpace: 'pre-wrap' }}>{entry.reason || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-secondary)' }}>No recorded posting errors yet.</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

function SubredditActionMenu({ sub, onEditRules, onErrors, onUnblock, onDelete }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
        if (!open) return;
        function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const isCoolingDown = sub.cooldownUntil && new Date(sub.cooldownUntil) > new Date();

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '4px 8px', fontSize: '1rem', lineHeight: 1 }}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
            >
                &#8942;
            </button>
            {open && (
                <div style={{
                    position: 'absolute', right: 0, top: '100%', marginTop: '4px', zIndex: 20,
                    backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    minWidth: '140px', overflow: 'hidden',
                }}>
                    {[
                        { label: 'Edit Rules', onClick: onEditRules },
                        { label: 'View Errors', onClick: onErrors },
                        ...(isCoolingDown ? [{ label: 'Unblock', onClick: onUnblock, color: 'var(--status-warning)' }] : []),
                        { label: 'Delete', onClick: onDelete, color: 'var(--status-danger)' },
                    ].map((item, i) => (
                        <button
                            key={i}
                            type="button"
                            style={{
                                display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
                                fontSize: '0.8rem', color: item.color || 'var(--text-primary)',
                                backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
                            }}
                            onMouseEnter={e => e.target.style.backgroundColor = 'var(--bg-surface-hover)'}
                            onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                            onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
