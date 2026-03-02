import React, { useEffect, useRef } from 'react';
import { CloudSyncService, SettingsService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const cycleRef = useRef(false);
    const tgCheckRef = useRef(false);
    const threadsPatrolRef = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const checkTelegramAutoSend = async () => {
            if (tgCheckRef.current) return;
            tgCheckRef.current = true;
            try {
                const settings = await SettingsService.getSettings();
                const token = (settings.telegramBotToken || '').trim();
                const chatId = (settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastTelegramReportDate === today) return;

                console.log('[CloudSync] Auto-sending Telegram daily report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendDailyReport();
                if (result.sent) {
                    await SettingsService.updateSetting('lastTelegramReportDate', today);
                    console.log('[CloudSync] Telegram report sent for', today);
                } else {
                    console.warn('[CloudSync] Telegram report not sent:', result.reason);
                }
            } catch (err) {
                console.error('[CloudSync] Telegram auto-send failed:', err);
            } finally {
                tgCheckRef.current = false;
            }
        };

        const runThreadsPatrol = async () => {
            if (threadsPatrolRef.current) return;
            threadsPatrolRef.current = true;
            const gotLock = await CloudSyncService.acquireLock();
            if (!gotLock) {
                threadsPatrolRef.current = false;
                return;
            }
            try {
                const { ThreadsHealthService } = await import('../services/growthEngine');
                const result = await ThreadsHealthService.runPatrol();
                console.log('[ThreadsPatrol] Patrol result:', result);
            } catch (err) {
                console.error('[ThreadsPatrol] Patrol failed:', err);
            } finally {
                CloudSyncService.releaseLock();
                threadsPatrolRef.current = false;
            }
        };

        const runCycle = async () => {
            if (cycleRef.current) return;
            cycleRef.current = true;
            // Acquire lock — skip if a manual sync (Dashboard "Sync All") is running
            const gotLock = await CloudSyncService.acquireLock();
            if (!gotLock) {
                cycleRef.current = false;
                return;
            }
            try {
                const enabled = await CloudSyncService.isEnabled();
                if (!enabled) return;
                console.log('[CloudSync] Running ordered push->pull cycle...');
                await CloudSyncService.pushLocalToCloud();
                await CloudSyncService.pullCloudToLocal();
            } catch (err) {
                console.error('[CloudSync] Cycle failed:', err);
            } finally {
                CloudSyncService.releaseLock();
                cycleRef.current = false;
            }

            // Check Telegram auto-send after each sync cycle (outside lock)
            checkTelegramAutoSend();
        };

        runCycle();

        const onFocus = () => runCycle();
        const onVisible = () => {
            if (document.visibilityState === 'visible') runCycle();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);

        const cycleIntervalId = setInterval(runCycle, 30000);

        // Threads Health Patrol: 2-min startup delay, then configurable interval (default 15 min)
        let threadsPatrolIntervalId = null;
        const threadsStartupTimeout = setTimeout(async () => {
            // Run first patrol
            runThreadsPatrol();
            // Set up recurring interval
            const settings = await SettingsService.getSettings();
            const intervalMin = Math.max(5, Math.min(120, Number(settings.threadsPatrolIntervalMinutes) || 15));
            threadsPatrolIntervalId = setInterval(runThreadsPatrol, intervalMin * 60 * 1000);
        }, 2 * 60 * 1000);

        return () => {
            clearInterval(cycleIntervalId);
            clearTimeout(threadsStartupTimeout);
            if (threadsPatrolIntervalId) clearInterval(threadsPatrolIntervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null; // Invisible background worker
}
