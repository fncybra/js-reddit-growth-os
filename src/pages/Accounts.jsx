import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Accounts() {
    const models = useLiveQuery(() => db.models.toArray());
    const accounts = useLiveQuery(() => db.accounts.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: ''
    });

    if (!models || models.length === 0) {
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

        setFormData({ handle: '', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: '' });
    }

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Agency Reddit Accounts</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Manage all operational Reddit accounts across your agency.
                    </div>
                </div>
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
                            <div className="input-group">
                                <label className="input-label">Notes (Optional)</label>
                                <input className="input-field" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="..." />
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
                                        <th>Status</th>
                                        <th>CQS</th>
                                        <th>Daily Cap</th>
                                        <th>Removal Rate</th>
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
                                                <td>
                                                    <span className={`badge ${acc.status === 'active' ? 'badge-success' : acc.status === 'warming' ? 'badge-warning' : 'badge-danger'}`}>
                                                        {acc.status}
                                                    </span>
                                                </td>
                                                <td>{acc.cqsStatus}</td>
                                                <td>{acc.dailyCap}</td>
                                                <td style={{ color: acc.removalRate > 20 ? 'var(--status-danger)' : 'inherit' }}>{acc.removalRate}%</td>
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
