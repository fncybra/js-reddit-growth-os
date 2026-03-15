import { db } from '../db/db.js';
import { generateId } from '../db/generateId.js';
import { subDays, isAfter, startOfDay, differenceInDays } from 'date-fns';

// Persistent sync metadata — survives page refresh (stored in IndexedDB)
// Replaces the old in-memory _pendingDeletes Map which was lost on refresh

export async function markDirty(table, recordId) {
    await db._syncMeta.put({ table, recordId, type: 'dirty', ts: Date.now() });
}

export async function markPendingDelete(table, id) {
    // Remove any dirty mark, add pending delete
    await db._syncMeta.where({ table, recordId: id }).delete();
    await db._syncMeta.put({ table, recordId: id, type: 'pendingDelete', ts: Date.now() });
}

export async function markPendingClear(table) {
    // Clear all entries for this table, add a clear sentinel
    await db._syncMeta.where({ table }).delete();
    await db._syncMeta.put({ table, recordId: '__clear__', type: 'pendingClear', ts: Date.now() });
}

async function getDirtyIds(table) {
    const rows = await db._syncMeta.where({ table }).filter(r => r.type === 'dirty').toArray();
    return new Set(rows.map(r => r.recordId));
}

async function getPendingDeleteIds(table) {
    const rows = await db._syncMeta.where({ table }).filter(r => r.type === 'pendingDelete').toArray();
    return new Set(rows.map(r => r.recordId));
}

async function hasPendingClear(table) {
    const row = await db._syncMeta.where({ table, recordId: '__clear__' }).first();
    return !!row;
}

async function clearSyncMeta(table, recordId) {
    await db._syncMeta.where({ table, recordId }).delete();
}

async function clearAllSyncMeta(table) {
    await db._syncMeta.where({ table }).delete();
}

// Cached proxy token to avoid DB lookup on every request
let _cachedProxyApiToken = '';
export async function getProxyHeaders(extra = {}) {
    if (!_cachedProxyApiToken) {
        try {
            const row = await db.settings.where({ key: 'proxyApiToken' }).first();
            _cachedProxyApiToken = row?.value || '';
        } catch { /* ignore */ }
    }
    const headers = { ...extra };
    if (_cachedProxyApiToken) headers['x-api-token'] = _cachedProxyApiToken;
    return headers;
}
// Reset cached token when settings change
function invalidateProxyTokenCache() { _cachedProxyApiToken = ''; }

const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
    const controller = new AbortController();
    const proxyHeaders = await getProxyHeaders(options.headers || {});
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, headers: proxyHeaders, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
};

const normalizeDriveFolderId = (rawValue = '') => {
    const value = String(rawValue || '').trim();
    if (!value) return '';

    if (!value.includes('drive.google.com')) {
        return value;
    }

    const folderMatch = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch?.[1]) return folderMatch[1];

    const idParamMatch = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParamMatch?.[1]) return idParamMatch[1];

    return value;
};

export const normalizeRedditHandle = (rawValue = '') => {
    let value = String(rawValue || '').trim().toLowerCase();
    if (!value) return '';

    value = value
        .replace(/^https?:\/\/(www\.)?reddit\.com\//i, '')
        .replace(/^user\//i, '')
        .replace(/^u\//i, '')
        .replace(/^\/+|\/+$/g, '')
        .trim();

    return value;
};

const getRedditHandleVariants = (rawValue = '') => {
    const raw = String(rawValue || '').trim();
    const normalized = normalizeRedditHandle(raw);
    const stripped = raw
        .replace(/^https?:\/\/(www\.)?reddit\.com\//i, '')
        .replace(/^user\//i, '')
        .replace(/^u\//i, '')
        .replace(/^\/+|\/+$/g, '')
        .trim();

    return [...new Set([
        normalized,
        stripped,
        stripped.toLowerCase(),
        normalized.replace(/^u\//i, ''),
    ].filter(Boolean))];
};

const isUsableAccountStats = (data) => {
    if (!data || typeof data !== 'object') return false;
    return (
        typeof data.totalKarma === 'number' ||
        typeof data.linkKarma === 'number' ||
        typeof data.commentKarma === 'number' ||
        typeof data.created === 'number' ||
        typeof data.isSuspended === 'boolean' ||
        data.exists === true
    );
};

const buildDeadAccountPatch = (reason, now = new Date().toISOString()) => ({
    status: 'dead',
    deadReason: reason,
    deadAt: now,
    phase: 'burned',
    phaseChangedDate: now,
});

async function fetchBestAccountSnapshot(proxyUrl, rawHandle, existingAccount = {}) {
    const variants = getRedditHandleVariants(rawHandle);
    const failures = [];

    for (const variant of variants) {
        try {
            const statsRes = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/stats/${encodeURIComponent(variant)}`, {}, 10000);
            if (statsRes.ok) {
                const statsData = await statsRes.json();
                if (isUsableAccountStats(statsData)) {
                    return { ok: true, source: 'stats', variant, data: statsData };
                }
                failures.push(`stats:${variant}:invalid`);
            } else {
                failures.push(`stats:${variant}:${statsRes.status}`);
            }
        } catch (err) {
            failures.push(`stats:${variant}:${err.message}`);
        }

        try {
            const profileRes = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/${encodeURIComponent(variant)}`, {}, 10000);
            if (!profileRes.ok) {
                failures.push(`profile:${variant}:${profileRes.status}`);
                continue;
            }

            const profileData = await profileRes.json();
            const posts = Array.isArray(profileData?.data?.children) ? profileData.data.children : [];
            const hasProfile = profileData?.kind === 'Listing' || posts.length > 0;
            if (!hasProfile) {
                failures.push(`profile:${variant}:empty`);
                continue;
            }

            return {
                ok: true,
                source: 'profile_fallback',
                variant,
                data: {
                    totalKarma: existingAccount.totalKarma ?? 0,
                    linkKarma: existingAccount.linkKarma ?? 0,
                    commentKarma: existingAccount.commentKarma ?? 0,
                    created: existingAccount.createdUtc ?? null,
                    isSuspended: false,
                    exists: true,
                    has_custom_avatar: !!existingAccount.hasAvatar,
                    has_banner: !!existingAccount.hasBanner,
                    description: existingAccount.hasBio ? 'existing-bio' : '',
                    display_name: existingAccount.handle || variant,
                    has_verified_email: !!existingAccount.hasVerifiedEmail,
                    has_profile_link: !!existingAccount.hasProfileLink,
                }
            };
        } catch (err) {
            failures.push(`profile:${variant}:${err.message}`);
        }
    }

    const allMissing = failures.length > 0 && failures.every((item) => /:(404|403|invalid|empty)$/.test(item));
    return { ok: false, reason: allMissing ? 'missing' : 'unreachable', failures };
}

export const extractRedditPostIdFromUrl = (rawUrl = '') => {
    const url = String(rawUrl || '').trim();
    if (!url) return '';

    const patterns = [
        /\/comments\/([a-z0-9]{6,8})/i,
        /redd\.it\/([a-z0-9]{6,8})/i,
        /\/gallery\/([a-z0-9]{6,8})/i,
        /\/s\/([a-zA-Z0-9]+)/i,
        /\/r\/[^/]+\/([a-z0-9]{6,8})(?:[/?#]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }

    return '';
};

export const SettingsService = {
    async getSettings() {
        const defaultSettings = {
            dailyTestingLimit: 3,
            minViewThreshold: 500,
            testsBeforeClassification: 3,
            removalThresholdPct: 20,
            assetReuseCooldownDays: 30,
            dailyPostCap: 10,
            maxPostsPerSubPerDay: 5,
            allowSubredditRepeatsInQueue: 0,
            supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://bwckevjsjlvsfwfbnske.supabase.co',
            supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_zJdDCrJNoZNGU5arum893A_mxmdvoCH',
            proxyUrl: import.meta.env.VITE_PROXY_URL || 'https://js-reddit-proxy-production.up.railway.app',
            openRouterApiKey: '',
            openRouterModel: 'z-ai/glm-5',
            useVoiceProfile: 1,
            telegramBotToken: '',
            telegramChatId: '',
            telegramThreadId: '',
            telegramAutoSendHour: 20,
            lastTelegramReportDate: '',
            redditManagerPin: '',
            redditTelegramBotToken: '',
            redditTelegramChatId: '',
            redditTelegramThreadId: '',
            redditDailyReportEnabled: 1,
            redditDailyReportHour: 8,
            lastRedditDailyReportDate: '',
            proxyApiToken: ''
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
            await db.settings.add({ id: generateId(), key, value });
        }
        if (key === 'proxyApiToken') invalidateProxyTokenCache();
    },
    async getProxyUrl() {
        const settings = await this.getSettings();
        return settings.proxyUrl || '';
    }
};



export const TitleGeneratorService = {
    // Scrapes top 50 titles from a subreddit and regenerates a high-quality title conforming to rules
    async generateTitle(subredditName, rulesSummary, requiredFlair, previousTitles = [], context = {}) {
        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            let topTitles = [];
            const assetType = String(context?.assetType || 'image').toLowerCase();
            const angleTag = String(context?.angleTag || '').trim();
            const modelVoiceProfile = String(context?.modelVoiceProfile || '').trim();
            const accountVoiceOverride = String(context?.accountVoiceOverride || '').trim();
            const sanitizeFinalTitle = (title) => {
                let clean = String(title || '').replace(/[\r\n]+/g, ' ').trim();
                try {
                    clean = clean.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
                } catch {
                    clean = clean.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
                }

                clean = clean.replace(/[\u200D\uFE0F]/g, '');

                if (!requiredFlair || String(requiredFlair).toLowerCase() !== 'f') {
                    clean = clean.replace(/\[\s*[fF]\s*\]|\(\s*[fF]\s*\)/g, '');
                }

                return clean.replace(/\s{2,}/g, ' ').trim();
            };

            const getFallbackTitle = () => {
                const pool = (topTitles && topTitles.length > 0)
                    ? topTitles.filter(Boolean)
                    : [
                        `anyone into this?`,
                        `who's online right now`,
                        `honest opinion?`,
                        `would you tap this?`,
                        `rate me honestly`
                    ];

                const nonDuplicatePool = pool.filter(t => !previousTitles.includes(t));
                const source = nonDuplicatePool.length > 0 ? nonDuplicatePool : pool;
                const picked = source[Math.floor(Math.random() * source.length)] || `new post for r/${subredditName}`;
                return sanitizeFinalTitle(String(picked).replace(/^\[.*?\]\s*/g, '').trim());
            };
            // Try fetching from Reddit directly via JSON API (Top of the month)
            try {
                const res = await fetchWithTimeout(`${proxyUrl}/api/scrape/subreddit/top/${subredditName}`, {}, 4000);
                if (res.ok) {
                    topTitles = await res.json();
                }
            } catch (e) {
                console.warn(`Could not fetch top titles directly for r/${subredditName} - falling back to explicit DNA list.`);
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
            const settings = await SettingsService.getSettings();
            const includeVoiceProfile = Number(settings.useVoiceProfile ?? 1) === 1;
            if (settings.openRouterApiKey) {
                try {
                    // Randomizer DNA - prevents the LLM from using the same sentence structures repeatedly
                    const structuralAngles = [
                        "Keep the title incredibly short, maximum 4 words, punchy.",
                        "Write it as a very vulnerable, shy confession.",
                        "Write it as a cocky, highly confident demand.",
                        "Write it casually, like it's just a text you're sending to a guy.",
                        "Write it like you are telling a dirty little secret.",
                        "Write it as an innocent-sounding question that is actually extremely dirty.",
                        "Start the title with 'honest opinion:' or 'question for the guys:'.",
                        "Be brutally direct and wildly explicit. No beating around the bush.",
                        "Write a slightly longer, highly descriptive scenario title (10-15 words)."
                    ];
                    const randomAngle = structuralAngles[Math.floor(Math.random() * structuralAngles.length)];

                    const prompt = `
Reddit Title Controller (Anti-Gravity Backend)

Purpose
Generate 1 subreddit-native title for this specific posting task. The title must comply with subreddit rules and match that subreddit's native tone and high-performing patterns.

Inputs for this task:
- Subreddit: r/${subredditName}
- Subreddit Rules & Formatting Requirements: 
${rulesSummary || 'No specific formatting rules found.'}
${requiredFlair ? `- Required Flair/Tag: You MUST include [${requiredFlair}] at the start or inside your title.` : ''}
- Asset context: single ${assetType} post (not a carousel/comparison). BANNED words: swipe, slides, first pic, second pic, gallery, carousel, before and after, vs, versus, comparison, left or right, "1 2 or 3", any numbered choices. This is ONE ${assetType} only — never imply multiple images exist.
${angleTag ? `- Visual angle/theme hint for this asset: ${angleTag}` : ''}

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

STRUCTURAL RANDOMIZER FOR THIS ENTIRE TASK:
You MUST adopt this specific style for this exact title: "${randomAngle}"

${includeVoiceProfile && modelVoiceProfile ? `MANDATORY PERSONA ENFORCEMENT (DO NOT SKIP):
You are writing AS this specific person. Your title MUST sound like it was written by someone with this exact identity:
${modelVoiceProfile}
${accountVoiceOverride ? `Account-specific voice override (takes priority): ${accountVoiceOverride}` : ''}
CRITICAL — "Age" and "Pregnancy weeks" (or "Current state") are COMPLETELY DIFFERENT fields with DIFFERENT numbers. "Age: 28" or "Age (years old): 28" means the person is 28 YEARS OLD — this is NOT a pregnancy week number. "Pregnancy weeks: 18 weeks" or "Current state: 18 weeks" means she is 18 WEEKS pregnant. NEVER mix these two numbers. NEVER use the Age number as weeks. The pregnancy week count is ONLY from the "Pregnancy weeks" or "Current state" field.

Rules:
- If the persona says "MILF" or gives an age like 30+, the title MUST reflect a mature woman's perspective (e.g. "mommy", "older", references to experience/age)
- If the persona gives an age, and you mention age in the title, use EXACTLY that age. Never invent a different age.
- If the persona says "pregnant", the title MUST reference pregnancy, bump, belly, expecting, etc.
- If the persona's "Pregnancy weeks" or "Current state" mentions a specific number (e.g. "18 weeks"), you MUST use EXACTLY that number if you mention weeks in the title. NEVER invent or change the week number. The week number comes ONLY from "Pregnancy weeks" / "Current state", NOT from "Age". If uncertain, omit weeks entirely rather than guessing.
- If the persona says "bratty" tone, write with attitude and sass
- If the persona says "sweet" tone, write with warmth and softness
- If the persona says "dominant" tone, write with commands and control
- If identity anchors mention hair color, body type, ethnicity — weave them naturally into the title when possible
- The persona identity OVERRIDES the structural randomizer above if they conflict. The randomizer controls HOW you write; the persona controls WHO is speaking.
- NEVER contradict the persona (e.g. don't write "barely legal" for a MILF persona, don't write "tiny" for a curvy persona, don't write "32 weeks" if the persona says "18 weeks", don't use the Age number as a week number)
` : ''}
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
                        console.warn('[AI] No API key detected; using fallback title.');
                        return getFallbackTitle();
                    }

                    // If user accidentally put a trailing /chat/completions into the Base URL box, fix it for the SDK
                    if (aiBaseUrl.endsWith('/chat/completions')) {
                        aiBaseUrl = aiBaseUrl.replace('/chat/completions', '');
                    }

                    const aiEndpoint = aiBaseUrl.endsWith('/') ? aiBaseUrl.slice(0, -1) : aiBaseUrl;

                    // Retry logic for 429 rate limits (free models cap at 8 req/min)
                    const MAX_RETRIES = 3;
                    let data = null;
                    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                        const response = await fetch(`${proxyUrl}/api/ai/generate`, {
                            method: 'POST',
                            headers: await getProxyHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({
                                aiBaseUrl: aiEndpoint,
                                apiKey: activeKey,
                                model: activeModel,
                                messages: [{ role: "user", content: prompt }],
                                temperature: 0.9,
                                presence_penalty: 0.4
                            })
                        });

                        if (response.ok) {
                            data = await response.json();
                            break;
                        }

                        const errData = await response.json().catch(() => ({}));
                        const errMsg = errData.details?.message || errData.details || errData.error || '';
                        const is429 = response.status === 500 && (typeof errMsg === 'string' && errMsg.includes('429'));

                        if (is429 && attempt < MAX_RETRIES) {
                            const waitSec = 8 * Math.pow(2, attempt); // 8s, 16s, 32s
                            console.warn(`[AI] Rate limited (429), waiting ${waitSec}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
                            await new Promise(r => setTimeout(r, waitSec * 1000));
                            continue;
                        }

                        throw new Error(errMsg || "Failed proxy AI generation");
                    }

                    if (!data) throw new Error("AI generation failed after all retries");

                    let finalTitle = data.choices && data.choices[0] && data.choices[0].message
                        ? data.choices[0].message.content.trim()
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

                    const lowerFinal = String(finalTitle || '').toLowerCase();
                    if (
                        lowerFinal.includes('api error')
                        || lowerFinal.includes('user not found')
                        || lowerFinal.includes('unauthorized')
                        || lowerFinal.includes('401')
                        || lowerFinal.includes('openrouter')
                    ) {
                        return getFallbackTitle();
                    }

                    return sanitizeFinalTitle(finalTitle.trim());

                } catch (err) {
                    console.error("AI Generation Error:", err);
                    return getFallbackTitle();
                }
            }


            // Fallback if no API key is set
            console.error("No API Key detected in Settings. Using fallback title.");
            return getFallbackTitle();
        } catch (err) {
            console.error("Title Generation Overall Error:", err);
            return `new post for r/${subredditName}`;
        }
    }
};

export const TitleGuardService = {
    normalize(title = '') {
        return String(title || '')
            .toLowerCase()
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    levenshtein(a = '', b = '') {
        const s = this.normalize(a);
        const t = this.normalize(b);
        const n = s.length;
        const m = t.length;
        if (!n) return m;
        if (!m) return n;

        const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
        for (let i = 0; i <= n; i++) dp[i][0] = i;
        for (let j = 0; j <= m; j++) dp[0][j] = j;

        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                const cost = s[i - 1] === t[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[n][m];
    },

    similarityRatio(a = '', b = '') {
        const na = this.normalize(a);
        const nb = this.normalize(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        const dist = this.levenshtein(na, nb);
        return 1 - (dist / Math.max(na.length, nb.length));
    },

    isTooClose(candidate, existingTitle) {
        const c = this.normalize(candidate);
        const e = this.normalize(existingTitle);
        if (!c || !e) return false;
        if (c === e) return true;
        const ratio = this.similarityRatio(c, e);
        if (ratio >= 0.86) return true;
        if ((c.includes(e) || e.includes(c)) && Math.abs(c.length - e.length) <= 8) return true;
        return false;
    },

    isLowQuality(candidate = '') {
        const raw = String(candidate || '').trim();
        if (!raw) return true;

        const lower = raw.toLowerCase();
        const bannedPatterns = [
            /\btype\s+["']?[a-z0-9]{2,12}["']?\b/i,
            /\bcomment\s+["']?[a-z0-9]{2,12}["']?\b/i,
            /\bunlock\b.*\bgallery\b/i,
            /\bfull\s+gallery\b/i,
            /\bswipe\b/i,
            /\bslides?\b/i,
            /\bcarousel\b/i,
            /\bfirst\s+pic\b/i,
            /\bsecond\s+pic\b/i,
            /\bbefore\s*(and|&)\s*after\b/i,
            /\b(first|next)\s+\d{2,4}\b/i,
            /\bdm\s+me\b/i,
            /\bonlyfans\b/i,
            /\btelegram\b/i,
            /\bsnap(chat)?\b/i,
            /\blink\s+in\s+bio\b/i,
            /\bsubscribe\b/i,
            /\bapi\s*error\b/i,
            /\berror\s*\d{2,4}\b/i,
            /\bvs\.?\b/i,
            /\bversus\b/i,
            /\d\s*,\s*\d\s+(or|and)\s+\d/i,
        ];

        if (bannedPatterns.some(rx => rx.test(lower))) return true;

        const words = lower.split(/\s+/).filter(Boolean);
        if (words.length < 3) return true;
        if (words.length > 18) return true;

        return false;
    },

    isContextMismatch(candidate = '', context = {}) {
        const lower = String(candidate || '').toLowerCase();
        if (!lower) return true;

        // Multi-image / carousel language — always reject for single-asset posts
        if (/\bswipe\b|\bslides?\b|\bcarousel\b|\bfirst\s+pic\b|\bsecond\s+pic\b|\bbefore\s*(and|&)\s*after\b/.test(lower)) {
            return true;
        }

        // Comparison / "vs" language implies 2+ images (e.g. "19 vs 29 weeks", "1, 2 or 3?")
        if (/\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b|\bwhich\s+one\b|\bleft\s+or\s+right\b|\bpic\s*\d\b/.test(lower)) {
            return true;
        }
        // Numbered choices like "1, 2 or 3?" or "option 1 or 2" — implies multiple images
        if (/\b\d\s*,\s*\d\s+(or|and)\s+\d\b/.test(lower)) {
            return true;
        }

        const assetType = String(context?.assetType || 'image').toLowerCase();
        // Image post shouldn't mention video language
        if (assetType === 'image' && /\bvideo\b|\bclip\b|\bwatch\b/.test(lower)) {
            return true;
        }
        // Video post shouldn't mention photo-only language
        if (assetType === 'video' && /\bpic\b|\bphoto\b|\bselfie\b|\bsnapshot\b/.test(lower)) {
            return true;
        }

        return false;
    },

    buildSafeFallback(context = {}) {
        const angle = String(context?.angleTag || '').toLowerCase();
        if (angle.includes('preg')) return 'honest opinion on my pregnant body?';
        if (angle.includes('petite')) return 'do petite girls do it for you?';
        if (angle.includes('milf')) return 'would you pick a milf like me?';
        return 'honest opinion on this one?';
    },

    async getRecentPostedTitles(modelId, subredditId, lookbackDays = 90) {
        const cutoffIso = subDays(new Date(), lookbackDays).toISOString();
        const tasks = await db.tasks
            .where('modelId').equals(modelId)
            .filter(t => (t.status === 'closed' || t.status === 'generated') && t.subredditId === subredditId && t.title && (!t.date || t.date >= cutoffIso))
            .toArray();
        return tasks.map(t => t.title).filter(Boolean);
    },
};

export const SubredditLifecycleService = {
    // Evaluates all testing subreddits against criteria to promote or demote them
    async evaluateSubreddits(modelId) {
        const settings = await SettingsService.getSettings();
        const allSubs = await db.subreddits.where('modelId').equals(modelId).toArray();

        for (const sub of allSubs) {
            if (sub.status === 'cooldown' && sub.cooldownUntil && new Date(sub.cooldownUntil) > new Date()) {
                continue;
            }
            // Match tasks by subredditId OR by subreddit name in the reddit URL
            const allModelTasks = await db.tasks.where('modelId').equals(modelId).toArray();
            const matchedTasks = allModelTasks.filter(t => {
                if (t.subredditId === sub.id) return true;
                // Fallback: match by subreddit name in the reddit URL
                if (t.redditUrl) {
                    const urlMatch = t.redditUrl.match(/\/r\/([^\/]+)/i);
                    if (urlMatch && urlMatch[1].toLowerCase() === sub.name.toLowerCase()) return true;
                }
                return false;
            });

            const taskIds = matchedTasks.map(t => t.id);
            const performances = taskIds.length > 0
                ? await db.performances.where('taskId').anyOf(taskIds).toArray()
                : [];

            const totalTests = performances.length;
            if (totalTests === 0) continue;

            let totalViews = 0;
            let removedCount = 0;
            performances.forEach(p => {
                totalViews += p.views24h || 0;
                if (p.removed) removedCount++;
            });

            const avgViews = totalViews / totalTests;
            const removalPct = (removedCount / totalTests) * 100;

            // Always update stats
            const updateObj = { totalTests, avg24hViews: avgViews, removalPct };

            // Only change status if enough tests
            if (totalTests >= settings.testsBeforeClassification) {
                if (removalPct > settings.removalThresholdPct) {
                    updateObj.status = 'rejected';
                } else {
                    // If posts aren't getting removed, the sub is working
                    updateObj.status = 'proven';
                }
            }

            // Learn peak posting hour from best-performing posts
            try {
                const closedTasks = matchedTasks.filter(t => t.postedAt);
                if (closedTasks.length >= 3) {
                    const taskPerf = [];
                    for (const t of closedTasks) {
                        const perf = performances.find(p => p.taskId === t.id);
                        if (perf && !perf.removed) {
                            taskPerf.push({ hour: new Date(t.postedAt).getUTCHours(), views: perf.views24h || 0 });
                        }
                    }
                    if (taskPerf.length >= 3) {
                        // Find the hour with highest average views
                        const hourBuckets = {};
                        for (const tp of taskPerf) {
                            if (!hourBuckets[tp.hour]) hourBuckets[tp.hour] = [];
                            hourBuckets[tp.hour].push(tp.views);
                        }
                        let bestHour = null, bestAvg = 0;
                        for (const [hour, views] of Object.entries(hourBuckets)) {
                            const avg = views.reduce((a, b) => a + b, 0) / views.length;
                            if (avg > bestAvg) { bestAvg = avg; bestHour = Number(hour); }
                        }
                        if (bestHour != null) updateObj.peakPostHour = bestHour;
                    }
                }
            } catch (e) { console.warn('Peak hour learning failed:', e.message); }

            await db.subreddits.update(sub.id, updateObj);

            // Cross-model sharing: if rejected with high removal, warn other models
            if (updateObj.status === 'rejected' && removalPct >= 40) {
                try {
                    const sameName = await db.subreddits.where('name').equals(sub.name).toArray();
                    for (const otherSub of sameName) {
                        if (otherSub.id === sub.id) continue; // skip self
                        if (otherSub.status === 'rejected') continue; // already rejected
                        // Flag the sub with a cross-model warning
                        await db.subreddits.update(otherSub.id, {
                            crossModelWarning: `Rejected for another model (${Math.round(removalPct)}% removal across ${totalTests} tests)`
                        });
                    }
                } catch (e) { console.warn('Cross-model warning failed:', e.message); }
            }
        }
    }
};

export const SubredditGuardService = {
    _extractFirstNumber(regex, text) {
        const m = text.match(regex);
        return m?.[1] ? Number(m[1]) : null;
    },

    _inferConstraintsFromError(reason) {
        const text = String(reason || '').toLowerCase();
        const inferred = {
            minAgeDays: null,
            minKarma: null,
            requiresVerified: false,
            cooldownDays: 7,
        };

        const explicitAge = this._extractFirstNumber(/(\d{1,4})\s*(?:day|days|d)\b/i, text);
        if (explicitAge) inferred.minAgeDays = explicitAge;
        if (text.includes('too new') || text.includes('account age') || text.includes('new account')) {
            inferred.minAgeDays = inferred.minAgeDays || 14;
            inferred.cooldownDays = Math.max(inferred.cooldownDays, inferred.minAgeDays);
        }

        const explicitKarma = this._extractFirstNumber(/(\d{2,6})\s*karma\b/i, text);
        if (explicitKarma) inferred.minKarma = explicitKarma;
        if (text.includes('not enough karma') || text.includes('low karma')) {
            inferred.minKarma = inferred.minKarma || 100;
        }

        if (text.includes('verify') || text.includes('verified email') || text.includes('email confirmed')) {
            inferred.requiresVerified = true;
        }

        return inferred;
    },

    async isBlockedForPosting(subreddit) {
        if (!subreddit) return false;
        if (subreddit.cooldownUntil) {
            return new Date(subreddit.cooldownUntil) > new Date();
        }
        return subreddit.status === 'cooldown';
    },

    async recordPostingError(subredditId, reason, context = {}) {
        const sub = await db.subreddits.get(subredditId);
        if (!sub) return null;

        const inferred = this._inferConstraintsFromError(reason);
        const nowIso = new Date().toISOString();
        const cooldownUntil = new Date(Date.now() + inferred.cooldownDays * 24 * 60 * 60 * 1000).toISOString();

        const previousNotes = String(sub.hiddenRuleNotes || '').trim();
        const newNote = `[${new Date().toLocaleDateString()}] ${String(reason || 'VA posting error')}`;
        const notes = previousNotes ? `${newNote}\n${previousNotes}` : newNote;
        const previousHistory = Array.isArray(sub.postErrorHistory) ? sub.postErrorHistory : [];
        const historyEntry = {
            at: nowIso,
            reason: String(reason || 'VA posting error'),
            accountHandle: context.accountHandle || '',
            modelName: context.modelName || '',
            taskId: context.taskId || null,
        };
        const postErrorHistory = [historyEntry, ...previousHistory].slice(0, 10);

        const patch = {
            status: 'cooldown',
            cooldownUntil,
            hiddenRuleNotes: notes.slice(0, 3000),
            postErrorHistory,
            postErrorCount: Number(sub.postErrorCount || 0) + 1,
            lastPostErrorAt: nowIso,
        };

        if (inferred.minAgeDays) {
            patch.minAccountAgeDays = Math.max(Number(sub.minAccountAgeDays || 0), inferred.minAgeDays);
        }
        if (inferred.minKarma) {
            patch.minRequiredKarma = Math.max(Number(sub.minRequiredKarma || 0), inferred.minKarma);
        }
        if (inferred.requiresVerified) {
            patch.requiresVerified = 1;
        }

        await db.subreddits.update(sub.id, patch);
        return { ...sub, ...patch };
    },

    calculateRiskLevel(subreddit) {
        const totalTests = Number(subreddit.totalTests || 0);
        if (totalTests < 3) return 'unknown';
        const removalPct = Number(subreddit.removalPct || 0);
        if (removalPct > 30) return 'high';
        if (removalPct >= 10) return 'medium';
        return 'low';
    },

    async moveCooldownToTesting(subredditId) {
        const sub = await db.subreddits.get(subredditId);
        if (!sub) return null;
        const patch = {
            status: 'testing',
            cooldownUntil: null,
        };
        await db.subreddits.update(subredditId, patch);
        return { ...sub, ...patch };
    }
};

export const VerificationService = {
    async isVerified(accountId, subredditId) {
        const record = await db.verifications
            .where('accountId').equals(accountId)
            .and(v => v.subredditId === subredditId)
            .first();
        return !!(record && record.verified);
    },

    async markVerified(accountId, subredditId) {
        const existing = await db.verifications
            .where('accountId').equals(accountId)
            .and(v => v.subredditId === subredditId)
            .first();
        if (existing) {
            await db.verifications.update(existing.id, { verified: 1, verifiedDate: new Date().toISOString() });
        } else {
            await db.verifications.add({ id: generateId(), accountId, subredditId, verified: 1, verifiedDate: new Date().toISOString() });
        }
        try { await CloudSyncService.autoPush(['verifications']); } catch (e) { /* non-critical */ }
    },

    async markUnverified(accountId, subredditId) {
        const existing = await db.verifications
            .where('accountId').equals(accountId)
            .and(v => v.subredditId === subredditId)
            .first();
        if (existing) {
            await db.verifications.update(existing.id, { verified: 0, verifiedDate: null });
        }
        try { await CloudSyncService.autoPush(['verifications']); } catch (e) { /* non-critical */ }
    },

    async getVerifiedAccountIds(subredditId) {
        const records = await db.verifications
            .where('subredditId').equals(subredditId)
            .filter(v => v.verified === 1)
            .toArray();
        return records.map(v => v.accountId);
    }
};

export const DailyPlanGenerator = {
    // Automatically generates structured daily posting plans across multiple accounts
    async generateDailyPlan(modelId, targetDate = new Date(), options = {}) {
        const { totalTarget } = options;
        console.log('DailyPlanGenerator: Starting generation for model', modelId, totalTarget != null ? `(target: ${totalTarget} total posts)` : '');

        const settings = await SettingsService.getSettings();
        // Evaluate account lifecycle phases before selecting accounts
        await AccountLifecycleService.evaluateAccountPhases();

        const activeAccounts = await db.accounts.where('modelId').equals(modelId).filter(a => {
            if (a.status !== 'active') return false;
            // Phase filter: only 'ready', 'active', or undefined (backward compat) get posting tasks
            const phase = a.phase || 'ready';
            return phase === 'ready' || phase === 'active';
        }).toArray();

        // Also fetch warming accounts — they get ONLY engagement/warmup tasks
        const warmingAccounts = await db.accounts.where('modelId').equals(modelId).filter(a => {
            return a.status === 'active' && a.phase === 'warming';
        }).toArray();

        if (activeAccounts.length === 0 && warmingAccounts.length === 0) {
            throw new Error("No eligible Reddit accounts found for this model. Accounts must have status 'Active' and phase 'Ready', 'Active', or 'Warming'. Check the Accounts tab.");
        }

        const todayStr = startOfDay(targetDate).toISOString();

        // Load existing tasks for today to avoid collisions
        const allModelTasksToday = await db.tasks.where('modelId').equals(modelId).filter(t => t.date === todayStr).toArray();
        const usedSubredditIds = new Set(allModelTasksToday.map(t => t.subredditId));
        const subUsageCount = new Map();
        for (const t of allModelTasksToday) {
            subUsageCount.set(t.subredditId, (subUsageCount.get(t.subredditId) || 0) + 1);
        }
        const maxPostsPerSubPerDay = Math.max(1, Number(settings.maxPostsPerSubPerDay || 5));

        const canUseSubreddit = (subId, allowReuse = false) => {
            if (!allowReuse && usedSubredditIds.has(subId)) return false;
            const used = subUsageCount.get(subId) || 0;
            return used < maxPostsPerSubPerDay;
        };
        const markSubredditUsed = (subId) => {
            usedSubredditIds.add(subId);
            subUsageCount.set(subId, (subUsageCount.get(subId) || 0) + 1);
        };

        // Get available subreddits for this model (excluding temporary cooldown blocks)
        const provenSubsRaw = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'proven').toArray();
        const testingSubsRaw = await db.subreddits.where('modelId').equals(modelId).filter(s => s.status === 'testing').toArray();
        const provenSubs = [];
        const testingSubs = [];
        for (const s of provenSubsRaw) {
            if (!(await SubredditGuardService.isBlockedForPosting(s))) provenSubs.push(s);
        }
        for (const s of testingSubsRaw) {
            if (!(await SubredditGuardService.isBlockedForPosting(s))) testingSubs.push(s);
        }

        let fallbackSubs = [];
        if (provenSubs.length === 0 && testingSubs.length === 0) {
            const fallbackAll = await db.subreddits.where('modelId').equals(modelId).toArray();
            fallbackSubs = [];
            for (const s of fallbackAll) {
                if (!(await SubredditGuardService.isBlockedForPosting(s))) fallbackSubs.push(s);
            }
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
                const proxyUrl = await SettingsService.getProxyUrl();

                let cleanFolderId = model.driveFolderId;
                if (cleanFolderId.includes('drive.google.com')) {
                    const match = cleanFolderId.match(/folders\/([a-zA-Z0-9_-]+)/);
                    if (match) cleanFolderId = match[1];
                }

                const res = await fetch(`${proxyUrl}/api/drive/list/${cleanFolderId}`, { headers: await getProxyHeaders() });
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
                        assetsToAdd.forEach(a => { a.id = generateId(); });
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
        const postedTitleCache = new Map();
        const usedTitlesSession = new Set(
            allModelTasksToday
                .map(t => TitleGuardService.normalize(t.title || ''))
                .filter(Boolean)
        );

        // 2. Spread tasks evenly across accounts via round-robin
        // Calculate total available sub slots and fair share per account
        const totalAvailableSubs = provenSubs.length + testingSubs.length + fallbackSubs.length;
        const totalExistingToday = allModelTasksToday.filter(t => t.taskType === 'post' || !t.taskType).length;

        // When totalTarget is provided, distribute the remaining target across accounts
        // instead of using per-account dailyCap
        let accountTargets = null;
        if (totalTarget != null && activeAccounts.length > 0) {
            const totalToGenerate = Math.max(0, totalTarget - totalExistingToday);
            if (totalToGenerate <= 0) {
                console.log('DailyPlanGenerator: Already at or above target, nothing to generate');
                return await db.tasks.where('modelId').equals(modelId).filter(t => t.date === todayStr).toArray();
            }
            // Distribute evenly across accounts, with remainder going to first accounts
            const perAccount = Math.floor(totalToGenerate / activeAccounts.length);
            const remainder = totalToGenerate % activeAccounts.length;
            accountTargets = new Map();
            activeAccounts.forEach((acc, i) => {
                const accountExisting = allModelTasksToday.filter(t => t.accountId === acc.id).length;
                accountTargets.set(acc.id, perAccount + (i < remainder ? 1 : 0) + accountExisting);
            });
        }

        const fairSharePerAccount = activeAccounts.length > 0
            ? Math.max(1, Math.floor(totalAvailableSubs / activeAccounts.length))
            : 0;

        for (const account of activeAccounts) {
            const accountTasksToday = allModelTasksToday.filter(t => t.accountId === account.id);

            let accountQuota;
            if (accountTargets) {
                // Use the distributed target for this account
                accountQuota = accountTargets.get(account.id) || 0;
            } else {
                const rawQuota = account.dailyCap || 999; // Only per-account cap matters
                // Cap at fair share to ensure even spread when subs are limited
                accountQuota = totalAvailableSubs < (rawQuota * activeAccounts.length)
                    ? Math.min(rawQuota, fairSharePerAccount)
                    : rawQuota;
            }
            const tasksToGenerate = accountQuota - accountTasksToday.length;

            if (tasksToGenerate <= 0) continue;

            let selectedSubsForAccount = [];
            const accountTestingSubs = testingSubs.filter(s => !s.accountId || Number(s.accountId) === Number(account.id));
            const accountFallbackSubs = fallbackSubs.filter(s => !s.accountId || Number(s.accountId) === Number(account.id));
            const accountProvenSubs = provenSubs.filter(s => !s.accountId || Number(s.accountId) === Number(account.id));

            // Try to pick Testing Subs first if global limit allows
            for (const sub of accountTestingSubs) {
                if (selectedSubsForAccount.length < tasksToGenerate && testsRemaining > 0 && canUseSubreddit(sub.id, false)) {
                    selectedSubsForAccount.push(sub);
                    markSubredditUsed(sub.id);
                    testsRemaining--;
                }
            }
            // If still need more subs and we have a fallback list, use it
            if (selectedSubsForAccount.length < tasksToGenerate && accountFallbackSubs.length > 0) {
                for (const sub of accountFallbackSubs) {
                    if (selectedSubsForAccount.length >= tasksToGenerate) break;
                    if (canUseSubreddit(sub.id, false)) {
                        selectedSubsForAccount.push(sub);
                        markSubredditUsed(sub.id);
                    }
                }
            }

            // Fill remainder with Proven Subs
            for (const sub of accountProvenSubs) {
                if (selectedSubsForAccount.length < tasksToGenerate && canUseSubreddit(sub.id, false)) {
                    selectedSubsForAccount.push(sub);
                    markSubredditUsed(sub.id);
                }
            }

            // Backfill quota when unique subreddits are exhausted
            if (Number(settings.allowSubredditRepeatsInQueue || 0) === 1 && selectedSubsForAccount.length < tasksToGenerate) {
                const canBackfillFromTesting = accountProvenSubs.length === 0 && accountFallbackSubs.length === 0;
                const reusablePool = [
                    ...accountProvenSubs,
                    ...accountFallbackSubs,
                    ...(canBackfillFromTesting ? accountTestingSubs : []),
                ];

                for (const sub of reusablePool) {
                    if (selectedSubsForAccount.length >= tasksToGenerate) break;
                    if (selectedSubsForAccount.some(existing => existing.id === sub.id)) continue;
                    if (!canUseSubreddit(sub.id, true)) continue;
                    selectedSubsForAccount.push(sub);
                    markSubredditUsed(sub.id);
                }
            }

            // Assign assets to selected subreddits for this account
            const cooldownDate = subDays(targetDate, settings.assetReuseCooldownDays);
            const accountAgeDays = account.createdUtc
                ? Math.floor((Date.now() - Number(account.createdUtc) * 1000) / (24 * 60 * 60 * 1000))
                : 9999;
            const accountKarma = Number(account.totalKarma || 0);

            // SHUFFLE assets before starting to ensure we don't always pick the same one as fallback
            const shuffledAssets = [...activeAssets].sort(() => Math.random() - 0.5);

            for (const sub of selectedSubsForAccount) {
                // Risk-level guard: new/low-karma accounts only get low-risk subs
                const autoRisk = SubredditGuardService.calculateRiskLevel(sub);
                if ((accountAgeDays < 30 || accountKarma < 500) && autoRisk === 'high') {
                    continue;
                }
                if (sub.minRequiredKarma && accountKarma < Number(sub.minRequiredKarma)) {
                    continue;
                }
                if (sub.minAccountAgeDays && accountAgeDays < Number(sub.minAccountAgeDays)) {
                    continue;
                }

                // Verification guard: if sub requires verification, only assign verified accounts
                if (sub.requiresVerified) {
                    const isVerified = await VerificationService.isVerified(account.id, sub.id);
                    if (!isVerified) continue;
                }

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

                // 4. Emergency Pass: IGNORE cooldown entirely rather than skip the subreddit
                // Better to reuse an older asset than generate no task at all
                if (!selectedAsset) {
                    console.warn(`[DailyPlan] All assets on cooldown for r/${sub.name} — ignoring cooldown to avoid empty slot`);
                    const emergencyOrder = [...shuffledAssets].sort((a, b) => {
                        const aGen = (a.angleTag || 'general') === 'general';
                        const bGen = (b.angleTag || 'general') === 'general';
                        return (bGen ? 1 : 0) - (aGen ? 1 : 0);
                    });
                    for (const asset of emergencyOrder) {
                        const timesUsedToday = usedAssetsInSession.get(asset.id) || 0;
                        if (timesUsedToday >= 5) continue;
                        selectedAsset = asset;
                        break;
                    }
                }

                if (!selectedAsset) {
                    console.error(`[DailyPlan] SKIPPED r/${sub.name} — every asset hit 5 uses/day limit. Upload more content to Library!`);
                }

                if (selectedAsset) {
                    usedAssetsInSession.set(selectedAsset.id, (usedAssetsInSession.get(selectedAsset.id) || 0) + 1);

                    // Fetch previous titles to pass to AI so it avoids duplicates
                    const pastTasks = await db.tasks.where('modelId').equals(modelId).toArray();
                    const previousTitles = pastTasks.map(t => t.title).filter(Boolean);

                    // Create async closure to process this task in parallel
                    const generateTaskPromise = async () => {
                        let currentRules = sub.rulesSummary;

                        if (!currentRules) {
                            const proxyUrl = await SettingsService.getProxyUrl();
                            console.log(`On-the-fly scraping rules for r/${sub.name}...`);
                            try {
                                const cleanName = sub.name.replace(/^(r\/|\/r\/)/i, '');
                                const res = await fetchWithTimeout(`${proxyUrl}/api/scrape/subreddit/${cleanName}`, {}, 4000);
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
                                console.warn("Failed to fetch on-the-fly deep metadata for", sub.name);
                            }
                        }

                        const cacheKey = `${modelId}:${sub.id}`;
                        let postedTitles = postedTitleCache.get(cacheKey);
                        if (!postedTitles) {
                            postedTitles = await TitleGuardService.getRecentPostedTitles(modelId, sub.id, 90);
                            postedTitleCache.set(cacheKey, postedTitles);
                        }

                        // Generate AI title based on top 50 scraped posts for THIS specific subreddit
                        let aiTitle = await TitleGeneratorService.generateTitle(
                            sub.name,
                            currentRules,
                            sub.requiredFlair,
                            previousTitles,
                            {
                                assetType: selectedAsset.assetType,
                                angleTag: selectedAsset.angleTag,
                                modelVoiceProfile: model?.voiceProfile || '',
                                accountVoiceOverride: account?.voiceOverride || ''
                            }
                        );

                        // Hard guard: avoid duplicates and low-quality CTA/error style titles.
                        let attempt = 0;
                        while (
                            attempt < 4 && (
                                postedTitles.some(t => TitleGuardService.isTooClose(aiTitle, t))
                                || TitleGuardService.isLowQuality(aiTitle)
                                || TitleGuardService.isContextMismatch(aiTitle, { assetType: selectedAsset.assetType, angleTag: selectedAsset.angleTag })
                            )
                        ) {
                            attempt++;
                            aiTitle = await TitleGeneratorService.generateTitle(
                                sub.name,
                                currentRules,
                                sub.requiredFlair,
                                [...previousTitles, ...postedTitles, aiTitle],
                                {
                                    assetType: selectedAsset.assetType,
                                    angleTag: selectedAsset.angleTag,
                                    modelVoiceProfile: model?.voiceProfile || '',
                                    accountVoiceOverride: account?.voiceOverride || ''
                                }
                            );
                        }

                        if (
                            TitleGuardService.isLowQuality(aiTitle)
                            || TitleGuardService.isContextMismatch(aiTitle, { assetType: selectedAsset.assetType, angleTag: selectedAsset.angleTag })
                        ) {
                            aiTitle = TitleGuardService.buildSafeFallback({ angleTag: selectedAsset.angleTag });
                        }

                        let dedupeAttempts = 0;
                        while (dedupeAttempts < 4 && usedTitlesSession.has(TitleGuardService.normalize(aiTitle))) {
                            dedupeAttempts++;
                            aiTitle = await TitleGeneratorService.generateTitle(
                                sub.name,
                                currentRules,
                                sub.requiredFlair,
                                [...previousTitles, ...postedTitles, aiTitle],
                                {
                                    assetType: selectedAsset.assetType,
                                    angleTag: selectedAsset.angleTag,
                                    modelVoiceProfile: model?.voiceProfile || '',
                                    accountVoiceOverride: account?.voiceOverride || ''
                                }
                            );
                        }

                        const normalizedFinal = TitleGuardService.normalize(aiTitle);
                        if (!normalizedFinal || usedTitlesSession.has(normalizedFinal)) {
                            aiTitle = `${TitleGuardService.buildSafeFallback({ angleTag: selectedAsset.angleTag })} ${Math.floor(Math.random() * 900 + 100)}`;
                        }

                        usedTitlesSession.add(TitleGuardService.normalize(aiTitle));

                        postedTitles.push(aiTitle);
                        postedTitleCache.set(cacheKey, postedTitles);

                        return {
                            date: todayStr,
                            modelId,
                            accountId: account.id,
                            subredditId: sub.id,
                            assetId: selectedAsset.id,
                            title: aiTitle,
                            taskType: 'post',
                            postingWindow: 'Morning', // Could be randomized later
                            status: 'generated'
                        };
                    };

                    taskGenerationPromises.push(generateTaskPromise);
                }
            }
        }

        // Process sequentially to guarantee deterministic de-duplication
        let finalNewTasks = [];

        for (const generateTaskFn of taskGenerationPromises) {
            const one = await generateTaskFn();
            finalNewTasks.push(one);
        }

        // Engagement (commenting/upvoting) is done manually on feed — no auto-generated engagement tasks.
        // Only warming accounts get warmup tasks below since they can't post yet.

        const allSubsForEngagement = [...provenSubs, ...testingSubs, ...fallbackSubs];

        // Generate warmup-only tasks for warming accounts
        for (const warmAcc of warmingAccounts) {
            const existingWarmupToday = allModelTasksToday.filter(t => t.accountId === warmAcc.id);
            if (existingWarmupToday.length > 0) continue; // Already has tasks today

            const shuffledSubs = [...allSubsForEngagement].sort(() => Math.random() - 0.5);
            const warmupCount = Math.min(3, shuffledSubs.length);
            for (let i = 0; i < warmupCount; i++) {
                const sub = shuffledSubs[i];
                const warmupActions = ['comment', 'upvote', 'upvote'];
                finalNewTasks.push({
                    date: todayStr,
                    modelId,
                    accountId: warmAcc.id,
                    subredditId: sub.id,
                    assetId: null,
                    title: warmupActions[i] === 'comment'
                        ? `Warmup: Leave a genuine comment in r/${sub.name}`
                        : `Warmup: Browse & upvote posts in r/${sub.name}`,
                    taskType: 'warmup',
                    postingWindow: 'Anytime',
                    status: 'generated'
                });
            }
        }

        // ========== SMART POST TIMING ==========
        // Schedule posts at each subreddit's peak hour instead of a fixed 9AM start.
        // Falls back to NSFW defaults (20:00 UTC = evening US) if no data.
        const postInterval = 0; // No forced delay — VAs post as fast as they want
        const defaultPeakHour = 20; // 8PM UTC (evening US — peak NSFW window)

        // Build lookup: subredditId → peakPostHour (0-23)
        const allSubIds = [...new Set(finalNewTasks.map(t => t.subredditId).filter(Boolean))];
        const subPeakMap = new Map();
        for (const sid of allSubIds) {
            const sub = await db.subreddits.get(sid);
            subPeakMap.set(sid, sub?.peakPostHour != null ? sub.peakPostHour : defaultPeakHour);
        }

        // Sort tasks: posts by peak hour (earliest first), then engagement/warmup at end
        const taskOrder = (t) => {
            if (t.taskType !== 'post') return 2400; // engagement/warmup go last
            return subPeakMap.get(t.subredditId) ?? defaultPeakHour;
        };
        finalNewTasks.sort((a, b) => taskOrder(a) - taskOrder(b));

        // Stagger per account, starting from each task's subreddit peak hour
        const accountTimeSlots = new Map();
        for (const task of finalNewTasks) {
            const peakHour = task.taskType === 'post'
                ? (subPeakMap.get(task.subredditId) ?? defaultPeakHour)
                : 9; // engagement/warmup start in morning
            const peakMinutes = peakHour * 60;
            const currentMinutes = accountTimeSlots.get(task.accountId);
            // Use whichever is later: the peak hour or the account's next available slot
            const startMinutes = currentMinutes != null ? Math.max(currentMinutes, peakMinutes) : peakMinutes;
            const hours = Math.floor(startMinutes / 60) % 24;
            const mins = startMinutes % 60;
            task.scheduledTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            const gap = task.taskType === 'post' ? postInterval : 5;
            accountTimeSlots.set(task.accountId, startMinutes + gap);
        }

        if (finalNewTasks.length > 0) { // Finalize
            finalNewTasks.forEach(t => { t.id = generateId(); });
            await db.tasks.bulkAdd(finalNewTasks);
            // Mark dirty so pull doesn't overwrite before push completes
            for (const t of finalNewTasks) await markDirty('tasks', t.id);
            console.log(`DailyPlanGenerator: Generated ${finalNewTasks.length} tasks for model ${modelId}`);

            // Mark each account that received tasks as active for the day (tracks consecutiveActiveDays)
            const accountsWithTasks = new Set(finalNewTasks.map(t => t.accountId));
            for (const accId of accountsWithTasks) {
                await AccountLifecycleService.markAccountActiveDay(accId);
            }

            // Auto-push to cloud so others (VAs) see the new plan immediately
            await CloudSyncService.autoPush();
        }

        return await db.tasks.where('modelId').equals(modelId).filter(t => t.date === todayStr).toArray();
    }
};

export const AnalyticsEngine = {
    computeAccountHealthScore(account) {
        let score = 100;
        const removalRate = Number(account.removalRate || 0);
        score -= removalRate * 0.5;
        if (account.isSuspended) score -= 15;
        // Inactive 7+ days
        if (account.lastSyncDate) {
            const daysSinceSync = differenceInDays(new Date(), new Date(account.lastSyncDate));
            if (daysSinceSync >= 7) score -= 10;
        } else if (account.lastActiveDate) {
            const daysSinceActive = differenceInDays(new Date(), new Date(account.lastActiveDate));
            if (daysSinceActive >= 7) score -= 10;
        }
        const karma = Number(account.totalKarma || 0);
        if (karma > 5000) score += 10;
        else if (karma > 1000) score += 5;
        return Math.max(0, Math.min(100, Math.round(score)));
    },

    computeProfileScore(account) {
        let score = 0;
        if (account.hasAvatar) score += 15;
        if (account.hasBanner) score += 10;
        if (account.hasBio) score += 15;
        if (account.hasDisplayName) score += 10;
        if (account.hasVerifiedEmail) score += 10;
        if (account.hasProfileLink) score += 10;
        // Account age > 7 days
        if (account.createdUtc) {
            const ageDays = Math.floor((Date.now() - Number(account.createdUtc) * 1000) / (24 * 60 * 60 * 1000));
            if (ageDays >= 15) score += 15;
        }
        // Karma > 100
        if (Number(account.totalKarma || 0) >= 100) score += 15;
        return Math.min(100, score);
    },

    getManagerSignals({ tasksCompleted, avgViewsPerPost, removalRatePct, worstSubreddits, testingSubs, provenSubs }) {
        const confidence = tasksCompleted >= 15 ? 'high' : tasksCompleted >= 5 ? 'medium' : 'low';
        const removalPenalty = Math.min(40, removalRatePct * 1.2);
        const scaleScore = Math.min(40, avgViewsPerPost * 0.8);
        const provenBonus = Math.min(12, provenSubs * 2);
        const testingBonus = testingSubs > 0 ? 8 : 0;
        const dangerPenalty = Math.min(20, (worstSubreddits?.length || 0) * 8);

        const healthScore = Math.max(0, Math.min(100, Math.round(40 + scaleScore + provenBonus + testingBonus - removalPenalty - dangerPenalty)));

        let status = 'healthy';
        if (healthScore < 45) status = 'critical';
        else if (healthScore < 70) status = 'watch';

        let primaryAction = 'Keep scaling proven subreddits and maintain posting quality.';
        if (confidence === 'low') {
            primaryAction = 'Low sample size: run more tests before changing strategy.';
        } else if (removalRatePct >= 25) {
            primaryAction = 'High removals: pause risky subs and tighten title/rules compliance.';
        } else if (worstSubreddits?.length > 0) {
            primaryAction = 'Review flagged subreddits and reduce exposure until removals drop.';
        } else if (testingSubs === 0) {
            primaryAction = 'No testing pipeline: add fresh subreddits to avoid growth plateaus.';
        }

        return {
            healthScore,
            confidence,
            status,
            primaryAction
        };
    },

    async _getModelTasksByWindow(modelId, lookbackDays = null, accountId = null) {
        const allTasks = await db.tasks.where('modelId').equals(modelId).toArray();
        const byAccount = accountId ? allTasks.filter(t => Number(t.accountId) === Number(accountId)) : allTasks;
        if (!lookbackDays) return byAccount;
        const cutoffIso = subDays(new Date(), Number(lookbackDays)).toISOString();
        return byAccount.filter(t => !t.date || t.date >= cutoffIso);
    },

    async getSubredditPerformanceRows(modelId, lookbackDays = 30, accountId = null) {
        const subreddits = await db.subreddits.where('modelId').equals(modelId).toArray();
        const recentTasks = await this._getModelTasksByWindow(modelId, lookbackDays, accountId);
        const taskIds = recentTasks.map(t => t.id);
        const performances = taskIds.length > 0
            ? await db.performances.where('taskId').anyOf(taskIds).toArray()
            : [];

        const perfByTaskId = new Map(performances.map(p => [p.taskId, p]));

        return subreddits.map(sub => {
            const matchedTasks = recentTasks.filter(t => {
                if (t.subredditId === sub.id) return true;
                if (t.redditUrl) {
                    const urlMatch = t.redditUrl.match(/\/r\/([^\/]+)/i);
                    if (urlMatch && urlMatch[1].toLowerCase() === sub.name.toLowerCase()) return true;
                }
                return false;
            });

            let totalViews = 0;
            let removals = 0;
            let tests = 0;

            for (const task of matchedTasks) {
                const perf = perfByTaskId.get(task.id);
                if (!perf) continue;
                tests++;
                totalViews += Number(perf.views24h || 0);
                if (perf.removed) removals++;
            }

            return {
                name: sub.name,
                status: sub.status,
                totalTests: tests,
                avgViews: tests > 0 ? Math.round(totalViews / tests) : 0,
                removalPct: tests > 0 ? Number(((removals / tests) * 100).toFixed(1)) : 0,
            };
        });
    },

    async getMetrics(modelId, lookbackDays = null, accountId = null) {
        // Basic implementation for MVP metrics
        const allTasks = await this._getModelTasksByWindow(modelId, lookbackDays, accountId);
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

        // Subreddits breakdown (scoped to selected account/date window when filters are active)
        const subredditRows = await this.getSubredditPerformanceRows(modelId, lookbackDays || 30, accountId);
        const subredditsWithData = subredditRows.filter(s => Number(s.totalTests || 0) > 0);
        const provenSubs = subredditsWithData.filter(s => s.status === 'proven').length;
        const testingSubs = subredditsWithData.filter(s => s.status === 'testing').length;

        const topSubreddits = subredditRows
            .slice()
            .sort((a, b) => b.avgViews - a.avgViews)
            .slice(0, 5);

        const worstSubreddits = subredditRows
            .filter(s => s.totalTests >= 3 && s.removalPct >= 40)
            .map(s => ({
                name: s.name,
                avgUps: s.avgViews || 0,
                removalPct: s.removalPct || 0,
                status: s.status,
                totalTests: s.totalTests || 0,
                action: s.removalPct >= 70 ? "Ban Risk — Stop Immediately" : "High Removals — Review Rules"
            }))
            .sort((a, b) => b.removalPct - a.removalPct)
            .slice(0, 10);
        const accountRankings = await this.getAccountRankings(modelId, lookbackDays, accountId);

        const managerSignals = this.getManagerSignals({
            tasksCompleted: performances.length,
            avgViewsPerPost: Number(avgViewsPerPost),
            removalRatePct: Number(removalRatePct),
            worstSubreddits,
            testingSubs,
            provenSubs,
        });

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
            nichePerformance: await this.getNichePerformance(modelId, lookbackDays, accountId),
            topAssets: await this.getAssetPerformance(modelId, lookbackDays, 12, accountId),
            topSubreddits,
            worstSubreddits,
            accountRankings,
            managerSignals
        };
    },

    async getNichePerformance(modelId, lookbackDays = null, accountId = null) {
        const assets = await db.assets.where('modelId').equals(modelId).toArray();
        const nicheStats = {};
        const filteredTasks = await this._getModelTasksByWindow(modelId, lookbackDays, accountId);
        const taskByAssetId = new Map();
        filteredTasks.forEach(t => {
            if (!taskByAssetId.has(t.assetId)) taskByAssetId.set(t.assetId, []);
            taskByAssetId.get(t.assetId).push(t);
        });

        for (const asset of assets) {
            const tag = asset.angleTag || 'untagged';
            if (!nicheStats[tag]) nicheStats[tag] = { views: 0, posts: 0, removals: 0 };

            const tasks = taskByAssetId.get(asset.id) || [];
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

    async getAssetPerformance(modelId, lookbackDays = null, limit = 12, accountId = null) {
        const tasks = await this._getModelTasksByWindow(modelId, lookbackDays, accountId);
        const assetTaskMap = new Map();

        tasks.forEach(task => {
            if (!task.assetId) return;
            if (!assetTaskMap.has(task.assetId)) assetTaskMap.set(task.assetId, []);
            assetTaskMap.get(task.assetId).push(task);
        });

        const assetIds = Array.from(assetTaskMap.keys());
        if (assetIds.length === 0) return [];

        const assets = await db.assets.where('id').anyOf(assetIds).toArray();
        const assetById = new Map(assets.map(asset => [asset.id, asset]));

        const rows = [];
        for (const assetId of assetIds) {
            const asset = assetById.get(assetId);
            if (!asset) continue;

            const linkedTasks = assetTaskMap.get(assetId) || [];
            let syncedPosts = 0;
            let totalViews = 0;
            let removals = 0;
            let lastPostedDate = '';

            for (const task of linkedTasks) {
                if (task.date && task.date > lastPostedDate) lastPostedDate = task.date;
                const perf = await db.performances.where('taskId').equals(task.id).first();
                if (!perf) continue;
                syncedPosts++;
                totalViews += Number(perf.views24h || 0);
                if (perf.removed) removals++;
            }

            rows.push({
                assetId,
                fileName: asset.fileName || `${asset.assetType || 'asset'}-${asset.id}`,
                assetType: asset.assetType || 'unknown',
                angleTag: asset.angleTag || 'general',
                driveFileId: asset.driveFileId || '',
                thumbnailUrl: asset.thumbnailUrl || '',
                posts: linkedTasks.length,
                syncedPosts,
                totalViews,
                avgViews: syncedPosts > 0 ? Math.round(totalViews / syncedPosts) : 0,
                removalRate: syncedPosts > 0 ? Number(((removals / syncedPosts) * 100).toFixed(1)) : 0,
                lastPostedDate: lastPostedDate || null,
            });
        }

        return rows
            .sort((a, b) => {
                if (b.avgViews !== a.avgViews) return b.avgViews - a.avgViews;
                return b.totalViews - a.totalViews;
            })
            .slice(0, limit);
    },

    async getSubredditRankings(modelId, lookbackDays = 30, accountId = null) {
        const rankings = await this.getSubredditPerformanceRows(modelId, lookbackDays, accountId);
        rankings.sort((a, b) => b.avgViews - a.avgViews);

        return rankings.slice(0, 5); // Top 5
    },

    async getWorstSubreddits(modelId, lookbackDays = 30, accountId = null) {
        // Manager-safe logic: do-not-post only when sample size is meaningful in last 30 days
        const rows = await this.getSubredditPerformanceRows(modelId, lookbackDays, accountId);
        const badSubs = rows
            .filter(s => s.totalTests >= 3 && s.removalPct >= 40)
            .map(s => ({
                name: s.name,
                avgUps: s.avgViews || 0,
                removalPct: s.removalPct || 0,
                status: s.status,
                totalTests: s.totalTests || 0,
                action: s.removalPct >= 70 ? "Ban Risk — Stop Immediately" : "High Removals — Review Rules"
            }))
            .sort((a, b) => b.removalPct - a.removalPct);

        return badSubs.slice(0, 10);
    },

    async getAccountRankings(modelId, lookbackDays = null, accountId = null) {
        const accounts = await db.accounts.where('modelId').equals(modelId).toArray();
        const filteredTasks = await this._getModelTasksByWindow(modelId, lookbackDays, accountId);
        const results = [];

        const scopedAccounts = accountId ? accounts.filter(a => Number(a.id) === Number(accountId)) : accounts;
        for (const acc of scopedAccounts) {
            // Find tasks posted by this account
            const accountTasks = filteredTasks.filter(t => t.accountId === acc.id && t.status === 'closed');

            let totalUps = 0;
            let removedCount = 0;
            let syncedPosts = 0;

            for (const task of accountTasks) {
                const perf = await db.performances.where('taskId').equals(task.id).first();
                if (perf) {
                    totalUps += perf.views24h || 0;
                    if (perf.removed) removedCount++;
                    syncedPosts++;
                }
            }

            results.push({
                id: acc.id,
                handle: acc.handle,
                karma: acc.totalKarma || 0,
                cqs: acc.cqsStatus || 'Unknown',
                status: acc.status,
                isSuspended: acc.isSuspended,
                totalPosts: accountTasks.length,
                totalUps,
                avgUpsPerPost: syncedPosts > 0 ? Math.round(totalUps / syncedPosts) : 0,
                removalRate: syncedPosts > 0 ? Number(((removedCount / syncedPosts) * 100).toFixed(1)) : 0,
                removedCount
            });
        }

        return results.sort((a, b) => b.totalUps - a.totalUps);
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
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const tasksToday = await db.tasks.filter(t => {
            if (!t?.date) return false;
            return t.date >= startIso && t.date < endIso;
        }).toArray();
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

export const CompetitorService = {
    async addCompetitor(modelId, handle) {
        const cleanHandle = handle.replace(/^(u\/|\/u\/)/i, '').trim();
        if (!cleanHandle) return null;
        // Check duplicate
        const existing = await db.competitors.where('modelId').equals(modelId)
            .and(c => c.handle.toLowerCase() === cleanHandle.toLowerCase()).first();
        if (existing) return existing;
        const id = generateId();
        await db.competitors.add({
            id,
            modelId,
            handle: cleanHandle,
            addedDate: new Date().toISOString(),
            totalKarma: 0,
            prevKarma: 0,
            topSubreddits: [],
            lastScrapedDate: null,
            notes: ''
        });
        try { await CloudSyncService.autoPush(['competitors']); } catch (e) { /* non-critical */ }
        return db.competitors.get(id);
    },

    async scrapeCompetitor(competitorId) {
        const comp = await db.competitors.get(competitorId);
        if (!comp) return null;
        const proxyUrl = await SettingsService.getProxyUrl();

        // Fetch stats
        let karma = comp.totalKarma || 0;
        try {
            const statsRes = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/stats/${comp.handle}`, {}, 8000);
            if (statsRes.ok) {
                const stats = await statsRes.json();
                karma = stats.totalKarma || 0;
            }
        } catch (e) { /* non-critical */ }

        // Fetch recent posts to find top subreddits
        let topSubs = comp.topSubreddits || [];
        try {
            const postsRes = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/${comp.handle}`, {}, 10000);
            if (postsRes.ok) {
                const data = await postsRes.json();
                const posts = data?.data?.children || [];
                const subMap = new Map();
                for (const post of posts) {
                    const subName = post.data?.subreddit;
                    if (!subName) continue;
                    if (!subMap.has(subName)) {
                        subMap.set(subName, { name: subName, posts: 0, avgUps: 0, totalUps: 0 });
                    }
                    const bucket = subMap.get(subName);
                    bucket.posts++;
                    bucket.totalUps += Number(post.data?.ups || 0);
                    bucket.avgUps = Math.round(bucket.totalUps / bucket.posts);
                }
                topSubs = Array.from(subMap.values())
                    .sort((a, b) => b.posts - a.posts)
                    .slice(0, 10);
            }
        } catch (e) { /* non-critical */ }

        const patch = {
            prevKarma: comp.totalKarma || 0,
            totalKarma: karma,
            topSubreddits: topSubs,
            lastScrapedDate: new Date().toISOString()
        };
        await db.competitors.update(competitorId, patch);
        try { await CloudSyncService.autoPush(['competitors']); } catch (e) { /* non-critical */ }
        return { ...comp, ...patch };
    },

    async scrapeAllCompetitors(modelId) {
        const comps = modelId
            ? await db.competitors.where('modelId').equals(modelId).toArray()
            : await db.competitors.toArray();
        let succeeded = 0, failed = 0;
        for (const comp of comps) {
            try {
                await this.scrapeCompetitor(comp.id);
                succeeded++;
            } catch (e) { failed++; }
        }
        return { total: comps.length, succeeded, failed };
    },

    async deleteCompetitor(competitorId) {
        await db.competitors.delete(competitorId);
        try {
            await CloudSyncService.deleteFromCloud('competitors', competitorId);
        } catch (e) { /* non-critical */ }
    }
};

export const SnapshotService = {
    async takeDailySnapshot() {
        const today = startOfDay(new Date()).toISOString();
        // Check if we already have a snapshot for today
        const existing = await db.dailySnapshots.where('date').equals(today).first();

        const accounts = await db.accounts.toArray();
        const tasks = await db.tasks.toArray();
        const performances = await db.performances.toArray();
        const perfByTaskId = new Map(performances.map(p => [p.taskId, p]));

        const totalKarma = accounts.reduce((sum, a) => sum + Number(a.totalKarma || 0), 0);
        const totalAccounts = accounts.length;
        const activeAccounts = accounts.filter(a => {
            const phase = a.phase || 'ready';
            return a.status === 'active' && (phase === 'ready' || phase === 'active');
        }).length;

        const todayTasks = tasks.filter(t => t.date === today);
        const postsToday = todayTasks.filter(t => t.status === 'closed' || t.status === 'failed').length;
        let removalsToday = 0;
        for (const t of todayTasks) {
            const p = perfByTaskId.get(t.id);
            if (p?.removed) removalsToday++;
        }

        const totalUpvotes = performances.reduce((sum, p) => sum + Number(p.views24h || 0), 0);

        const snapshot = {
            date: today,
            totalKarma,
            totalAccounts,
            activeAccounts,
            postsToday,
            removalsToday,
            totalUpvotes,
            takenAt: new Date().toISOString()
        };

        if (existing) {
            await db.dailySnapshots.update(existing.id, snapshot);
        } else {
            await db.dailySnapshots.add({ id: generateId(), ...snapshot });
        }
        return snapshot;
    },

    async getSnapshots(days = 14) {
        const cutoff = startOfDay(subDays(new Date(), days)).toISOString();
        return db.dailySnapshots
            .where('date')
            .aboveOrEqual(cutoff)
            .sortBy('date');
    }
};

export const CloudSyncService = {
    _syncLock: false,

    async isEnabled() {
        const settings = await SettingsService.getSettings();
        return !!(settings.supabaseUrl && settings.supabaseAnonKey);
    },

    // Cache of known cloud columns per table (populated on first push)
    _cloudColumns: {},

    async _getCloudColumns(supabase, table) {
        if (this._cloudColumns[table]) return this._cloudColumns[table];
        try {
            const { data, error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                // Table might not exist — return null so caller can skip
                if (/schema cache|relation.*does not exist|not found/i.test(error.message || '')) return null;
                return null;
            }
            if (data && data.length > 0) {
                this._cloudColumns[table] = new Set(Object.keys(data[0]));
            } else {
                // Empty table — try inserting a dummy to discover columns from error, or just allow all
                this._cloudColumns[table] = null; // null = don't filter
            }
        } catch (e) {
            this._cloudColumns[table] = null;
        }
        return this._cloudColumns[table];
    },

    _stripUnknownColumns(rows, knownColumns) {
        if (!knownColumns) return rows; // null = allow all (empty table)
        return rows.map(row => {
            const clean = {};
            for (const key of Object.keys(row)) {
                if (knownColumns.has(key)) clean[key] = row[key];
            }
            return clean;
        });
    },

    async acquireLock() {
        if (this._syncLock) return false;
        this._syncLock = true;
        return true;
    },

    releaseLock() {
        this._syncLock = false;
    },

    get isLocked() {
        return this._syncLock;
    },

    async pushLocalToCloud(onlyTables = null) {
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const allTables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings', 'verifications', 'dailySnapshots', 'competitors'];
        const tables = onlyTables || allTables;
        const TASK_STATUS_RANK = { 'generated': 1, 'failed': 2, 'closed': 3 };

        // Pre-compute account IDs that will be excluded from push (no handle = NOT NULL violation)
        // Dependent tables (tasks, subreddits, verifications) must also exclude rows referencing these
        const fkTables = ['accounts', 'tasks', 'subreddits', 'verifications'];
        const needsExclusionCheck = tables.some(t => fkTables.includes(t));
        const excludedAccountIds = new Set();
        if (needsExclusionCheck) {
            const allAccounts = await db.accounts.toArray();
            for (const acc of allAccounts) {
                if (!acc.handle) excludedAccountIds.add(acc.id);
            }
        }

        // Process pending deletes from _syncMeta (persistent, survives refresh)
        for (const table of tables) {
            try {
                const pendingDels = await getPendingDeleteIds(table);
                if (pendingDels.size > 0) {
                    for (const id of pendingDels) {
                        await supabase.from(table).delete().eq('id', id);
                        await clearSyncMeta(table, id);
                    }
                    console.log(`[CloudSync] Processed ${pendingDels.size} pending deletes for ${table}`);
                }
                // Process pending clears
                if (await hasPendingClear(table)) {
                    await supabase.from(table).delete().neq('id', '__impossible__');
                    await clearAllSyncMeta(table);
                    console.log(`[CloudSync] Processed pending clear for ${table}`);
                }
            } catch (e) { console.warn(`[CloudSync] Pending delete processing failed for ${table}:`, e.message); }
        }

        for (const table of tables) {
            const localData = await db[table].toArray();
            if (localData.length === 0) continue;

            let cleanData = localData.map(item => {
                const { ...rest } = item;
                if (table === 'assets' && rest.fileBlob) delete rest.fileBlob;
                return rest;
            }).filter(Boolean);

            // Skip accounts with missing handle — Supabase has NOT NULL constraint
            if (table === 'accounts') {
                cleanData = cleanData.filter(row => !!row.handle);
            }

            // Skip rows that reference excluded accounts — prevents FK violations
            if (excludedAccountIds.size > 0) {
                if (table === 'tasks' || table === 'subreddits' || table === 'verifications') {
                    cleanData = cleanData.filter(row => !row.accountId || !excludedAccountIds.has(row.accountId));
                }
            }

            if (cleanData.length === 0) continue;

            // For settings: match local rows to cloud by `key` to avoid unique constraint violation
            if (table === 'settings') {
                try {
                    const { data: cloudSettings } = await supabase.from('settings').select('id, key');
                    if (cloudSettings && cloudSettings.length > 0) {
                        const cloudByKey = new Map(cloudSettings.map(s => [s.key, s.id]));
                        cleanData = cleanData.map(row => {
                            const cloudId = cloudByKey.get(row.key);
                            if (cloudId !== undefined && cloudId !== row.id) {
                                return { ...row, id: cloudId };
                            }
                            return row;
                        });
                    }
                } catch (e) {
                    console.warn('[CloudSync] Could not pre-fetch cloud settings for merge:', e.message);
                }
            }

            // For tasks: fetch cloud versions first to avoid downgrading status
            if (table === 'tasks') {
                try {
                    const { data: cloudTasks } = await supabase.from('tasks').select('id, status, redditUrl, redditPostId');
                    if (cloudTasks && cloudTasks.length > 0) {
                        const cloudById = new Map(cloudTasks.map(t => [t.id, t]));
                        cleanData = cleanData.map(local => {
                            const cloud = cloudById.get(local.id);
                            if (!cloud) return local;
                            const localRank = TASK_STATUS_RANK[local.status] || 0;
                            const cloudRank = TASK_STATUS_RANK[cloud.status] || 0;
                            if (cloudRank > localRank) {
                                // Cloud is more advanced — don't downgrade
                                return { ...local, status: cloud.status, redditUrl: cloud.redditUrl || local.redditUrl, redditPostId: cloud.redditPostId || local.redditPostId };
                            }
                            // Local is more advanced or equal — push local but preserve any Reddit data
                            return { ...local, redditUrl: local.redditUrl || cloud.redditUrl, redditPostId: local.redditPostId || cloud.redditPostId };
                        });
                    }
                } catch (e) {
                    console.warn('[CloudSync] Could not pre-fetch cloud tasks for merge:', e.message);
                }
            }

            // Discover valid cloud columns for this table (once, cached)
            const cloudCols = await this._getCloudColumns(supabase, table);
            if (cloudCols === null && !this._cloudColumns[table]) {
                // Null with no cache entry means table doesn't exist in cloud
                // If we got null but have a cache entry, it means empty table (allow all)
                if (!(table in this._cloudColumns)) {
                    console.warn(`[CloudSync] Table "${table}" not in cloud schema, skipping push.`);
                    continue;
                }
            }

            // Strip columns that don't exist in cloud schema (prevents 400 errors)
            cleanData = this._stripUnknownColumns(cleanData, cloudCols);

            // Batch upsert in chunks of 500 to avoid Supabase payload limits
            const BATCH_SIZE = 500;
            for (let i = 0; i < cleanData.length; i += BATCH_SIZE) {
                const batch = cleanData.slice(i, i + BATCH_SIZE);
                let { error } = await supabase.from(table).upsert(batch);
                if (error) {
                    // Table doesn't exist in Supabase yet — skip it, don't crash
                    if (/schema cache|relation.*does not exist|not found/i.test(error.message || '')) {
                        console.warn(`[CloudSync] Table "${table}" not in cloud schema, skipping push.`);
                        break;
                    }
                    // FK violations (e.g. task references account not yet in cloud) — skip batch, don't crash
                    if (/violates foreign key|foreign key constraint|insert or update on table/i.test(error.message || '')) {
                        console.warn(`[CloudSync] FK violation in ${table}, skipping batch: ${error.message}`);
                        continue;
                    }
                    // Unknown column slipped through — try stripping it (fallback)
                    if (/Could not find the '([^']+)' column/i.test(String(error.message || ''))) {
                        const match = String(error.message).match(/Could not find the '([^']+)' column/i);
                        if (match?.[1]) {
                            const col = match[1];
                            console.warn(`[CloudSync] ${table}.${col} missing in cloud, stripping and retrying`);
                            const stripped = batch.map(row => { const { [col]: _, ...rest } = row; return rest; });
                            const retry = await supabase.from(table).upsert(stripped);
                            if (!retry.error) continue;
                        }
                    }
                    console.error(`Sync Error(${table}): `, error.message);
                    throw new Error(`Failed to push to ${table}: ${error.message}`);
                }
            }
            // Clear dirty marks after successful push — these records are now in cloud
            const dirtyIds = await getDirtyIds(table);
            for (const id of dirtyIds) {
                await clearSyncMeta(table, id);
            }
            console.log(`[CloudSync] Pushed ${cleanData.length} rows for ${table}`);
        }
    },

    async pullCloudToLocal() {
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings', 'verifications', 'dailySnapshots', 'competitors'];
        const fetched = {};

        // Phase 1: fetch every table first; skip tables that don't exist in cloud yet
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                // Table doesn't exist in Supabase yet — skip it, don't crash
                if (/schema cache|relation.*does not exist|not found/i.test(error.message || '')) {
                    console.warn(`[CloudSync] Table "${table}" not in cloud schema, skipping pull.`);
                    fetched[table] = [];
                    continue;
                }
                console.error(`Pull Error(${table}): `, error.message);
                throw new Error(`Cloud pull failed on ${table}: ${error.message}`);
            }
            fetched[table] = data || [];
        }

        // Task status ranking for conflict resolution (higher = more advanced)
        const TASK_STATUS_RANK = { 'generated': 1, 'failed': 2, 'closed': 3 };

        // Phase 2: MERGE cloud data into local (never clear — prevents data loss)
        for (const table of tables) {
            let cloudData = fetched[table] || [];
            if (cloudData.length === 0) {
                console.log(`[CloudSync] Skipped ${table} — cloud is empty, keeping local data`);
                continue;
            }

            if (table === 'assets') {
                const localAssets = await db.assets.toArray();
                const byId = new Map(localAssets.map(a => [a.id, a]));
                const byDriveId = new Map(localAssets.filter(a => a.driveFileId).map(a => [a.driveFileId, a]));
                const byModelAndName = new Map(localAssets.filter(a => a.modelId && a.fileName).map(a => [`${a.modelId}::${a.fileName}`, a]));

                cloudData = cloudData.map(remote => {
                    const localMatch = byId.get(remote.id)
                        || (remote.driveFileId ? byDriveId.get(remote.driveFileId) : null)
                        || ((remote.modelId && remote.fileName) ? byModelAndName.get(`${remote.modelId}::${remote.fileName}`) : null);

                    if (!remote.fileBlob && localMatch?.fileBlob) {
                        return { ...remote, fileBlob: localMatch.fileBlob };
                    }
                    return remote;
                });
            }

            if (table === 'subreddits') {
                const localSubs = await db.subreddits.toArray();
                const localById = new Map(localSubs.map(s => [s.id, s]));
                cloudData = cloudData.map(remote => {
                    if (remote.accountId !== undefined) return remote;
                    const local = localById.get(remote.id);
                    if (local && local.accountId !== undefined) {
                        return { ...remote, accountId: local.accountId };
                    }
                    return remote;
                });
            }

            // Tasks: smart merge — never downgrade status, always preserve Reddit data
            if (table === 'tasks') {
                const localTasks = await db.tasks.toArray();
                const localById = new Map(localTasks.map(t => [t.id, t]));
                cloudData = cloudData.map(remote => {
                    const local = localById.get(remote.id);
                    if (!local) return remote;
                    const localRank = TASK_STATUS_RANK[local.status] || 0;
                    const remoteRank = TASK_STATUS_RANK[remote.status] || 0;
                    // Keep whichever status is more advanced
                    const winnerStatus = localRank >= remoteRank ? local.status : remote.status;
                    // Always preserve Reddit URL/ID from whichever has it
                    return {
                        ...remote,
                        status: winnerStatus,
                        redditUrl: remote.redditUrl || local.redditUrl,
                        redditPostId: remote.redditPostId || local.redditPostId,
                    };
                });
            }

            // Performances: smart merge — keep whichever has more data
            if (table === 'performances') {
                const localPerfs = await db.performances.toArray();
                const localById = new Map(localPerfs.map(p => [p.id, p]));
                const localByTaskId = new Map(localPerfs.map(p => [p.taskId, p]));
                cloudData = cloudData.map(remote => {
                    const local = localById.get(remote.id) || localByTaskId.get(remote.taskId);
                    if (!local) return remote;
                    // Keep whichever has higher views (more up-to-date sync)
                    if ((local.views24h || 0) > (remote.views24h || 0)) {
                        return { ...remote, views24h: local.views24h, removed: local.removed, notes: local.notes };
                    }
                    return remote;
                });
            }

            // Accounts: preserve locally-set profile audit fields that Supabase may not have
            if (table === 'accounts') {
                const localAccounts = await db.accounts.toArray();
                const localById = new Map(localAccounts.map(a => [a.id, a]));
                const profileFields = [
                    'hasAvatar', 'hasBanner', 'hasBio', 'hasDisplayName', 'hasVerifiedEmail', 'hasProfileLink',
                    'lastProfileAudit', 'removalRate', 'lastActiveDate', 'shadowBanStatus', 'lastShadowCheck',
                    // Lifecycle phase fields — cloud schema may not have these columns yet
                    'phase', 'phaseChangedDate', 'warmupStartDate', 'restUntilDate', 'consecutiveActiveDays'
                ];
                cloudData = cloudData.map(remote => {
                    const local = localById.get(remote.id);
                    const merged = { ...remote };
                    // Preserve local fields if cloud doesn't have them
                    if (local) {
                        for (const field of profileFields) {
                            if ((merged[field] === undefined || merged[field] === null) && local[field] !== undefined && local[field] !== null) {
                                merged[field] = local[field];
                            }
                        }
                    }
                    // Default phase for accounts that have never had one set (fresh from cloud)
                    if (!merged.phase) {
                        const now = Date.now();
                        const ageDays = merged.createdUtc ? Math.floor((now - Number(merged.createdUtc) * 1000) / 86400000) : null;
                        const karma = Number(merged.totalKarma || 0);
                        if (merged.isSuspended) {
                            merged.phase = 'burned';
                        } else if (ageDays !== null && ageDays >= 7 && karma >= 100) {
                            merged.phase = 'active';
                        } else if (ageDays !== null && ageDays >= 7) {
                            merged.phase = 'ready';
                        } else {
                            merged.phase = 'warming';
                        }
                        merged.phaseChangedDate = merged.phaseChangedDate || new Date().toISOString();
                    }
                    return merged;
                });
            }

            // Settings: merge by `key` field, not auto-increment `id` (IDs differ across devices)
            if (table === 'settings') {
                const localSettings = await db.settings.toArray();
                const localByKey = new Map(localSettings.map(s => [s.key, s]));
                cloudData = cloudData.map(remote => {
                    const local = localByKey.get(remote.key);
                    if (local) {
                        // Use local ID so bulkPut updates the right row in Dexie
                        return { ...remote, id: local.id };
                    }
                    return remote;
                });
            }

            // Respect pending clears/deletes from _syncMeta (persistent, survives refresh)
            if (await hasPendingClear(table)) {
                console.log(`[CloudSync] Skipped pull for ${table} — user cleared it`);
                continue; // Don't clear syncMeta here — push will handle the cloud delete
            }
            const pendingDel = await getPendingDeleteIds(table);
            if (pendingDel.size > 0) {
                cloudData = cloudData.filter(r => !pendingDel.has(r.id));
            }

            // Protect dirty local records — don't overwrite unpushed edits with stale cloud data
            const dirtyIds = await getDirtyIds(table);
            if (dirtyIds.size > 0) {
                cloudData = cloudData.filter(r => !dirtyIds.has(r.id));
            }

            // Merge: upsert cloud data without clearing local
            await db[table].bulkPut(cloudData);
            console.log(`[CloudSync] Merged ${cloudData.length} cloud rows into ${table}`);

            // NOTE: No orphan cleanup here. Local records not in cloud may be newly added
            // and not yet pushed. Deletes propagate via _pendingDeletes guard + cloud delete in push flow.
        }
    },

    async autoPush(onlyTables = null) {
        const settings = await SettingsService.getSettings();
        if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;

        // Acquire lock to prevent racing with background sync cycle
        const gotLock = await this.acquireLock();
        if (!gotLock) {
            console.log('[CloudSync] autoPush skipped — sync cycle in progress');
            return;
        }
        try {
            console.log(`CloudSync: Auto-pushing ${onlyTables ? onlyTables.join(', ') : 'all tables'}...`);
            await this.pushLocalToCloud(onlyTables);
        } catch (err) {
            console.error("CloudSync autoPush error:", err);
            throw err;
        } finally {
            this.releaseLock();
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
    },

    async clearAllCloudData() {
        if (!await this.isEnabled()) return;
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const tables = ['verifications', 'dailySnapshots', 'competitors', 'performances', 'tasks', 'assets', 'subreddits', 'accounts', 'models', 'settings'];
        for (const table of tables) {
            const { error } = await supabase.from(table).delete().neq('id', -1);
            if (error) {
                if (/schema cache|relation.*does not exist|not found/i.test(error.message || '')) {
                    console.warn(`[CloudSync] Table "${table}" not in cloud, skipping clear.`);
                    continue;
                }
                throw new Error(`Failed to clear cloud table ${table}: ${error.message}`);
            }
        }
    }
};

export const DriveSyncService = {
    async syncModelFolder(modelId, reuseCooldownSetting = 30) {
        const model = await db.models.get(Number(modelId));
        if (!model) throw new Error('Model not found');
        if (!model.driveFolderId) throw new Error('This model has no Drive Folder ID configured. Go to Models tab to add one.');

        const proxyUrl = await SettingsService.getProxyUrl();
        const cleanFolderId = normalizeDriveFolderId(model.driveFolderId);
        const res = await fetch(`${proxyUrl}/api/drive/list/${cleanFolderId}`, { headers: await getProxyHeaders() });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const detail = errData.detail || '';
            if (res.status === 403) {
                // Fetch service account email to show the user exactly what to share with
                let shareHint = 'Share the Google Drive folder with the service account email (check Settings or proxy logs).';
                try {
                    const infoRes = await fetch(`${proxyUrl}/api/drive/info`, { headers: await getProxyHeaders() });
                    if (infoRes.ok) {
                        const info = await infoRes.json();
                        if (info.email) shareHint = `Share the folder with: ${info.email}`;
                    }
                } catch (_) {}
                throw new Error(`Drive folder not accessible (403 Forbidden). ${shareHint}`);
            }
            if (res.status === 404) {
                throw new Error(`Drive folder not found (404). Check that the Folder ID is correct in the Models tab. ${detail ? '(' + detail + ')' : ''}`);
            }
            if (res.status === 503) {
                throw new Error('Google Drive not configured on the proxy server. Check that SERVICE_ACCOUNT_JSON is set.');
            }
            throw new Error(detail || errData.error || 'Failed to fetch from Drive');
        }

        const driveFiles = await res.json();
        let newCount = 0;
        let updatedCount = 0;

        for (const file of driveFiles) {
            const exists = await db.assets.where('driveFileId').equals(file.id).first();
            if (!exists) {
                await db.assets.add({
                    id: generateId(),
                    modelId: Number(model.id),
                    assetType: file.mimeType.startsWith('image/') ? 'image' : 'video',
                    angleTag: file.mappedTag || 'general',
                    locationTag: '',
                    reuseCooldownSetting: Number(reuseCooldownSetting),
                    approved: 1,
                    lastUsedDate: null,
                    timesUsed: 0,
                    driveFileId: file.id,
                    fileName: file.name,
                    thumbnailUrl: file.thumbnailLink,
                    originalUrl: file.webContentLink
                });
                newCount++;
            } else if (file.mappedTag && exists.angleTag !== file.mappedTag) {
                await db.assets.update(exists.id, { angleTag: file.mappedTag });
                updatedCount++;
            }
        }

        if (newCount > 0 || updatedCount > 0) {
            await CloudSyncService.autoPush(['assets']);
        }

        return { newCount, updatedCount, totalFiles: driveFiles.length };
    }
};

export const AccountDeduplicationService = {
    async findDuplicateGroups() {
        const accounts = await db.accounts.toArray();
        const grouped = new Map();

        for (const acc of accounts) {
            const normalizedHandle = normalizeRedditHandle(acc.handle);
            if (!normalizedHandle) continue;
            if (!grouped.has(normalizedHandle)) grouped.set(normalizedHandle, []);
            grouped.get(normalizedHandle).push(acc);
        }

        return [...grouped.entries()]
            .filter(([, rows]) => rows.length > 1)
            .map(([handle, rows]) => ({ normalizedHandle: handle, accounts: rows }));
    },

    async dedupeAccounts() {
        const duplicateGroups = await this.findDuplicateGroups();
        if (duplicateGroups.length === 0) return { groups: 0, removed: 0 };

        let removed = 0;
        let touchedTables = new Set(['accounts']);

        for (const group of duplicateGroups) {
            const taskCounts = new Map();
            const subredditCounts = new Map();
            const verificationCounts = new Map();

            for (const acc of group.accounts) {
                taskCounts.set(acc.id, await db.tasks.where('accountId').equals(acc.id).count());
                subredditCounts.set(acc.id, await db.subreddits.where('accountId').equals(acc.id).count());
                verificationCounts.set(acc.id, await db.verifications.where('accountId').equals(acc.id).count());
            }

            const canonical = [...group.accounts].sort((a, b) => {
                const aRefs = (taskCounts.get(a.id) || 0) + (subredditCounts.get(a.id) || 0) + (verificationCounts.get(a.id) || 0);
                const bRefs = (taskCounts.get(b.id) || 0) + (subredditCounts.get(b.id) || 0) + (verificationCounts.get(b.id) || 0);
                if (bRefs !== aRefs) return bRefs - aRefs;

                const aSync = new Date(a.lastSyncDate || a.lastShadowCheck || 0).getTime();
                const bSync = new Date(b.lastSyncDate || b.lastShadowCheck || 0).getTime();
                if (bSync !== aSync) return bSync - aSync;

                return Number(a.id) - Number(b.id);
            })[0];

            const duplicates = group.accounts.filter(acc => acc.id !== canonical.id);
            if (duplicates.length === 0) continue;

            for (const dup of duplicates) {
                const mergePatch = {};
                const preferredFields = [
                    'handle', 'notes', 'proxyInfo', 'vaPin', 'cqsStatus', 'phase',
                    'phaseChangedDate', 'warmupStartDate', 'restUntilDate', 'lastSyncDate',
                    'lastShadowCheck', 'lastActiveDate', 'createdUtc', 'totalKarma',
                    'linkKarma', 'commentKarma', 'shadowBanStatus'
                ];

                for (const field of preferredFields) {
                    const canonicalValue = canonical[field];
                    const dupValue = dup[field];
                    if ((canonicalValue === undefined || canonicalValue === null || canonicalValue === '') && dupValue !== undefined && dupValue !== null && dupValue !== '') {
                        mergePatch[field] = dupValue;
                    }
                }

                mergePatch.dailyCap = Math.max(Number(canonical.dailyCap || 0), Number(dup.dailyCap || 0), 10);
                mergePatch.removalRate = Math.max(Number(canonical.removalRate || 0), Number(dup.removalRate || 0));
                mergePatch.status = canonical.status || dup.status || 'active';

                await db.transaction('rw', db.accounts, db.tasks, db.subreddits, db.verifications, async () => {
                    if (Object.keys(mergePatch).length > 0) {
                        await db.accounts.update(canonical.id, mergePatch);
                    }

                    const dupTasks = await db.tasks.where('accountId').equals(dup.id).toArray();
                    if (dupTasks.length > 0) {
                        touchedTables.add('tasks');
                        await db.tasks.bulkPut(dupTasks.map(task => ({ ...task, accountId: canonical.id })));
                    }

                    const dupSubreddits = await db.subreddits.where('accountId').equals(dup.id).toArray();
                    if (dupSubreddits.length > 0) {
                        touchedTables.add('subreddits');
                        await db.subreddits.bulkPut(dupSubreddits.map(sub => ({ ...sub, accountId: canonical.id })));
                    }

                    const dupVerifications = await db.verifications.where('accountId').equals(dup.id).toArray();
                    if (dupVerifications.length > 0) {
                        touchedTables.add('verifications');
                        await db.verifications.bulkPut(dupVerifications.map(v => ({ ...v, accountId: canonical.id })));
                    }

                    await markDirty('accounts', canonical.id);
                    await markPendingDelete('accounts', dup.id);
                    await db.accounts.delete(dup.id);
                });

                removed++;
            }
        }

        try {
            await CloudSyncService.autoPush([...touchedTables]);
        } catch (err) {
            console.warn('[AccountDeduplication] Cloud sync after dedupe failed:', err.message);
        }

        return { groups: duplicateGroups.length, removed };
    }
};


export const AccountLifecycleService = {
    async evaluateAccountPhases() {
        const settings = await SettingsService.getSettings();
        const minWarmupDays = Number(settings.minWarmupDays) || 7;
        const minWarmupKarma = Number(settings.minWarmupKarma) || 100;
        const maxConsecutiveActiveDays = Number(settings.maxConsecutiveActiveDays) || 4;
        const restDurationDays = Number(settings.restDurationDays) || 2;

        const accounts = await db.accounts.toArray();
        const today = startOfDay(new Date());

        for (const acc of accounts) {
            let phase = acc.phase || '';
            let newPhase = phase;
            const updates = {};
            const isDead = String(acc.status || '').toLowerCase() === 'dead';

            if (isDead) {
                if (phase !== 'burned') {
                    updates.phase = 'burned';
                    updates.phaseChangedDate = new Date().toISOString();
                    await db.accounts.update(acc.id, updates);
                }
                continue;
            }

            // Auto-assign phase to accounts that don't have one yet
            // Uses Reddit account age from createdUtc (set during sync)
            if (!phase) {
                if (acc.createdUtc) {
                    const ageDays = differenceInDays(today, startOfDay(new Date(acc.createdUtc * 1000)));
                    const karma = acc.totalKarma || 0;
                    if (acc.isSuspended) {
                        phase = 'burned';
                    } else if (ageDays >= minWarmupDays && karma >= minWarmupKarma) {
                        phase = 'ready';
                        // Stagger rest rotation with existing sibling accounts
                        const siblings = accounts.filter(a =>
                            a.modelId === acc.modelId && a.id !== acc.id &&
                            (a.phase === 'active' || a.phase === 'ready')
                        );
                        updates.consecutiveActiveDays = siblings.length % maxConsecutiveActiveDays;
                        updates.restVariance = Math.floor(Math.random() * 3) - 1;
                    } else {
                        phase = 'warming';
                        updates.warmupStartDate = new Date(acc.createdUtc * 1000).toISOString();
                    }
                } else {
                    // No Reddit data yet — assume warming until first sync
                    phase = 'warming';
                    updates.warmupStartDate = new Date().toISOString();
                }
                newPhase = phase;
            }

            // any → burned: suspended or extreme removal rate
            if (acc.isSuspended || (acc.removalRate && acc.removalRate > 60)) {
                if (phase !== 'burned') {
                    newPhase = 'burned';
                }
            }
            // burned → recover: no longer suspended AND removal rate OK
            else if (phase === 'burned' && !acc.isSuspended && !isDead && (!acc.removalRate || acc.removalRate <= 60)) {
                const karma = acc.totalKarma || 0;
                const ageDays = acc.createdUtc ? differenceInDays(today, startOfDay(new Date(acc.createdUtc * 1000))) : 0;
                if (ageDays >= minWarmupDays && karma >= minWarmupKarma) {
                    newPhase = 'ready';
                } else {
                    newPhase = 'warming';
                }
            }
            // warming → ready: old enough + enough karma (with staggered start)
            else if (phase === 'warming') {
                const warmupStart = acc.warmupStartDate ? new Date(acc.warmupStartDate) : (acc.createdUtc ? new Date(acc.createdUtc * 1000) : null);
                const accountAge = warmupStart ? differenceInDays(today, startOfDay(warmupStart)) : 999;
                const karma = acc.totalKarma || 0;

                if (accountAge >= minWarmupDays && karma >= minWarmupKarma) {
                    newPhase = 'ready';
                    // Stagger: count how many sibling accounts are already active/ready
                    // and offset this account's consecutiveActiveDays so rest periods rotate
                    const siblings = accounts.filter(a =>
                        a.modelId === acc.modelId && a.id !== acc.id &&
                        (a.phase === 'active' || a.phase === 'ready')
                    );
                    const staggerOffset = siblings.length % maxConsecutiveActiveDays;
                    updates.consecutiveActiveDays = staggerOffset;
                    updates.restVariance = Math.floor(Math.random() * 3) - 1;
                }
            }
            // active → resting: too many consecutive active days (with ±1 day randomness)
            else if (phase === 'active') {
                const consecutive = acc.consecutiveActiveDays || 0;
                // Add ±1 day variance per cycle so rest patterns look human
                const variance = (acc.restVariance != null) ? acc.restVariance : 0;
                if (consecutive >= maxConsecutiveActiveDays + variance) {
                    newPhase = 'resting';
                    // Randomize rest duration too: base ±1 day (min 1)
                    const restJitter = Math.random() < 0.5 ? -1 : (Math.random() < 0.5 ? 0 : 1);
                    const actualRestDays = Math.max(1, restDurationDays + restJitter);
                    const restUntil = new Date(today);
                    restUntil.setDate(restUntil.getDate() + actualRestDays);
                    updates.restUntilDate = restUntil.toISOString();
                    updates.consecutiveActiveDays = 0;
                    // Set new random variance for next active cycle (-1, 0, or +1)
                    updates.restVariance = Math.floor(Math.random() * 3) - 1;
                }
            }
            // resting → ready: rest period over
            else if (phase === 'resting') {
                if (acc.restUntilDate && new Date(acc.restUntilDate) <= today) {
                    newPhase = 'ready';
                    updates.restUntilDate = null;
                }
            }

            if (newPhase !== phase) {
                updates.phase = newPhase;
                updates.phaseChangedDate = new Date().toISOString();
                await db.accounts.update(acc.id, updates);
            }
        }
    },

    async markAccountActiveDay(accountId) {
        const acc = await db.accounts.get(accountId);
        if (!acc) return;
        const today = startOfDay(new Date()).toISOString();
        const updates = {};

        if (acc.lastActiveDate !== today) {
            updates.lastActiveDate = today;
            updates.consecutiveActiveDays = (acc.consecutiveActiveDays || 0) + 1;
        }

        const phase = acc.phase || 'ready';
        if (phase === 'ready') {
            updates.phase = 'active';
            updates.phaseChangedDate = new Date().toISOString();
        }

        if (Object.keys(updates).length > 0) {
            await db.accounts.update(accountId, updates);
        }
    }
};


export const AccountSyncService = {
    async syncAccountHealth(accountId) {
        const account = await db.accounts.get(accountId);
        if (!account || !account.handle) return;

        try {
            const proxyUrl = await SettingsService.getProxyUrl();
            const snapshot = await fetchBestAccountSnapshot(proxyUrl, account.handle, account);
            if (!snapshot.ok) {
                const now = new Date().toISOString();
                const reason = snapshot.reason === 'missing'
                    ? 'Account not found via proxy'
                    : `Proxy scrape failed: ${(snapshot.failures || []).slice(0, 3).join(', ')}`;
                await db.accounts.update(accountId, {
                    lastSyncAttempt: now,
                    lastSyncError: reason,
                });
                return null;
            }

            const data = snapshot.data;
            const now = new Date().toISOString();

            const patch = {
                totalKarma: data.totalKarma ?? account.totalKarma ?? 0,
                linkKarma: data.linkKarma ?? account.linkKarma ?? 0,
                commentKarma: data.commentKarma ?? account.commentKarma ?? 0,
                createdUtc: data.created ?? account.createdUtc ?? null,
                isSuspended: !!data.isSuspended,
                lastSyncDate: now,
                lastSyncAttempt: now,
                lastSyncSource: snapshot.source,
                lastSyncVariant: snapshot.variant,
                lastSyncError: ''
            };
            // Profile audit fields — use pre-computed booleans from proxy when available
            patch.hasAvatar = data.has_custom_avatar !== undefined ? (data.has_custom_avatar ? 1 : 0)
                : (account.hasAvatar ?? (((data.snoovatar_img && data.snoovatar_img.length > 0) || (data.icon_img && !String(data.icon_img).includes('default'))) ? 1 : 0));
            patch.hasBanner = data.has_banner !== undefined ? (data.has_banner ? 1 : 0)
                : (account.hasBanner ?? ((data.banner_img && data.banner_img.length > 0) ? 1 : 0));
            patch.hasBio = (data.description && data.description.trim().length > 0) ? 1 : (account.hasBio ?? 0);
            // display_name (subreddit.title) counts only if it's not just the handle itself
            const dn = (data.display_name || '').trim();
            const handleClean = (account.handle || '').replace(/^u\//i, '').trim();
            patch.hasDisplayName = (dn.length > 0 && dn.toLowerCase() !== handleClean.toLowerCase()) ? 1 : (account.hasDisplayName ?? 0);
            patch.hasVerifiedEmail = data.has_verified_email ? 1 : (account.hasVerifiedEmail ?? 0);
            patch.hasProfileLink = data.has_profile_link ? 1 : (account.hasProfileLink ?? 0);
            patch.lastProfileAudit = now;
            if (data.isSuspended) {
                Object.assign(patch, buildDeadAccountPatch('suspended', now), {
                    shadowBanStatus: 'suspended',
                    lastShadowCheck: now,
                });
            }
            await db.accounts.update(accountId, patch);
            return { ...snapshot, data };
        } catch (err) {
            console.error(`Account sync fail(${account.handle}): `, err);
            await db.accounts.update(accountId, {
                lastSyncAttempt: new Date().toISOString(),
                lastSyncError: err.message || String(err),
            });
            return null;
        }
    },

    async syncAllAccounts() {
        const accounts = await db.accounts.toArray();
        const eligible = accounts.filter(acc => !!acc.handle);
        const results = await Promise.allSettled(
            eligible.map(acc => this.syncAccountHealth(acc.id))
        );
        let succeeded = 0;
        let failed = 0;
        const failedHandles = [];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === 'fulfilled' && r.value) {
                succeeded++;
            } else {
                failed++;
                failedHandles.push(eligible[i].handle);
            }
        }
        if (failedHandles.length > 0) {
            console.warn('[AccountSync] Failed to sync:', failedHandles.join(', '));
        }
        try { await CloudSyncService.autoPush(); } catch (e) { console.error('[AccountSync] autoPush failed:', e); }
        const skippedNoHandle = accounts.length - eligible.length;
        return { total: eligible.length, succeeded, failed, failedHandles, skippedNoHandle };
    },

    async checkShadowBan(accountId) {
        const account = await db.accounts.get(accountId);
        if (!account || !account.handle) return null;

        const proxyUrl = await SettingsService.getProxyUrl();
        const now = new Date().toISOString();

        try {
            const snapshot = await fetchBestAccountSnapshot(proxyUrl, account.handle, account);
            if (!snapshot.ok) {
                // 404 or error → likely shadow-banned or suspended
                await db.accounts.update(accountId, {
                    shadowBanStatus: 'shadow_banned',
                    lastShadowCheck: now,
                    ...buildDeadAccountPatch('shadow_banned', now),
                });
                return 'shadow_banned';
            }
            const data = snapshot.data;
            if (data.isSuspended) {
                await db.accounts.update(accountId, {
                    shadowBanStatus: 'suspended',
                    lastShadowCheck: now,
                    isSuspended: true,
                    ...buildDeadAccountPatch('suspended', now),
                });
                return 'suspended';
            }
            await db.accounts.update(accountId, {
                shadowBanStatus: 'clean',
                lastShadowCheck: now
            });
            return 'clean';
        } catch (err) {
            console.error(`Shadow ban check failed (${account.handle}):`, err);
            await db.accounts.update(accountId, { lastShadowCheck: now });
            return 'error';
        }
    },

    async checkAllShadowBans() {
        const accounts = await db.accounts.toArray();
        const eligible = accounts.filter(acc => !!acc.handle);
        const results = await Promise.allSettled(
            eligible.map(acc => this.checkShadowBan(acc.id))
        );
        let clean = 0, flagged = 0, errors = 0;
        for (const r of results) {
            const result = r.status === 'fulfilled' ? r.value : 'error';
            if (result === 'clean') clean++;
            else if (result === 'shadow_banned' || result === 'suspended') flagged++;
            else errors++;
        }
        try { await CloudSyncService.autoPush(); } catch (e) { /* non-critical */ }
        return { total: accounts.length, clean, flagged, errors };
    }
};

export const PerformanceSyncService = {
    async syncPostPerformance(taskId) {
        const task = await db.tasks.get(taskId);
        if (!task || !task.redditPostId) {
            return { ok: false, reason: 'missing_post_id' };
        }

        try {
            const proxyUrl = await SettingsService.getProxyUrl();

            // Extract subreddit name from URL for share link resolution
            let subredditHint = '';
            if (task.redditUrl) {
                const subMatch = task.redditUrl.match(/\/r\/([^\/]+)/i);
                if (subMatch) subredditHint = subMatch[1];
            }

            const url = `${proxyUrl}/api/scrape/post/${task.redditPostId}${subredditHint ? '?subreddit=' + subredditHint : ''}`;
            const response = await fetchWithTimeout(url, {}, 10000);
            if (!response.ok) throw new Error("Sync failed");

            const data = await response.json();

            // If proxy resolved a share link to a real ID, save it back
            if (data.realPostId && data.realPostId !== task.redditPostId) {
                console.log(`[PerfSync] Resolved share ID ${task.redditPostId} => ${data.realPostId}`);
                await db.tasks.update(taskId, { redditPostId: data.realPostId });
            }

            // Find or create performance record
            const performance = await db.performances.where('taskId').equals(taskId).first();
            const updateObj = {
                views24h: data.ups || 0,
                removed: data.removed ? 1 : 0,
                notes: `Last synced: ${new Date().toLocaleString()} (Status: ${data.removed_category || 'Active'})`
            };

            if (performance) {
                await db.performances.update(performance.id, updateObj);
            } else {
                await db.performances.add({
                    id: generateId(),
                    taskId,
                    ...updateObj
                });
            }

            await SubredditLifecycleService.evaluateSubreddits(task.modelId);

            return { ok: true, data };
        } catch (err) {
            console.error("Performance Sync Error:", err);
            return { ok: false, reason: err.message || 'sync_failed' };
        }
    },

    async syncAllPendingPerformance() {
        // Find tasks from the last 14 days that are closed or failed (some failed posts still have live URLs)
        const cutoff = subDays(new Date(), 14).toISOString();
        const pendingTasks = await db.tasks
            .filter(t => (t.status === 'closed' || t.status === 'failed') && (!t.date || t.date >= cutoff))
            .toArray();

        let attempted = 0;
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        // Pre-process: heal missing postIds and split into syncable vs skipped
        const syncable = [];
        for (const task of pendingTasks) {
            let postId = task.redditPostId;

            // Retroactive Auto-Healing for bad URLs saved previously
            if (!postId && task.redditUrl) {
                const extractedPostId = extractRedditPostIdFromUrl(task.redditUrl);
                if (extractedPostId) {
                    postId = extractedPostId;
                    await db.tasks.update(task.id, { redditPostId: postId });
                }
            }

            if (postId) {
                syncable.push(task);
            } else {
                skipped++;
            }
        }

        // Process in batches of 5 with 1s gap between batches
        const BATCH_SIZE = 5;
        for (let i = 0; i < syncable.length; i += BATCH_SIZE) {
            const batch = syncable.slice(i, i + BATCH_SIZE);
            attempted += batch.length;
            const results = await Promise.allSettled(
                batch.map(task => this.syncPostPerformance(task.id))
            );
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value?.ok) succeeded++;
                else failed++;
            }
            // Throttle between batches to respect proxy rate limits
            if (i + BATCH_SIZE < syncable.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        try { await CloudSyncService.autoPush(); } catch (e) { console.error('[PerfSync] autoPush failed:', e); }

        return { attempted, succeeded, failed, skipped, scanned: pendingTasks.length };
    }
};

/**
 * Pure function: generates manager action items from account data.
 * No DB calls, no async, no side effects.
 */
export async function generateManagerActionItems(accounts) {
    if (!accounts || !accounts.length) return [];

    const now = Date.now();
    const items = [];

    for (const account of accounts) {
        const handle = account.handle || `Account #${account.id}`;
        const accountId = account.id;
        const karma = Number(account.totalKarma || 0);
        const removalRate = Number(account.removalRate || 0);
        const phase = (account.phase || '').toLowerCase();
        const isSuspended = !!account.isSuspended;

        // Compute account age in days
        let ageDays = null;
        if (account.createdUtc) {
            ageDays = Math.floor((now - Number(account.createdUtc) * 1000) / (86400000));
        }

        // Rule 13: Burned/suspended — short-circuit, only this rule applies
        if (isSuspended || phase === 'burned') {
            items.push({
                accountId,
                handle,
                priority: 'critical',
                message: `${handle} is BURNED — remove from rotation`,
                rule: 13
            });
            continue;
        }

        // Fallback: use warmupStartDate for age when createdUtc is missing
        if (phase === 'warming' && ageDays === null) {
            if (account.warmupStartDate) {
                ageDays = Math.floor((now - new Date(account.warmupStartDate).getTime()) / 86400000);
            }
        }

        // Rule 0: Unsynced account — prompt sync
        // Covers warming accounts with no age AND brand-new accounts with no phase set yet
        if ((phase === 'warming' && ageDays === null) || (!phase && !account.lastSyncDate)) {
            items.push({
                accountId,
                handle,
                priority: 'warning',
                message: `Sync ${handle} — account not yet synced with Reddit`,
                rule: 0
            });
        }

        // Rule 0b: Account has phase but never synced — profile audit won't populate until synced
        if (phase && !account.lastSyncDate && !account.lastProfileAudit) {
            items.push({
                accountId,
                handle,
                priority: 'info',
                message: `Run "Sync Stats" to populate ${handle}'s profile audit`,
                rule: 0
            });
        }

        // --- Warming Phase Rules (days 0-7) ---
        if (phase === 'warming' && ageDays !== null) {
            // Rule 1: Day 0-3, karma = 0
            if (ageDays <= 3 && karma === 0) {
                items.push({
                    accountId,
                    handle,
                    priority: 'info',
                    message: `Leave ${handle} alone — don't post yet (day ${ageDays}/3)`,
                    rule: 1
                });
            }

            // Rule 2: Day 3+, karma < 30
            if (ageDays >= 3 && karma < 30) {
                items.push({
                    accountId,
                    handle,
                    priority: 'warning',
                    message: `Start anime karma farming on ${handle} — only ${karma} karma`,
                    rule: 2
                });
            }

            // Rule 3: Day 5+, karma < 80
            if (ageDays >= 5 && karma < 80) {
                items.push({
                    accountId,
                    handle,
                    priority: 'critical',
                    message: `URGENT: ${handle} behind on karma — needs 100 by day 7`,
                    rule: 3
                });
            }

            // Rule 4: Day 7+, still warming
            if (ageDays >= 7) {
                items.push({
                    accountId,
                    handle,
                    priority: 'critical',
                    message: `${handle} failed warmup — only ${karma} karma after ${ageDays} days`,
                    rule: 4
                });
            }
        }

        // --- Profile Checklist (warming accounts get 'info', ready/active get 'warning') ---
        // Show profile setup items for ALL synced accounts so VAs can prep during warmup
        const hasBeenSynced = !!account.lastProfileAudit;
        const isReadyOrActive = phase === 'ready' || phase === 'active' || (ageDays !== null && ageDays >= 7 && phase !== 'warming');
        const profilePriority = isReadyOrActive ? 'warning' : 'info';

        if (isReadyOrActive || (phase === 'warming' && hasBeenSynced)) {
            const missing = [];

            // Rule 5: No profile link (Reddit blocks this before day 7)
            if (!account.hasProfileLink && ageDays !== null && ageDays >= 7) {
                items.push({ accountId, handle, priority: profilePriority, message: `Add deep link to ${handle}'s bio`, rule: 5 });
                missing.push('profileLink');
            }

            // Rule 6: No avatar
            if (!account.hasAvatar) {
                items.push({ accountId, handle, priority: profilePriority, message: `Set custom avatar on ${handle}`, rule: 6 });
                missing.push('avatar');
            }

            // Rule 7: No banner
            if (!account.hasBanner) {
                items.push({ accountId, handle, priority: profilePriority, message: `Set profile banner on ${handle}`, rule: 7 });
                missing.push('banner');
            }

            // Rule 8: No bio
            if (!account.hasBio) {
                items.push({ accountId, handle, priority: profilePriority, message: `Write bio for ${handle}`, rule: 8 });
                missing.push('bio');
            }

            // Rule 9: No display name
            if (!account.hasDisplayName) {
                items.push({ accountId, handle, priority: profilePriority, message: `Set display name on ${handle}`, rule: 9 });
                missing.push('displayName');
            }

            // Rule 10: All profile complete
            if (missing.length === 0 && account.hasProfileLink && account.hasAvatar && account.hasBanner && account.hasBio && account.hasDisplayName) {
                items.push({ accountId, handle, priority: 'success', message: `${handle} fully set up — ready for NSFW posting`, rule: 10 });
            }
        }

        // --- Ongoing Monitoring ---

        // Rule 11: Removal rate > 30%
        if (removalRate > 30) {
            items.push({
                accountId,
                handle,
                priority: 'critical',
                message: `HIGH removals on ${handle} (${Math.round(removalRate)}%) — check subreddits`,
                rule: 11
            });
        }

        // Rule 12: No posts in 3+ days (active accounts only)
        // Skip if account just entered ready/active phase (< 3 days ago)
        if ((phase === 'ready' || phase === 'active') && account.lastActiveDate) {
            const daysSinceActive = Math.floor((now - new Date(account.lastActiveDate).getTime()) / 86400000);
            const daysInPhase = account.phaseChangedDate
                ? Math.floor((now - new Date(account.phaseChangedDate).getTime()) / 86400000)
                : null;
            if (daysSinceActive >= 3 && (daysInPhase === null || daysInPhase >= 3)) {
                items.push({
                    accountId,
                    handle,
                    priority: 'warning',
                    message: `${handle} hasn't posted in ${daysSinceActive} days`,
                    rule: 12
                });
            }
        }
    }

    // Rule 14: Active/ready accounts with tasks today but none completed
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString();
    const todayTasks = await db.tasks.where('date').equals(todayStr).toArray();
    const tasksByAccount = new Map();
    for (const t of todayTasks) {
        if (t.taskType === 'warmup') continue; // skip warmup tasks
        if (!tasksByAccount.has(t.accountId)) tasksByAccount.set(t.accountId, []);
        tasksByAccount.get(t.accountId).push(t);
    }
    for (const acc of accounts) {
        const phase = acc.phase || '';
        if (phase !== 'active' && phase !== 'ready') continue;
        const accTasks = tasksByAccount.get(acc.id);
        if (!accTasks || accTasks.length === 0) continue;
        const anyCompleted = accTasks.some(t => t.status === 'closed');
        if (!anyCompleted) {
            const handle = acc.handle?.startsWith('u/') ? acc.handle : `u/${acc.handle || 'unknown'}`;
            items.push({
                accountId: acc.id, handle,
                priority: 'warning',
                message: `${handle} has ${accTasks.length} task${accTasks.length > 1 ? 's' : ''} today — none completed yet`,
                rule: 14
            });
        }
    }

    // Sort: critical → warning → info → success
    const priorityOrder = { critical: 0, warning: 1, info: 2, success: 3 };
    items.sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

    return items;
}

// ─── Telegram Daily Reports ───────────────────────────────────────────

export const TelegramService = {
    async sendMessage(botToken, chatId, text, threadId) {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (threadId) payload.message_thread_id = Number(threadId);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.description || `Telegram API error ${res.status}`);
        }
        return res.json();
    },

    async buildReport() {
        const accounts = await db.accounts.toArray();
        const metrics = await AnalyticsEngine.getAgencyMetrics();
        const actionItems = await generateManagerActionItems(accounts);

        // Today's posted accounts
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const todayTasks = await db.tasks.filter(t =>
            t?.date >= startIso && t?.date < endIso && t.status === 'closed'
        ).toArray();

        const postedAccountIds = [...new Set(todayTasks.map(t => t.accountId).filter(Boolean))];
        const postedHandles = [];
        for (const id of postedAccountIds) {
            const acct = accounts.find(a => a.id === id);
            if (acct?.handle) postedHandles.push('u/' + acct.handle);
        }

        // Account phase counts
        const phases = { warming: 0, ready: 0, active: 0, resting: 0, burned: 0 };
        for (const a of accounts) {
            const p = (a.phase || a.status || 'active').toLowerCase();
            if (phases[p] !== undefined) phases[p]++;
        }

        // Stale accounts (no posts 3+ days)
        const staleAccounts = accounts.filter(a => {
            const p = (a.phase || '').toLowerCase();
            if (p === 'burned' || p === 'warming') return false;
            if (!a.lastSyncDate) return false;
            const daysSinceSync = Math.floor((Date.now() - new Date(a.lastSyncDate).getTime()) / 86400000);
            return daysSinceSync >= 3;
        });

        // Filter action items to critical + warning only
        const urgent = actionItems.filter(i => i.priority === 'critical' || i.priority === 'warning');
        const suspended = accounts.filter(a => a.isSuspended);

        // Top performer
        const topModel = metrics.leaderboard?.[0];

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const exec = metrics.executionToday;
        const lines = [];
        lines.push(`<b>Reddit Daily Report</b> — ${dateStr}`);
        lines.push('');

        // EXECUTION
        lines.push('<b>EXECUTION</b>');
        lines.push(`Posts: ${exec.completed}/${exec.total} (${exec.percent}%)`);
        lines.push(`Removal rate: ${metrics.agencyRemovalRate}%`);
        lines.push('');

        // PERFORMANCE
        lines.push('<b>PERFORMANCE</b>');
        lines.push(`Total views: ${metrics.agencyTotalViews.toLocaleString()} | Avg/post: ${metrics.agencyAvgViews.toLocaleString()}`);
        if (topModel) {
            lines.push(`Top model: ${topModel.name} — ${topModel.metrics.totalViews.toLocaleString()} views`);
        }
        lines.push('');

        // FLEET
        lines.push('<b>FLEET</b>');
        lines.push(`Active: ${phases.active} | Ready: ${phases.ready} | Warming: ${phases.warming} | Burned: ${phases.burned}`);
        if (postedHandles.length > 0) {
            lines.push(`Posted today: ${postedHandles.join(', ')}`);
        } else {
            lines.push('Posted today: none');
        }
        lines.push('');

        // ATTENTION — only if there are issues
        if (suspended.length > 0 || staleAccounts.length > 0 || urgent.length > 0) {
            lines.push('<b>ATTENTION</b>');
            if (suspended.length > 0) {
                lines.push(`🔴 ${suspended.length} account${suspended.length > 1 ? 's' : ''} suspended`);
            }
            if (staleAccounts.length > 0) {
                lines.push(`🟡 ${staleAccounts.length} account${staleAccounts.length > 1 ? 's' : ''} stale (no posts 3+ days)`);
            }
            for (const item of urgent.filter(i => i.priority === 'critical').slice(0, 3)) {
                lines.push(`🔴 ${item.message}`);
            }
            for (const item of urgent.filter(i => i.priority === 'warning').slice(0, 3)) {
                lines.push(`🟡 ${item.message}`);
            }
        }

        return lines.join('\n');
    },

    async sendDailyReport() {
        try {
            const settings = await SettingsService.getSettings();
            const token = (settings.redditTelegramBotToken || settings.telegramBotToken || '').trim();
            const chatId = (settings.redditTelegramChatId || settings.telegramChatId || '').trim();
            if (!token || !chatId) {
                return { sent: false, reason: 'Telegram not configured' };
            }
            const threadId = (settings.redditTelegramThreadId || settings.telegramThreadId || '').trim();
            const report = await this.buildReport();
            await this.sendMessage(token, chatId, report, threadId);
            return { sent: true };
        } catch (e) {
            console.error('[TelegramService] sendDailyReport failed:', e);
            return { sent: false, reason: e.message || 'Unknown error' };
        }
    },

    async sendTestMessage(botToken, chatId, threadId) {
        const text = '✅ <b>Reddit Growth OS</b> — Telegram integration is working!';
        await this.sendMessage(botToken, chatId, text, threadId);
    },
};
