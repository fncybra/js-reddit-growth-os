import React, { useEffect, useRef } from 'react';
import { CloudSyncService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const cycleRef = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const runCycle = async () => {
            if (cycleRef.current) return;
            cycleRef.current = true;
            try {
                const enabled = await CloudSyncService.isEnabled();
                if (!enabled) return;
                console.log('[CloudSync] Running ordered push->pull cycle...');
                await CloudSyncService.pushLocalToCloud();
                await CloudSyncService.pullCloudToLocal();
            } catch (err) {
                console.error('[CloudSync] Cycle failed:', err);
            } finally {
                cycleRef.current = false;
            }
        };

        runCycle();

        const onFocus = () => runCycle();
        const onVisible = () => {
            if (document.visibilityState === 'visible') runCycle();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);

        const cycleIntervalId = setInterval(runCycle, 30000);

        return () => {
            clearInterval(cycleIntervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null; // Invisible background worker
}
