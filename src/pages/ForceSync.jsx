import React, { useState, useEffect } from 'react';
import { db } from '../db/db';

export function ForceSync() {
    const [log, setLog] = useState([]);
    const [done, setDone] = useState(false);

    function addLog(msg) {
        setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }

    useEffect(() => {
        let ran = false;
        async function run() {
            if (ran) return;
            ran = true;

            try {
                // Step 1: Check local data
                const localCounts = {};
                const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings'];
                for (const t of tables) {
                    localCounts[t] = await db[t].count();
                }
                addLog('Local data: ' + Object.entries(localCounts).map(([k, v]) => `${k}=${v}`).join(', '));

                if (localCounts.accounts === 0) {
                    addLog('ERROR: No local accounts! Open this on your ADMIN PC browser, not phone.');
                    setDone(true);
                    return;
                }

                // Step 2: Push to Supabase
                addLog('Starting push to Supabase...');
                const { CloudSyncService } = await import('../services/growthEngine');
                await CloudSyncService.pushLocalToCloud();
                addLog('Push complete!');

                // Step 3: Verify cloud data
                const { getSupabaseClient } = await import('../db/supabase');
                const supabase = await getSupabaseClient();
                if (!supabase) {
                    addLog('ERROR: No Supabase client - check settings');
                    setDone(true);
                    return;
                }

                for (const t of tables) {
                    const { data, error } = await supabase.from(t).select('id', { count: 'exact', head: true });
                    if (error) {
                        addLog(`  ${t}: ERROR - ${error.message}`);
                    } else {
                        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
                        addLog(`  ${t}: ${count} rows in cloud`);
                    }
                }

                addLog('DONE! Phone should now see data after refresh.');
            } catch (err) {
                addLog('FATAL ERROR: ' + err.message);
                console.error(err);
            }
            setDone(true);
        }
        run();
    }, []);

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', color: '#e5e7eb', fontFamily: 'monospace', padding: '24px' }}>
            <h1 style={{ color: '#6366f1', marginBottom: '16px' }}>Force Sync</h1>
            <p style={{ color: '#9ca3af', marginBottom: '24px' }}>Pushing all local IndexedDB data to Supabase...</p>
            <div style={{ backgroundColor: '#1a1d24', padding: '16px', borderRadius: '8px', border: '1px solid #2d313a' }}>
                {log.map((line, i) => (
                    <div key={i} style={{ marginBottom: '4px', color: line.includes('ERROR') ? '#ef4444' : line.includes('DONE') ? '#10b981' : '#e5e7eb' }}>
                        {line}
                    </div>
                ))}
                {!done && <div style={{ color: '#fbbf24', marginTop: '8px' }}>Running...</div>}
            </div>
        </div>
    );
}
