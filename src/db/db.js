import Dexie from 'dexie';
import { generateId } from './generateId.js';

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

// v13: daily snapshots for trend tracking
db.version(13).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key',
    verifications: '++id, accountId, subredditId',
    dailySnapshots: '++id, date'
});

// v14: persistent competitor tracking
db.version(14).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key',
    verifications: '++id, accountId, subredditId',
    dailySnapshots: '++id, date',
    competitors: '++id, modelId, handle'
});

// v15: collision-proof IDs — all new records use generateId(), but keep ++id
// so Dexie doesn't recreate object stores (which would wipe existing data).
// ++id still accepts explicit IDs when provided; it only auto-increments when omitted.
db.version(15).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key',
    verifications: '++id, accountId, subredditId',
    dailySnapshots: '++id, date',
    competitors: '++id, modelId, handle'
});

// v16: OF Tracker tables (models, VAs, tracking links, bulk imports, link snapshots, daily stats)
db.version(16).stores({
    models: '++id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin',
    accounts: '++id, modelId, handle, status, proxyInfo, phase',
    subreddits: '++id, modelId, name, status, lastTestedDate',
    assets: '++id, modelId, assetType, approved, lastUsedDate, driveFileId, externalUrl',
    tasks: '++id, date, modelId, accountId, subredditId, assetId, status, redditPostId, taskType',
    performances: '++id, taskId',
    settings: '++id, key',
    verifications: '++id, accountId, subredditId',
    dailySnapshots: '++id, date',
    competitors: '++id, modelId, handle',
    ofModels: '++id, name, ofUsername, active',
    ofVas: '++id, name, active',
    ofTrackingLinks: '++id, label, ofModelId, ofVaId, platform, [label+ofModelId]',
    ofBulkImports: '++id, importDate, filename',
    ofLinkSnapshots: '++id, importId, ofModelId, ofVaId, label, sourceCategory, [importId+ofModelId+label]',
    ofDailyStats: '++id, statDate, ofModelId, ofVaId, [statDate+ofModelId+ofVaId]'
});

// Seed default settings if empty
db.on('populate', async () => {
    await db.settings.bulkAdd([
        { id: generateId(), key: 'dailyTestingLimit', value: 3 },
        { id: generateId(), key: 'minViewThreshold', value: 500 },
        { id: generateId(), key: 'testsBeforeClassification', value: 3 },
        { id: generateId(), key: 'removalThresholdPct', value: 20 },
        { id: generateId(), key: 'assetReuseCooldownDays', value: 30 },
        { id: generateId(), key: 'dailyPostCap', value: 10 },
        { id: generateId(), key: 'vaPin', value: '1234' },
        { id: generateId(), key: 'supabaseUrl', value: '' },
        { id: generateId(), key: 'supabaseAnonKey', value: '' }
    ]);
});
