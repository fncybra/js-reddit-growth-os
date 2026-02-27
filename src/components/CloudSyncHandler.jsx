import React, { useEffect, useRef } from 'react';
import { CloudSyncService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const syncingRef = useRef(false);
    const pushingRef = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        async function sync() {
            if (syncingRef.current) return;
            syncingRef.current = true;
            const enabled = await CloudSyncService.isEnabled();
            if (enabled) {
                console.log("[CloudSync] Background sync starting...");
                // Start with a pull to get latest from other team members
                await CloudSyncService.pullCloudToLocal();
                console.log("[CloudSync] Data ready.");
            }
            syncingRef.current = false;
        }

        async function push() {
            if (pushingRef.current) return;
            pushingRef.current = true;
            const enabled = await CloudSyncService.isEnabled();
            if (enabled) {
                try {
                    await CloudSyncService.pushLocalToCloud();
                } catch (err) {
                    console.error('[CloudSync] Background push failed:', err);
                }
            }
            pushingRef.current = false;
        }

        const safeSync = async () => {
            try {
                await sync();
            } catch (err) {
                syncingRef.current = false;
                console.error('[CloudSync] Pull failed:', err);
            }
        };

        safeSync();
        push();

        const onFocus = () => safeSync();
        const onVisible = () => {
            if (document.visibilityState === 'visible') safeSync();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);

        const pullIntervalId = setInterval(safeSync, 30000);
        const pushIntervalId = setInterval(push, 45000);

        return () => {
            clearInterval(pullIntervalId);
            clearInterval(pushIntervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null; // Invisible background worker
}
