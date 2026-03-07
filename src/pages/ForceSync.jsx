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
                const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings'];
                for (const t of tables) {
                    const count = await db[t].count();
                    addLog(`Local ${t}: ${count}`);
                }

                const localAccounts = await db.accounts.toArray();
                if (localAccounts.length === 0) {
                    addLog('ERROR: No local accounts. Open this on ADMIN PC.');
                    setDone(true);
                    return;
                }
                addLog('Accounts: ' + localAccounts.map(a => `${a.handle}(id=${a.id})`).join(', '));

                const { getSupabaseClient } = await import('../db/supabase');
                const supabase = await getSupabaseClient();
                if (!supabase) {
                    addLog('ERROR: No Supabase client.');
                    setDone(true);
                    return;
                }
                addLog('Supabase connected.');

                // Discover valid columns by inserting a test row
                async function getValidCols(table, testRow) {
                    const allKeys = Object.keys(testRow);
                    const { error } = await supabase.from(table).upsert(testRow);
                    if (!error) {
                        await supabase.from(table).delete().eq('id', testRow.id);
                        return new Set(allKeys);
                    }
                    // Find bad columns one by one
                    const bad = new Set();
                    const colMatch = error.message.match(/Could not find the '([^']+)' column/);
                    if (colMatch) bad.add(colMatch[1]);

                    // Iteratively strip bad columns
                    let remaining = { ...testRow };
                    for (let i = 0; i < 20; i++) {
                        for (const b of bad) delete remaining[b];
                        const { error: e2 } = await supabase.from(table).upsert(remaining);
                        if (!e2) {
                            await supabase.from(table).delete().eq('id', testRow.id);
                            return new Set(Object.keys(remaining));
                        }
                        const m2 = e2.message.match(/Could not find the '([^']+)' column/);
                        if (m2) bad.add(m2[1]);
                        else break;
                    }
                    await supabase.from(table).delete().eq('id', testRow.id);
                    return new Set(allKeys.filter(k => !bad.has(k)));
                }

                // Clear dummy accounts
                addLog('Clearing cloud accounts...');
                await supabase.from('accounts').delete().gte('id', 0);

                // Discover valid account columns
                addLog('Discovering account schema...');
                const testAcc = { ...localAccounts[0], id: 99999, handle: '_schema_test_' };
                const validAccCols = await getValidCols('accounts', testAcc);
                addLog('Valid account cols: ' + [...validAccCols].join(', '));

                // Push accounts with only valid columns
                addLog('Pushing accounts...');
                const cleanAccounts = localAccounts.filter(a => !!a.handle).map(a => {
                    const clean = {};
                    for (const [k, v] of Object.entries(a)) {
                        if (validAccCols.has(k)) clean[k] = v;
                    }
                    return clean;
                });

                const { error: accErr } = await supabase.from('accounts').upsert(cleanAccounts);
                if (accErr) {
                    addLog('Account push FAIL: ' + accErr.message);
                } else {
                    addLog('Pushed ' + cleanAccounts.length + ' accounts OK');
                }

                // Verify accounts in cloud
                const { data: cloudAccs } = await supabase.from('accounts').select('id,handle');
                addLog('Cloud accounts: ' + (cloudAccs || []).map(a => a.handle).join(', '));

                // Push tasks with only valid columns
                addLog('Pushing tasks...');
                const localTasks = await db.tasks.toArray();
                if (localTasks.length > 0) {
                    const testTask = { ...localTasks[0], id: 99999 };
                    const validTaskCols = await getValidCols('tasks', testTask);
                    addLog('Valid task cols: ' + [...validTaskCols].slice(0, 10).join(', ') + '...');

                    const cleanTasks = localTasks.map(t => {
                        const clean = {};
                        for (const [k, v] of Object.entries(t)) {
                            if (validTaskCols.has(k)) clean[k] = v;
                        }
                        return clean;
                    });

                    const BATCH = 200;
                    for (let i = 0; i < cleanTasks.length; i += BATCH) {
                        const batch = cleanTasks.slice(i, i + BATCH);
                        const { error: tErr } = await supabase.from('tasks').upsert(batch);
                        addLog('Tasks ' + i + '-' + (i + batch.length) + ': ' + (tErr ? 'FAIL - ' + tErr.message : 'OK'));
                    }
                }

                // Push performances
                addLog('Pushing performances...');
                const localPerfs = await db.performances.toArray();
                if (localPerfs.length > 0) {
                    const testPerf = { ...localPerfs[0], id: 99999 };
                    const validPerfCols = await getValidCols('performances', testPerf);
                    const cleanPerfs = localPerfs.map(p => {
                        const clean = {};
                        for (const [k, v] of Object.entries(p)) {
                            if (validPerfCols.has(k)) clean[k] = v;
                        }
                        return clean;
                    });
                    const { error: pErr } = await supabase.from('performances').upsert(cleanPerfs);
                    addLog('Performances: ' + (pErr ? 'FAIL - ' + pErr.message : cleanPerfs.length + ' OK'));
                }

                // Verification
                addLog('--- CLOUD VERIFICATION ---');
                for (const t of tables) {
                    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
                    addLog('Cloud ' + t + ': ' + count);
                }

                addLog('DONE! Refresh VA dashboard on phone now.');
            } catch (err) {
                addLog('FATAL: ' + err.message);
                console.error(err);
            }
            setDone(true);
        }
        run();
    }, []);

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#0f1115', color: '#e5e7eb', fontFamily: 'monospace', padding: '24px' }}>
            <h1 style={{ color: '#6366f1', marginBottom: '16px' }}>Force Sync</h1>
            <p style={{ color: '#9ca3af', marginBottom: '24px' }}>Pushing local data to Supabase...</p>
            <div style={{ backgroundColor: '#1a1d24', padding: '16px', borderRadius: '8px', border: '1px solid #2d313a', maxHeight: '80vh', overflowY: 'auto' }}>
                {log.map((line, i) => (
                    <div key={i} style={{ marginBottom: '4px', fontSize: '0.85rem', color: line.includes('ERROR') || line.includes('FAIL') || line.includes('FATAL') ? '#ef4444' : line.includes('DONE') || line.includes('OK') ? '#10b981' : '#e5e7eb' }}>
                        {line}
                    </div>
                ))}
                {!done && <div style={{ color: '#fbbf24', marginTop: '8px' }}>Running...</div>}
            </div>
        </div>
    );
}
