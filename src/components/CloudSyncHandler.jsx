import React, { useEffect, useRef } from 'react';
import { CloudSyncService, SettingsService } from '../services/growthEngine';

export function CloudSyncHandler() {
    const hasRun = useRef(false);
    const cycleRef = useRef(false);
    const tgCheckRef = useRef(false);
    const threadsDailyRef = useRef(false);
    const ofDailyRef = useRef(false);

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

        const checkThreadsDailyReport = async () => {
            if (threadsDailyRef.current) return;
            threadsDailyRef.current = true;
            try {
                const settings = await SettingsService.getSettings();
                if (!settings.threadsDailyReportEnabled) return;

                // Need Telegram config (Threads or main)
                const token = (settings.threadsTelegramBotToken || settings.telegramBotToken || '').trim();
                const chatId = (settings.threadsTelegramChatId || settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                // Need Airtable config
                const airtableKey = (settings.airtableApiKey || '').trim();
                const airtableBase = (settings.airtableBaseId || '').trim();
                if (!airtableKey || !airtableBase) return;

                // Already sent today?
                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastThreadsDailyReportDate === today) return;

                // Hour gate
                const sendHour = Number(settings.threadsDailyReportHour) || 8;
                if (now.getHours() < sendHour) return;

                console.log('[CloudSync] Auto-sending Threads daily VA report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendThreadsDailyReport();
                if (result.sent) {
                    await SettingsService.updateSetting('lastThreadsDailyReportDate', today);
                    console.log('[CloudSync] Threads daily VA report sent for', today);
                } else {
                    console.warn('[CloudSync] Threads daily VA report not sent:', result.reason);
                }
            } catch (err) {
                console.error('[CloudSync] Threads daily VA report failed:', err);
            } finally {
                threadsDailyRef.current = false;
            }
        };

        const checkOFDailyReport = async () => {
            if (ofDailyRef.current) return;
            ofDailyRef.current = true;
            try {
                const settings = await SettingsService.getSettings();
                if (!settings.ofDailyReportEnabled) return;

                const token = (settings.ofTelegramBotToken || settings.telegramBotToken || '').trim();
                const chatId = (settings.ofTelegramChatId || settings.telegramChatId || '').trim();
                if (!token || !chatId) return;

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                if (settings.lastOFDailyReportDate === today) return;

                const sendHour = Number(settings.ofDailyReportHour) || 20;
                if (now.getHours() < sendHour) return;

                console.log('[CloudSync] Auto-sending OF daily report...');
                const { TelegramService } = await import('../services/growthEngine');
                const result = await TelegramService.sendOFDailyReport();
                if (result.sent) {
                    await SettingsService.updateSetting('lastOFDailyReportDate', today);
                    console.log('[CloudSync] OF daily report sent for', today);
                } else {
                    console.warn('[CloudSync] OF daily report not sent:', result.reason);
                }
            } catch (err) {
                console.error('[CloudSync] OF daily report failed:', err);
            } finally {
                ofDailyRef.current = false;
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
            } catch (err) {
                console.error('[CloudSync] Cycle failed:', err);
            } finally {
                CloudSyncService.releaseLock();
                cycleRef.current = false;
            }

            // Check Telegram auto-send after each sync cycle (outside lock)
            checkTelegramAutoSend();
            checkThreadsDailyReport();
            checkOFDailyReport();
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
