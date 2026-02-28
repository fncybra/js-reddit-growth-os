import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { SubredditGuardService, VerificationService } from '../services/growthEngine';

export function Subreddits() {
    const models = useLiveQuery(() => db.models.toArray());
    const subreddits = useLiveQuery(() => db.subreddits.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());
    const tasks = useLiveQuery(() => db.tasks.toArray());
    const performances = useLiveQuery(() => db.performances.toArray());
    const verifications = useLiveQuery(() => db.verifications.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');
    const [tableModelFilter, setTableModelFilter] = useState('');
    const [tableAccountFilter, setTableAccountFilter] = useState('');
    const [searchText, setSearchText] = useState('');
    const [historySubredditId, setHistorySubredditId] = useState(null);

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        name: '', url: '', nicheTag: '', riskLevel: 'low', contentComplexity: 'general', accountId: 'all'
    });

    const formAccounts = (accounts || []).filter(a => String(a.modelId) === String(selectedModelId));

    async function handleSubmit(e) {
        e.preventDefault();
        if (!formData.name || !selectedModelId) return;

        let rulesSummary = '';
        let flairRequired = 0;

        try {
            const cleanName = formData.name.replace(/^(r\/|\/r\/)/i, '');
            const { SettingsService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();
            const res = await fetch(`${proxyUrl}/api/scrape/subreddit/${cleanName}`);
            if (res.ok) {
                const deepData = await res.json();
                rulesSummary = deepData.rules?.map(r => `• ${r.title}: ${r.description}`).join('\n\n') || '';
                flairRequired = deepData.flairRequired ? 1 : 0;
            }
        } catch (err) {
            console.error("Failed to fetch deep metadata for", formData.name);
        }

        await db.subreddits.add({
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

    const visibleAccounts = (accounts || []).filter(a => !tableModelFilter || String(a.modelId) === String(tableModelFilter));

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

                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Managed Subreddits ({filteredSubreddits.length})</h2>
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
                    {filteredSubreddits.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No subreddits added.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Assigned Model</th>
                                        <th>Attached Account</th>
                                        <th>Status</th>
                                        <th>Niche Tag</th>
                                        <th>Risk</th>
                                        <th>Tests</th>
                                        <th>Avg 24h</th>
                                        <th>Removal %</th>
                                        <th>Posting Gate</th>
                                        <th>Verified</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSubreddits.map(sub => {
                                        const scoped = scopedStatsBySubreddit.get(sub.id);
                                        const tests = scoped ? scoped.tests : (sub.totalTests || 0);
                                        const avg24h = scoped ? scoped.avg24h : (sub.avg24hViews || 0);
                                        const removalPct = scoped ? scoped.removalPct : Number(sub.removalPct || 0);
                                        const model = models?.find(m => m.id === sub.modelId);
                                        return (
                                            <tr key={sub.id}>
                                                <td style={{ fontWeight: '500' }}>
                                                    <a href={`https://reddit.com/r/${sub.name.replace(/^(r\/|\/r\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                        r/{sub.name}
                                                    </a>
                                                </td>
                                                <td>
                                                    <select
                                                        className="input-field"
                                                        value={String(sub.modelId)}
                                                        style={{ padding: '4px 8px', fontSize: '0.8rem', width: '140px' }}
                                                        onChange={async (e) => {
                                                            const nextModelId = Number(e.target.value);
                                                            if (nextModelId !== sub.modelId) {
                                                                const modelAccountIds = (accounts || []).filter(a => a.modelId === nextModelId).map(a => Number(a.id));
                                                                const nextAccountId = modelAccountIds.includes(Number(sub.accountId)) ? sub.accountId : null;
                                                                await db.subreddits.update(sub.id, { modelId: nextModelId, accountId: nextAccountId });
                                                            }
                                                        }}
                                                    >
                                                        {models?.map(m => (
                                                            <option key={m.id} value={String(m.id)}>{m.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td>
                                                    <select
                                                        className="input-field"
                                                        value={sub.accountId ? String(sub.accountId) : 'all'}
                                                        style={{ padding: '4px 8px', fontSize: '0.8rem', width: '170px' }}
                                                        onChange={async (e) => {
                                                            const nextAccountId = e.target.value === 'all' ? null : Number(e.target.value);
                                                            await db.subreddits.update(sub.id, { accountId: nextAccountId });
                                                        }}
                                                    >
                                                        <option value="all">All model accounts</option>
                                                        {(accounts || []).filter(a => a.modelId === sub.modelId).map(acc => (
                                                            <option key={acc.id} value={String(acc.id)}>{acc.handle}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td>
                                                    <span className={`badge ${sub.status === 'proven' ? 'badge-success' :
                                                        sub.status === 'testing' ? 'badge-info' :
                                                            sub.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                                                        }`}>
                                                        {sub.status.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        className="input-field"
                                                        style={{ padding: '4px 8px', fontSize: '0.8rem', width: '120px' }}
                                                        defaultValue={sub.nicheTag || ''}
                                                        placeholder="e.g. boots"
                                                        onBlur={async (e) => {
                                                            if (e.target.value !== sub.nicheTag) {
                                                                await db.subreddits.update(sub.id, { nicheTag: e.target.value });
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td>
                                                    {(() => {
                                                        const risk = (() => {
                                                            if (tests < 3) return 'unknown';
                                                            if (removalPct > 30) return 'high';
                                                            if (removalPct >= 10) return 'medium';
                                                            return 'low';
                                                        })();
                                                        const badges = {
                                                            low:     { icon: '🟢', color: '#4caf50' },
                                                            medium:  { icon: '🟡', color: '#ff9800' },
                                                            high:    { icon: '🔴', color: '#f44336' },
                                                            unknown: { icon: '⚪', color: '#9e9e9e' },
                                                        };
                                                        const b = badges[risk];
                                                        return (
                                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: b.color }} title={`Auto-calculated: ${risk}`}>
                                                                {b.icon} {risk}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                                <td>{tests}</td>
                                                <td>{avg24h?.toLocaleString() || 0}</td>
                                                <td style={{ color: removalPct > 20 ? 'var(--status-danger)' : 'inherit' }}>{Number(removalPct || 0).toFixed(1)}%</td>
                                                <td style={{ fontSize: '0.75rem' }}>
                                                    {sub.cooldownUntil && new Date(sub.cooldownUntil) > new Date() ? (
                                                        <span style={{ color: 'var(--status-warning)' }}>Cooldown until {new Date(sub.cooldownUntil).toLocaleDateString()}</span>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-secondary)' }}>
                                                            {sub.minRequiredKarma ? `Karma ${sub.minRequiredKarma}+` : ''}
                                                            {sub.minRequiredKarma && sub.minAccountAgeDays ? ' • ' : ''}
                                                            {sub.minAccountAgeDays ? `Age ${sub.minAccountAgeDays}d+` : ''}
                                                            {!sub.minRequiredKarma && !sub.minAccountAgeDays ? 'Open' : ''}
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {(() => {
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
                                                                {isVerified ? '✓ Yes' : '✗ No'}
                                                            </button>
                                                        );
                                                    })()}
                                                </td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline"
                                                        title="Edit Custom AI Rules for this Subreddit"
                                                        style={{ padding: '2px 8px', fontSize: '0.8rem', marginRight: '6px' }}
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            const currentRules = sub.rulesSummary || '';
                                                            const newRules = window.prompt(`Custom AI prompt rules for r/${sub.name} (e.g. 'Must have word pregnant', 'No emojis'):`, currentRules);
                                                            if (newRules !== null && newRules !== currentRules) {
                                                                try {
                                                                    await db.subreddits.update(sub.id, { rulesSummary: newRules });
                                                                } catch (err) {
                                                                    alert("Failed to save rules: " + err.message);
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        ⚙️ Rules
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline"
                                                        style={{ padding: '2px 8px', fontSize: '0.8rem', marginRight: '6px' }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setHistorySubredditId(sub.id);
                                                        }}
                                                    >
                                                        🧾 Errors
                                                    </button>
                                                    {(sub.cooldownUntil && new Date(sub.cooldownUntil) > new Date()) && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline"
                                                            style={{ padding: '2px 8px', fontSize: '0.8rem', marginRight: '6px', color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }}
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (!window.confirm(`Move r/${sub.name} from cooldown back to testing?`)) return;
                                                                await SubredditGuardService.moveCooldownToTesting(sub.id);
                                                            }}
                                                        >
                                                            ↩ Unblock
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline"
                                                        style={{ padding: '2px 8px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteSubreddit(sub);
                                                        }}
                                                    >
                                                        🗑️
                                                    </button>
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
