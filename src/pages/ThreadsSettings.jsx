import React, { useState, useEffect } from 'react';
import { SettingsService, AirtableService } from '../services/growthEngine';

export function ThreadsSettings() {
    const [apiKey, setApiKey] = useState('');
    const [baseId, setBaseId] = useState('');
    const [tableName, setTableName] = useState('Phone Posting');
    const [patrolEnabled, setPatrolEnabled] = useState(1);
    const [patrolInterval, setPatrolInterval] = useState(15);
    const [patrolBatchSize, setPatrolBatchSize] = useState(3);
    const [lastPatrol, setLastPatrol] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        async function load() {
            const data = await SettingsService.getSettings();
            setApiKey(data.airtableApiKey || '');
            setBaseId(data.airtableBaseId || 'appbdTRxib6pxvtmG');
            setTableName(data.airtableTableName || 'Phone Posting');
            setPatrolEnabled(Number(data.threadsPatrolEnabled ?? 1));
            setPatrolInterval(Number(data.threadsPatrolIntervalMinutes) || 15);
            setPatrolBatchSize(Number(data.threadsPatrolBatchSize) || 3);
            try {
                if (data.lastThreadsPatrol) setLastPatrol(JSON.parse(data.lastThreadsPatrol));
            } catch (_) {}
            setLoaded(true);
        }
        load();
    }, []);

    async function handleSave() {
        await SettingsService.updateSetting('airtableApiKey', apiKey);
        await SettingsService.updateSetting('airtableBaseId', baseId);
        await SettingsService.updateSetting('airtableTableName', tableName);
        // Immediately push to cloud so the next pull doesn't overwrite with empty values
        try {
            const { CloudSyncService } = await import('../services/growthEngine');
            await CloudSyncService.pushLocalToCloud();
        } catch (_) { /* offline is fine */ }
        alert('Threads settings saved.');
    }

    async function handleTest() {
        // Save first so test uses latest values
        await SettingsService.updateSetting('airtableApiKey', apiKey);
        await SettingsService.updateSetting('airtableBaseId', baseId);
        await SettingsService.updateSetting('airtableTableName', tableName);
        try {
            await AirtableService.testConnection();
            alert('Airtable connection successful!');
        } catch (e) {
            alert('Connection failed: ' + e.message);
        }
    }

    async function handlePatrolSave() {
        await SettingsService.updateSetting('threadsPatrolEnabled', patrolEnabled);
        await SettingsService.updateSetting('threadsPatrolIntervalMinutes', Math.max(5, Math.min(120, patrolInterval)));
        await SettingsService.updateSetting('threadsPatrolBatchSize', Math.max(1, Math.min(10, patrolBatchSize)));
        alert('Patrol settings saved. Changes take effect on next patrol cycle.');
    }

    if (!loaded) return <div className="page-content">Loading...</div>;

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Threads Settings</h1>
            </header>
            <div className="page-content">
                <div style={{ maxWidth: '600px' }}>
                    <div className="card">
                        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Airtable Integration</h2>
                        <div className="input-group">
                            <label className="input-label">Airtable API Key</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="pat..."
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                            />
                            <small style={{ color: 'var(--text-secondary)' }}>Personal access token from <b>airtable.com/create/tokens</b> — needs <b>data.records:read</b> and <b>data.records:write</b> scopes</small>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Base ID</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder="appXXXXXXXXXXXXXX"
                                value={baseId}
                                onChange={e => setBaseId(e.target.value)}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Table Name</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder="Phone Posting"
                                value={tableName}
                                onChange={e => setTableName(e.target.value)}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                            <button onClick={handleSave} className="btn btn-primary">Save</button>
                            <button type="button" className="btn btn-outline" onClick={handleTest}>
                                Test Connection
                            </button>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: '24px' }}>
                        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Health Patrol</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
                            Automatically scrapes Threads profiles to detect dead/suspended accounts and updates Airtable.
                        </p>
                        <div className="input-group">
                            <label className="input-label">Enable Patrol</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <button
                                    className={`btn ${patrolEnabled ? 'btn-primary' : 'btn-outline'}`}
                                    onClick={() => setPatrolEnabled(patrolEnabled ? 0 : 1)}
                                    style={{ minWidth: '80px' }}
                                >
                                    {patrolEnabled ? 'ON' : 'OFF'}
                                </button>
                            </div>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Check Interval (minutes)</label>
                            <input
                                type="number"
                                className="input-field"
                                min={5}
                                max={120}
                                value={patrolInterval}
                                onChange={e => setPatrolInterval(Number(e.target.value) || 15)}
                            />
                            <small style={{ color: 'var(--text-secondary)' }}>Min 5, max 120. Default 15 minutes.</small>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Batch Size</label>
                            <input
                                type="number"
                                className="input-field"
                                min={1}
                                max={10}
                                value={patrolBatchSize}
                                onChange={e => setPatrolBatchSize(Number(e.target.value) || 3)}
                            />
                            <small style={{ color: 'var(--text-secondary)' }}>Accounts checked per interval. 3s delay between each.</small>
                        </div>
                        <button onClick={handlePatrolSave} className="btn btn-primary" style={{ marginTop: '16px' }}>
                            Save Patrol Settings
                        </button>

                        {lastPatrol && (
                            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '0.8rem' }}>
                                <div style={{ fontWeight: '600', marginBottom: '8px' }}>Last Patrol Result</div>
                                <div>Time: {new Date(lastPatrol.timestamp).toLocaleString()}</div>
                                <div>Checked: {lastPatrol.checked} | Healthy: {lastPatrol.healthy} | Dead: {lastPatrol.dead} | Errors: {lastPatrol.errors}</div>
                                <div>Session: {lastPatrol.sessionProgress}/{lastPatrol.sessionTotal} accounts rotated</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
