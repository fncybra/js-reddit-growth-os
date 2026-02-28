import React, { useState } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Loader2, Download, RefreshCw, Trash2, Plus, Eye } from 'lucide-react';
import { CompetitorService } from '../services/growthEngine';

export function Discovery() {
    const models = useLiveQuery(() => db.models.toArray());
    const [selectedModelId, setSelectedModelId] = useState(null);
    const [selectedAccountId, setSelectedAccountId] = useState('');

    // Auto-select first model available if none selected
    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const targetModel = models?.find(m => m.id === selectedModelId);
    const modelAccounts = useLiveQuery(
        () => targetModel ? db.accounts.where({ modelId: targetModel.id }).toArray() : [],
        [targetModel?.id]
    );

    React.useEffect(() => {
        if (!modelAccounts || modelAccounts.length === 0) {
            setSelectedAccountId('');
            return;
        }

        const exists = modelAccounts.some(a => String(a.id) === String(selectedAccountId));
        if (!selectedAccountId || !exists) {
            setSelectedAccountId(String(modelAccounts[0].id));
        }
    }, [modelAccounts, selectedAccountId]);

    const existingSubreddits = useLiveQuery(
        () => targetModel ? db.subreddits.where({ modelId: targetModel.id }).toArray() : [],
        [targetModel?.id]
    );

    const competitors = useLiveQuery(
        () => targetModel ? db.competitors.where('modelId').equals(targetModel.id).toArray() : [],
        [targetModel?.id]
    );
    const [scrapingAll, setScrapingAll] = useState(false);
    const [addingCompetitor, setAddingCompetitor] = useState('');
    const [expandedCompetitor, setExpandedCompetitor] = useState(null);

    const [discoveryMode, setDiscoveryMode] = useState('competitor'); // 'competitor' or 'niche'
    const [username, setUsername] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [selectedSubs, setSelectedSubs] = useState(new Set());
    const [importNiche, setImportNiche] = useState('general'); // The niche to apply to all selected subs on import

    if (models === undefined) {
        return <div className="page-content" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>Loading...</div>;
    }
    if (models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    const existingSubNames = new Set(existingSubreddits?.map(s => s.name.toLowerCase()) || []);

    async function handleSearch(e) {
        e.preventDefault();

        setLoading(true);
        setError(null);
        setResults([]);
        setSelectedSubs(new Set());

        try {
            const { SettingsService } = await import('../services/growthEngine');
            const proxyUrl = await SettingsService.getProxyUrl();

            if (discoveryMode === 'competitor') {
                if (!username.trim()) return;
                const cleanUsername = username.replace(/^(u\/|\/u\/|https:\/\/www.reddit.com\/u(ser)?\/)/i, '').split('/')[0].trim();
                const response = await fetch(`${proxyUrl}/api/scrape/user/${cleanUsername}`);

                if (!response.ok) throw new Error("Competitor not found or proxy error.");
                const data = await response.json();
                const posts = data.data.children;

                const subMap = new Map();
                for (const post of posts) {
                    const subName = post.data.subreddit;
                    if (!subMap.has(subName)) {
                        subMap.set(subName, {
                            name: subName,
                            subscribers: post.data.subreddit_subscribers,
                            postsSeen: 1,
                            nsfw: post.data.over_18,
                            avgUpvotes: post.data.ups,
                        });
                    } else {
                        const existing = subMap.get(subName);
                        existing.postsSeen += 1;
                        existing.avgUpvotes = Math.round(((existing.avgUpvotes * (existing.postsSeen - 1)) + post.data.ups) / existing.postsSeen);
                    }
                }
                setResults(Array.from(subMap.values()).sort((a, b) => b.postsSeen - a.postsSeen));
            } else {
                if (!query.trim()) return;
                const response = await fetch(`${proxyUrl}/api/scrape/search/subreddits?q=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error("Failed to search subreddits.");
                const data = await response.json();

                setResults(data.map(s => ({
                    name: s.name,
                    subscribers: s.subscribers,
                    postsSeen: 'N/A',
                    nsfw: s.over18,
                    avgUpvotes: 'N/A'
                })));
            }

        } catch (err) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    }

    function toggleSelection(subName) {
        const newSet = new Set(selectedSubs);
        if (newSet.has(subName)) {
            newSet.delete(subName);
        } else {
            newSet.add(subName);
        }
        setSelectedSubs(newSet);
    }

    function toggleAll() {
        if (selectedSubs.size === filterValidResults(results).length) {
            setSelectedSubs(new Set());
        } else {
            setSelectedSubs(new Set(filterValidResults(results).map(r => r.name)));
        }
    }

    function filterValidResults(res) {
        // Only return ones not already in existingSubNames
        return res.filter(r => !existingSubNames.has(r.name.toLowerCase()));
    }

    async function handleImport() {
        if (selectedSubs.size === 0) return;
        if (!selectedAccountId) {
            alert('Select an account first so imported subreddits are attached correctly.');
            return;
        }

        setLoading(true);
        const subNames = Array.from(selectedSubs);
        const subsToAdd = [];

        try {
            for (const subName of subNames) {
                const subData = results.find(r => r.name === subName);

                // Fetch deep metadata (Rules & Flairs) from proxy
                let deepData = {};
                try {
                    const { SettingsService } = await import('../services/growthEngine');
                    const proxyUrl = await SettingsService.getProxyUrl();
                    const res = await fetch(`${proxyUrl}/api/scrape/subreddit/${subName}`);
                    if (res.ok) {
                        deepData = await res.json();
                    }
                } catch (e) {
                    console.error("Failed to fetch deep metadata for", subName);
                }

                subsToAdd.push({
                    modelId: targetModel.id,
                    accountId: Number(selectedAccountId),
                    name: subName,
                    url: `reddit.com/r/${subName}`,
                    nicheTag: importNiche.toLowerCase(),
                    riskLevel: subData.nsfw ? 'high' : 'medium',
                    contentComplexity: 'general',
                    status: 'testing',
                    rulesSummary: deepData.rules?.map(r => `• ${r.title}: ${r.description}`).join('\n\n') || '',
                    flairRequired: deepData.flairRequired ? 1 : 0,
                    requiredFlair: '', // VA can fill/manager can adjust
                    totalTests: 0,
                    avg24hViews: 0,
                    removalPct: 0,
                    lastTestedDate: null
                });

                // Avoid slamming proxy
                await new Promise(r => setTimeout(r, 200));
            }

            await db.subreddits.bulkAdd(subsToAdd);
            setSelectedSubs(new Set());
            alert(`Successfully added ${subsToAdd.length} subreddits with rules & compliance data.`);
        } catch (e) {
            alert("Error adding subreddits: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleAssignExistingToSelectedAccount() {
        if (!targetModel || !selectedAccountId) return;
        const scoped = (existingSubreddits || []).filter(s => !s.accountId);
        if (scoped.length === 0) {
            alert('No unassigned subreddits found for this model.');
            return;
        }

        const account = (modelAccounts || []).find(a => String(a.id) === String(selectedAccountId));
        const confirmed = window.confirm(`Assign ${scoped.length} existing unassigned subreddits in ${targetModel.name} to ${account?.handle || selectedAccountId}?`);
        if (!confirmed) return;

        try {
            await db.subreddits.bulkPut(scoped.map(s => ({ ...s, accountId: Number(selectedAccountId) })));
        } catch (err) {
            alert('Failed to assign existing subreddits locally: ' + err.message);
            return;
        }

        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.autoPush(['subreddits']);
        } catch (err) {
            console.warn('[Discovery] Cloud push failed after local assignment:', err.message);
        }

        alert(`Assigned ${scoped.length} subreddits to ${account?.handle || selectedAccountId}.`);
    }

    const validResults = filterValidResults(results);

    return (
        <>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Discovery & Scraping</h1>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Importing to Model:
                        <select
                            className="input-field"
                            style={{ padding: '4px 8px', fontSize: '0.9rem', width: 'auto', display: 'inline-block' }}
                            value={selectedModelId || ''}
                            onChange={e => setSelectedModelId(Number(e.target.value))}
                        >
                            {models?.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        Account:
                        <select
                            className="input-field"
                            style={{ padding: '4px 8px', fontSize: '0.9rem', width: 'auto', display: 'inline-block', minWidth: '170px' }}
                            value={selectedAccountId}
                            onChange={e => setSelectedAccountId(e.target.value)}
                        >
                            {(modelAccounts || []).map(a => (
                                <option key={a.id} value={String(a.id)}>{a.handle}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={handleAssignExistingToSelectedAccount}
                            disabled={!selectedAccountId}
                            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                        >
                            Assign Existing To Account
                        </button>
                    </div>
                </div>
                {selectedSubs.size > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Assign Niche Tag:</div>
                            <input
                                className="input-field"
                                style={{ padding: '4px 8px', fontSize: '0.85rem', width: '140px' }}
                                placeholder="e.g. fitness, petite"
                                value={importNiche}
                                onChange={e => setImportNiche(e.target.value)}
                            />
                        </div>
                        <button className="btn btn-primary" onClick={handleImport} disabled={loading} style={{ height: '42px' }}>
                            <Download size={18} />
                            {loading ? 'Processing...' : `Import ${selectedSubs.size} to Testing`}
                        </button>
                    </div>
                )}
            </header>

            <div className="page-content">
                <div className="card mb-6" style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid #2d313a' }}>
                        <button
                            onClick={() => setDiscoveryMode('competitor')}
                            style={{ padding: '12px 4px', background: 'none', border: 'none', color: discoveryMode === 'competitor' ? '#6366f1' : '#9ca3af', borderBottom: discoveryMode === 'competitor' ? '2px solid #6366f1' : 'none', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            Scrape Competitor
                        </button>
                        <button
                            onClick={() => setDiscoveryMode('niche')}
                            style={{ padding: '12px 4px', background: 'none', border: 'none', color: discoveryMode === 'niche' ? '#6366f1' : '#9ca3af', borderBottom: discoveryMode === 'niche' ? '2px solid #6366f1' : 'none', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            Search by Niche
                        </button>
                    </div>

                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                        {discoveryMode === 'competitor'
                            ? "Enter a competitor's Reddit username to see where they post."
                            : "Enter a niche keyword (e.g. 'fitness') to find relevant subreddits."}
                    </p>

                    <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                            {discoveryMode === 'competitor' ? (
                                <input
                                    className="input-field"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    placeholder="e.g. u/topmodel"
                                    required
                                />
                            ) : (
                                <input
                                    className="input-field"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="e.g. fitness, gaming, yoga"
                                    required
                                />
                            )}
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={loading} style={{ height: '42px' }}>
                            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                            {loading ? 'Discovering...' : 'Start Discovery'}
                        </button>
                    </form>

                    {error && <div style={{ color: 'var(--status-danger)', marginTop: '12px', fontSize: '0.9rem' }}>⚠️ {error}</div>}
                </div>

                {/* Saved Competitors */}
                <div className="card" style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Tracked Competitors ({(competitors || []).length})</h2>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                className="input-field"
                                placeholder="u/handle"
                                value={addingCompetitor}
                                onChange={e => setAddingCompetitor(e.target.value)}
                                onKeyDown={async e => {
                                    if (e.key === 'Enter' && addingCompetitor.trim() && targetModel) {
                                        await CompetitorService.addCompetitor(targetModel.id, addingCompetitor);
                                        setAddingCompetitor('');
                                    }
                                }}
                                style={{ width: '160px', padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                            <button
                                className="btn btn-primary"
                                disabled={!addingCompetitor.trim() || !targetModel}
                                onClick={async () => {
                                    if (!addingCompetitor.trim() || !targetModel) return;
                                    await CompetitorService.addCompetitor(targetModel.id, addingCompetitor);
                                    setAddingCompetitor('');
                                }}
                                style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <Plus size={14} /> Add
                            </button>
                            <button
                                className="btn btn-outline"
                                disabled={scrapingAll || !(competitors?.length > 0)}
                                onClick={async () => {
                                    setScrapingAll(true);
                                    try {
                                        const result = await CompetitorService.scrapeAllCompetitors(targetModel?.id);
                                        alert(`Scraped ${result.succeeded}/${result.total} competitors.${result.failed > 0 ? ` ${result.failed} failed.` : ''}`);
                                    } catch (e) { alert('Scrape failed: ' + e.message); }
                                    setScrapingAll(false);
                                }}
                                style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <RefreshCw size={14} className={scrapingAll ? 'animate-spin' : ''} />
                                {scrapingAll ? 'Scraping...' : 'Scrape All'}
                            </button>
                        </div>
                    </div>
                    {(!competitors || competitors.length === 0) ? (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>
                            No competitors tracked yet. Add a Reddit handle above to start monitoring.
                        </div>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Handle</th>
                                        <th>Karma</th>
                                        <th>Change</th>
                                        <th>Top Subreddits</th>
                                        <th>Last Scraped</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(competitors || []).map(comp => {
                                        const karmaDiff = (comp.totalKarma || 0) - (comp.prevKarma || 0);
                                        const topSubs = comp.topSubreddits || [];
                                        const isExpanded = expandedCompetitor === comp.id;
                                        return (
                                            <React.Fragment key={comp.id}>
                                                <tr>
                                                    <td style={{ fontWeight: 500 }}>
                                                        <a href={`https://reddit.com/user/${comp.handle}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                            u/{comp.handle}
                                                        </a>
                                                    </td>
                                                    <td style={{ fontWeight: 600 }}>{(comp.totalKarma || 0).toLocaleString()}</td>
                                                    <td style={{ color: karmaDiff > 0 ? '#4caf50' : karmaDiff < 0 ? '#f44336' : 'var(--text-secondary)', fontWeight: 600 }}>
                                                        {comp.lastScrapedDate ? (karmaDiff > 0 ? `+${karmaDiff.toLocaleString()}` : karmaDiff === 0 ? '—' : karmaDiff.toLocaleString()) : '—'}
                                                    </td>
                                                    <td style={{ fontSize: '0.8rem' }}>
                                                        {topSubs.slice(0, 3).map(s => (
                                                            <span key={s.name} className="badge badge-info" style={{ marginRight: '4px', fontSize: '0.7rem' }}>
                                                                r/{s.name} ({s.posts})
                                                            </span>
                                                        ))}
                                                        {topSubs.length > 3 && <span style={{ color: 'var(--text-secondary)' }}>+{topSubs.length - 3} more</span>}
                                                    </td>
                                                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {comp.lastScrapedDate ? new Date(comp.lastScrapedDate).toLocaleDateString() : 'Never'}
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: '4px' }}>
                                                            <button className="btn btn-outline" style={{ padding: '2px 6px' }} title="Expand subreddits"
                                                                onClick={() => setExpandedCompetitor(isExpanded ? null : comp.id)}>
                                                                <Eye size={12} />
                                                            </button>
                                                            <button className="btn btn-outline" style={{ padding: '2px 6px' }} title="Scrape now"
                                                                onClick={async () => {
                                                                    try {
                                                                        await CompetitorService.scrapeCompetitor(comp.id);
                                                                    } catch (e) { alert('Failed: ' + e.message); }
                                                                }}>
                                                                <RefreshCw size={12} />
                                                            </button>
                                                            <button className="btn btn-outline" style={{ padding: '2px 6px', color: '#f44336', borderColor: '#f44336' }} title="Delete"
                                                                onClick={async () => {
                                                                    if (window.confirm(`Remove u/${comp.handle} from tracking?`)) {
                                                                        await CompetitorService.deleteCompetitor(comp.id);
                                                                    }
                                                                }}>
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && topSubs.length > 0 && (
                                                    <tr>
                                                        <td colSpan="6" style={{ padding: '8px 16px', backgroundColor: 'rgba(99,102,241,0.05)' }}>
                                                            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>u/{comp.handle}'s Active Subreddits</div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                {topSubs.map(s => (
                                                                    <span key={s.name} style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                        padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem',
                                                                        backgroundColor: existingSubNames.has(s.name.toLowerCase()) ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.05)',
                                                                        border: `1px solid ${existingSubNames.has(s.name.toLowerCase()) ? '#4caf50' : 'var(--border-color)'}`
                                                                    }}>
                                                                        <a href={`https://reddit.com/r/${s.name}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>r/{s.name}</a>
                                                                        <span style={{ color: 'var(--text-secondary)' }}>{s.posts} posts</span>
                                                                        <span style={{ color: 'var(--text-secondary)' }}>~{s.avgUps} ups</span>
                                                                        {existingSubNames.has(s.name.toLowerCase()) && <span style={{ color: '#4caf50', fontWeight: 600 }}>✓ tracked</span>}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {results.length > 0 && (
                    <div className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '1.1rem' }}>Discovered Subreddits ({results.length})</h2>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                {results.length - validResults.length} already in your database (hidden)
                            </span>
                        </div>

                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '40px' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedSubs.size === validResults.length && validResults.length > 0}
                                                onChange={toggleAll}
                                                disabled={validResults.length === 0}
                                            />
                                        </th>
                                        <th>Subreddit</th>
                                        <th>Posts Found</th>
                                        <th>Avg Upvotes</th>
                                        <th>NSFW</th>
                                        <th>Subscribers</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {validResults.map(sub => (
                                        <tr key={sub.name} onClick={() => toggleSelection(sub.name)} style={{ cursor: 'pointer' }}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSubs.has(sub.name)}
                                                    onChange={() => { }} // handled by tr click
                                                />
                                            </td>
                                            <td style={{ fontWeight: '500' }}>
                                                <a
                                                    href={`https://reddit.com/r/${sub.name}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    style={{ color: 'var(--primary-color)', textDecoration: 'none' }}
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    r/{sub.name}
                                                </a>
                                            </td>
                                            <td>{sub.postsSeen} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>recent</span></td>
                                            <td>{sub.avgUpvotes}</td>
                                            <td>{sub.nsfw ? <span style={{ color: 'var(--status-danger)' }}>Yes</span> : <span style={{ color: 'var(--text-secondary)' }}>No</span>}</td>
                                            <td>{sub.subscribers ? sub.subscribers.toLocaleString() : 'N/A'}</td>
                                        </tr>
                                    ))}
                                    {validResults.length === 0 && (
                                        <tr>
                                            <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '32px' }}>
                                                All subreddits found for this user are already in your OS.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
        </>
    );
}
