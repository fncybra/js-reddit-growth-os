import React, { useEffect, useRef } from 'react';
import { CloudSyncService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const syncingRef = useRef(false);

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

        const safeSync = async () => {
            try {
                await sync();
            } catch (err) {
                syncingRef.current = false;
                console.error('[CloudSync] Pull failed:', err);
            }
        };

        safeSync();

        const onFocus = () => safeSync();
        const onVisible = () => {
            if (document.visibilityState === 'visible') safeSync();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);

        const intervalId = setInterval(safeSync, 30000);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null; // Invisible background worker
}
