import React, { useState, useEffect } from 'react';
import { SettingsService, PerformanceSyncService, AccountSyncService } from '../services/growthEngine';

export function Settings() {
    const [settings, setSettings] = useState(null);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        async function load() {
            let data = await SettingsService.getSettings();

            // Auto-fill logic for remembered keys if they are empty
            let modified = false;
            const updates = {};

            if (!data.openRouterApiKey) {
                updates.openRouterApiKey = 'REDACTED_OPENROUTER_KEY';
                modified = true;
            }
            if (!data.aiBaseUrl) {
                updates.aiBaseUrl = 'https://openrouter.ai/api/v1';
                modified = true;
            }
            if (!data.openRouterModel) {
                updates.openRouterModel = 'nousresearch/hermes-3-llama-3.1-70b';
                modified = true;
            }
            if (!data.proxyUrl || data.proxyUrl === 'http://localhost:3001') {
                updates.proxyUrl = 'https://js-reddit-proxy-production.up.railway.app';
                modified = true;
            }
            if (!data.supabaseUrl) {
                updates.supabaseUrl = 'https://REDACTED_SUPABASE_URL';
                modified = true;
            }
            if (!data.supabaseAnonKey) {
                updates.supabaseAnonKey = 'REDACTED_SUPABASE_ANON_KEY';
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
            await AccountSyncService.syncAllAccounts();
            const stats = await PerformanceSyncService.syncAllPendingPerformance();
            alert(`Sync done. Scanned ${stats.scanned} tasks, attempted ${stats.attempted}, succeeded ${stats.succeeded}, failed ${stats.failed}, skipped ${stats.skipped}.`);
        } finally {
            setSyncing(false);
        }
    }

    async function handleSave(e) {
        e.preventDefault();
        for (const [key, value] of Object.entries(settings)) {
            // Handle mixing types: vaPin stays string, others are numbers, api key is string
            let finalValue = value;
            const textKeys = ['vaPin', 'openRouterApiKey', 'aiBaseUrl', 'openRouterModel', 'supabaseUrl', 'supabaseAnonKey', 'proxyUrl', 'telegramBotToken', 'telegramChatId', 'telegramThreadId', 'lastTelegramReportDate', 'airtableApiKey', 'airtableBaseId', 'airtableTableName', 'lastThreadsPatrol', 'threadsTelegramBotToken', 'threadsTelegramChatId', 'threadsTelegramThreadId', 'lastThreadsDailyReportDate', 'lastVASnapshot', 'threadsManagerPin', 'redditManagerPin', 'ofTelegramBotToken', 'ofTelegramChatId', 'ofTelegramThreadId', 'lastOFDailyReportDate'];
            if (!textKeys.includes(key) && value !== '') {
                finalValue = Number(value);
            }
            if (value !== null && value !== undefined) {
                await SettingsService.updateSetting(key, finalValue);
            }
        }
        // Reset cached Supabase client so new credentials take effect immediately
        const { resetSupabaseClient } = await import('../db/supabase');
        resetSupabaseClient();
        // Push to cloud immediately so next pull doesn't overwrite with stale values
        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.pushLocalToCloud();
        } catch (_) { /* offline is fine */ }
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

                    <div className="card">
                        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Account Lifecycle Rules</h2>
                        <div className="input-group">
                            <label className="input-label">Min Warmup Days</label>
                            <input type="number" className="input-field" value={settings.minWarmupDays ?? 7} onChange={e => setSettings({ ...settings, minWarmupDays: e.target.value })} />
                            <small style={{ color: 'var(--text-secondary)' }}>New accounts stay in "Warming" phase for at least this many days.</small>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Min Warmup Karma</label>
                            <input type="number" className="input-field" value={settings.minWarmupKarma ?? 100} onChange={e => setSettings({ ...settings, minWarmupKarma: e.target.value })} />
                            <small style={{ color: 'var(--text-secondary)' }}>Account must reach this karma before graduating from Warming.</small>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Max Consecutive Active Days</label>
                            <input type="number" className="input-field" value={settings.maxConsecutiveActiveDays ?? 4} onChange={e => setSettings({ ...settings, maxConsecutiveActiveDays: e.target.value })} />
                            <small style={{ color: 'var(--text-secondary)' }}>After this many consecutive posting days, account enters "Resting" phase.</small>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Rest Duration Days</label>
                            <input type="number" className="input-field" value={settings.restDurationDays ?? 2} onChange={e => setSettings({ ...settings, restDurationDays: e.target.value })} />
                            <small style={{ color: 'var(--text-secondary)' }}>How many days an account rests before returning to "Ready".</small>
                        </div>
                        <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginTop: '8px' }}>Save Lifecycle Rules</button>
                    </div>

                    <div className="card">
                        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>AI Brain Integration</h2>
                        <div className="input-group" style={{ marginBottom: '16px' }}>
                            <label className="input-label">AI Base URL</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder="https://openrouter.ai/api/v1"
                                value={settings.aiBaseUrl || ''}
                                onChange={e => setSettings({ ...settings, aiBaseUrl: e.target.value })}
                            />
                            <small style={{ color: 'var(--text-secondary)' }}>E.g. OpenRouter or Venice: https://api.venice.ai/api/v1</small>
                        </div>
                        <div className="input-group" style={{ marginBottom: '16px' }}>
                            <label className="input-label">API Key</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="..."
                                value={settings.openRouterApiKey || ''}
                                onChange={e => setSettings({ ...settings, openRouterApiKey: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Model String</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder="e.g. dolphin-2.9.2-qwen2-72b or mistralai/mixtral-8x7b-instruct"
                                value={settings.openRouterModel || ''}
                                onChange={e => setSettings({ ...settings, openRouterModel: e.target.value })}
                            />
                            <small style={{ color: 'var(--text-secondary)' }}>You can change the brain here.</small>
                        </div>
                        <div className="input-group" style={{ marginTop: '12px' }}>
                            <label className="input-label">Use Model Voice Profile</label>
                            <select className="input-field" value={String(settings.useVoiceProfile ?? 1)} onChange={e => setSettings({ ...settings, useVoiceProfile: Number(e.target.value) })}>
                                <option value="1">On (recommended)</option>
                                <option value="0">Off (legacy behavior)</option>
                            </select>
                            <small style={{ color: 'var(--text-secondary)' }}>When ON, AI titles follow model persona builder inputs.</small>
                        </div>
                        <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginTop: '16px' }}>Save AI Settings</button>
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
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '10px' }}>
                                Railway env vars for scraper IP control: <code>PROXY_POOL_API_URL</code> (or <code>SMARTPROXY_API_URL</code>) and optional <code>REDDIT_PROXY_POOL</code>.
                            </small>
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
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Manager Access PINs</h2>
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '16px' }}>
                                Give department managers their own PIN to access only their section. Leave blank to disable a role (only master PIN works).
                            </small>
                            <div className="input-group">
                                <label className="input-label">Threads Manager PIN</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to disable"
                                    value={settings.threadsManagerPin || ''}
                                    onChange={e => setSettings({ ...settings, threadsManagerPin: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Unlocks: Command Center, Threads Dashboard, Threads Settings, Settings</small>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Reddit Manager PIN</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to disable"
                                    value={settings.redditManagerPin || ''}
                                    onChange={e => setSettings({ ...settings, redditManagerPin: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Unlocks: Command Center, all Reddit pages, Settings</small>
                            </div>
                            <button onClick={handleSave} className="btn btn-outline" style={{ width: '100%', marginTop: '8px' }}>Save Manager PINs</button>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Performance Tracking</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                                Use this to refresh live Reddit post stats (upvotes/removal status) across recent closed tasks.
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
                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Telegram Notifications</h2>
                            <div className="input-group">
                                <label className="input-label">Bot Token</label>
                                <input
                                    type="password"
                                    className="input-field"
                                    placeholder="123456:ABC-DEF..."
                                    value={settings.telegramBotToken || ''}
                                    onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Create a bot via <b>@BotFather</b> on Telegram and paste the token here.</small>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Chat ID</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. 123456789"
                                    value={settings.telegramChatId || ''}
                                    onChange={e => setSettings({ ...settings, telegramChatId: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Send a message to <b>@userinfobot</b> on Telegram to get your chat ID.</small>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Topic Thread ID <small>(optional)</small></label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. 227"
                                    value={settings.telegramThreadId || ''}
                                    onChange={e => setSettings({ ...settings, telegramThreadId: e.target.value })}
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>For forum groups with topics. Leave blank for regular chats/groups.</small>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                                <button onClick={handleSave} className="btn btn-primary">Save</button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={async () => {
                                        const token = (settings.telegramBotToken || '').trim();
                                        const chatId = (settings.telegramChatId || '').trim();
                                        const threadId = (settings.telegramThreadId || '').trim();
                                        if (!token || !chatId) {
                                            alert('Please enter both Bot Token and Chat ID first.');
                                            return;
                                        }
                                        try {
                                            const { TelegramService } = await import('../services/growthEngine');
                                            await TelegramService.sendTestMessage(token, chatId, threadId);
                                            alert('Test message sent! Check your Telegram.');
                                        } catch (e) {
                                            alert('Failed to send test message: ' + e.message);
                                        }
                                    }}
                                >
                                    Send Test Message
                                </button>
                            </div>
                        </div>
                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Threads Telegram Alerts</h2>
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '16px' }}>
                                Separate Telegram settings for Threads patrol alerts. If left blank, falls back to the main Reddit Telegram settings above.
                            </small>
                            <div className="input-group">
                                <label className="input-label">Bot Token (Threads)</label>
                                <input
                                    type="password"
                                    className="input-field"
                                    placeholder="Leave blank to use main bot token"
                                    value={settings.threadsTelegramBotToken || ''}
                                    onChange={e => setSettings({ ...settings, threadsTelegramBotToken: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Chat ID (Threads)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to use main chat ID"
                                    value={settings.threadsTelegramChatId || ''}
                                    onChange={e => setSettings({ ...settings, threadsTelegramChatId: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Topic Thread ID (Threads) <small>(optional)</small></label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to use main thread ID"
                                    value={settings.threadsTelegramThreadId || ''}
                                    onChange={e => setSettings({ ...settings, threadsTelegramThreadId: e.target.value })}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                <button onClick={handleSave} className="btn btn-primary">Save</button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={async () => {
                                        const token = (settings.threadsTelegramBotToken || settings.telegramBotToken || '').trim();
                                        const chatId = (settings.threadsTelegramChatId || settings.telegramChatId || '').trim();
                                        const threadId = (settings.threadsTelegramThreadId || settings.telegramThreadId || '').trim();
                                        if (!token || !chatId) {
                                            alert('No Telegram credentials configured for Threads alerts.');
                                            return;
                                        }
                                        try {
                                            const { TelegramService } = await import('../services/growthEngine');
                                            await TelegramService.sendMessage(token, chatId, '<b>Threads Health Patrol</b> — Test message. Alerts will appear here.', threadId);
                                            alert('Test message sent! Check your Telegram.');
                                        } catch (e) {
                                            alert('Failed: ' + e.message);
                                        }
                                    }}
                                >
                                    Send Test
                                </button>
                            </div>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Threads Daily VA Report</h2>
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '16px' }}>
                                Sends a daily Telegram report with per-VA accountability metrics: red flags (stale logins, dead accounts), watch list, and top performers with day-over-day deltas.
                            </small>
                            <div className="input-group">
                                <label className="input-label">Enable Daily VA Report</label>
                                <select className="input-field" value={String(settings.threadsDailyReportEnabled ?? 1)} onChange={e => setSettings({ ...settings, threadsDailyReportEnabled: Number(e.target.value) })}>
                                    <option value="1">Enabled</option>
                                    <option value="0">Disabled</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Send After Hour (0-23)</label>
                                <input type="number" className="input-field" value={settings.threadsDailyReportHour ?? 8} onChange={e => setSettings({ ...settings, threadsDailyReportHour: e.target.value })} min="0" max="23" />
                                <small style={{ color: 'var(--text-secondary)' }}>Report auto-sends once per day after this hour (local time). Default: 8 AM.</small>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                <button onClick={handleSave} className="btn btn-primary">Save</button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={async () => {
                                        try {
                                            const { TelegramService } = await import('../services/growthEngine');
                                            const result = await TelegramService.sendThreadsDailyReport();
                                            if (result.sent) {
                                                alert('Daily VA report sent! Check your Telegram.');
                                            } else {
                                                alert('Report not sent: ' + (result.reason || 'Unknown error'));
                                            }
                                        } catch (e) {
                                            alert('Failed: ' + e.message);
                                        }
                                    }}
                                >
                                    Send Now
                                </button>
                            </div>
                        </div>

                        <div className="card">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>OF Tracker Telegram</h2>
                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '16px' }}>
                                Separate Telegram settings for OF Tracker daily reports. If left blank, falls back to the main Telegram settings.
                            </small>
                            <div className="input-group">
                                <label className="input-label">Bot Token (OF)</label>
                                <input
                                    type="password"
                                    className="input-field"
                                    placeholder="Leave blank to use main bot token"
                                    value={settings.ofTelegramBotToken || ''}
                                    onChange={e => setSettings({ ...settings, ofTelegramBotToken: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Chat ID (OF)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to use main chat ID"
                                    value={settings.ofTelegramChatId || ''}
                                    onChange={e => setSettings({ ...settings, ofTelegramChatId: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Topic Thread ID (OF) <small>(optional)</small></label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Leave blank to use main thread ID"
                                    value={settings.ofTelegramThreadId || ''}
                                    onChange={e => setSettings({ ...settings, ofTelegramThreadId: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Enable OF Daily Report</label>
                                <select className="input-field" value={String(settings.ofDailyReportEnabled ?? 0)} onChange={e => setSettings({ ...settings, ofDailyReportEnabled: Number(e.target.value) })}>
                                    <option value="1">Enabled</option>
                                    <option value="0">Disabled</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Send After Hour (0-23)</label>
                                <input type="number" className="input-field" value={settings.ofDailyReportHour ?? 20} onChange={e => setSettings({ ...settings, ofDailyReportHour: e.target.value })} min="0" max="23" />
                                <small style={{ color: 'var(--text-secondary)' }}>Report auto-sends once per day after this hour (local time). Default: 8 PM.</small>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                <button onClick={handleSave} className="btn btn-primary">Save</button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={async () => {
                                        const token = (settings.ofTelegramBotToken || settings.telegramBotToken || '').trim();
                                        const chatId = (settings.ofTelegramChatId || settings.telegramChatId || '').trim();
                                        const threadId = (settings.ofTelegramThreadId || settings.telegramThreadId || '').trim();
                                        if (!token || !chatId) {
                                            alert('No Telegram credentials configured for OF reports.');
                                            return;
                                        }
                                        try {
                                            const { TelegramService } = await import('../services/growthEngine');
                                            await TelegramService.sendMessage(token, chatId, '<b>OF Tracker</b> — Test message. Reports will appear here.', threadId);
                                            alert('Test message sent! Check your Telegram.');
                                        } catch (e) {
                                            alert('Failed: ' + e.message);
                                        }
                                    }}
                                >
                                    Test
                                </button>
                            </div>
                            <button
                                type="button"
                                className="btn btn-outline"
                                style={{ width: '100%', marginTop: '12px' }}
                                onClick={async () => {
                                    try {
                                        const { TelegramService } = await import('../services/growthEngine');
                                        const result = await TelegramService.sendOFDailyReport();
                                        if (result.sent) {
                                            alert('OF daily report sent! Check your Telegram.');
                                        } else {
                                            alert('Report not sent: ' + (result.reason || 'Unknown error'));
                                        }
                                    } catch (e) {
                                        alert('Failed: ' + e.message);
                                    }
                                }}
                            >
                                Send OF Report Now
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
}
