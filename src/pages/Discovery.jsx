import React, { useState } from 'react';
import { db } from '../db/db';
import { generateId } from '../db/generateId';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Loader2, Download, RefreshCw, Trash2, Plus, Eye, Sparkles } from 'lucide-react';
import { canUseStore, CompetitorService, fetchProxyResponse, getAssignmentAccountRoster, ModelDiscoveryProfileService, SubredditAssignmentService } from '../services/growthEngine';

function readDiscoverySampleFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: String(reader.result || ''),
        });
        reader.onerror = () => reject(reader.error || new Error(`Failed reading ${file.name}`));
        reader.readAsDataURL(file);
    });
}

export function Discovery() {
    const models = useLiveQuery(() => db.models.toArray());
    const [selectedModelId, setSelectedModelId] = useState(null);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [importNiche, setImportNiche] = useState('general'); // The niche to apply to all selected subs on import
    const [uploadedVisionSamples, setUploadedVisionSamples] = useState([]);
    const [loadingVisionSamples, setLoadingVisionSamples] = useState(false);
    const cleanupSignatureRef = React.useRef('');

    // Auto-select first model available if none selected
    React.useEffect(() => {
        if (models && models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
        }
    }, [models, selectedModelId]);

    const targetModel = models?.find(m => m.id === selectedModelId);
    const rawModelAccounts = useLiveQuery(
        async () => {
            if (!targetModel) return [];
            return db.accounts.where({ modelId: targetModel.id }).toArray();
        },
        [targetModel?.id]
    );
    const modelAccounts = React.useMemo(
        () => getAssignmentAccountRoster(rawModelAccounts || []),
        [rawModelAccounts]
    );
    const modelDiscoveryProfile = useLiveQuery(
        async () => {
            if (!targetModel?.id) return null;
            return ModelDiscoveryProfileService.getProfile(targetModel.id);
        },
        [targetModel?.id]
    );
    const modelImageCount = useLiveQuery(
        async () => {
            if (!targetModel?.id) return 0;
            const assets = await db.assets.where('modelId').equals(targetModel.id).toArray();
            return assets.filter((asset) => String(asset.assetType || '').toLowerCase() === 'image').length;
        },
        [targetModel?.id]
    );
    const competitorStoreAvailable = useLiveQuery(
        async () => canUseStore('competitors'),
        []
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

    React.useEffect(() => {
        if (!modelDiscoveryProfile?.primaryNiche) return;
        if (!importNiche || importNiche === 'general') {
            setImportNiche(modelDiscoveryProfile.primaryNiche);
        }
    }, [modelDiscoveryProfile, importNiche]);

    React.useEffect(() => {
        setUploadedVisionSamples([]);
    }, [targetModel?.id]);

    const existingSubreddits = useLiveQuery(
        () => targetModel ? db.subreddits.where({ modelId: targetModel.id }).toArray() : [],
        [targetModel?.id]
    );

    React.useEffect(() => {
        if (!targetModel?.id || rawModelAccounts === undefined || existingSubreddits === undefined) return;

        const signature = JSON.stringify({
            modelId: Number(targetModel.id),
            accounts: (rawModelAccounts || [])
                .map(account => `${account.id}:${account.handle || ''}:${account.status || ''}:${account.phase || ''}:${account.shadowBanStatus || ''}:${account.isSuspended ? 1 : 0}`)
                .sort(),
            subreddits: (existingSubreddits || [])
                .filter(subreddit => subreddit?.accountId)
                .map(subreddit => `${subreddit.id}:${subreddit.accountId}`)
                .sort(),
        });

        if (signature === cleanupSignatureRef.current) return;
        cleanupSignatureRef.current = signature;

        let cancelled = false;
        (async () => {
            const result = await SubredditAssignmentService.cleanupInvalidAccountLinks(targetModel.id);
            if (!cancelled && result.cleaned > 0) {
                console.info(`[Discovery] Cleaned ${result.cleaned} stale subreddit account links for model ${targetModel.id}.`);
            }
        })().catch(err => {
            console.warn('[Discovery] Failed to clean stale subreddit account links:', err.message);
        });

        return () => {
            cancelled = true;
        };
    }, [targetModel?.id, rawModelAccounts, existingSubreddits]);

    const competitors = useLiveQuery(
        async () => {
            if (!targetModel || competitorStoreAvailable === false) return [];
            if (competitorStoreAvailable === undefined) return undefined;
            return db.competitors.where('modelId').equals(targetModel.id).toArray();
        },
        [targetModel?.id, competitorStoreAvailable]
    );
    const [scrapingAll, setScrapingAll] = useState(false);
    const [addingCompetitor, setAddingCompetitor] = useState('');
    const [expandedCompetitor, setExpandedCompetitor] = useState(null);

    const [discoveryMode, setDiscoveryMode] = useState('competitor'); // 'competitor' or 'niche'
    const [username, setUsername] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [generatingProfile, setGeneratingProfile] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [selectedSubs, setSelectedSubs] = useState(new Set());

    if (models === undefined) {
        return <div className="page-content" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>Loading...</div>;
    }
    if (models.length === 0) {
        return <div className="page-content"><div className="card">Please create a Model first.</div></div>;
    }

    const existingSubNames = new Set(existingSubreddits?.map(s => s.name.toLowerCase()) || []);

    async function runDiscoverySearch(options = {}) {
        const mode = options.mode || discoveryMode;
        const competitorUsername = String(options.competitorUsername ?? username);
        const searchQuery = String(options.searchQuery ?? query);
        setLoading(true);
        setError(null);
        setResults([]);
        setSelectedSubs(new Set());

        try {
            if (mode === 'competitor') {
                if (!competitorUsername.trim()) return;
                const cleanUsername = competitorUsername.replace(/^(u\/|\/u\/|https:\/\/www.reddit.com\/u(ser)?\/)/i, '').split('/')[0].trim();
                const response = await fetchProxyResponse(`/api/scrape/user/${encodeURIComponent(cleanUsername)}`);

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
                if (!searchQuery.trim()) return;
                const response = await fetchProxyResponse(`/api/scrape/search/subreddits?q=${encodeURIComponent(searchQuery)}`);
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

    async function handleSearch(e) {
        e.preventDefault();
        await runDiscoverySearch();
    }

    async function handleGenerateCrawlProfile(options = {}) {
        if (!targetModel?.id) return;
        setGeneratingProfile(true);
        try {
            const shouldReuseExisting = options.runSearch
                && modelDiscoveryProfile
                && !options.forceRefresh
                && uploadedVisionSamples.length === 0;
            const profile = shouldReuseExisting
                ? modelDiscoveryProfile
                : await ModelDiscoveryProfileService.generateProfile(targetModel.id, {
                    visionSamples: uploadedVisionSamples,
                });
            if (profile?.primaryNiche && (!importNiche || importNiche === 'general')) {
                setImportNiche(profile.primaryNiche);
            }

            if (options.runSearch) {
                setLoading(true);
                setError(null);
                setResults([]);
                setSelectedSubs(new Set());
                const crawl = await ModelDiscoveryProfileService.crawlModelSubreddits(targetModel.id, {
                    profile,
                    saveProfile: false,
                });
                setDiscoveryMode('niche');
                setQuery((crawl.queries || []).join(', '));
                setResults(crawl.results || []);
            }
        } catch (err) {
            alert(`Failed to generate model crawl profile: ${err.message}`);
        } finally {
            setLoading(false);
            setGeneratingProfile(false);
        }
    }

    async function handleVisionSampleUpload(event) {
        const files = Array.from(event.target.files || [])
            .filter((file) => String(file.type || '').startsWith('image/'))
            .slice(0, 3);
        event.target.value = '';
        if (files.length === 0) return;

        setLoadingVisionSamples(true);
        try {
            const samples = await Promise.all(files.map((file) => readDiscoverySampleFile(file)));
            setUploadedVisionSamples(samples);
        } catch (err) {
            alert(`Failed to load photo samples: ${err.message}`);
        } finally {
            setLoadingVisionSamples(false);
        }
    }

    async function handleUseProfileKeyword(keyword) {
        const cleanKeyword = String(keyword || '').trim();
        if (!cleanKeyword) return;
        setDiscoveryMode('niche');
        setQuery(cleanKeyword);
        await runDiscoverySearch({ mode: 'niche', searchQuery: cleanKeyword });
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
                    const res = await fetchProxyResponse(`/api/scrape/subreddit/${encodeURIComponent(subName)}`);
                    if (res.ok) {
                        deepData = await res.json();
                    }
                } catch {
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

            subsToAdd.forEach(s => { s.id = generateId(); });
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
    const hasUploadedVisionSamples = uploadedVisionSamples.length > 0;
    const storedImageCount = Number(modelImageCount || 0);
    const currentAnalysisSource = hasUploadedVisionSamples
        ? 'uploaded photos'
        : storedImageCount > 0
            ? `${storedImageCount} library image${storedImageCount === 1 ? '' : 's'}`
            : 'no photos available';

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ maxWidth: '720px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <Sparkles size={16} style={{ color: 'var(--primary-color)' }} />
                                <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Model Crawl Profile</h2>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: modelDiscoveryProfile ? '12px' : 0 }}>
                                Let the OS turn this model into a crawl plan first. Upload 1-3 photos for a fresh model, or let it use library images if they already exist. It matches the girl to OnlyGuider-style tags, picks seed subreddits, then crawls posters in those lanes to find where else they actually post.
                            </p>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                                marginBottom: '14px',
                                padding: '12px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            Photo Analysis Input
                                        </div>
                                        <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                            Current source: <strong>{currentAnalysisSource}</strong>
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            If there are no uploaded or library photos, analysis falls back to text heuristics.
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <label className="btn btn-outline" style={{ cursor: loadingVisionSamples ? 'wait' : 'pointer' }}>
                                            {loadingVisionSamples ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                            {loadingVisionSamples ? 'Loading Photos...' : 'Upload Photos'}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                multiple
                                                hidden
                                                onChange={handleVisionSampleUpload}
                                                disabled={loadingVisionSamples}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className="btn btn-outline"
                                            onClick={() => setUploadedVisionSamples([])}
                                            disabled={uploadedVisionSamples.length === 0}
                                        >
                                            Clear Photos
                                        </button>
                                    </div>
                                </div>
                                {uploadedVisionSamples.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                        {uploadedVisionSamples.map((sample) => (
                                            <div
                                                key={sample.name}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 10px',
                                                    borderRadius: '10px',
                                                    background: 'rgba(255,255,255,0.03)',
                                                    border: '1px solid var(--border-color)',
                                                }}
                                            >
                                                <img
                                                    src={sample.dataUrl}
                                                    alt={sample.name}
                                                    style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '8px' }}
                                                />
                                                <div>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{sample.name}</div>
                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                                        {(sample.size / 1024).toFixed(0)} KB ready for vision
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {modelDiscoveryProfile && (
                                <>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '10px' }}>
                                        {modelDiscoveryProfile.summary}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                                        <span className="badge badge-info">Primary: {modelDiscoveryProfile.primaryNiche || 'general'}</span>
                                        <span className="badge badge-success">Source: {modelDiscoveryProfile.source || 'heuristic'}</span>
                                        <span className="badge badge-info">Analysis: {modelDiscoveryProfile.analysisMode || 'heuristic'}</span>
                                        <span className="badge badge-warning">Confidence: {modelDiscoveryProfile.confidence || 'medium'}</span>
                                        <span className="badge badge-danger">Fit: {modelDiscoveryProfile.nsfwFit || 'mixed'}</span>
                                    </div>
                                    {(modelDiscoveryProfile.onlyGuiderTags || []).length > 0 && (
                                        <div style={{ marginBottom: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                OnlyGuider Match Tags
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {(modelDiscoveryProfile.onlyGuiderTags || []).map((tag) => (
                                                    <span key={tag} className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {(modelDiscoveryProfile.crawlKeywords || []).length > 0 && (
                                        <div style={{ marginBottom: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                Best Crawl Keywords
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {(modelDiscoveryProfile.crawlKeywords || []).map((keyword) => (
                                                    <button
                                                        key={keyword}
                                                        type="button"
                                                        className="btn btn-outline"
                                                        style={{ padding: '5px 10px', fontSize: '0.8rem' }}
                                                        onClick={() => handleUseProfileKeyword(keyword)}
                                                    >
                                                        {keyword}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {(modelDiscoveryProfile.seedSubreddits || []).length > 0 && (
                                        <div>
                                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                Seed Subreddits
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {modelDiscoveryProfile.seedSubreddits.slice(0, 8).map((subreddit) => (
                                                    <span key={subreddit} className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                                                        r/{subreddit}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="btn btn-outline"
                                disabled={generatingProfile || !targetModel}
                                onClick={() => handleGenerateCrawlProfile()}
                            >
                                {generatingProfile ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                {modelDiscoveryProfile ? 'Refresh Analysis' : 'Analyze Model'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={generatingProfile || loading || !targetModel}
                                onClick={() => handleGenerateCrawlProfile({ runSearch: true })}
                            >
                                {loading && discoveryMode === 'niche' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                Run Model Crawl
                            </button>
                        </div>
                    </div>
                </div>

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
                            : "Enter a niche keyword to search manually, or use Run Model Crawl for the full seed-sub -> posters -> overlap crawl."}
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
                                disabled={competitorStoreAvailable === false}
                                onKeyDown={async e => {
                                    if (e.key === 'Enter' && addingCompetitor.trim() && targetModel && competitorStoreAvailable !== false) {
                                        await CompetitorService.addCompetitor(targetModel.id, addingCompetitor);
                                        setAddingCompetitor('');
                                    }
                                }}
                                style={{ width: '160px', padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                            <button
                                className="btn btn-primary"
                                disabled={competitorStoreAvailable === false || !addingCompetitor.trim() || !targetModel}
                                onClick={async () => {
                                    if (!addingCompetitor.trim() || !targetModel || competitorStoreAvailable === false) return;
                                    await CompetitorService.addCompetitor(targetModel.id, addingCompetitor);
                                    setAddingCompetitor('');
                                }}
                                style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <Plus size={14} /> Add
                            </button>
                            <button
                                className="btn btn-outline"
                                disabled={competitorStoreAvailable === false || scrapingAll || !(competitors?.length > 0)}
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
                            {competitorStoreAvailable === false
                                ? 'Competitor tracking is unavailable in this local browser database. Refresh the app data, then try again.'
                                : 'No competitors tracked yet. Add a Reddit handle above to start monitoring.'}
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
                                        <th>Lane</th>
                                        <th>Match</th>
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
                                            <td>
                                                {sub.lane ? (
                                                    <span className={`badge ${sub.lane === 'goal' ? 'badge-success' : sub.lane === 'testing' ? 'badge-info' : 'badge-warning'}`}>
                                                        {sub.lane}
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td style={{ maxWidth: '240px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                {sub.matchSummary || (sub.queryHits || []).slice(0, 2).join(', ') || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                    {validResults.length === 0 && (
                                        <tr>
                                            <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '32px' }}>
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
