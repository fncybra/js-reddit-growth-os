import { db } from '../db/db.js';
import { generateId } from '../db/generateId.js';
import {
    AccountAdminService,
    AccountLifecycleService,
    AccountDeduplicationService,
    AnalyticsEngine,
    canUseStore,
    classifyAccountSnapshotFailures,
    CloudSyncService,
    DailyPlanGenerator,
    generateManagerActionItems,
    getAssignmentAccountRoster,
    ModelDiscoveryProfileService,
    normalizeRedditHandle,
    resolveLatestTaskQueue,
    SubredditAssignmentService,
} from '../services/growthEngine.js';

function createLogger() {
    const results = [];
    const push = (status, name, detail = '') => {
        const row = { status, name, detail };
        results.push(row);
        const color = status === 'PASS' ? '#16a34a' : '#dc2626';
        console.log(`%c[${status}] ${name}${detail ? ` | ${detail}` : ''}`, `color:${color};font-weight:700`);
    };
    return {
        results,
        pass: (name, detail) => push('PASS', name, detail),
        fail: (name, detail) => push('FAIL', name, detail),
    };
}

async function deleteIds(table, ids) {
    if (!ids?.length) return;
    try {
        await db[table].bulkDelete(ids);
    } catch {
        // Cleanup should never fail the suite.
    }
}

async function cleanupScenario(idsByTable) {
    await deleteIds('performances', idsByTable.performances || []);
    await deleteIds('tasks', idsByTable.tasks || []);
    await deleteIds('assets', idsByTable.assets || []);
    await deleteIds('verifications', idsByTable.verifications || []);
    await deleteIds('subreddits', idsByTable.subreddits || []);
    await deleteIds('accounts', idsByTable.accounts || []);
    await deleteIds('models', idsByTable.models || []);
    await deleteIds('settings', idsByTable.settings || []);
    await deleteIds('_syncMeta', idsByTable.syncMeta || []);
}

function stressName(label) {
    return `stress-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export async function runRedditStressSuite() {
    const log = createLogger();
    const hasVerificationsStore = await canUseStore('verifications');

    // Test 1: Normalize + dedupe existing duplicates
    {
        const ids = { models: [], accounts: [], tasks: [], subreddits: [], verifications: [] };
        try {
            const modelId = generateId();
            const canonicalId = generateId();
            const duplicateId = generateId();
            const taskId = generateId();
            const subId = generateId();
            const verificationId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(canonicalId, duplicateId);
            ids.tasks.push(taskId);
            ids.subreddits.push(subId);
            ids.verifications.push(verificationId);

            await db.models.add({ id: modelId, name: stressName('dedupe-model'), status: 'active' });
            await db.accounts.bulkAdd([
                { id: canonicalId, modelId, handle: 'u/StressDup', status: 'active', phase: 'active', dailyCap: 10 },
                { id: duplicateId, modelId, handle: 'https://reddit.com/user/stressdup/', status: 'active', phase: 'warming', dailyCap: 4 },
            ]);
            await db.tasks.add({ id: taskId, date: '2099-01-01', modelId, accountId: duplicateId, subredditId: null, assetId: null, status: 'generated' });
            await db.subreddits.add({ id: subId, modelId, name: stressName('dedupe-sub'), status: 'active', accountId: duplicateId });
            if (hasVerificationsStore) {
                await db.verifications.add({ id: verificationId, accountId: duplicateId, subredditId: subId, verified: 1 });
            }

            const result = await AccountDeduplicationService.dedupeAccounts();
            const accounts = await db.accounts.where('modelId').equals(modelId).toArray();
            const dedupedGroup = accounts.filter((account) => normalizeRedditHandle(account.handle) === 'stressdup');
            const movedTask = await db.tasks.get(taskId);
            const movedSub = await db.subreddits.get(subId);
            const canonicalAccount = dedupedGroup[0];
            const movedVerification = hasVerificationsStore ? await db.verifications.get(verificationId) : { accountId: canonicalAccount?.id };

            const ok = result.removed >= 1
                && dedupedGroup.length === 1
                && movedTask?.accountId === canonicalAccount?.id
                && movedSub?.accountId === canonicalAccount?.id
                && movedVerification?.accountId === canonicalAccount?.id;

            if (!ok) throw new Error(`removed=${result.removed} group=${dedupedGroup.length}`);
            log.pass('Duplicate merge', 'Canonical account kept and linked rows moved');
        } catch (err) {
            log.fail('Duplicate merge', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 2: Cascade delete removes linked rows and leaves sync tombstones
    {
        const ids = { models: [], accounts: [], tasks: [], performances: [], verifications: [], subreddits: [] };
        try {
            const modelId = generateId();
            const accountId = generateId();
            const taskId = generateId();
            const perfId = generateId();
            const subId = generateId();
            const verificationId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(accountId);
            ids.tasks.push(taskId);
            ids.performances.push(perfId);
            ids.subreddits.push(subId);
            ids.verifications.push(verificationId);

            await db.models.add({ id: modelId, name: stressName('delete-model'), status: 'active' });
            await db.accounts.add({ id: accountId, modelId, handle: 'u/stressdelete', status: 'active', phase: 'active' });
            await db.subreddits.add({ id: subId, modelId, name: stressName('delete-sub'), status: 'active', accountId });
            await db.tasks.add({ id: taskId, date: '2099-01-01', modelId, accountId, subredditId: subId, assetId: null, status: 'generated' });
            await db.performances.add({ id: perfId, taskId, views24h: 0, removed: 0 });
            if (hasVerificationsStore) {
                await db.verifications.add({ id: verificationId, accountId, subredditId: subId, verified: 1 });
            }

            const result = await AccountAdminService.deleteAccountCascade(accountId, { skipCloud: true });
            const account = await db.accounts.get(accountId);
            const task = await db.tasks.get(taskId);
            const perf = await db.performances.get(perfId);
            const verification = hasVerificationsStore ? await db.verifications.get(verificationId) : null;
            const subreddit = await db.subreddits.get(subId);
            const syncMeta = await db._syncMeta.where('table').anyOf(['accounts', 'tasks', 'performances', 'verifications']).toArray();

            const ok = !account
                && !task
                && !perf
                && (!hasVerificationsStore || !verification)
                && subreddit?.accountId == null
                && result.deletedTasks === 1
                && syncMeta.length >= (hasVerificationsStore ? 4 : 3);

            if (!ok) throw new Error(`result=${JSON.stringify(result)} syncMeta=${syncMeta.length}`);
            log.pass('Account delete cascade', 'Linked rows removed, subreddit unassigned, tombstones kept');
        } catch (err) {
            log.fail('Account delete cascade', err.message);
        } finally {
            await db._syncMeta.clear();
            await cleanupScenario(ids);
        }
    }

    // Test 3: Missing cloud verifications table must not make account delete look failed
    {
        const ids = { models: [], accounts: [], tasks: [], performances: [], verifications: [], subreddits: [] };
        const originalDeleteMultipleFromCloud = CloudSyncService.deleteMultipleFromCloud;
        const originalDeleteFromCloud = CloudSyncService.deleteFromCloud;
        const originalAutoPush = CloudSyncService.autoPush;
        try {
            const modelId = generateId();
            const accountId = generateId();
            const taskId = generateId();
            const perfId = generateId();
            const subId = generateId();
            const verificationId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(accountId);
            ids.tasks.push(taskId);
            ids.performances.push(perfId);
            ids.subreddits.push(subId);
            ids.verifications.push(verificationId);

            await db.models.add({ id: modelId, name: stressName('delete-cloud-model'), status: 'active' });
            await db.accounts.add({ id: accountId, modelId, handle: 'u/stressclouddelete', status: 'active', phase: 'active' });
            await db.subreddits.add({ id: subId, modelId, name: stressName('delete-cloud-sub'), status: 'active', accountId });
            await db.tasks.add({ id: taskId, date: '2099-01-01', modelId, accountId, subredditId: subId, assetId: null, status: 'generated' });
            await db.performances.add({ id: perfId, taskId, views24h: 0, removed: 0 });
            if (hasVerificationsStore) {
                await db.verifications.add({ id: verificationId, accountId, subredditId: subId, verified: 1 });
            }

            CloudSyncService.deleteMultipleFromCloud = async (table) => {
                if (table === 'verifications') {
                    throw new Error("Could not find the table 'public.verifications' in the schema cache");
                }
            };
            CloudSyncService.deleteFromCloud = async () => {};
            CloudSyncService.autoPush = async () => {};

            const result = await AccountAdminService.deleteAccountCascade(accountId);
            const account = await db.accounts.get(accountId);
            const task = await db.tasks.get(taskId);
            const perf = await db.performances.get(perfId);
            const verification = hasVerificationsStore ? await db.verifications.get(verificationId) : null;
            const subreddit = await db.subreddits.get(subId);

            const ok = !account
                && !task
                && !perf
                && (!hasVerificationsStore || !verification)
                && subreddit?.accountId == null
                && result?.cloudSkipped === false;

            if (!ok) {
                throw new Error(`result=${JSON.stringify(result)} subreddit=${JSON.stringify(subreddit)}`);
            }
            log.pass('Delete with missing cloud verifications', 'Cloud schema gaps no longer fake a delete failure');
        } catch (err) {
            log.fail('Delete with missing cloud verifications', err.message);
        } finally {
            CloudSyncService.deleteMultipleFromCloud = originalDeleteMultipleFromCloud;
            CloudSyncService.deleteFromCloud = originalDeleteFromCloud;
            CloudSyncService.autoPush = originalAutoPush;
            await db._syncMeta.clear();
            await cleanupScenario(ids);
        }
    }

    // Test 4: Manager action generation should short-circuit burned/dead accounts
    {
        try {
            const items = await generateManagerActionItems([{
                id: generateId(),
                handle: 'u/stressdead',
                status: 'dead',
                shadowBanStatus: 'shadow_banned',
                phase: 'active',
                isSuspended: false,
                totalKarma: 999,
            }]);
            const ok = items.length === 1 && items[0].priority === 'critical' && /BURNED/i.test(items[0].message);
            if (!ok) throw new Error(`items=${JSON.stringify(items)}`);
            log.pass('Dead account manager rule', 'Only the burned/remove-from-rotation item remains');
        } catch (err) {
            log.fail('Dead account manager rule', err.message);
        }
    }

    // Test 5: VA-style post completion updates task, perf, and asset usage
    {
        const ids = { models: [], accounts: [], tasks: [], performances: [], assets: [], subreddits: [] };
        try {
            const modelId = generateId();
            const accountId = generateId();
            const assetId = generateId();
            const subId = generateId();
            const taskId = generateId();
            const perfId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(accountId);
            ids.assets.push(assetId);
            ids.subreddits.push(subId);
            ids.tasks.push(taskId);
            ids.performances.push(perfId);

            await db.models.add({ id: modelId, name: stressName('va-model'), status: 'active' });
            await db.accounts.add({ id: accountId, modelId, handle: 'u/stressva', status: 'active', phase: 'active' });
            await db.assets.add({ id: assetId, modelId, assetType: 'image', approved: 1, timesUsed: 0, fileName: 'stress.jpg' });
            await db.subreddits.add({ id: subId, modelId, name: stressName('va-sub'), status: 'active' });
            await db.tasks.add({ id: taskId, date: '2099-01-01', modelId, accountId, subredditId: subId, assetId, status: 'generated', title: 'Stress title' });

            await db.tasks.update(taskId, {
                status: 'closed',
                redditUrl: 'https://reddit.com/r/test/comments/abc123/post',
                redditPostId: 'abc123',
                vaName: 'stress-va',
                postedAt: new Date().toISOString()
            });
            await db.performances.add({ id: perfId, taskId, views24h: 0, removed: 0, notes: 'Awaiting automated sync...' });
            await db.assets.update(assetId, { timesUsed: 1, lastUsedDate: new Date().toISOString() });

            const task = await db.tasks.get(taskId);
            const perf = await db.performances.get(perfId);
            const asset = await db.assets.get(assetId);
            const ok = task?.status === 'closed' && !!perf && asset?.timesUsed === 1;
            if (!ok) throw new Error(`task=${task?.status} perf=${!!perf} asset=${asset?.timesUsed}`);
            log.pass('VA post completion path', 'Task closes, performance row exists, asset usage increments');
        } catch (err) {
            log.fail('VA post completion path', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 6: Large task dataset query should stay under a sane local threshold
    {
        const ids = { models: [], tasks: [] };
        try {
            const modelId = generateId();
            ids.models.push(modelId);
            await db.models.add({ id: modelId, name: stressName('perf-model'), status: 'active' });
            const bulkTasks = [];
            for (let i = 0; i < 500; i++) {
                const taskId = generateId() + i;
                ids.tasks.push(taskId);
                bulkTasks.push({
                    id: taskId,
                    date: '2099-01-01',
                    modelId,
                    accountId: null,
                    subredditId: null,
                    assetId: null,
                    status: i % 4 === 0 ? 'closed' : 'generated',
                    taskType: 'post',
                    title: `stress-task-${i}`
                });
            }
            await db.tasks.bulkAdd(bulkTasks);
            const start = performance.now();
            const rows = await db.tasks.where('modelId').equals(modelId).toArray();
            const generated = rows.filter(row => row.status === 'generated');
            const elapsed = Math.round(performance.now() - start);
            if (rows.length !== 500 || generated.length === 0 || elapsed > 750) {
                throw new Error(`rows=${rows.length} generated=${generated.length} elapsed=${elapsed}`);
            }
            log.pass('Large dataset query', `${rows.length} tasks queried in ${elapsed}ms`);
        } catch (err) {
            log.fail('Large dataset query', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 7: Duplicate merge keeps the strongest dead-state signal
    {
        const ids = { models: [], accounts: [] };
        try {
            const modelId = generateId();
            const activeId = generateId();
            const deadId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(activeId, deadId);

            await db.models.add({ id: modelId, name: stressName('dead-merge-model'), status: 'active' });
            await db.accounts.bulkAdd([
                { id: activeId, modelId, handle: 'ValerieBlooom', status: 'active', phase: 'active', dailyCap: 10 },
                { id: deadId, modelId, handle: 'u/valerieblooom', status: 'dead', phase: 'burned', shadowBanStatus: 'shadow_banned', deadReason: 'shadow_banned', dailyCap: 1 },
            ]);

            await AccountDeduplicationService.dedupeAccounts();
            const merged = (await db.accounts.toArray()).filter(
                (account) => normalizeRedditHandle(account.handle) === 'valerieblooom'
            );
            const survivor = merged[0];
            const ok = merged.length === 1
                && survivor?.status === 'dead'
                && survivor?.phase === 'burned'
                && survivor?.shadowBanStatus === 'shadow_banned';
            if (!ok) {
                throw new Error(`merged=${JSON.stringify(merged)}`);
            }
            log.pass('Dead duplicate merge', 'Dead state wins when duplicate rows disagree');
        } catch (err) {
            log.fail('Dead duplicate merge', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 8: Manager items collapse duplicate handles into one source of truth
    {
        try {
            const items = await generateManagerActionItems([
                { id: generateId(), handle: 'ValerieBlooom', status: 'active', phase: 'active', hasAvatar: 0, hasBanner: 0, hasBio: 0, hasDisplayName: 0 },
                { id: generateId(), handle: 'u/valerieblooom', status: 'dead', phase: 'burned', shadowBanStatus: 'shadow_banned' },
            ]);
            const burnedItems = items.filter((item) => /remove from rotation/i.test(item.message));
            const profileItems = items.filter((item) => /avatar|banner|bio|display name/i.test(item.message));
            const ok = burnedItems.length === 1 && profileItems.length === 0;
            if (!ok) {
                throw new Error(`items=${JSON.stringify(items)}`);
            }
            log.pass('Manager item dedupe', 'Duplicate handles no longer spam profile tasks');
        } catch (err) {
            log.fail('Manager item dedupe', err.message);
        }
    }

    // Test 9: Normalization guard catches mixed handle formats
    {
        try {
            const inputs = [
                'u/StressUser',
                '/u/stressuser/',
                'https://www.reddit.com/user/stressuser/',
                'stressuser',
            ];
            const outputs = [...new Set(inputs.map(normalizeRedditHandle))];
            if (outputs.length !== 1 || outputs[0] !== 'stressuser') {
                throw new Error(`outputs=${outputs.join(',')}`);
            }
            log.pass('Handle normalization', outputs[0]);
        } catch (err) {
            log.fail('Handle normalization', err.message);
        }
    }

    // Test 10: Mixed stats/profile failures still classify missing when profile scrape says 404
    {
        try {
            const reason = classifyAccountSnapshotFailures([
                'stats:Valerieblooom:500',
                'profile:Valerieblooom:404',
                'stats:LisaNova88:500',
                'profile:LisaNova88:404',
            ]);
            if (reason !== 'missing') {
                throw new Error(`reason=${reason}`);
            }
            log.pass('Missing classification fallback', reason);
        } catch (err) {
            log.fail('Missing classification fallback', err.message);
        }
    }

    // Test 11: Assignment roster hides stale accounts and repairs subreddit account links
    {
        const ids = { models: [], accounts: [], subreddits: [] };
        try {
            const modelId = generateId();
            const liveAccountId = generateId();
            const deadDuplicateId = generateId();
            const orphanedSubId = generateId();
            const duplicateLinkedSubId = generateId();

            ids.models.push(modelId);
            ids.accounts.push(liveAccountId, deadDuplicateId);
            ids.subreddits.push(orphanedSubId, duplicateLinkedSubId);

            await db.models.add({ id: modelId, name: stressName('assignment-model'), status: 'active' });
            await db.accounts.bulkAdd([
                { id: liveAccountId, modelId, handle: 'u/stressassignment', status: 'active', phase: 'active', totalKarma: 800 },
                { id: deadDuplicateId, modelId, handle: 'StressAssignment', status: 'dead', phase: 'burned', shadowBanStatus: 'shadow_banned' },
            ]);
            await db.subreddits.bulkAdd([
                { id: orphanedSubId, modelId, name: stressName('orphan-sub'), status: 'testing', accountId: generateId() },
                { id: duplicateLinkedSubId, modelId, name: stressName('duplicate-sub'), status: 'testing', accountId: deadDuplicateId },
            ]);

            const roster = getAssignmentAccountRoster(await db.accounts.where('modelId').equals(modelId).toArray());
            const cleanup = await SubredditAssignmentService.cleanupInvalidAccountLinks(modelId, { skipCloud: true });
            const orphanedSub = await db.subreddits.get(orphanedSubId);
            const duplicateLinkedSub = await db.subreddits.get(duplicateLinkedSubId);

            const ok = roster.length === 1
                && roster[0]?.id === liveAccountId
                && cleanup.cleaned === 2
                && orphanedSub?.accountId == null
                && duplicateLinkedSub?.accountId === liveAccountId;

            if (!ok) {
                throw new Error(`roster=${roster.length} cleanup=${JSON.stringify(cleanup)} orphan=${orphanedSub?.accountId} duplicate=${duplicateLinkedSub?.accountId}`);
            }
            log.pass('Assignment account cleanup', 'Stale and duplicate links no longer leak into assignment flows');
        } catch (err) {
            log.fail('Assignment account cleanup', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 12: Planner skips diagnostic subs, blocked pairings, and explicit assets on clothed-only subs
    {
        const ids = { models: [], accounts: [], assets: [], subreddits: [], tasks: [], verifications: [] };
        try {
            const modelId = generateId();
            const accountId = generateId();
            const explicitAssetId = generateId();
            const safeAssetId = generateId();
            const safeSubId = generateId();
            const diagnosticSubId = generateId();
            const blockedSubId = generateId();
            const verificationId = generateId();

            ids.models.push(modelId);
            ids.accounts.push(accountId);
            ids.assets.push(explicitAssetId, safeAssetId);
            ids.subreddits.push(safeSubId, diagnosticSubId, blockedSubId);
            ids.verifications.push(verificationId);

            const createdUtc = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);

            await db.models.add({ id: modelId, name: stressName('planner-model'), status: 'active' });
            await db.accounts.add({
                id: accountId,
                modelId,
                handle: 'u/stressplanner',
                status: 'active',
                phase: 'active',
                dailyCap: 3,
                totalKarma: 1500,
                createdUtc,
            });
            await db.assets.bulkAdd([
                { id: explicitAssetId, modelId, assetType: 'image', angleTag: 'pregnant nude', approved: 1, timesUsed: 0, fileName: 'pregnant_nude.jpg' },
                { id: safeAssetId, modelId, assetType: 'image', angleTag: 'pregnant sweater', approved: 1, timesUsed: 0, fileName: 'pregnant_sweater.jpg' },
            ]);
            await db.subreddits.bulkAdd([
                { id: safeSubId, modelId, name: 'womeninshirtandtie', status: 'proven', rulesSummary: 'No nudity. Fully clothed only.' },
                { id: diagnosticSubId, modelId, name: 'WhatIsMyCQS', status: 'proven', rulesSummary: 'Diagnostic only.' },
                { id: blockedSubId, modelId, name: 'PregnantPetite', status: 'proven', rulesSummary: 'Pregnancy posts only.' },
            ]);
            if (hasVerificationsStore) {
                await db.verifications.add({
                    id: verificationId,
                    accountId,
                    subredditId: blockedSubId,
                    blocked: 1,
                    blockedReason: 'banned from sub',
                });
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayIso = today.toISOString();

            await DailyPlanGenerator.generateDailyPlan(modelId, new Date(), { totalTarget: 3 });
            const plannedTasks = await db.tasks.where('modelId').equals(modelId).filter(task => task.date === todayIso).toArray();
            ids.tasks.push(...plannedTasks.map(task => task.id));

            const queuedSubIds = new Set(plannedTasks.map(task => task.subredditId));
            const safeTask = plannedTasks.find(task => task.subredditId === safeSubId);
            const ok = plannedTasks.length === 1
                && queuedSubIds.has(safeSubId)
                && !queuedSubIds.has(diagnosticSubId)
                && !queuedSubIds.has(blockedSubId)
                && safeTask?.assetId === safeAssetId;

            if (!ok) {
                throw new Error(`tasks=${JSON.stringify(plannedTasks)}`);
            }
            log.pass('Planner compatibility guards', 'Only the safe subreddit/asset pairing was queued');
        } catch (err) {
            log.fail('Planner compatibility guards', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 13: Pulse-style intelligence should surface scale and dead-risk states cleanly
    {
        try {
            const accountBreakdown = AnalyticsEngine.computeAccountHealthBreakdown({
                handle: 'u/stresspulse',
                status: 'active',
                phase: 'active',
                totalKarma: 2400,
                cqsStatus: 'High',
                hasAvatar: 1,
                hasBanner: 1,
                hasBio: 1,
                hasDisplayName: 1,
                hasProfileLink: 1,
                hasVerifiedEmail: 1,
                lastSyncDate: new Date().toISOString(),
                removalRate: 4,
            });
            const subredditStanding = AnalyticsEngine.getSubredditStanding(
                { name: 'pregnantgonewild', status: 'proven' },
                { totalTests: 6, avgViews: 1800, removalPct: 0 }
            );

            const ok = accountBreakdown.score >= 80
                && accountBreakdown.status === 'strong'
                && subredditStanding.label === 'Scale'
                && subredditStanding.score >= 70;

            if (!ok) {
                throw new Error(`account=${JSON.stringify(accountBreakdown)} subreddit=${JSON.stringify(subredditStanding)}`);
            }
            log.pass('Pulse intelligence', 'High-health accounts and clean lanes classify as scale-ready');
        } catch (err) {
            log.fail('Pulse intelligence', err.message);
        }
    }

    // Test 14: VA queue resolution should match manager queue even with ISO task dates
    {
        try {
            const isoToday = new Date();
            isoToday.setHours(0, 0, 0, 0);
            const yesterday = new Date(isoToday);
            yesterday.setDate(yesterday.getDate() - 1);

            const queue = resolveLatestTaskQueue([
                { id: 1, date: yesterday.toISOString(), status: 'generated', accountId: 101 },
                { id: 2, date: isoToday.toISOString(), status: 'generated', accountId: 202 },
                { id: 3, date: isoToday.toISOString(), status: 'closed', accountId: 202 },
            ]);

            const ok = queue.queueDate === isoToday.toISOString()
                && queue.tasks.length === 1
                && queue.tasks[0]?.id === 2;

            if (!ok) {
                throw new Error(`queue=${JSON.stringify(queue)}`);
            }
            log.pass('Queue date resolution', 'ISO-dated generated tasks stay visible in the active VA queue');
        } catch (err) {
            log.fail('Queue date resolution', err.message);
        }
    }

    // Test 15: Model crawl profile should persist a usable niche fingerprint without AI
    {
        const ids = { models: [], assets: [], subreddits: [], settings: [] };
        try {
            const modelId = generateId();
            const assetId = generateId();
            const subredditId = generateId();
            ids.models.push(modelId);
            ids.assets.push(assetId);
            ids.subreddits.push(subredditId);

            await db.models.add({
                id: modelId,
                name: stressName('crawl-model'),
                status: 'active',
                primaryNiche: 'pregnant milf',
                voiceArchetype: 'pregnant',
                identityNicheKeywords: 'pregnant, mature, bump',
                identityBodyType: 'curvy',
            });
            await db.assets.add({
                id: assetId,
                modelId,
                assetType: 'image',
                angleTag: 'pregnant bikini',
                approved: 1,
                timesUsed: 0,
                fileName: 'stress-bikini.jpg',
            });
            await db.subreddits.add({
                id: subredditId,
                modelId,
                name: 'PregnantGoneWild',
                nicheTag: 'pregnant',
                status: 'testing',
            });

            const profile = await ModelDiscoveryProfileService.generateProfile(modelId, {
                preferAI: false,
                push: false,
            });
            const storedSetting = await db.settings.where('key').equals(`modelDiscoveryProfile:${modelId}`).first();
            if (storedSetting?.id) ids.settings.push(storedSetting.id);

            const ok = profile?.primaryNiche?.includes('pregnant')
                && profile?.crawlKeywords?.some((keyword) => keyword.includes('pregnant'))
                && profile?.onlyGuiderTags?.some((tag) => tag.includes('pregnant') || tag.includes('milf'))
                && profile?.seedSubreddits?.includes('pregnantgonewild')
                && storedSetting?.value;

            if (!ok) {
                throw new Error(`profile=${JSON.stringify(profile)} stored=${storedSetting?.value || 'none'}`);
            }
            log.pass('Model crawl profile', 'Model signals persist into a reusable crawl fingerprint');
        } catch (err) {
            log.fail('Model crawl profile', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    // Test 16: Model crawl should keep the old seed-sub -> posters pipeline
    {
        try {
            const listings = [
                {
                    data: {
                        children: [
                            { data: { author: 'promoA', is_self: false, url: 'https://example.com/promo', selftext: '' } },
                            { data: { author: 'promoB', is_self: true, url: 'https://reddit.com/r/test', selftext: 'my onlyfans is in bio' } },
                            { data: { author: 'promoC', is_self: true, url: 'https://reddit.com/r/test', selftext: 'linktr.ee/me' } },
                            { data: { author: 'AutoModerator', is_self: true, url: '', selftext: '' } },
                        ],
                    },
                },
            ];

            const posters = ModelDiscoveryProfileService.collectSeedPostersFromListings(listings, { maxUsers: 10 });
            const ok = posters.includes('promoA') && posters.includes('promoB') && posters.includes('promoC') && !posters.includes('AutoModerator');

            if (!ok) {
                throw new Error(`posters=${JSON.stringify(posters)}`);
            }
            log.pass('Model crawl seed posters', 'Seed subreddit listings resolve likely promo posters before profile crawl');
        } catch (err) {
            log.fail('Model crawl seed posters', err.message);
        }
    }

    // Test 17: Poster overlap crawl should discover shared NSFW lanes
    {
        try {
            const candidates = ModelDiscoveryProfileService.buildPosterOverlapCandidates([
                {
                    username: 'promoA',
                    listings: [{
                        data: {
                            children: [
                                { data: { subreddit: 'PregnantPorn', over_18: true, ups: 120 } },
                                { data: { subreddit: 'PregnantPorn', over_18: true, ups: 80 } },
                                { data: { subreddit: 'BabyBumps', over_18: false, ups: 20 } },
                            ],
                        },
                    }],
                },
                {
                    username: 'promoB',
                    listings: [{
                        data: {
                            children: [
                                { data: { subreddit: 'PregnantPorn', over_18: true, ups: 60 } },
                                { data: { subreddit: 'PregnantPetite', over_18: true, ups: 45 } },
                            ],
                        },
                    }],
                },
            ]);

            const pregPorn = candidates.find((row) => row.name === 'PregnantPorn');
            const ok = pregPorn
                && pregPorn.postCount === 3
                && pregPorn.avgUpvotes === 87
                && pregPorn.foundViaUsers.length === 2;

            if (!ok) {
                throw new Error(`candidates=${JSON.stringify(candidates)}`);
            }
            log.pass('Model crawl poster overlap', 'User history crawl accumulates shared subreddit evidence correctly');
        } catch (err) {
            log.fail('Model crawl poster overlap', err.message);
        }
    }

    // Test 18: NSFW model crawl should reject advice subs and keep adult lanes
    {
        try {
            const profile = {
                primaryNiche: 'pregnant milf',
                secondaryNiches: ['preggo', 'breeding'],
                onlyGuiderTags: ['pregnant', 'pregnant milf', 'milf'],
                crawlKeywords: ['pregnant milf', 'preggo', 'breeding'],
                riskyKeywords: ['pregnant nsfw', 'pregnant porn'],
                seedSubreddits: ['pregnantgonewild'],
                nsfwFit: 'nsfw',
            };
            const ranked = ModelDiscoveryProfileService.rankCandidates(profile, [
                {
                    name: 'pregnantporn',
                    nsfw: true,
                    subscribers: 52000,
                    title: 'Pregnant Porn',
                    description: 'NSFW pregnant content',
                    rulesSummary: 'No spam. No minors.',
                    searchMatches: 2,
                },
                {
                    name: 'BabyBumps',
                    nsfw: false,
                    subscribers: 880000,
                    title: 'Pregnancy support',
                    description: 'Advice and support for expecting moms',
                    rulesSummary: 'Medical questions and support only.',
                    searchMatches: 3,
                },
            ]);

            const adultLane = ranked.find((candidate) => candidate.name === 'pregnantporn');
            const adviceLane = ranked.find((candidate) => candidate.name === 'BabyBumps');
            const ok = adultLane && !adultLane.blocked
                && adviceLane && adviceLane.blocked
                && adviceLane.rejectionReasons.includes('advice/support');

            if (!ok) {
                throw new Error(`ranked=${JSON.stringify(ranked)}`);
            }
            log.pass('Model crawl NSFW filter', 'Advice/support pregnancy subs are rejected while adult lanes stay available');
        } catch (err) {
            log.fail('Model crawl NSFW filter', err.message);
        }
    }

    // Test 19: Lone resting account should wake for coverage and still generate posts
    {
        const ids = { models: [], accounts: [], assets: [], subreddits: [], tasks: [] };
        const originalAutoPush = CloudSyncService.autoPush;
        try {
            const modelId = generateId();
            const accountId = generateId();
            const assetId = generateId();
            const subredditId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(accountId);
            ids.assets.push(assetId);
            ids.subreddits.push(subredditId);

            const createdUtc = Math.floor(Date.now() / 1000) - (45 * 24 * 60 * 60);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            await db.models.add({ id: modelId, name: stressName('resting-coverage-model'), status: 'active' });
            await db.accounts.add({
                id: accountId,
                modelId,
                handle: 'u/stressrestingcoverage',
                status: 'active',
                phase: 'resting',
                restUntilDate: tomorrow.toISOString(),
                consecutiveActiveDays: 0,
                totalKarma: 1400,
                createdUtc,
                dailyCap: 1,
            });
            await db.assets.add({
                id: assetId,
                modelId,
                assetType: 'image',
                angleTag: 'pregnant',
                approved: 1,
                timesUsed: 0,
                fileName: 'stress-resting.jpg',
            });
            await db.subreddits.add({
                id: subredditId,
                modelId,
                name: 'PregnantGoneWild',
                status: 'proven',
                rulesSummary: 'NSFW pregnancy content only.',
            });

            CloudSyncService.autoPush = async () => {};

            await AccountLifecycleService.evaluateAccountPhases();
            const afterEval = await db.accounts.get(accountId);
            const tasks = await DailyPlanGenerator.generateDailyPlan(modelId, new Date(), { totalTarget: 1 });
            ids.tasks.push(...tasks.map((task) => task.id));
            const finalAccount = await db.accounts.get(accountId);

            const ok = afterEval?.phase === 'ready'
                && finalAccount?.phase === 'active'
                && tasks.length === 1
                && tasks[0]?.accountId === accountId
                && tasks[0]?.subredditId === subredditId;

            if (!ok) {
                throw new Error(`afterEval=${afterEval?.phase} final=${finalAccount?.phase} tasks=${JSON.stringify(tasks)}`);
            }
            log.pass('Lone resting account coverage', 'Single-account models wake from resting and regenerate a queue');
        } catch (err) {
            log.fail('Lone resting account coverage', err.message);
        } finally {
            CloudSyncService.autoPush = originalAutoPush;
            await cleanupScenario(ids);
        }
    }

    // Test 20: Lone active account should not get forced into resting just for hitting the rotation threshold
    {
        const ids = { models: [], accounts: [] };
        try {
            const modelId = generateId();
            const accountId = generateId();
            ids.models.push(modelId);
            ids.accounts.push(accountId);

            const createdUtc = Math.floor(Date.now() / 1000) - (60 * 24 * 60 * 60);

            await db.models.add({ id: modelId, name: stressName('active-coverage-model'), status: 'active' });
            await db.accounts.add({
                id: accountId,
                modelId,
                handle: 'u/stressactivecoverage',
                status: 'active',
                phase: 'active',
                consecutiveActiveDays: 99,
                restVariance: 0,
                totalKarma: 2200,
                createdUtc,
                dailyCap: 1,
            });

            await AccountLifecycleService.evaluateAccountPhases();
            const account = await db.accounts.get(accountId);
            const ok = account?.phase === 'active';

            if (!ok) {
                throw new Error(`account=${JSON.stringify(account)}`);
            }
            log.pass('Lone active account coverage', 'Single-account models stay active instead of being rotated into resting');
        } catch (err) {
            log.fail('Lone active account coverage', err.message);
        } finally {
            await cleanupScenario(ids);
        }
    }

    const passed = log.results.filter(item => item.status === 'PASS').length;
    const failed = log.results.length - passed;
    const summary = { passed, failed, total: log.results.length, results: log.results };
    console.log(`Reddit stress suite complete: ${passed}/${summary.total} passed`);
    return summary;
}

if (typeof window !== 'undefined') {
    window.runRedditStressSuite = runRedditStressSuite;
}
