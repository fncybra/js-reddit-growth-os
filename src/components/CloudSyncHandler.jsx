import React, { useEffect, useRef } from 'react';
import { CloudSyncService, SettingsService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const cycleRef = useRef(false);
    const tgCheckRef = useRef(false);

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

                const sendHour = Number(settings.telegramAutoSendHour) || 20;
                const now = new Date();
                if (now.getHours() < sendHour) return;

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

        return () => {
            clearInterval(cycleIntervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null; // Invisible background worker
}
