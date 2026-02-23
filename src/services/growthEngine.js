import { db } from '../db/db.js';
import { subDays, isAfter, startOfDay } from 'date-fns';

export const SettingsService = {
    async getSettings() {
        const defaultSettings = {
            dailyTestingLimit: 3,
            minViewThreshold: 500,
            testsBeforeClassification: 3,
            removalThresholdPct: 20,
            assetReuseCooldownDays: 30,
            dailyPostCap: 10
        };
        const settingsArr = await db.settings.toArray();
        const settings = { ...defaultSettings };
        settingsArr.forEach(s => { settings[s.key] = s.value; });
        return settings;
    },
    async updateSetting(key, value) {
        const existing = await db.settings.where('key').equals(key).first();
        if (existing) {
            await db.settings.update(existing.id, { value });
        } else {
            await db.settings.add({ key, value });
        }
    },
    async getProxyUrl() {
        const settings = await this.getSettings();
        return settings.proxyUrl || '';
    }
};

import OpenAI from 'openai';

export const TitleGeneratorService = {
    // Scrapes top 50 titles from a subreddit and regenerates a high-quality title conforming to rules
    async generateTitle(subredditName, rulesSummary, requiredFlair, previousTitles = []) {
        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            let topTitles = [];
            // Try fetching from Reddit directly via JSON API (Top of the month)
            try {
                const res = await fetch(`${proxyUrl}/api/scrape/subreddit/top/${subredditName}`);
                if (res.ok) {
                    topTitles = await res.json();
                }
            } catch (e) {
                console.warn(`Could not fetch top titles directly for r/${subredditName}`, e);
            }

            // Fallback list if network/CORS blocks the direct fetch
            if (topTitles.length === 0) {
                topTitles = [
                    "Felt amazing today",
                    "Just a quick snap",
                    "What do you think of this look?",
                    "Morning vibes",
                    "Loving this aesthetic today"
                ];
            }

            // Call OpenAI if the key is available
            const settings = await SettingsService.getSettings();
            if (settings.openaiApiKey) {
                try {
                    const openai = new OpenAI({
                        apiKey: settings.openaiApiKey,
                        dangerouslyAllowBrowser: true // Running explicitly in the browser client for this MVP
                    });

                    const prompt = `
You are an expert Reddit growth optimizer. We are generating a highly engaging short title for the subreddit r/${subredditName}.
Here are the top 50 viral titles from this subreddit this month to learn its exact tone and "vibe": 
${JSON.stringify(topTitles)}

Here are the strict rules for this subreddit you MUST follow: 
${rulesSummary || 'No specific rules provided.'}

${requiredFlair ? `You MUST include this exact flair text inside brackets at the start of the title: [${requiredFlair}]` : ''}

${previousTitles.length > 0 ? `CRITICAL: DO NOT generate any title containing words or themes you have used before. Here is a list of your previously generated titles to AVOID:\n${JSON.stringify(previousTitles.slice(-50))}\n` : ''}

CRITICAL RULES:
1. absolutely NO EMOJIS! Do not use ANY emojis under any circumstances. Emojis will get the post banned on many subreddits.
2. The target subreddit is r/${subredditName}. You MUST infer the core required keywords from this name (e.g. if the sub is 'pregnantpetite', the title must clearly imply or state being pregnant/petite). 
3. Review the strict rules above. If the rules specifically require a certain word (e.g., "[f]" or "pregnant"), you MUST include it natively in the title.
4. Your goal is to recreate something SIMILAR in "vibe" to the viral titles, but completely UNIQUE. Do NOT copy the top titles exactly. Make it feel completely human and authentic (do not sound like a bot, no hashtags).

Output ONLY the resulting title as plain text without quotes.
                     `;

                    const completion = await openai.chat.completions.create({
                        messages: [{ role: "system", content: prompt }],
                        model: "gpt-4o-mini",
                    });

                    return completion.choices[0].message.content.trim().replace(/^"/, '').replace(/"$/, '');

                } catch (err) {
                    console.error("OpenAI Generation Error:", err);
                    // Fallthrough to mock logic if it fails
                }
            }


            // Mock AI Modification (Fallback if no API key or API fails)
            const baseTitle = topTitles[Math.floor(Math.random() * topTitles.length)];
            const prefixes = ["", "Honestly, ", "Not gonna lie, ", "OC - ", "Just wanted to share: "];
            const suffixes = ["...", " <3", " x", " :)", ""];

            let generatedTitle = prefixes[Math.floor(Math.random() * prefixes.length)]
                + baseTitle
                + suffixes[Math.floor(Math.random() * suffixes.length)];

            // Ensure flair is respected if we generated it
            if (requiredFlair && !generatedTitle.includes(requiredFlair)) {
                generatedTitle = `[${requiredFlair}] ` + generatedTitle;
            }

            return generatedTitle;
        } catch (err) {
            console.error("Title Generation API Error:", err);
            return `Generated Post for r/${subredditName}`;
        }
    }
};

export const SubredditLifecycleService = {
    // Evaluates all testing subreddits against criteria to promote or demote them
    async evaluateSubreddits(modelId) {
        const settings = await SettingsService.getSettings();
        const testingSubreddits = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'testing').toArray();

        for (const sub of testingSubreddits) {
            // Re-calculate based on tasks/performances
            const tasks = await db.tasks.where({ subredditId: sub.id }).toArray();
            const taskIds = tasks.map(t => t.id);
            const performances = await db.performances.where('taskId').anyOf(taskIds).toArray();

            const totalTests = performances.length;
            if (totalTests >= settings.testsBeforeClassification) {
                let totalViews = 0;
                let removedCount = 0;

                performances.forEach(p => {
                    totalViews += p.views24h || 0;
                    if (p.removed) removedCount++;
                });

                const avgViews = totalViews / totalTests;
                const removalPct = (removedCount / totalTests) * 100;

                let newStatus = 'testing';
                if (removalPct > settings.removalThresholdPct) {
                    newStatus = 'rejected';
                } else if (avgViews >= settings.minViewThreshold) {
                    newStatus = 'proven';
                } else {
                    newStatus = 'low_yield';
                }

                await db.subreddits.update(sub.id, {
                    status: newStatus,
                    totalTests,
                    avg24hViews: avgViews,
                    removalPct
                });
            }
        }
    }
};

export const DailyPlanGenerator = {
    // Automatically generates structured daily posting plans across multiple accounts
    async generateDailyPlan(modelId, targetDate = new Date()) {
        console.log('DailyPlanGenerator: Starting generation for model', modelId);

        const settings = await SettingsService.getSettings();
        const activeAccounts = await db.accounts.where('modelId').equals(modelId).filter(a => a.status === 'active').toArray();

        if (activeAccounts.length === 0) {
            throw new Error("No ACTIVE Reddit accounts found for this model. Go to Accounts tab and set at least one to 'Active'.");
        }

        const todayStr = startOfDay(targetDate).toISOString();

        // Load existing tasks for today to avoid collisions
        const allModelTasksToday = await db.tasks.where('modelId').equals(modelId).filter(t => t.date === todayStr).toArray();
        const usedSubredditIds = new Set(allModelTasksToday.map(t => t.subredditId));

        // Get available subreddits for this model
        const provenSubs = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'proven').toArray();
        const testingSubs = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'testing').toArray();

        let fallbackSubs = [];
        if (provenSubs.length === 0 && testingSubs.length === 0) {
            fallbackSubs = await db.subreddits.where('modelId').equals(modelId).toArray();
            console.warn('DailyPlanGenerator: No proven/testing subreddits found – falling back to all subreddits');
        }

        if (provenSubs.length === 0 && testingSubs.length === 0 && fallbackSubs.length === 0) {
            throw new Error("No Subreddits assigned to this model. Go to Subreddits tab and add at least one.");
        }

        // ========== AUTO-SYNC FROM GOOGLE DRIVE ==========
        // Pulls fresh content from the Model's APPROVED folder automatically
        // so the Manager never needs to visit the Library tab separately.
        const model = await db.models.get(modelId);
        if (model?.driveFolderId) {
            console.log('DailyPlanGenerator: Auto-syncing from Google Drive folder', model.driveFolderId);
            try {
                const res = await fetch(`/api/drive/list/${model.driveFolderId}`);
                if (res.ok) {
                    const driveFiles = await res.json();
                    const assetsToAdd = [];
                    for (const file of driveFiles) {
                        const exists = await db.assets.where('driveFileId').equals(file.id).first();
                        if (!exists) {
                            assetsToAdd.push({
                                modelId,
                                assetType: file.mimeType.startsWith('image/') ? 'image' : 'video',
                                angleTag: file.mappedTag || 'general',
                                locationTag: '',
                                reuseCooldownSetting: settings.assetReuseCooldownDays || 7,
                                approved: 1,
                                lastUsedDate: null,
                                timesUsed: 0,
                                driveFileId: file.id,
                                fileName: file.name,
                                thumbnailUrl: file.thumbnailLink,
                                originalUrl: file.webContentLink
                            });
                        }
                    }
                    if (assetsToAdd.length > 0) {
                        await db.assets.bulkAdd(assetsToAdd);
                        console.log(`DailyPlanGenerator: Auto-synced ${assetsToAdd.length} new files from Drive`);
                    }
                }
            } catch (driveErr) {
                console.warn('DailyPlanGenerator: Drive auto-sync failed (non-fatal):', driveErr.message);
            }
        }

        // Active assets (now includes freshly synced Drive content)
        const activeAssets = await db.assets.where('modelId').equals(modelId).filter(a => a.approved === 1).toArray();
        if (activeAssets.length === 0) {
            throw new Error("No APPROVED media assets found. Make sure your Google Drive APPROVED folder has content and is shared with the service account.");
        }

        // 1. Calculate how many test slots are remaining globally today for this model
        const testsDoneToday = allModelTasksToday.filter(t => {
            const sub = testingSubs.find(s => s.id === t.subredditId);
            return !!sub;
        }).length;
        let testsRemaining = Math.max(0, settings.dailyTestingLimit - testsDoneToday);

        let newTasks = [];
        const usedAssetsInSession = new Map(); // Track counts to reuse a photo multiple times a day

        // 2. Iterate through accounts and fill their individual quotas
        for (const account of activeAccounts) {
            const accountTasksToday = allModelTasksToday.filter(t => t.accountId === account.id);
            const accountQuota = account.dailyCap || settings.dailyPostCap;
            const tasksToGenerate = accountQuota - accountTasksToday.length;

            if (tasksToGenerate <= 0) continue;

            let selectedSubsForAccount = [];

            // Try to pick Testing Subs first if global limit allows
            for (const sub of testingSubs) {
                if (selectedSubsForAccount.length < tasksToGenerate && testsRemaining > 0 && !usedSubredditIds.has(sub.id)) {
                    selectedSubsForAccount.push(sub);
                    usedSubredditIds.add(sub.id);
                    testsRemaining--;
                }
            }
            // If still need more subs and we have a fallback list, use it
            if (selectedSubsForAccount.length < tasksToGenerate && fallbackSubs.length > 0) {
                for (const sub of fallbackSubs) {
                    if (selectedSubsForAccount.length >= tasksToGenerate) break;
                    if (!usedSubredditIds.has(sub.id)) {
                        selectedSubsForAccount.push(sub);
                        usedSubredditIds.add(sub.id);
                    }
                }
            }

            // Fill remainder with Proven Subs
            for (const sub of provenSubs) {
                if (selectedSubsForAccount.length < tasksToGenerate && !usedSubredditIds.has(sub.id)) {
                    selectedSubsForAccount.push(sub);
                    usedSubredditIds.add(sub.id);
                }
            }

            // Assign assets to selected subreddits for this account
            const cooldownDate = subDays(targetDate, settings.assetReuseCooldownDays);

            for (const sub of selectedSubsForAccount) {
                let selectedAsset = null;

                // 1. First Pass: Try to find an asset that perfectly matches the Subreddit's niche tag
                for (const asset of activeAssets) {
                    if (sub.nicheTag && sub.nicheTag.toLowerCase() !== asset.angleTag.toLowerCase()) continue;

                    const timesUsedToday = usedAssetsInSession.get(asset.id) || 0;
                    if (timesUsedToday >= 5) continue; // Reuse up to 5 times per day

                    // Track global asset usage across any subreddit 
                    // ONLY verify cooldown if we haven't already decided to use it today
                    if (timesUsedToday === 0) {
                        const pastUsages = await db.tasks.where('assetId').equals(asset.id).toArray();
                        const recentlyUsed = pastUsages.some(t => isAfter(new Date(t.date), cooldownDate));
                        if (recentlyUsed) continue;
                    }

                    selectedAsset = asset;
                    break;
                }

                // 2. Second Pass (Fallback): If no tagged photo found, just grab ANY available photo to prevent empty tasks
                if (!selectedAsset) {
                    for (const asset of activeAssets) {
                        const timesUsedToday = usedAssetsInSession.get(asset.id) || 0;
                        if (timesUsedToday >= 5) continue;

                        if (timesUsedToday === 0) {
                            const pastUsages = await db.tasks.where('assetId').equals(asset.id).toArray();
                            const recentlyUsed = pastUsages.some(t => isAfter(new Date(t.date), cooldownDate));
                            if (recentlyUsed) continue;
                        }

                        selectedAsset = asset;
                        break;
                    }
                }

                if (selectedAsset) {
                    usedAssetsInSession.set(selectedAsset.id, (usedAssetsInSession.get(selectedAsset.id) || 0) + 1);

                    // Fetch previous titles to pass to AI so it avoids duplicates
                    const pastTasks = await db.tasks.where('modelId').equals(modelId).toArray();
                    const previousTitles = pastTasks.map(t => t.title).filter(Boolean);

                    // Check if the subreddit is missing rules/flair data (happens if added prior to update)
                    let currentRules = sub.rulesSummary;

                    if (!currentRules) {
                        const proxyUrl = await SettingsService.getProxyUrl();
                        console.log(`On-the-fly scraping rules for r/${sub.name}...`);
                        try {
                            const cleanName = sub.name.replace(/^(r\/|\/r\/)/i, '');
                            const res = await fetch(`${proxyUrl}/api/scrape/subreddit/${cleanName}`);
                            if (res.ok) {
                                const deepData = await res.json();
                                currentRules = deepData.rules?.map(r => `• ${r.title}: ${r.description}`).join('\n\n') || '';

                                // Cleanly update the DB so the VA dashboard instantly repopulates
                                await db.subreddits.update(sub.id, {
                                    rulesSummary: currentRules,
                                    flairRequired: deepData.flairRequired ? 1 : 0
                                });
                            }
                        } catch (err) {
                            console.error("Failed to fetch on-the-fly deep metadata for", sub.name);
                        }
                    }

                    // Generate AI title based on top 50 scraped posts for THIS specific subreddit
                    const aiTitle = await TitleGeneratorService.generateTitle(
                        sub.name,
                        currentRules,
                        sub.requiredFlair,
                        previousTitles
                    );

                    newTasks.push({
                        date: todayStr,
                        modelId,
                        accountId: account.id,
                        subredditId: sub.id,
                        assetId: selectedAsset.id,
                        title: aiTitle,
                        postingWindow: 'Morning', // Could be randomized later
                        status: 'generated'
                    });
                }
            }
        }

        if (newTasks.length > 0) {
            await db.tasks.bulkAdd(newTasks);
            console.log(`DailyPlanGenerator: Added ${newTasks.length} new tasks for model ${modelId}`);

            // Cloud Sync Push
            const { getSupabaseClient } = await import('../db/supabase.js');
            const supabase = await getSupabaseClient();
            if (supabase) {
                console.log("Pushing new daily plan to cloud...");
                await supabase.from('tasks').upsert(newTasks);
            }
        }

        return await db.tasks.where('modelId').equals(modelId).filter(t => t.date === todayStr).toArray();
    }
};

export const AnalyticsEngine = {
    async getMetrics(modelId) {
        // Basic implementation for MVP metrics
        const allTasks = await db.tasks.where('modelId').equals(modelId).toArray();
        const taskIds = allTasks.map(t => t.id);
        const performances = taskIds.length > 0
            ? await db.performances.where('taskId').anyOf(taskIds).toArray()
            : [];

        let totalViews = 0;
        let removedCount = 0;

        performances.forEach(p => {
            totalViews += p.views24h || 0;
            if (p.removed) removedCount++;
        });

        const avgViewsPerPost = performances.length > 0 ? (totalViews / performances.length).toFixed(0) : 0;
        const removalRatePct = performances.length > 0 ? ((removedCount / performances.length) * 100).toFixed(1) : 0;

        // Subreddits breakdown
        const provenSubs = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'proven').count();
        const testingSubs = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'testing').count();

        return {
            totalViews,
            avgViewsPerPost: Number(avgViewsPerPost),
            removalRatePct: Number(removalRatePct),
            removedCount,
            provenSubs,
            testingSubs,
            tasksCompleted: performances.length,
            tasksTotal: allTasks.length
        };
    },

    async getAgencyMetrics() {
        const models = await db.models.toArray();
        const accounts = await db.accounts.toArray();

        let agencyTotalViews = 0;
        let agencyTasksCompleted = 0;
        let agencyRemovedCount = 0;

        const modelLeaderboard = [];

        for (const model of models) {
            const metrics = await this.getMetrics(model.id);
            agencyTotalViews += metrics.totalViews;
            agencyTasksCompleted += metrics.tasksCompleted;
            agencyRemovedCount += metrics.removedCount;

            // Highlight logic
            const target = model.weeklyViewTarget || 0;
            const targetHit = target > 0 && metrics.totalViews >= target;

            modelLeaderboard.push({
                ...model,
                metrics,
                targetHit
            });
        }

        const agencyAvgViews = agencyTasksCompleted > 0 ? (agencyTotalViews / agencyTasksCompleted).toFixed(0) : 0;
        const agencyRemovalRate = agencyTasksCompleted > 0 ? ((agencyRemovedCount / agencyTasksCompleted) * 100).toFixed(1) : 0;

        // Sort leaderboard by total views
        modelLeaderboard.sort((a, b) => b.metrics.totalViews - a.metrics.totalViews);

        return {
            totalModels: models.length,
            activeAccounts: accounts.filter(a => a.status === 'active').length,
            totalAccounts: accounts.length,
            agencyTotalViews,
            agencyAvgViews: Number(agencyAvgViews),
            agencyRemovalRate: Number(agencyRemovalRate),
            leaderboard: modelLeaderboard
        };
    }
};

export const CloudSyncService = {
    async isEnabled() {
        const settings = await SettingsService.getSettings();
        return !!(settings.supabaseUrl && settings.supabaseAnonKey);
    },

    async pushLocalToCloud() {
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances'];

        for (const table of tables) {
            const localData = await db[table].toArray();
            if (localData.length === 0) continue;

            // Remove local auto-increment IDs for cloud insert if they are not BIGINT compatible or if we want cloud to handle it
            // Actually, keep them if we want to maintain relationships
            const cleanData = localData.map(item => {
                const { ...rest } = item;
                // If it's assets, we need to handle the FileBlob specifically (Supabase doesn't store blobs in table, usually Storage)
                if (table === 'assets' && rest.fileBlob) {
                    delete rest.fileBlob; // Skip blobs for now, or handle later
                }
                return rest;
            });

            const { error } = await supabase.from(table).upsert(cleanData);
            if (error) console.error(`Sync Error (${table}):`, error.message);
        }
    },

    async pullCloudToLocal() {
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances'];

        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                console.error(`Pull Error (${table}):`, error.message);
                continue;
            }

            if (data && data.length > 0) {
                await db[table].clear();
                await db[table].bulkPut(data);
            }
        }
    }
};

export const PerformanceSyncService = {
    async syncPostPerformance(taskId) {
        const task = await db.tasks.get(taskId);
        if (!task || !task.redditPostId) return;

        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            const response = await fetch(`${proxyUrl}/api/scrape/post/${task.redditPostId}`);
            if (!response.ok) throw new Error("Sync failed");

            const data = await response.json();

            // Find or create performance record
            const performance = await db.performances.where('taskId').equals(taskId).first();
            const updateObj = {
                views24h: data.views,
                removed: data.isRemoved ? 1 : 0,
                notes: `Last synced: ${new Date().toLocaleString()}`
            };

            if (performance) {
                await db.performances.update(performance.id, updateObj);
            } else {
                await db.performances.add({
                    taskId,
                    ...updateObj
                });
            }

            // After syncing one post, we should re-evaluate the subreddit it belongs to
            await SubredditLifecycleService.evaluateSubreddits(task.modelId);

            return data;
        } catch (err) {
            console.error("Performance Sync Error:", err);
        }
    },

    async syncAllPendingPerformance() {
        // Find tasks from the last 7 days that are closed and have a Post ID
        const weekAgo = subDays(new Date(), 7).toISOString();
        const pendingTasks = await db.tasks
            .where('status').equals('closed')
            .filter(t => t.redditPostId && t.date >= weekAgo)
            .toArray();

        for (const task of pendingTasks) {
            await this.syncPostPerformance(task.id);
            // Throttle slightly to be nice to proxy/reddit
            await new Promise(r => setTimeout(r, 1000));
        }

        return pendingTasks.length;
    }
};
