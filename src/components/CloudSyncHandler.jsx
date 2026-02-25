import React, { useEffect, useRef } from 'react';
import { CloudSyncService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        async function sync() {
            const enabled = await CloudSyncService.isEnabled();
            if (enabled) {
                console.log("[CloudSync] Background sync starting...");
                // Start with a pull to get latest from other team members
                await CloudSyncService.pullCloudToLocal();
                console.log("[CloudSync] Data ready.");
            }
        }
        sync();
    }, []);

    return null; // Invisible background worker
}
