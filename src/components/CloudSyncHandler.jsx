import React, { useEffect, useRef } from 'react';
import { CloudSyncService, SettingsService } from '../services/growthEngine';

export function CloudSyncHandler() {
  const hasRun = useRef(false);
  const cycleRef = useRef(false);
  const redditSentToday = useRef(false);

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

        redditSentToday.current = true;
        await SettingsService.updateSetting('lastRedditDailyReportDate', today);

        const { TelegramService } = await import('../services/growthEngine');
        const result = await TelegramService.sendDailyReport();
        if (!result.sent) {
          redditSentToday.current = false;
          await SettingsService.updateSetting('lastRedditDailyReportDate', '');
          console.warn('[CloudSync] Reddit report not sent:', result.reason);
        }
      } catch (err) {
        redditSentToday.current = false;
        try {
          await SettingsService.updateSetting('lastRedditDailyReportDate', '');
        } catch {
          // no-op
        }
        console.error('[CloudSync] Reddit auto-send failed:', err);
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
        await CloudSyncService.pushLocalToCloud();
        await CloudSyncService.pullCloudToLocal();
        syncOk = true;
      } catch (err) {
        console.error('[CloudSync] Cycle failed:', err);
      } finally {
        CloudSyncService.releaseLock();
        cycleRef.current = false;
      }

      if (syncOk) {
        checkRedditDailyReport();
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

  return null;
}
