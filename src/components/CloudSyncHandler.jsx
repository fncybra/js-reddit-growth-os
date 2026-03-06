import React, { useEffect, useRef } from 'react';
import { CloudSyncService, SettingsService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const cycleRef = useRef(false);

    // Persistent flags — once a report sends today, never retry until tomorrow
    const redditSentToday = useRef(false);
    const threadsSentToday = useRef(false);
    const ofSentToday = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const checkRedditDailyReport = async () => {
            if (redditSentToday.current) return;
            try {
                const settings = await SettingsService.getSettings();
                if (!settings.redditDailyReportEnabled) return;

                const token = (settings.redditTelegramBotToken || settings.telegramBotToken || '').trim();
                const chatId = (settings.redditTelegramChatId || settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastRedditDailyReportDate === today) {
                    redditSentToday.current = true;
                    return;
                }

                const sendHour = Number(settings.redditDailyReportHour) || 8;
                if (now.getHours() < sendHour) return;

                // Stamp BEFORE sending to prevent duplicate sends from concurrent cycles
                redditSentToday.current = true;
                await SettingsService.updateSetting('lastRedditDailyReportDate', today);

                console.log('[CloudSync] Auto-sending Reddit daily report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendDailyReport();
                if (result.sent) {
                    console.log('[CloudSync] Reddit report sent for', today);
                } else {
                    // Rollback so it retries next cycle
                    redditSentToday.current = false;
                    await SettingsService.updateSetting('lastRedditDailyReportDate', '');
                    console.warn('[CloudSync] Reddit report not sent:', result.reason);
                }
            } catch (err) {
                // Rollback so it retries next cycle
                redditSentToday.current = false;
                try { await SettingsService.updateSetting('lastRedditDailyReportDate', ''); } catch (_) {}
                console.error('[CloudSync] Reddit auto-send failed:', err);
            }
        };

        const checkThreadsDailyReport = async () => {
            if (threadsSentToday.current) return;
            try {
                const settings = await SettingsService.getSettings();
                if (!settings.threadsDailyReportEnabled) return;

                const token = (settings.threadsTelegramBotToken || settings.telegramBotToken || '').trim();
                const chatId = (settings.threadsTelegramChatId || settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                const airtableKey = (settings.airtableApiKey || '').trim();
                const airtableBase = (settings.airtableBaseId || '').trim();
                if (!airtableKey || !airtableBase) return;

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastThreadsDailyReportDate === today) {
                    threadsSentToday.current = true;
                    return;
                }

                const sendHour = Number(settings.threadsDailyReportHour) || 8;
                if (now.getHours() < sendHour) return;

                // Stamp BEFORE sending to prevent duplicate sends from concurrent cycles
                threadsSentToday.current = true;
                await SettingsService.updateSetting('lastThreadsDailyReportDate', today);

                console.log('[CloudSync] Auto-sending Threads daily VA report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendThreadsDailyReport();
                if (result.sent) {
                    console.log('[CloudSync] Threads daily VA report sent for', today);
                } else {
                    threadsSentToday.current = false;
                    await SettingsService.updateSetting('lastThreadsDailyReportDate', '');
                    console.warn('[CloudSync] Threads daily VA report not sent:', result.reason);
                }
            } catch (err) {
                threadsSentToday.current = false;
                try { await SettingsService.updateSetting('lastThreadsDailyReportDate', ''); } catch (_) {}
                console.error('[CloudSync] Threads daily VA report failed:', err);
            }
        };

        const checkOFDailyReport = async () => {
            if (ofSentToday.current) return;
            try {
                const settings = await SettingsService.getSettings();
                if (!settings.ofDailyReportEnabled) return;

                const token = (settings.ofTelegramBotToken || settings.telegramBotToken || '').trim();
                const chatId = (settings.ofTelegramChatId || settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastOFDailyReportDate === today) {
                    ofSentToday.current = true;
                    return;
                }

                const sendHour = Number(settings.ofDailyReportHour) || 20;
                if (now.getHours() < sendHour) return;

                // Stamp BEFORE sending to prevent duplicate sends from concurrent cycles
                ofSentToday.current = true;
                await SettingsService.updateSetting('lastOFDailyReportDate', today);

                console.log('[CloudSync] Auto-sending OF daily report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendOFDailyReport();
                if (result.sent) {
                    console.log('[CloudSync] OF daily report sent for', today);
                } else {
                    ofSentToday.current = false;
                    await SettingsService.updateSetting('lastOFDailyReportDate', '');
                    console.warn('[CloudSync] OF daily report not sent:', result.reason);
                }
            } catch (err) {
                ofSentToday.current = false;
                try { await SettingsService.updateSetting('lastOFDailyReportDate', ''); } catch (_) {}
                console.error('[CloudSync] OF daily report failed:', err);
            }
        };

        const runCycle = async () => {
            if (cycleRef.current) return;
            cycleRef.current = true;
            const gotLock = await CloudSyncService.acquireLock();
            if (!gotLock) {
                cycleRef.current = false;
                return;
            }
            let syncOk = false;
            try {
                const enabled = await CloudSyncService.isEnabled();
                if (!enabled) return;
                console.log('[CloudSync] Running ordered push->pull cycle...');
                await CloudSyncService.pushLocalToCloud();
                await CloudSyncService.pullCloudToLocal();
                syncOk = true;
            } catch (err) {
                console.error('[CloudSync] Cycle failed:', err);
            } finally {
                CloudSyncService.releaseLock();
                cycleRef.current = false;
            }

            // Reports run AFTER sync completes and lock is released
            // so they don't block the next sync cycle with HTTP calls
            if (syncOk) {
                checkRedditDailyReport();
                checkThreadsDailyReport();
                checkOFDailyReport();
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
