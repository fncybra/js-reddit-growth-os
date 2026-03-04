import React, { useState, useEffect } from 'react';
import { SettingsService, AirtableService } from '../services/growthEngine';

export function ThreadsSettings() {
    const [apiKey, setApiKey] = useState('');
    const [baseId, setBaseId] = useState('');
    const [tableName, setTableName] = useState('Phone Posting');
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        async function load() {
            const data = await SettingsService.getSettings();
            setApiKey(data.airtableApiKey || '');
            setBaseId(data.airtableBaseId || 'REDACTED_AIRTABLE_BASE_ID');
            setTableName(data.airtableTableName || 'Phone Posting');
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
                </div>
            </div>
        </>
    );
}
