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
                if (settings.lastTelegramReportDate === today) {
                    redditSentToday.current = true;
                    return;
                }

                const sendHour = Number(settings.redditDailyReportHour) || 8;
                if (now.getHours() < sendHour) return;

                // Stamp BEFORE sending to prevent duplicate sends from concurrent cycles
                redditSentToday.current = true;
                await SettingsService.updateSetting('lastTelegramReportDate', today);

                console.log('[CloudSync] Auto-sending Reddit daily report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendDailyReport();
                if (result.sent) {
                    console.log('[CloudSync] Reddit report sent for', today);
                } else {
                    console.warn('[CloudSync] Reddit report not sent:', result.reason);
                }
            } catch (err) {
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
                    console.warn('[CloudSync] Threads daily VA report not sent:', result.reason);
                }
            } catch (err) {
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
                    console.warn('[CloudSync] OF daily report not sent:', result.reason);
                }
            } catch (err) {
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
            try {
                const enabled = await CloudSyncService.isEnabled();
                if (!enabled) return;
                console.log('[CloudSync] Running ordered push->pull cycle...');
                await CloudSyncService.pushLocalToCloud();
                await CloudSyncService.pullCloudToLocal();

                // Reports run INSIDE the sync block — after pull completes, data is fresh
                await checkRedditDailyReport();
                await checkThreadsDailyReport();
                await checkOFDailyReport();
            } catch (err) {
                console.error('[CloudSync] Cycle failed:', err);
            } finally {
                CloudSyncService.releaseLock();
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
