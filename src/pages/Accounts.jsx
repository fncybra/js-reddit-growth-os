import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { AccountSyncService } from '../services/growthEngine';
import { Smartphone, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';

export function Accounts() {
    const models = useLiveQuery(() => db.models.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');

    const [syncing, setSyncing] = useState(false);

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: '', proxyInfo: ''
    });

    async function handleRefreshAll() {
        setSyncing(true);
        await AccountSyncService.syncAllAccounts();
        setSyncing(false);
    }

    async function handleDeleteAccount(acc) {
        const relatedTasks = await db.tasks.filter(t => t.accountId === acc.id).toArray();
        const relatedTaskIds = relatedTasks.map(t => t.id);
        const relatedPerformances = relatedTaskIds.length > 0
            ? await db.performances.where('taskId').anyOf(relatedTaskIds).toArray()
            : [];

        const confirmMsg = relatedTasks.length > 0
            ? `Delete ${acc.handle}? This will also delete ${relatedTasks.length} tasks and ${relatedPerformances.length} performance records linked to this account.`
            : `Delete ${acc.handle}?`;

        if (!window.confirm(confirmMsg)) return;

        if (relatedPerformances.length > 0) {
            await db.performances.bulkDelete(relatedPerformances.map(p => p.id));
        }
        if (relatedTaskIds.length > 0) {
            await db.tasks.bulkDelete(relatedTaskIds);
        }
        await db.accounts.delete(acc.id);

        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.deleteFromCloud('accounts', acc.id);
            if (relatedTaskIds.length > 0) await CloudSyncService.deleteMultipleFromCloud('tasks', relatedTaskIds);
            if (relatedPerformances.length > 0) await CloudSyncService.deleteMultipleFromCloud('performances', relatedPerformances.map(p => p.id));
        } catch (e) {
            console.error('Cloud delete failed:', e);
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

        await db.accounts.add({
            ...formData,
            modelId: Number(selectedModelId),
            dailyCap: Number(formData.dailyCap)
        });

        setFormData({ handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: '', proxyInfo: '' });
    }

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Agency Reddit Accounts</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Manage health and karma for all operational handles.
                    </div>
                </div>
                <button
                    className="btn btn-outline"
                    onClick={handleRefreshAll}
                    disabled={syncing}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                    {syncing ? 'Refreshing Health...' : 'Refresh All Health Data'}
                </button>
            </header>
            <div className="page-content">
                <div className="grid-cards mb-6" style={{ marginBottom: '32px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Add New Account</h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Reddit Handle / Username</label>
                                    <input className="input-field" value={formData.handle} onChange={e => setFormData({ ...formData, handle: e.target.value })} placeholder="u/username" required />
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
                                    <label className="input-label">CQS Status (Manual)</label>
                                    <select className="input-field" value={formData.cqsStatus} onChange={e => setFormData({ ...formData, cqsStatus: e.target.value })}>
                                        <option value="Highest">Highest</option>
                                        <option value="High">High</option>
                                        <option value="Moderate">Moderate</option>
                                        <option value="Low">Low</option>
                                        <option value="Lowest">Lowest</option>
                                    </select>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Proxy Info (Override)</label>
                                    <input className="input-field" value={formData.proxyInfo} onChange={e => setFormData({ ...formData, proxyInfo: e.target.value })} placeholder="IP:Port:User:Pass" />
                                </div>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label">Notes (Optional)</label>
                                    <input className="input-field" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="..." />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>Add Account</button>
                        </form>
                    </div>
                </div>

                <div className="card">
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Active Accounts ({accounts?.length || 0})</h2>
                    {accounts?.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No accounts registered for this model.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Handle</th>
                                        <th>Assigned Model</th>
                                        <th>Karma</th>
                                        <th>Account Health</th>
                                        <th>Status</th>
                                        <th>CQS</th>
                                        <th>Proxy</th>
                                        <th>Last Sync</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accounts?.map(acc => {
                                        const model = models?.find(m => m.id === acc.modelId);
                                        return (
                                            <tr key={acc.id}>
                                                <td style={{ fontWeight: '500' }}>
                                                    <a href={`https://reddit.com/user/${acc.handle.replace(/^(u\/|\/u\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                        {acc.handle}
                                                    </a>
                                                </td>
                                                <td>{model ? model.name : 'Unassigned'}</td>
                                                <td style={{ fontWeight: '600' }}>
                                                    {(acc.totalKarma || 0).toLocaleString()}
                                                </td>
                                                <td>
                                                    {acc.isSuspended ? (
                                                        <span style={{ color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                            <AlertTriangle size={14} /> SUSPENDED
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: 'var(--status-success)', fontSize: '0.8rem', fontWeight: 'bold' }}>✅ HEALTHY</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className={`badge ${acc.status === 'active' ? 'badge-success' : acc.status === 'warming' ? 'badge-warning' : 'badge-danger'}`}>
                                                        {acc.status}
                                                    </span>
                                                </td>
                                                <td>{acc.cqsStatus}</td>
                                                <td style={{ fontSize: '0.8rem', color: acc.proxyInfo ? 'var(--status-warning)' : 'inherit' }}>
                                                    {acc.proxyInfo || 'Model Default'}
                                                </td>
                                                <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                    {acc.lastSyncDate ? new Date(acc.lastSyncDate).toLocaleDateString() : 'Never'}
                                                </td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline"
                                                        style={{ padding: '4px 8px', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                                                        onClick={() => handleDeleteAccount(acc)}
                                                        title="Delete account"
                                                    >
                                                        <Trash2 size={14} />
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
            </div>
        </>
    );
}
