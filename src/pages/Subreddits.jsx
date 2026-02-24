import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

export function Subreddits() {
    const models = useLiveQuery(() => db.models.toArray());
    const subreddits = useLiveQuery(() => db.subreddits.toArray());

    const [selectedModelId, setSelectedModelId] = useState('');

    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const [formData, setFormData] = useState({
        name: '', url: '', nicheTag: '', riskLevel: 'low', contentComplexity: 'general'
    });

    if (!models || models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

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
            status: 'testing',
            totalTests: 0,
            avg24hViews: 0,
            removalPct: 0,
            lastTestedDate: null,
            rulesSummary,
            flairRequired,
            requiredFlair: ''
        });

        setFormData({ name: '', url: '', nicheTag: '', riskLevel: 'low', contentComplexity: 'general' });
    }

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Agency Subreddits</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                        Manage subreddits for all models across the agency.
                    </div>
                </div>
            </header>
            <div className="page-content">
                <div className="grid-cards mb-6" style={{ marginBottom: '32px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Add New Subreddit</h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Managed Subreddits ({subreddits?.length || 0})</h2>
                    {subreddits?.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No subreddits added.</div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Assigned Model</th>
                                        <th>Status</th>
                                        <th>Niche Tag</th>
                                        <th>Risk</th>
                                        <th>Tests</th>
                                        <th>Avg 24h</th>
                                        <th>Removal %</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {subreddits?.map(sub => {
                                        const model = models?.find(m => m.id === sub.modelId);
                                        return (
                                            <tr key={sub.id}>
                                                <td style={{ fontWeight: '500' }}>
                                                    <a href={`https://reddit.com/r/${sub.name.replace(/^(r\/|\/r\/)/i, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                        r/{sub.name}
                                                    </a>
                                                </td>
                                                <td>{model ? model.name : 'Unassigned'}</td>
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
                                                <td>{sub.riskLevel}</td>
                                                <td>{sub.totalTests}</td>
                                                <td>{sub.avg24hViews?.toLocaleString() || 0}</td>
                                                <td style={{ color: sub.removalPct > 20 ? 'var(--status-danger)' : 'inherit' }}>{sub.removalPct?.toFixed(1) || 0}%</td>
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
                                                        style={{ padding: '2px 8px', fontSize: '0.8rem', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (window.confirm(`Delete r/${sub.name}?`)) {
                                                                try {
                                                                    await db.subreddits.delete(sub.id);
                                                                } catch (err) {
                                                                    console.error("Failed to delete", err);
                                                                    alert("Delete failed: " + err.message);
                                                                }
                                                            }
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
            </div>
        </>
    );
}
