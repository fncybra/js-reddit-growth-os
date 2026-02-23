import React, { useState, useEffect } from 'react';
import { SettingsService, PerformanceSyncService } from '../services/growthEngine';

export function Settings() {
    const [settings, setSettings] = useState(null);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        async function load() {
            let data = await SettingsService.getSettings();

            // Auto-fill logic for remembered keys if they are empty
            let modified = false;
            const updates = {};

            if (!data.openaiApiKey) {
                updates.openaiApiKey = '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';
                modified = true;
            }
            if (!data.proxyUrl || data.proxyUrl === 'http://localhost:3001') {
                updates.proxyUrl = 'https://js-reddit-proxy-production.up.railway.app';
                modified = true;
            }
            if (!data.supabaseUrl) {
                updates.supabaseUrl = 'https://bwckevjsjlvsfwfbnske.supabase.co';
                modified = true;
            }
            if (!data.supabaseAnonKey) {
                updates.supabaseAnonKey = 'sb_publishable_zJdDCrJNoZNGU5arum893A_mxmdvoCH';
                modified = true;
            }

            if (modified) {
                for (const [k, v] of Object.entries(updates)) {
                    await SettingsService.updateSetting(k, v);
                }
                data = await SettingsService.getSettings();
            }

            setSettings(data);
        }
        load();
    }, []);

    async function handleForceSync() {
        setSyncing(true);
        try {
            const count = await PerformanceSyncService.syncAllPendingPerformance();
            alert(`Successfully synced metrics for ${count} live posts.`);
        } finally {
            setSyncing(false);
        }
    }

    async function handleSave(e) {
        e.preventDefault();
        for (const [key, value] of Object.entries(settings)) {
            // Handle mixing types: vaPin stays string, others are numbers, api key is string
            let finalValue = value;
            const textKeys = ['vaPin', 'openaiApiKey', 'supabaseUrl', 'supabaseAnonKey', 'proxyUrl'];
            if (!textKeys.includes(key) && value !== '') {
                finalValue = Number(value);
            }
            if (value !== null && value !== undefined) {
                await SettingsService.updateSetting(key, finalValue);
            }
        }
        alert('Settings saved successfully.');
    }

    if (!settings) return <div className="page-content">Loading...</div>;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">System Settings</h1>
            </header>
            <div className="page-content">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Global Growth Rules</h2>
                        <form onSubmit={handleSave}>
                            <div className="input-group">
                                <label className="input-label">Daily Testing Limit per Account</label>
                                <input type="number" className="input-field" value={settings.dailyTestingLimit} onChange={e => setSettings({ ...settings, dailyTestingLimit: e.target.value })} />
                            </div>

                            <div className="input-group">
                                <label className="input-label">Minimum Viable View Threshold</label>
                                <input type="number" className="input-field" value={settings.minViewThreshold} onChange={e => setSettings({ ...settings, minViewThreshold: e.target.value })} />
                            </div>

                            <div className="input-group">
                                <label className="input-label">Tests Before Classification</label>
                                <input type="number" className="input-field" value={settings.testsBeforeClassification} onChange={e => setSettings({ ...settings, testsBeforeClassification: e.target.value })} />
                            </div>

                            <div className="input-group">
                                <label className="input-label">Removal Threshold (%)</label>
                                <input type="number" className="input-field" value={settings.removalThresholdPct} onChange={e => setSettings({ ...settings, removalThresholdPct: e.target.value })} />
                            </div>

                            <div className="input-group">
                                <label className="input-label">Asset Reuse Cooldown (Days)</label>
                                <input type="number" className="input-field" value={settings.assetReuseCooldownDays} onChange={e => setSettings({ ...settings, assetReuseCooldownDays: e.target.value })} />
                            </div>

                            <div className="input-group">
                                <label className="input-label">Anti-Ban Post Interval (Minutes)</label>
                                <input type="number" className="input-field" value={settings.postInterval} onChange={e => setSettings({ ...settings, postInterval: e.target.value })} />
                                <small style={{ color: 'var(--text-secondary)' }}>Forces VAs to wait between posts to prevent Reddit bans.</small>
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ marginTop: '16px', width: '100%' }}>Save Growth Configuration</button>
                        </form>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Supabase Cloud Sync (Multi-VA)</h2>
                            <div className="input-group">
                                <label className="input-label">Supabase URL</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="https://xyz.supabase.co"
                                    value={settings.supabaseUrl || ''}
                                    onChange={e => setSettings({ ...settings, supabaseUrl: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Supabase Anon Key</label>
                                <input
                                    type="password"
                                    className="input-field"
                                    placeholder="eyJhbG..."
                                    value={settings.supabaseAnonKey || ''}
                                    onChange={e => setSettings({ ...settings, supabaseAnonKey: e.target.value })}
                                />
                            </div>
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '16px' }}>
                                Enabling this moves your data from your local browser to the cloud so a team of VAs can work together.
                            </small>
                            <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginBottom: '12px' }}>Save Supabase Config</button>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                                <button
                                    onClick={async () => {
                                        if (window.confirm("This will upload all your local Models, Accounts, Subreddits, and Tasks to Supabase. Continue?")) {
                                            const { CloudSyncService } = await import('../services/growthEngine');
                                            await CloudSyncService.pushLocalToCloud();
                                            alert("Local data PUSHED to cloud successfully.");
                                        }
                                    }}
                                    className="btn btn-primary"
                                    style={{ padding: '8px', fontSize: '0.85rem' }}
                                >
                                    ⬆️ Push Local to Cloud
                                </button>
                                <button
                                    onClick={async () => {
                                        if (window.confirm("This will OVERWRITE your local data with whatever is in Supabase. Are you sure?")) {
                                            const { CloudSyncService } = await import('../services/growthEngine');
                                            await CloudSyncService.pullCloudToLocal();
                                            alert("Cloud data PULLED to local successfully. Page will reload.");
                                            window.location.reload();
                                        }
                                    }}
                                    className="btn btn-outline"
                                    style={{ padding: '8px', fontSize: '0.85rem' }}
                                >
                                    ⬇️ Pull Cloud to Local
                                </button>
                            </div>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>AI Integrations</h2>
                            <div className="input-group">
                                <label className="input-label">OpenAI API Key (Optional)</label>
                                <input
                                    type="password"
                                    className="input-field"
                                    placeholder="sk-..."
                                    value={settings.openaiApiKey || ''}
                                    onChange={e => setSettings({ ...settings, openaiApiKey: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Required for LLM-powered Title Generation based on viral subreddit posts.</small>
                            </div>
                            <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginBottom: '12px' }}>Save API Key</button>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Cloud Engine (Backend)</h2>
                            <div className="input-group">
                                <label className="input-label">Production Scraper Engine URL</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="https://your-proxy.railway.app"
                                    value={settings.proxyUrl || 'http://localhost:3001'}
                                    onChange={e => setSettings({ ...settings, proxyUrl: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>The URL of your deployed Node.js proxy server.</small>
                            </div>
                            <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginTop: '8px' }}>Save Engine URL</button>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>VA Dashboard Security</h2>
                            <div className="input-group">
                                <label className="input-label">VA Access PIN</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Set 4-digit PIN"
                                    value={settings.vaPin}
                                    onChange={e => setSettings({ ...settings, vaPin: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>VAs must enter this PIN to access the /va dashboard.</small>
                            </div>
                            <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginTop: '8px' }}>Update PIN</button>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Performance Tracking</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                                Automatic metric syncing is enabled. The system will scan live posts every 6 hours and update views/removal status.
                            </p>
                            <button
                                onClick={handleForceSync}
                                disabled={syncing}
                                className="btn btn-primary"
                                style={{ width: '100%' }}
                            >
                                {syncing ? 'Syncing...' : 'Force Sync All Posts Now'}
                            </button>
                        </div>
                        <div className="card" style={{ border: '1px solid var(--status-danger)' }}>
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '8px', color: 'var(--status-danger)' }}>Danger Zone</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                                This will permanently erase everything: all models, subreddits, library assets, tasks, and settings.
                            </p>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (window.confirm("Are you absolutely sure you want to completely erase the JS Reddit Growth OS Database? This cannot be undone.")) {
                                        try {
                                            db.close();
                                            await window.indexedDB.deleteDatabase('JSRedditGrowthOS');
                                            alert("Database wiped. The app will now reload.");
                                            window.location.reload();
                                        } catch (e) {
                                            console.error("Wipe failed:", e);
                                            alert("Failed to wipe database: " + e.message);
                                        }
                                    }
                                }}
                                className="btn btn-outline"
                                style={{ width: '100%', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                            >
                                Wipe All App Data
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
