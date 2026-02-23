import Dexie from 'dexie';

export const db = new Dexie('JSRedditGrowthOS');

db.version(5).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo',
    accounts: '++id, modelId, handle, status, proxyInfo',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId',
    performances: '++id, taskId',
    settings: '++id, key'
});

// Seed default settings if empty
db.on('populate', async () => {
    await db.settings.bulkAdd([
        { key: 'dailyTestingLimit', value: 3 },
        { key: 'minViewThreshold', value: 500 },
        { key: 'testsBeforeClassification', value: 3 },
        { key: 'removalThresholdPct', value: 20 },
        { key: 'assetReuseCooldownDays', value: 30 },
        { key: 'dailyPostCap', value: 10 },
        { key: 'vaPin', value: '1234' },
        { key: 'supabaseUrl', value: '' },
        { key: 'supabaseAnonKey', value: '' }
    ]);
});
