import Dexie from 'dexie';

export const db = new Dexie('JSRedditGrowthOS');

db.version(7).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId',
    performances: '++id, taskId',
    settings: '++id, key'
});

db.version(8).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId',
    performances: '++id, taskId',
    settings: '++id, key'
});

// v9: shadow-ban detection fields on accounts (shadowBanStatus, lastShadowCheck)
db.version(9).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId',
    performances: '++id, taskId',
    settings: '++id, key'
});

// v10: engagement task types (taskType field on tasks)
db.version(10).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key'
});

// v11: posting stagger — scheduledTime and postedAt on tasks
db.version(11).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key'
});

// v12: verification tracking — which accounts are verified for which subreddits
db.version(12).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key',
    verifications: '++id, accountId, subredditId'
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
