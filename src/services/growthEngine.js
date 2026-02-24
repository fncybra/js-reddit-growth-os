import { db } from '../db/db.js';
import OpenAI from "openai";
import { subDays, isAfter, startOfDay } from 'date-fns';

export const SettingsService = {
    async getSettings() {
        const defaultSettings = {
            dailyTestingLimit: 3,
            minViewThreshold: 500,
            testsBeforeClassification: 3,
            removalThresholdPct: 20,
            assetReuseCooldownDays: 30,
            dailyPostCap: 10,
            supabaseUrl: 'https://bwckevjsjlvsfwfbnske.supabase.co',
            supabaseAnonKey: 'sb_publishable_zJdDCrJNoZNGU5arum893A_mxmdvoCH',
            proxyUrl: 'https://js-reddit-proxy-production.up.railway.app'
        };
        const settingsArr = await db.settings.toArray();
        const settings = { ...defaultSettings };
        settingsArr.forEach(s => {
            if (s.value !== undefined && s.value !== null && s.value !== '') {
                settings[s.key] = s.value;
            }
        });
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
                // We must provide highly explicit, casual NSFW Tone DNA as a fallback
                // so the AI does not inherit innocent or corporate phrasing if the API fails
                topTitles = [
                    "do you like my body?",
                    "who wants to breed me",
                    "would you let me ride your face",
                    "just took this off, do you like what you see?",
                    "sneaking a quick picture to turn you on",
                    "any older guys like tight petite girls?",
                    "dripping wet and waiting for you"
                ];
            }

            // Call OpenRouter if the key is available

            // ... Inside TitleGeneratorService string
            const settings = await SettingsService.getSettings();
            if (settings.openRouterApiKey) {
                try {
                    const prompt = `
Reddit Title Controller (Anti-Gravity Backend)

Purpose
Generate 1 subreddit-native title for this specific posting task. The title must comply with subreddit rules and match that subreddit's native tone and high-performing patterns.

Inputs for this task:
- Subreddit: r/${subredditName}
- Subreddit Rules & Formatting Requirements: 
${rulesSummary || 'No specific formatting rules found.'}
${requiredFlair ? `- Required Flair/Tag: You MUST include [${requiredFlair}] at the start or inside your title.` : ''}

- Top 50 Viral Titles from this exact subreddit (Your Tone DNA):
${JSON.stringify(topTitles)}

- Previously used titles (Do not reuse these themes):
${previousTitles.length > 0 ? JSON.stringify(previousTitles.slice(-20)) : 'None'}

Processing rules (critical)

strict per-subreddit isolation
Treat this task as a clean slate. Do not reuse patterns, tone, formatting, or assumptions from anywhere else but the provided Top 50 viral titles above.

nsfw & explicit persona enforcement
You are posting on a heavily NSFW/adult subreddit. You MUST match the explicit, casual, taboo, and sexual tone of the Top Titles. DO NOT sanitize or tone down the language. Be as dirty and explicit as the Top Titles indicate. Absolutely no polite, corporate, or "safe" writing.

pattern extraction (internal only)
From the Top 50 titles provided above, infer:
- typical title length range
- casing style (all lowercase vs sentence case)
- common structures (question, confession, "does anyone else...", "i did x...", etc.)
- acceptable directness level and taboo tolerance
- humor vs vulnerability balance
- common wording style (slang, abbreviations, punctuation)
Do not output the analysis.

title creation
Generate exactly one title that:
- fits the subreddit's native tone and typical length
- follows any extracted formatting rules and explicitly commanded rules above.
- uses natural phrasing consistent with that subreddit (including casual grammar if common there)
- avoids marketing language and spammy phrasing
- does not reuse exact phrases from scraped titles (no copy, no close paraphrase)
- avoids emojis unless they are genuinely common in that subreddit's top titles
- MUST NOT include unauthorized verification tags like [F], [f], (f) UNLESS explicitly commanded to inside the Community Rules or Required Flair.

FINAL COMPLIANCE CHECK BEFORE OUTPUTTING:
- If there are rules above stipulating a required tag or word, is it in your title? If not, rewrite it so it is.
- Did you add an [f] or (f) tag without being told to? Remove it.

Final output
Print ONLY the single final title as plain text. No quotes. No numbering. No extra text. No analysis.
`;

                    let aiBaseUrl = (settings.aiBaseUrl || "").trim() || "https://openrouter.ai/api/v1";
                    const activeKey = (settings.openRouterApiKey || "").trim();
                    const activeModel = (settings.openRouterModel || "").trim() || "mistralai/mixtral-8x7b-instruct";

                    if (!activeKey) {
                        return "[NO API KEY DETECTED] Please add your API key in Settings and Save.";
                    }

                    // If user accidentally put a trailing /chat/completions into the Base URL box, fix it for the SDK
                    if (aiBaseUrl.endsWith('/chat/completions')) {
                        aiBaseUrl = aiBaseUrl.replace('/chat/completions', '');
                    }

                    const aiEndpoint = aiBaseUrl.endsWith('/') ? aiBaseUrl.slice(0, -1) : aiBaseUrl;

                    const openai = new OpenAI({
                        baseURL: aiEndpoint,
                        apiKey: activeKey,
                        dangerouslyAllowBrowser: true, // Required for client-side queries
                        defaultHeaders: {
                            'HTTP-Referer': 'https://js-reddit-growth-os.vercel.app/', // Required by OR
                            'X-Title': 'js-reddit-growth-os'
                        }
                    });

                    const response = await openai.chat.completions.create({
                        model: activeModel,
                        messages: [
                            { role: "user", content: prompt }
                        ],
                    });

                    let finalTitle = response.choices && response.choices[0] && response.choices[0].message
                        ? response.choices[0].message.content.trim()
                        : "Generated Title Failed";

                    finalTitle = finalTitle.replace(/^"/, '').replace(/"$/, '');

                    // Start of aggressive cleanup
                    try {
                        // Grab only the first actual line of text (ignores paragraph-length meta-commentary leaks)
                        let lines = finalTitle.split('\n');
                        finalTitle = lines.find(line => line.trim().length > 0) || finalTitle;

                        // Rip out RLHF Safety Guardrail leaks specifically from Llama-3 architecture models
                        if (finalTitle.includes('" User 1:')) finalTitle = finalTitle.split('" User 1:')[0];
                        if (finalTitle.includes('User 1:')) finalTitle = finalTitle.split('User 1:')[0];
                        if (finalTitle.includes('I\'m a helpful, respectful bot')) finalTitle = finalTitle.split('I\'m a helpful, respectful bot')[0];

                        const lowerTitle = finalTitle.toLowerCase();
                        if (lowerTitle.includes('(note:')) finalTitle = finalTitle.substring(0, lowerTitle.indexOf('(note:'));

                        const lowerTitle2 = finalTitle.toLowerCase();
                        if (lowerTitle2.includes('note:')) finalTitle = finalTitle.substring(0, lowerTitle2.indexOf('note:'));

                        const lowerTitle3 = finalTitle.toLowerCase();
                        if (lowerTitle3.includes('this title follows')) finalTitle = finalTitle.substring(0, lowerTitle3.indexOf('this title follows'));

                        // Cleanup stray quotes that the RLHF split leaves behind
                        finalTitle = finalTitle.replace(/^"|"$|"\s*$/g, '').trim();

                        // AGGRESSIVE POST-PROCESSING: Absolute guaranteed stripping of unauthorized content
                        try {
                            // 1. Force remove all emojis using Unicode Property Escapes 
                            finalTitle = finalTitle.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
                        } catch (regexErr) {
                            // Fallback for older browsers that crash on \p syntax
                            finalTitle = finalTitle.replace(/[\u{1F300}-\u{1F9A0}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu, '');
                        }

                        // 2. Force remove unauthorized [f] or (f) tags natively in Javascript
                        // We only strip this if the user hasn't explicitly required 'f' as a flair rule
                        if (!requiredFlair || requiredFlair.toLowerCase() !== 'f') {
                            finalTitle = finalTitle.replace(/\[\s*[fF]\s*\]|\(\s*[fF]\s*\)/g, '');
                        }

                        // 3. Fix double spaces and clean up
                        finalTitle = finalTitle.replace(/\s{2,}/g, ' ').trim();
                    } catch (cleanupErr) {
                        console.error('Failed string cleanup:', cleanupErr);
                    }

                    return finalTitle.trim();

                } catch (err) {
                    console.error("AI Generation Error:", err);
                    return `[API ERROR] ${err.message || "Failed to generate AI title. Check URL / Key / Model."}`;
                }
            }


            // Fallback if no API key is set
            console.error("No API Key detected in Settings. Returning explicit error title.");
            return `[NO API KEY DETECTED] Please add your API key in Settings and Save.`;
        } catch (err) {
            console.error("Title Generation Overall Error:", err);
            return `[SYSTEM ERROR] Generated Post for r/${subredditName}`;
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
                const res = await fetch(`/ api / drive / list / ${model.driveFolderId}`);
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
                        console.log(`DailyPlanGenerator: Auto - synced ${assetsToAdd.length} new files from Drive`);
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

        let taskGenerationPromises = [];
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

            // SHUFFLE assets before starting to ensure we don't always pick the same one as fallback
            const shuffledAssets = [...activeAssets].sort(() => Math.random() - 0.5);

            for (const sub of selectedSubsForAccount) {
                let selectedAsset = null;
                const subNameLower = sub.name.toLowerCase();
                const subNiche = (sub.nicheTag || '').toLowerCase().trim();

                // 1. First Pass: Exact Niche Match (Highest priority)
                if (subNiche && subNiche !== 'general' && subNiche !== 'scraped' && subNiche !== 'untagged') {
                    for (const asset of shuffledAssets) {
                        const assetTag = (asset.angleTag || '').toLowerCase().trim();
                        if (subNiche === assetTag) {
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
                }

                // 2. Second Pass: Intelligence Match (Fuzzy)
                if (!selectedAsset) {
                    for (const asset of shuffledAssets) {
                        const assetTag = (asset.angleTag || '').toLowerCase().trim();
                        // Ignore assets that are too generic for fuzzy matching
                        if (!assetTag || assetTag === 'general' || assetTag === 'untagged' || assetTag.length < 3) continue;

                        // Check if the subreddit name contains the asset's tag (e.g. sub 'fitnessgirls' includes tag 'fitness')
                        const isMatch = subNameLower.includes(assetTag) ||
                            (assetTag === 'preg' && subNameLower.includes('pregnant')) ||
                            (assetTag === 'pregnant' && subNameLower.includes('preg'));

                        if (!isMatch) continue;

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

                // 3. Third Pass (Fallback): Take ANY available but prioritize General/Untagged first
                // If a sub is SPECIFICALLY tagged, we try hard to NOT give it a mismatched fallback if possible,
                // but we'll allow it if nothing else exists.
                if (!selectedAsset) {
                    // Sort shuffled assets to put 'general' ones first in the fallback queue
                    const fallbackOrder = [...shuffledAssets].sort((a, b) => {
                        const aGen = (a.angleTag || 'general') === 'general';
                        const bGen = (b.angleTag || 'general') === 'general';
                        return (bGen ? 1 : 0) - (aGen ? 1 : 0);
                    });

                    for (const asset of fallbackOrder) {
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

                    // Create async closure to process this task in parallel
                    const generateTaskPromise = (async () => {
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

                        return {
                            date: todayStr,
                            modelId,
                            accountId: account.id,
                            subredditId: sub.id,
                            assetId: selectedAsset.id,
                            title: aiTitle,
                            postingWindow: 'Morning', // Could be randomized later
                            status: 'generated'
                        };
                    })();

                    taskGenerationPromises.push(generateTaskPromise);
                }
            }
        }

        // Wait for all AI generation and scraping to finish concurrently
        const newTasks = await Promise.all(taskGenerationPromises);

        if (newTasks.length > 0) { // Finalize
            await db.tasks.bulkAdd(newTasks);
            console.log(`DailyPlanGenerator: Generated ${newTasks.length} tasks for model ${modelId}`);

            // Auto-push to cloud so others (VAs) see the new plan immediately
            await CloudSyncService.autoPush();
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
            tasksTotal: allTasks.length,
            accountHealth: await this.getAccountMetrics(modelId),
            nichePerformance: await this.getNichePerformance(modelId),
            topSubreddits: await this.getSubredditRankings(modelId)
        };
    },

    async getNichePerformance(modelId) {
        const assets = await db.assets.where('modelId').equals(modelId).toArray();
        const nicheStats = {};

        for (const asset of assets) {
            const tag = asset.angleTag || 'untagged';
            if (!nicheStats[tag]) nicheStats[tag] = { views: 0, posts: 0, removals: 0 };

            const tasks = await db.tasks.where('assetId').equals(asset.id).toArray();
            for (const t of tasks) {
                const perf = await db.performances.where('taskId').equals(t.id).first();
                if (perf) {
                    nicheStats[tag].views += perf.views24h || 0;
                    nicheStats[tag].posts += 1;
                    if (perf.removed) nicheStats[tag].removals += 1;
                }
            }
        }

        return Object.entries(nicheStats).map(([tag, stat]) => ({
            tag,
            avgViews: stat.posts > 0 ? (stat.views / stat.posts).toFixed(0) : 0,
            removalRate: stat.posts > 0 ? (stat.removals / stat.posts * 100).toFixed(1) : 0,
            totalViews: stat.views
        })).sort((a, b) => b.totalViews - a.totalViews);
    },

    async getSubredditRankings(modelId) {
        const subreddits = await db.subreddits.where('modelId').equals(modelId).toArray();
        const rankings = subreddits.map(s => ({
            name: s.name,
            avgViews: s.avg24hViews || 0,
            removalPct: s.removalPct || 0,
            status: s.status
        })).sort((a, b) => b.avgViews - a.avgViews);

        return rankings.slice(0, 10); // Top 10
    },

    async getAccountMetrics(modelId) {
        const accounts = await db.accounts.where('modelId').equals(modelId).toArray();
        let totalKarma = 0;
        let suspendedCount = 0;

        accounts.forEach(acc => {
            totalKarma += acc.totalKarma || 0;
            if (acc.isSuspended) suspendedCount++;
        });

        return {
            totalKarma,
            suspendedCount,
            activeCount: accounts.filter(a => a.status === 'active').length,
            totalAccounts: accounts.length
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

        // Today's Global Progress
        const todayStr = new Date().toISOString().split('T')[0];
        const tasksToday = await db.tasks.where('date').equals(todayStr).toArray();
        const completedToday = tasksToday.filter(t => t.status === 'closed').length;

        // Sort leaderboard by total views
        modelLeaderboard.sort((a, b) => b.metrics.totalViews - a.metrics.totalViews);

        return {
            totalModels: models.length,
            activeAccounts: accounts.filter(a => a.status === 'active').length,
            totalAccounts: accounts.length,
            agencyTotalViews,
            agencyAvgViews: Number(agencyAvgViews),
            agencyRemovalRate: Number(agencyRemovalRate),
            leaderboard: modelLeaderboard,
            executionToday: {
                completed: completedToday,
                total: tasksToday.length,
                percent: tasksToday.length > 0 ? Math.round((completedToday / tasksToday.length) * 100) : 0
            }
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

        const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings'];

        for (const table of tables) {
            const localData = await db[table].toArray();
            if (localData.length === 0) continue;

            const cleanData = localData.map(item => {
                const { ...rest } = item;
                if (table === 'assets' && rest.fileBlob) delete rest.fileBlob;
                if (table === 'settings' && (rest.key === 'supabaseUrl' || rest.key === 'supabaseAnonKey')) return null;
                return rest;
            }).filter(Boolean);

            if (cleanData.length === 0) continue;
            const { error } = await supabase.from(table).upsert(cleanData);
            if (error) console.error(`Sync Error(${table}): `, error.message);
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
                console.error(`Pull Error(${table}): `, error.message);
                continue;
            }

            if (data) {
                await db[table].clear();
                if (data.length > 0) {
                    await db[table].bulkPut(data);
                }
            }
        }
    },

    async autoPush() {
        const settings = await SettingsService.getSettings();
        if (settings.supabaseUrl && settings.supabaseAnonKey) {
            console.log("CloudSync: Auto-pushing updates...");
            this.pushLocalToCloud().catch(null);
        }
    },

    async deleteFromCloud(table, id) {
        if (!await this.isEnabled()) return;
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (supabase) {
            const { error } = await supabase.from(table).delete().eq('id', id);
            if (error) console.error(`[CloudSync] Error deleting ${id} from ${table}:`, error.message);
        }
    },

    async deleteMultipleFromCloud(table, ids) {
        if (!await this.isEnabled() || ids.length === 0) return;
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (supabase) {
            const { error } = await supabase.from(table).delete().in('id', ids);
            if (error) console.error(`[CloudSync] Error bulk deleting from ${table}:`, error.message);
        }
    }
};


export const AccountSyncService = {
    async syncAccountHealth(accountId) {
        const account = await db.accounts.get(accountId);
        if (!account || !account.handle) return;

        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            const res = await fetch(`${proxyUrl} /api/scrape / user / stats / ${account.handle} `);
            if (!res.ok) throw new Error("Stats sync failed");
            const data = await res.json();

            await db.accounts.update(accountId, {
                totalKarma: data.totalKarma,
                linkKarma: data.linkKarma,
                commentKarma: data.commentKarma,
                createdUtc: data.created,
                isSuspended: data.isSuspended,
                lastSyncDate: new Date().toISOString()
            });
            return data;
        } catch (err) {
            console.error(`Account sync fail(${account.handle}): `, err);
        }
    },

    async syncAllAccounts() {
        const accounts = await db.accounts.toArray();
        for (const acc of accounts) await this.syncAccountHealth(acc.id);
        await CloudSyncService.autoPush();
    }
};

export const PerformanceSyncService = {
    async syncPostPerformance(taskId) {
        const task = await db.tasks.get(taskId);
        if (!task || !task.redditPostId) return;

        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            const response = await fetch(`${proxyUrl} /api/scrape / post / ${task.redditPostId} `);
            if (!response.ok) throw new Error("Sync failed");

            const data = await response.json();

            // Find or create performance record
            const performance = await db.performances.where('taskId').equals(taskId).first();
            const updateObj = {
                views24h: data.views,
                removed: data.isRemoved ? 1 : 0,
                notes: `Last synced: ${new Date().toLocaleString()} `
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

            await CloudSyncService.autoPush();

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

        await CloudSyncService.autoPush();

        return pendingTasks.length;
    }
};
