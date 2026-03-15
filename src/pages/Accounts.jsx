import React, { useRef, useState } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { useLiveQuery } from 'dexie-react-hooks';
import { AccountAdminService, AccountDeduplicationService, AccountSyncService, AnalyticsEngine, canUseStore, markDirty, normalizeRedditHandle } from '../services/growthEngine';
import { Smartphone, RefreshCw, AlertTriangle, Trash2, ShieldCheck } from 'lucide-react';

const PHASE_BADGES = {
    warming: { label: 'Warming', bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    ready:   { label: 'Ready',   bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    active:  { label: 'Active',  bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    resting: { label: 'Resting', bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' },
    burned:  { label: 'Burned',  bg: '#ffebee', color: '#c62828', border: '#ef9a9a' },
};

function isDeadAccount(account) {
    if (!account) return false;
    return String(account.status || '').toLowerCase() === 'dead'
        || !!account.isSuspended
        || ['suspended', 'shadow_banned'].includes(String(account.shadowBanStatus || '').toLowerCase());
}

function PhaseBadge({ phase }) {
    const key = phase || 'ready';
    const badge = PHASE_BADGES[key] || PHASE_BADGES.ready;
    return (
        <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem',
            fontWeight: 600, backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
            whiteSpace: 'nowrap'
        }}>
            {badge.label}
        </span>
    );
}

function HealthBar({ score }) {
    const color = score >= 80 ? '#4caf50' : score >= 50 ? '#ff9800' : '#f44336';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '80px' }}>
            <div style={{ flex: 1, height: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${score}%`, height: '100%', backgroundColor: color, borderRadius: '3px' }} />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color, minWidth: '24px' }}>{score}</span>
        </div>
    );
}

export function Accounts() {
    const models = useLiveQuery(() => db.models.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());

    // Engagement ratio: count post vs engagement/warmup tasks per account (last 30 days)
    const engagementRatios = useLiveQuery(async () => {
        if (!accounts) return {};
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        const recentTasks = await db.tasks.filter(t => t.status === 'closed' && t.date >= cutoff).toArray();
        const ratios = {};
        for (const acc of accounts) {
            const accTasks = recentTasks.filter(t => t.accountId === acc.id);
            const posts = accTasks.filter(t => t.taskType === 'post' || (!t.taskType && !/^(Engage|Warmup):/i.test(t.title))).length;
            const engagement = accTasks.filter(t => (t.taskType && t.taskType !== 'post') || /^(Engage|Warmup):/i.test(t.title)).length;
            const total = posts + engagement;
            ratios[acc.id] = { posts, engagement, total, ratio: total > 0 ? (engagement / total * 100) : 0 };
        }
        return ratios;
    }, [accounts]);

    const [selectedModelId, setSelectedModelId] = useState('');
    const [phaseFilter, setPhaseFilter] = useState('all');

    const [syncing, setSyncing] = useState(false);
    const [checkingShadow, setCheckingShadow] = useState(false);
    const dedupeSignatureRef = useRef('');

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    React.useEffect(() => {
        if (!accounts || accounts.length === 0) return;

        const duplicateSignature = [...accounts]
            .map(acc => `${acc.id}:${normalizeRedditHandle(acc.handle)}`)
            .sort()
            .join('|');

        if (duplicateSignature === dedupeSignatureRef.current) return;
        dedupeSignatureRef.current = duplicateSignature;

        let cancelled = false;
        (async () => {
            const result = await AccountDeduplicationService.dedupeAccounts();
            if (!cancelled && result.removed > 0) {
                alert(`Merged ${result.removed} duplicate account(s).`);
            }
        })().catch(err => {
            console.warn('[Accounts] Duplicate cleanup failed:', err.message);
        });

        return () => {
            cancelled = true;
        };
    }, [accounts]);

    const [formData, setFormData] = useState({
        handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: '', proxyInfo: '', vaPin: ''
    });

    async function handleRefreshAll() {
        setSyncing(true);
        try {
            const result = await AccountSyncService.syncAllAccounts();
            const msg = result.failed > 0
                ? `Synced ${result.succeeded}/${result.total} accounts. Failed: ${(result.failedHandles || []).join(', ') || result.failed}`
                : `All ${result.succeeded} accounts synced successfully.`;
            alert(msg);
        } catch (e) {
            alert('Sync failed: ' + e.message);
        }
        setSyncing(false);
    }

    async function handleSyncSingleAccount(acc) {
        const handle = acc.handle || `Account #${acc.id}`;
        try {
            const result = await AccountSyncService.syncAccountHealth(acc.id);
            const fresh = await db.accounts.get(acc.id);

            if (!result) {
                alert(`SYNC FAIL for ${handle}\n${fresh?.lastSyncError || 'Unknown scrape error'}`);
                return;
            }

            const data = result.data || {};
            alert(`SYNC OK for ${handle}\nSource: ${result.source} (${result.variant})\nKarma: ${data.totalKarma ?? fresh?.totalKarma ?? 0}, Suspended: ${!!data.isSuspended}\nAvatar: ${fresh?.hasAvatar ? 'yes' : 'no'}, Banner: ${fresh?.hasBanner ? 'yes' : 'no'}\nBio: ${fresh?.hasBio ? 'yes' : 'no'}, Link: ${fresh?.hasProfileLink ? 'yes' : 'no'}\nStatus: ${fresh?.status || acc.status || 'active'}`);
        } catch (err) {
            alert(`SYNC ERROR for ${handle}\n${err.name}: ${err.message}`);
        }
    }

    async function handleCheckAllShadowBans() {
        setCheckingShadow(true);
        try {
            const result = await AccountSyncService.checkAllShadowBans();
            alert(`Shadow ban check complete: ${result.clean} clean, ${result.flagged} flagged, ${result.errors} errors`);
        } catch (e) {
            alert('Shadow ban check failed: ' + e.message);
        }
        setCheckingShadow(false);
    }

    async function handleDeleteAccount(acc) {
        const hasVerificationsStore = await canUseStore('verifications');
        const relatedTasks = await db.tasks.filter(t => t.accountId === acc.id).toArray();
        const relatedPerformances = relatedTasks.length > 0
            ? await db.performances.where('taskId').anyOf(relatedTasks.map(t => t.id)).toArray()
            : [];
        const relatedVerifications = hasVerificationsStore ? await db.verifications.where('accountId').equals(acc.id).toArray() : [];
        const attachedSubreddits = await db.subreddits.filter(sub => sub.accountId === acc.id).toArray();

        const confirmMsg = relatedTasks.length > 0
            ? `Delete ${acc.handle}? This will also delete ${relatedTasks.length} tasks and ${relatedPerformances.length} performance records linked to this account. ${attachedSubreddits.length > 0 ? `It will also unassign ${attachedSubreddits.length} subreddit(s). ` : ''}${relatedVerifications.length > 0 ? `It will remove ${relatedVerifications.length} verification record(s).` : ''}`
            : `Delete ${acc.handle}?${attachedSubreddits.length > 0 ? ` This will also unassign ${attachedSubreddits.length} subreddit(s).` : ''}${relatedVerifications.length > 0 ? ` It will remove ${relatedVerifications.length} verification record(s).` : ''}`;

        if (!window.confirm(confirmMsg)) return;

        try {
            await AccountAdminService.deleteAccountCascade(acc.id);
        } catch (err) {
            console.error('Failed to delete account', err);
            alert('Delete failed: ' + err.message);
        }
    }

    if (models === undefined) {
        return <div className="page-content" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>Loading...</div>;
    }
    if (models.length === 0) {
        return (
            <div className="page-content">
                <div className="card">Please create a Model first to manage Reddit Accounts.</div>
            </div>
        );
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!formData.handle || !selectedModelId) return;

        const normalizedHandle = normalizeRedditHandle(formData.handle);
        if (!normalizedHandle) {
            alert('Enter a valid Reddit handle.');
            return;
        }

        const existingAccount = (accounts || []).find(acc => normalizeRedditHandle(acc.handle) === normalizedHandle);
        if (existingAccount) {
            alert(`${existingAccount.handle || normalizedHandle} already exists in the account system.`);
            return;
        }

        const newId = generateId();
        await db.accounts.add({
            id: newId,
            ...formData,
            handle: `u/${normalizedHandle}`,
            modelId: Number(selectedModelId),
            dailyCap: Number(formData.dailyCap),
            phase: 'warming',
            phaseChangedDate: new Date().toISOString(),
            warmupStartDate: new Date().toISOString()
        });
        await markDirty('accounts', newId);

        // Fire-and-forget initial sync to populate createdUtc, karma, profile fields
        AccountSyncService.syncAccountHealth(newId).catch(() => {});

        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['accounts']);
        } catch (e) {
            console.error('Auto-push after account add failed:', e);
        }

        setFormData({ handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: '', proxyInfo: '', vaPin: '' });
    }

    async function updateAccountPatch(accountId, patch) {
        try {
            await db.accounts.update(accountId, patch);
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['accounts']);
        } catch (e) {
            console.error('Account update failed:', e);
            alert('Failed to update account: ' + e.message);
        }
    }

    const allAccounts = accounts || [];
    const operationalAccounts = allAccounts.filter(acc => !isDeadAccount(acc));
    const deadAccounts = allAccounts.filter(isDeadAccount);

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Agency Reddit Accounts</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Manage health and karma for all operational handles.
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className="btn btn-outline"
                        onClick={handleCheckAllShadowBans}
                        disabled={checkingShadow || syncing}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <ShieldCheck size={16} className={checkingShadow ? 'spin' : ''} />
                        {checkingShadow ? 'Checking...' : 'Check Shadow Bans'}
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={handleRefreshAll}
                        disabled={syncing || checkingShadow}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                        {syncing ? 'Refreshing Health...' : 'Refresh All Health Data'}
                    </button>
                </div>
            </header>
            <div className="page-content">
                <div className="card" style={{ marginBottom: '32px', maxWidth: '820px' }}>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '20px' }}>Add New Account</h2>
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div className="input-group">
                                <label className="input-label">Reddit Handle</label>
                                <input className="input-field" value={formData.handle} onChange={e => setFormData({ ...formData, handle: e.target.value })} placeholder="u/username" required />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Assign to Model</label>
                                <select className="input-field" value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)} required>
                                    <option value="" disabled>Select a Model</option>
                                    {models?.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                            <div className="input-group">
                                <label className="input-label">Daily Post Cap</label>
                                <input type="number" className="input-field" value={formData.dailyCap} onChange={e => setFormData({ ...formData, dailyCap: e.target.value })} />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Initial Status</label>
                                <select className="input-field" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                                    <option value="warming">Warming</option>
                                    <option value="active">Active</option>
                                    <option value="cooldown">Cooldown</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label">CQS Status</label>
                                <select className="input-field" value={formData.cqsStatus} onChange={e => setFormData({ ...formData, cqsStatus: e.target.value })}>
                                    <option value="Highest">Highest</option>
                                    <option value="High">High</option>
                                    <option value="Moderate">Moderate</option>
                                    <option value="Low">Low</option>
                                    <option value="Lowest">Lowest</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ borderTop: '1px solid var(--border-light)', margin: '20px 0 0', paddingTop: '20px' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '16px' }}>Optional</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                <div className="input-group">
                                    <label className="input-label">Proxy Override</label>
                                    <input className="input-field" value={formData.proxyInfo} onChange={e => setFormData({ ...formData, proxyInfo: e.target.value })} placeholder="IP:Port:User:Pass" />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">VA PIN</label>
                                    <input className="input-field" value={formData.vaPin} onChange={e => setFormData({ ...formData, vaPin: e.target.value })} placeholder="e.g. 7788" />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">Notes</label>
                                    <input className="input-field" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Any notes..." />
                                </div>
                            </div>
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ marginTop: '20px' }}>Add Account</button>
                    </form>
                </div>

                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Operational Accounts ({operationalAccounts.length})</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Phase:</label>
                            <select
                                className="input-field"
                                value={phaseFilter}
                                onChange={e => setPhaseFilter(e.target.value)}
                                style={{ width: '130px', padding: '4px 8px', fontSize: '0.85rem' }}
                            >
                                <option value="all">All Phases</option>
                                <option value="warming">Warming</option>
                                <option value="ready">Ready</option>
                                <option value="active">Active</option>
                                <option value="resting">Resting</option>
                                <option value="burned">Burned</option>
                            </select>
                        </div>
                    </div>
                    {operationalAccounts.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No accounts registered for this model.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Handle</th>
                                        <th>Phase</th>
                                        <th>Score</th>
                                        <th>Model</th>
                                        <th>Karma</th>
                                        <th>Cap</th>
                                        <th>CQS</th>
                                        <th>Engage %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {operationalAccounts.filter(a => phaseFilter === 'all' || (a.phase || 'ready') === phaseFilter).map(acc => {
                                        const model = models?.find(m => m.id === acc.modelId);
                                        const combinedScore = Math.round((AnalyticsEngine.computeProfileScore(acc) + AnalyticsEngine.computeAccountHealthScore(acc)) / 2);
                                        return (
                                            <tr key={acc.id}>
                                                <td style={{ fontWeight: '500' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <a href={`https://reddit.com/user/${acc.handle.replace(/^(u\/|\/u\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                            {acc.handle}
                                                        </a>
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline"
                                                            style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                                            onClick={() => handleSyncSingleAccount(acc)}
                                                            title="Sync this account"
                                                        >
                                                            <RefreshCw size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline"
                                                            style={{ padding: '2px 6px', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                                                            onClick={() => handleDeleteAccount(acc)}
                                                            title="Delete account"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                                                        <PhaseBadge phase={acc.phase} />
                                                        {acc.isSuspended && (
                                                            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                                <AlertTriangle size={11} /> SUSPENDED
                                                            </span>
                                                        )}
                                                        {acc.shadowBanStatus && acc.shadowBanStatus !== 'clean' && (
                                                            <span style={{
                                                                display: 'inline-block', padding: '1px 6px', borderRadius: '8px', fontSize: '0.6rem', fontWeight: 600,
                                                                backgroundColor: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a'
                                                            }}>
                                                                SHADOW-BAN
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td><HealthBar score={combinedScore} /></td>
                                                <td>{model ? model.name : 'Unassigned'}</td>
                                                <td style={{ fontWeight: '600' }}>
                                                    {(acc.totalKarma || 0).toLocaleString()}
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        defaultValue={acc.dailyCap || 10}
                                                        style={{ width: '64px', padding: '4px 8px', fontSize: '0.8rem' }}
                                                        onBlur={(e) => {
                                                            const next = Number(e.target.value || 0);
                                                            if (!Number.isFinite(next) || next <= 0 || next === Number(acc.dailyCap || 10)) return;
                                                            updateAccountPatch(acc.id, { dailyCap: next });
                                                        }}
                                                    />
                                                </td>
                                                <td>
                                                    <select
                                                        className="input-field"
                                                        value={acc.cqsStatus || 'High'}
                                                        style={{ width: '100px', padding: '4px 8px', fontSize: '0.8rem' }}
                                                        onChange={(e) => updateAccountPatch(acc.id, { cqsStatus: e.target.value })}
                                                    >
                                                        <option value="Highest">Highest</option>
                                                        <option value="High">High</option>
                                                        <option value="Moderate">Moderate</option>
                                                        <option value="Low">Low</option>
                                                        <option value="Lowest">Lowest</option>
                                                    </select>
                                                </td>
                                                <td>
                                                    {(() => {
                                                        const r = engagementRatios?.[acc.id];
                                                        if (!r || r.total === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>--</span>;
                                                        const pct = r.ratio;
                                                        const color = pct >= 50 ? 'var(--status-success)' : pct >= 30 ? 'var(--status-warning)' : 'var(--status-danger)';
                                                        return (
                                                            <div style={{ fontSize: '0.8rem' }} title={`${r.engagement} engagement / ${r.posts} posts (last 30d)`}>
                                                                <span style={{ color, fontWeight: 600 }}>{Math.round(pct)}%</span>
                                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{r.engagement}e / {r.posts}p</div>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="card" style={{ marginTop: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Dead Accounts ({deadAccounts.length})</h2>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            Suspended and shadow-banned accounts are parked here automatically.
                        </div>
                    </div>
                    {deadAccounts.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No dead accounts right now.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Handle</th>
                                        <th>Reason</th>
                                        <th>Model</th>
                                        <th>Karma</th>
                                        <th>Last Sync</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {deadAccounts.map(acc => {
                                        const model = models?.find(m => m.id === acc.modelId);
                                        const reason = acc.deadReason || acc.shadowBanStatus || (acc.isSuspended ? 'suspended' : 'dead');
                                        return (
                                            <tr key={`dead-${acc.id}`}>
                                                <td style={{ fontWeight: 500 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <a href={`https://reddit.com/user/${acc.handle.replace(/^(u\/|\/u\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                            {acc.handle}
                                                        </a>
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline"
                                                            style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                                            onClick={() => handleSyncSingleAccount(acc)}
                                                            title="Re-check this account"
                                                        >
                                                            <RefreshCw size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span style={{
                                                        display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem',
                                                        fontWeight: 600, backgroundColor: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a'
                                                    }}>
                                                        {String(reason).replace(/_/g, ' ')}
                                                    </span>
                                                </td>
                                                <td>{model ? model.name : 'Unassigned'}</td>
                                                <td>{(acc.totalKarma || 0).toLocaleString()}</td>
                                                <td>{acc.lastSyncDate ? new Date(acc.lastSyncDate).toLocaleString() : 'Never'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
