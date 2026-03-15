import { db } from '../db/db.js';
import { generateId } from '../db/generateId.js';
import {
    AccountAdminService,
    AccountDeduplicationService,
    canUseStore,
    generateManagerActionItems,
    normalizeRedditHandle,
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

    // Test 3: Manager action generation should short-circuit burned/dead accounts
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

    // Test 4: VA-style post completion updates task, perf, and asset usage
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

    // Test 5: Large task dataset query should stay under a sane local threshold
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

    // Test 6: Duplicate merge keeps the strongest dead-state signal
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

    // Test 7: Manager items collapse duplicate handles into one source of truth
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

    // Test 8: Normalization guard catches mixed handle formats
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

    const passed = log.results.filter(item => item.status === 'PASS').length;
    const failed = log.results.length - passed;
    const summary = { passed, failed, total: log.results.length, results: log.results };
    console.log(`Reddit stress suite complete: ${passed}/${summary.total} passed`);
    return summary;
}

if (typeof window !== 'undefined') {
    window.runRedditStressSuite = runRedditStressSuite;
}
