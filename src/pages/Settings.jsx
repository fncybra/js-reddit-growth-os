import React, { useEffect, useState } from 'react';
import { SettingsService, PerformanceSyncService, AccountSyncService } from '../services/growthEngine';

const TEXT_KEYS = new Set([
  'vaPin',
  'redditManagerPin',
  'openRouterApiKey',
  'aiBaseUrl',
  'openRouterModel',
  'supabaseUrl',
  'supabaseAnonKey',
  'proxyUrl',
  'telegramBotToken',
  'telegramChatId',
  'telegramThreadId',
  'lastTelegramReportDate',
  'lastRedditDailyReportDate',
  'redditTelegramBotToken',
  'redditTelegramChatId',
  'redditTelegramThreadId',
  'proxyApiToken',
]);

async function saveSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    if (value === null || value === undefined) continue;

    let finalValue = value;
    if (!TEXT_KEYS.has(key) && value !== '') {
      finalValue = Number(value);
    }

    await SettingsService.updateSetting(key, finalValue);
  }

  const { resetSupabaseClient } = await import('../db/supabase');
  resetSupabaseClient();

  try {
    const { CloudSyncService } = await import('../services/growthEngine');
    await CloudSyncService.pushLocalToCloud();
  } catch {
    // Offline is fine.
  }
}

function SettingText({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <input
        type={type}
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SettingNumber({ label, value, onChange, min, max }) {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <input
        type="number"
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
      />
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      let data = await SettingsService.getSettings();
      const updates = {};

      if (!data.aiBaseUrl) updates.aiBaseUrl = 'https://openrouter.ai/api/v1';
      if (!data.openRouterModel) updates.openRouterModel = 'z-ai/glm-5';
      if (!data.proxyUrl || data.proxyUrl === 'http://localhost:3001') {
        updates.proxyUrl = 'https://js-reddit-proxy-production.up.railway.app';
      }
      if (!data.supabaseUrl) updates.supabaseUrl = 'https://bwckevjsjlvsfwfbnske.supabase.co';
      if (!data.supabaseAnonKey) updates.supabaseAnonKey = 'sb_publishable_zJdDCrJNoZNGU5arum893A_mxmdvoCH';

      if (Object.keys(updates).length > 0) {
        for (const [key, value] of Object.entries(updates)) {
          await SettingsService.updateSetting(key, value);
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
    setSaving(true);
    try {
      await saveSettings(settings);
      alert('Settings saved successfully.');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div className="page-content">Loading...</div>;

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">System Settings</h1>
      </header>
      <div className="page-content">
        <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Growth Rules</h2>
            <SettingNumber label="Daily Testing Limit per Account" value={settings.dailyTestingLimit} onChange={(value) => setSettings({ ...settings, dailyTestingLimit: value })} />
            <SettingNumber label="Minimum Viable View Threshold" value={settings.minViewThreshold} onChange={(value) => setSettings({ ...settings, minViewThreshold: value })} />
            <SettingNumber label="Tests Before Classification" value={settings.testsBeforeClassification} onChange={(value) => setSettings({ ...settings, testsBeforeClassification: value })} />
            <SettingNumber label="Removal Threshold (%)" value={settings.removalThresholdPct} onChange={(value) => setSettings({ ...settings, removalThresholdPct: value })} />
            <SettingNumber label="Asset Reuse Cooldown (Days)" value={settings.assetReuseCooldownDays} onChange={(value) => setSettings({ ...settings, assetReuseCooldownDays: value })} />
            <SettingNumber label="Daily Post Cap" value={settings.dailyPostCap ?? 10} onChange={(value) => setSettings({ ...settings, dailyPostCap: value })} />
            <SettingNumber label="Max Posts per Subreddit per Day" value={settings.maxPostsPerSubPerDay ?? 5} onChange={(value) => setSettings({ ...settings, maxPostsPerSubPerDay: value })} />
            <div className="input-group">
              <label className="input-label">Allow Subreddit Repeats in Queue</label>
              <select className="input-field" value={String(settings.allowSubredditRepeatsInQueue ?? 0)} onChange={(e) => setSettings({ ...settings, allowSubredditRepeatsInQueue: Number(e.target.value) })}>
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Account Lifecycle</h2>
            <SettingNumber label="Min Warmup Days" value={settings.minWarmupDays ?? 7} onChange={(value) => setSettings({ ...settings, minWarmupDays: value })} />
            <SettingNumber label="Min Warmup Karma" value={settings.minWarmupKarma ?? 100} onChange={(value) => setSettings({ ...settings, minWarmupKarma: value })} />
            <SettingNumber label="Max Consecutive Active Days" value={settings.maxConsecutiveActiveDays ?? 4} onChange={(value) => setSettings({ ...settings, maxConsecutiveActiveDays: value })} />
            <SettingNumber label="Rest Duration Days" value={settings.restDurationDays ?? 2} onChange={(value) => setSettings({ ...settings, restDurationDays: value })} />
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>AI Brain</h2>
            <SettingText label="AI Base URL" value={settings.aiBaseUrl || ''} onChange={(value) => setSettings({ ...settings, aiBaseUrl: value })} placeholder="https://openrouter.ai/api/v1" />
            <SettingText label="OpenRouter API Key" value={settings.openRouterApiKey || ''} onChange={(value) => setSettings({ ...settings, openRouterApiKey: value })} placeholder="sk-or-v1-..." type="password" />
            <SettingText label="Model String" value={settings.openRouterModel || ''} onChange={(value) => setSettings({ ...settings, openRouterModel: value })} placeholder="z-ai/glm-5" />
            <div className="input-group">
              <label className="input-label">Use Model Voice Profile</label>
              <select className="input-field" value={String(settings.useVoiceProfile ?? 1)} onChange={(e) => setSettings({ ...settings, useVoiceProfile: Number(e.target.value) })}>
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Cloud Sync</h2>
            <SettingText label="Supabase URL" value={settings.supabaseUrl || ''} onChange={(value) => setSettings({ ...settings, supabaseUrl: value })} placeholder="https://xyz.supabase.co" />
            <SettingText label="Supabase Anon Key" value={settings.supabaseAnonKey || ''} onChange={(value) => setSettings({ ...settings, supabaseAnonKey: value })} placeholder="sb_publishable_..." type="password" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  if (!window.confirm('This will upload all local Reddit OS data to Supabase. Continue?')) return;
                  const { CloudSyncService } = await import('../services/growthEngine');
                  await CloudSyncService.pushLocalToCloud();
                  alert('Local data pushed to cloud successfully.');
                }}
              >
                Push Local to Cloud
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={async () => {
                  if (!window.confirm('This will overwrite local data with the current cloud state. Continue?')) return;
                  const { CloudSyncService } = await import('../services/growthEngine');
                  await CloudSyncService.pullCloudToLocal();
                  alert('Cloud data pulled to local. The page will reload.');
                  window.location.reload();
                }}
              >
                Pull Cloud to Local
              </button>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Proxy</h2>
            <SettingText label="Production Scraper Engine URL" value={settings.proxyUrl || ''} onChange={(value) => setSettings({ ...settings, proxyUrl: value })} placeholder="https://your-proxy.railway.app" />
            <SettingText label="Proxy API Token" value={settings.proxyApiToken || ''} onChange={(value) => setSettings({ ...settings, proxyApiToken: value })} placeholder="Optional shared secret" type="password" />
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Access PINs</h2>
            <SettingText label="Admin Access PIN" value={settings.vaPin || ''} onChange={(value) => setSettings({ ...settings, vaPin: value })} placeholder="1234" />
            <SettingText label="Reddit Manager PIN" value={settings.redditManagerPin || ''} onChange={(value) => setSettings({ ...settings, redditManagerPin: value })} placeholder="Optional" />
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Telegram Reports</h2>
            <SettingText label="Bot Token" value={settings.redditTelegramBotToken || settings.telegramBotToken || ''} onChange={(value) => setSettings({ ...settings, redditTelegramBotToken: value })} placeholder="Telegram bot token" type="password" />
            <SettingText label="Chat ID" value={settings.redditTelegramChatId || settings.telegramChatId || ''} onChange={(value) => setSettings({ ...settings, redditTelegramChatId: value })} placeholder="Telegram chat ID" />
            <SettingText label="Topic Thread ID" value={settings.redditTelegramThreadId || settings.telegramThreadId || ''} onChange={(value) => setSettings({ ...settings, redditTelegramThreadId: value })} placeholder="Optional topic thread ID" />
            <div className="input-group">
              <label className="input-label">Enable Reddit Daily Report</label>
              <select className="input-field" value={String(settings.redditDailyReportEnabled ?? 1)} onChange={(e) => setSettings({ ...settings, redditDailyReportEnabled: Number(e.target.value) })}>
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <SettingNumber label="Send After Hour (0-23)" value={settings.redditDailyReportHour ?? 8} onChange={(value) => setSettings({ ...settings, redditDailyReportHour: value })} min="0" max="23" />
            <button
              type="button"
              className="btn btn-outline"
              onClick={async () => {
                try {
                  const { TelegramService } = await import('../services/growthEngine');
                  const result = await TelegramService.sendDailyReport();
                  alert(result.sent ? 'Reddit daily report sent.' : `Report not sent: ${result.reason || 'Unknown error'}`);
                } catch (err) {
                  alert(`Failed: ${err.message}`);
                }
              }}
            >
              Send Reddit Report Now
            </button>
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Manual Maintenance</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save All Settings'}
              </button>
              <button type="button" className="btn btn-outline" onClick={handleForceSync} disabled={syncing}>
                {syncing ? 'Syncing...' : 'Force Performance Sync'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
