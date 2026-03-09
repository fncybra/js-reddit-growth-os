import { db } from '../db/db.js';
import { generateId } from '../db/generateId.js';
import { subDays, isAfter, startOfDay, differenceInDays } from 'date-fns';

// Pending-delete guard: prevents CloudSync pull from re-adding records
// that were deleted locally while a pull was in-flight
const _pendingDeletes = new Map(); // table -> Set<id>
const _pendingClears = new Set();  // tables fully cleared by user

export function markPendingDelete(table, id) {
    if (!_pendingDeletes.has(table)) _pendingDeletes.set(table, new Set());
    _pendingDeletes.get(table).add(id);
}

export function markPendingClear(table) {
    _pendingClears.add(table);
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
            airtableApiKey: '',
            airtableBaseId: '',
            airtableTableName: 'Phone Posting',
            threadsTelegramBotToken: '',
            threadsTelegramChatId: '',
            threadsTelegramThreadId: '',
            threadsDailyReportEnabled: 1,
            threadsDailyReportHour: 8,
            lastThreadsDailyReportDate: '',
            lastVASnapshot: '',
            threadsManagerPin: '',
            redditManagerPin: '',
            redditTelegramBotToken: '',
            redditTelegramChatId: '',
            redditTelegramThreadId: '',
            redditDailyReportEnabled: 1,
            redditDailyReportHour: 8,
            lastRedditDailyReportDate: '',
            ofTelegramBotToken: '',
            ofTelegramChatId: '',
            ofTelegramThreadId: '',
            ofDailyReportEnabled: 0,
            ofDailyReportHour: 20,
            lastOFDailyReportDate: '',
            aiChatApiKey: '',
            aiChatGeminiKey: '',
            aiChatHaikuModel: 'google/gemini-2.0-flash-001',
            aiChatSonnetModel: 'google/gemini-2.0-flash-001',
            proxyApiToken: ''
        };
        const settingsArr = await db.settings.toArray();
        const settings = { ...defaultSettings };
        settingsArr.forEach(s => {
            if (s.value !== undefined && s.value !== null && s.value !== '') {
                settings[s.key] = s.value;
            }
        });
        // Auto-migrate old model IDs to Gemini Flash
        const geminiModel = 'google/gemini-2.0-flash-001';
        if (settings.aiChatHaikuModel.includes('anthropic/') || settings.aiChatHaikuModel.includes('claude')) {
            settings.aiChatHaikuModel = geminiModel;
            this.updateSetting('aiChatHaikuModel', geminiModel);
        }
        if (settings.aiChatSonnetModel.includes('anthropic/') || settings.aiChatSonnetModel.includes('claude')) {
            settings.aiChatSonnetModel = geminiModel;
            this.updateSetting('aiChatSonnetModel', geminiModel);
        }
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

        const allTables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings', 'verifications', 'dailySnapshots', 'competitors', 'ofModels', 'ofVas', 'ofTrackingLinks', 'ofBulkImports', 'ofLinkSnapshots', 'ofDailyStats', 'aiChatImports', 'aiChatters', 'aiChatModels', 'aiChatConversations', 'aiChatMessages', 'aiChatGrades', 'aiChatterReports', 'threadsSnapshots'];
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

        // Tables where local is authoritative for deletions — sync deletions to cloud
        // NOTE: 'accounts' removed — fresh browsers (VA phones) have 0 local accounts
        // and would wipe all cloud accounts. Account deletions are handled explicitly
        // in handleDeleteAccount() which deletes from cloud directly.
        const ofConfigTables = ['ofModels', 'ofVas', 'ofTrackingLinks'];
        for (const table of ofConfigTables) {
            if (!tables.includes(table)) continue;
            try {
                const localData = await db[table].toArray();
                const localIds = new Set(localData.map(r => r.id));
                const { data: cloudData } = await supabase.from(table).select('id');
                if (cloudData && cloudData.length > 0) {
                    const orphanIds = cloudData.filter(r => !localIds.has(r.id)).map(r => r.id);
                    for (const oid of orphanIds) {
                        await supabase.from(table).delete().eq('id', oid);
                    }
                    if (orphanIds.length > 0) console.log(`[CloudSync] Deleted ${orphanIds.length} orphaned cloud rows from ${table}`);
                }
            } catch (e) { console.warn(`[CloudSync] OF config cloud cleanup failed for ${table}:`, e.message); }
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
            console.log(`[CloudSync] Pushed ${cleanData.length} rows for ${table}`);
        }
    },

    async pullCloudToLocal() {
        const { getSupabaseClient } = await import('../db/supabase.js');
        const supabase = await getSupabaseClient();
        if (!supabase) return;

        const tables = ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings', 'verifications', 'dailySnapshots', 'competitors', 'ofModels', 'ofVas', 'ofTrackingLinks', 'ofBulkImports', 'ofLinkSnapshots', 'ofDailyStats', 'aiChatImports', 'aiChatters', 'aiChatModels', 'aiChatConversations', 'aiChatMessages', 'aiChatGrades', 'aiChatterReports', 'threadsSnapshots'];
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
            const localAuthTables = ['ofModels', 'ofVas', 'ofTrackingLinks', 'accounts'];
            if (cloudData.length === 0) {
                // Local-authoritative tables: if cloud is empty, clear local too
                if (localAuthTables.includes(table)) {
                    const localCount = await db[table].count();
                    if (localCount > 0) {
                        await db[table].clear();
                        console.log(`[CloudSync] Cleared local ${table} — cloud is empty`);
                    }
                } else {
                    console.log(`[CloudSync] Skipped ${table} — cloud is empty, keeping local data`);
                }
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

            // Respect pending deletes/clears from concurrent user actions (OFConfig)
            if (_pendingClears.has(table)) {
                _pendingClears.delete(table);
                _pendingDeletes.delete(table);
                console.log(`[CloudSync] Skipped pull for ${table} — user cleared it`);
                continue;
            }
            const pendingDel = _pendingDeletes.get(table);
            if (pendingDel && pendingDel.size > 0) {
                cloudData = cloudData.filter(r => !pendingDel.has(r.id));
            }

            // Merge: upsert cloud data without clearing local
            await db[table].bulkPut(cloudData);

            // Clear pending deletes AFTER bulkPut so they can't be re-added by a concurrent sync
            if (pendingDel) {
                _pendingDeletes.delete(table);
            }
            console.log(`[CloudSync] Merged ${cloudData.length} cloud rows into ${table}`);

            // For local-authoritative tables: remove local records that no longer exist in cloud
            // This ensures deletions propagate properly
            if (localAuthTables.includes(table)) {
                const cloudIds = new Set(cloudData.map(r => r.id));
                const localRecords = await db[table].toArray();
                const orphanIds = localRecords.filter(r => !cloudIds.has(r.id)).map(r => r.id);
                if (orphanIds.length > 0) {
                    await db[table].bulkDelete(orphanIds);
                    console.log(`[CloudSync] Removed ${orphanIds.length} orphaned local rows from ${table}`);
                }
            }
        }
    },

    async autoPush(onlyTables = null) {
        const settings = await SettingsService.getSettings();
        if (settings.supabaseUrl && settings.supabaseAnonKey) {
            console.log(`CloudSync: Auto-pushing ${onlyTables ? onlyTables.join(', ') : 'all tables'}...`);
            try {
                await this.pushLocalToCloud(onlyTables);
            } catch (err) {
                console.error("CloudSync autoPush error:", err);
                throw err;
            }
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

        const tables = ['threadsSnapshots', 'aiChatterReports', 'aiChatGrades', 'aiChatMessages', 'aiChatConversations', 'aiChatModels', 'aiChatters', 'aiChatImports', 'ofDailyStats', 'ofLinkSnapshots', 'ofTrackingLinks', 'ofBulkImports', 'ofVas', 'ofModels', 'verifications', 'dailySnapshots', 'competitors', 'performances', 'tasks', 'assets', 'subreddits', 'accounts', 'models', 'settings'];
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
            else if (phase === 'burned' && !acc.isSuspended && (!acc.removalRate || acc.removalRate <= 60)) {
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
            const cleanHandle = account.handle.replace(/^(u\/|\/u\/)/i, '').trim();
            const res = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/stats/${cleanHandle}`, {}, 10000);
            if (!res.ok) throw new Error("Stats sync failed");
            const data = await res.json();

            const patch = {
                totalKarma: data.totalKarma,
                linkKarma: data.linkKarma,
                commentKarma: data.commentKarma,
                createdUtc: data.created,
                isSuspended: data.isSuspended,
                lastSyncDate: new Date().toISOString()
            };
            // Profile audit fields — use pre-computed booleans from proxy when available
            patch.hasAvatar = data.has_custom_avatar !== undefined ? (data.has_custom_avatar ? 1 : 0)
                : (((data.snoovatar_img && data.snoovatar_img.length > 0) || (data.icon_img && !String(data.icon_img).includes('default'))) ? 1 : 0);
            patch.hasBanner = data.has_banner !== undefined ? (data.has_banner ? 1 : 0)
                : ((data.banner_img && data.banner_img.length > 0) ? 1 : 0);
            patch.hasBio = (data.description && data.description.trim().length > 0) ? 1 : 0;
            // display_name (subreddit.title) counts only if it's not just the handle itself
            const dn = (data.display_name || '').trim();
            const handleClean = (account.handle || '').replace(/^u\//i, '').trim();
            patch.hasDisplayName = (dn.length > 0 && dn.toLowerCase() !== handleClean.toLowerCase()) ? 1 : 0;
            patch.hasVerifiedEmail = data.has_verified_email ? 1 : 0;
            patch.hasProfileLink = data.has_profile_link ? 1 : 0;
            patch.lastProfileAudit = new Date().toISOString();
            await db.accounts.update(accountId, patch);
            return data;
        } catch (err) {
            console.error(`Account sync fail(${account.handle}): `, err);
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

        const cleanHandle = account.handle.replace(/^(u\/|\/u\/)/i, '').trim();
        const proxyUrl = await SettingsService.getProxyUrl();
        const now = new Date().toISOString();

        try {
            const res = await fetchWithTimeout(`${proxyUrl}/api/scrape/user/stats/${cleanHandle}`, {}, 10000);
            if (!res.ok) {
                // 404 or error → likely shadow-banned or suspended
                await db.accounts.update(accountId, {
                    shadowBanStatus: 'shadow_banned',
                    lastShadowCheck: now,
                    phase: 'burned',
                    phaseChangedDate: now
                });
                return 'shadow_banned';
            }
            const data = await res.json();
            if (data.isSuspended) {
                await db.accounts.update(accountId, {
                    shadowBanStatus: 'suspended',
                    lastShadowCheck: now,
                    isSuspended: true,
                    phase: 'burned',
                    phaseChangedDate: now
                });
                return 'suspended';
            }
            await db.accounts.update(accountId, {
                shadowBanStatus: 'clean',
                lastShadowCheck: now
            });
            return 'clean';
        } catch (err) {
            console.error(`Shadow ban check failed (${cleanHandle}):`, err);
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

    async buildThreadsDailyReport() {
        const reportData = await VAReportService.generateReportData();
        const { fleet, vaCards, delta } = reportData;

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        const totalThreads = vaCards.reduce((sum, v) => sum + (v.totalThreads || 0), 0);
        const totalIdle = vaCards.reduce((sum, v) => sum + (v.idle || 0), 0);
        const postingPct = fleet.active > 0 ? Math.round((fleet.active - totalIdle) / fleet.active * 100) : 0;
        const fmt = (n) => (n >= 0 ? '+' + n : String(n));

        const lines = [];
        lines.push(`<b>Threads Daily Report</b> — ${dateStr}`);
        lines.push('');

        // FLEET
        lines.push('<b>FLEET</b>');
        lines.push(`${fleet.active} Active | ${fleet.warmUp} Warming | ${fleet.loginErrors} Errors`);
        lines.push(`${postingPct}% posting | ${totalIdle} idle | ${totalThreads.toLocaleString()} total posts`);
        if (delta.fleet) {
            lines.push(`vs yesterday: ${fmt(delta.fleet.activeChange)} active | ${fmt(delta.fleet.followerChange)} followers`);
        }
        lines.push('');

        // VA SCORECARD — sorted worst → best posting %
        const assignedVAs = vaCards
            .filter(v => v.handler !== 'Unassigned' && (v.active + v.warmUp + v.loginErrors) > 0)
            .sort((a, b) => (a.postingPct || 0) - (b.postingPct || 0));

        if (assignedVAs.length > 0) {
            lines.push('<b>VA SCORECARD</b>');
            for (const v of assignedVAs) {
                const pct = v.postingPct || 0;
                let icon;
                if (pct < 50) icon = '❌';
                else if (pct < 80) icon = '⚠️';
                else icon = '✅';

                let line = `${icon} ${v.handler}: ${pct}% posting (${v.idle}/${v.active} idle)`;
                // Show idle account names for underperformers
                if (pct < 80 && v.idleAccountNames && v.idleAccountNames.length > 0) {
                    const names = v.idleAccountNames.slice(0, 3).map(n => '@' + n).join(', ');
                    const extra = v.idleAccountNames.length > 3 ? ` +${v.idleAccountNames.length - 3}` : '';
                    line += ` — ${names}${extra}`;
                }
                lines.push(line);
            }
            lines.push('');
        }

        // STALE LOGINS
        const staleVAs = vaCards.filter(v => v.handler !== 'Unassigned' && v.staleLogins.length > 0);
        if (staleVAs.length > 0) {
            lines.push('<b>STALE LOGINS</b>');
            for (const v of staleVAs) {
                lines.push(`${v.handler}: ${v.staleLogins.length} not logged in 3+ days`);
            }
            lines.push('');
        }

        // TOP 3
        const topVAs = vaCards
            .filter(v => v.handler !== 'Unassigned' && v.active > 0)
            .sort((a, b) => (b.postingPct || 0) - (a.postingPct || 0))
            .slice(0, 3);
        if (topVAs.length > 0) {
            lines.push('<b>TOP 3</b>');
            topVAs.forEach((v, i) => {
                const followerDelta = delta.va[v.handler]?.followerChange;
                const fDelta = followerDelta ? ` (${followerDelta >= 0 ? '+' : ''}${followerDelta.toLocaleString()})` : '';
                lines.push(`${i + 1}. ${v.handler}: ${v.postingPct || 0}% posting, ${v.active} active, ${v.totalFollowers.toLocaleString()} followers${fDelta}`);
            });
        }

        await VAReportService.saveSnapshot(reportData);
        return lines.join('\n');
    },

    async sendThreadsDailyReport() {
        try {
            const settings = await SettingsService.getSettings();
            // Use Threads Telegram config with fallback to main
            const token = (settings.threadsTelegramBotToken || settings.telegramBotToken || '').trim();
            const chatId = (settings.threadsTelegramChatId || settings.telegramChatId || '').trim();
            const threadId = (settings.threadsTelegramThreadId || settings.telegramThreadId || '').trim();
            if (!token || !chatId) {
                return { sent: false, reason: 'No Telegram credentials configured (Threads or main)' };
            }
            const report = await this.buildThreadsDailyReport();
            await this.sendMessage(token, chatId, report, threadId);
            return { sent: true };
        } catch (e) {
            console.error('[TelegramService] sendThreadsDailyReport failed:', e);
            return { sent: false, reason: e.message || 'Unknown error' };
        }
    },

    async buildOFDailyReport() {
        const today = new Date().toISOString().split('T')[0];
        const report = await OFReportService.getDailyReport(today);
        const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const fmt = (n) => (n >= 0 ? '+' + n : String(n));

        const lines = [];
        lines.push(`<b>OF Tracker Daily Report</b> — ${dateStr}`);
        lines.push('');

        // Model subs ranking
        if (report.modelRanking.length > 0) {
            lines.push('<b>MODEL SUBS</b>');
            for (const m of report.modelRanking) {
                lines.push(`${m.model}: ${m.subs}`);
            }
            lines.push('');
        }

        // VA performance
        if (report.vaRanking.length > 0) {
            lines.push('<b>VA PERFORMANCE</b>');
            for (const v of report.vaRanking) {
                const icon = v.subs === 0 ? '🔴' : v.subs >= 10 ? '🟢' : '🟡';
                lines.push(`${icon} ${v.va}: ${v.subs} subs (${v.modelCount} models)`);
            }
            lines.push('');
        }

        // Totals
        lines.push('<b>TOTALS</b>');
        lines.push(`New subs: ${report.totalSubs} | vs yesterday: ${fmt(report.comparison.delta)}`);
        lines.push(`VAs producing: ${report.producingVAs}/${report.activeVAs}`);

        return lines.join('\n');
    },

    async sendOFDailyReport() {
        try {
            const settings = await SettingsService.getSettings();
            const token = (settings.ofTelegramBotToken || settings.telegramBotToken || '').trim();
            const chatId = (settings.ofTelegramChatId || settings.telegramChatId || '').trim();
            const threadId = (settings.ofTelegramThreadId || settings.telegramThreadId || '').trim();
            if (!token || !chatId) {
                return { sent: false, reason: 'No Telegram credentials configured (OF or main)' };
            }
            const report = await this.buildOFDailyReport();
            await this.sendMessage(token, chatId, report, threadId);
            return { sent: true };
        } catch (e) {
            console.error('[TelegramService] sendOFDailyReport failed:', e);
            return { sent: false, reason: e.message || 'Unknown error' };
        }
    }
};


// ─── Airtable Integration (Threads Dashboard) ────────────────────────────────

export const AirtableService = {
    _cache: null,
    _deviceCache: null,
    _cacheTime: 0,
    _deviceCacheTime: 0,
    _CACHE_TTL: 5 * 60 * 1000, // 5 minutes

    async _getConfig() {
        const settings = await SettingsService.getSettings();
        const apiKey = (settings.airtableApiKey || '').trim();
        const baseId = (settings.airtableBaseId || '').trim();
        const tableName = (settings.airtableTableName || 'Phone Posting').trim();
        if (!apiKey || !baseId) throw new Error('Airtable API key and Base ID are required. Configure them in Settings.');
        return { apiKey, baseId, tableName };
    },

    async _fetchPaginated(baseId, tableName, apiKey, filterByFormula) {
        const allRecords = [];
        let offset = null;
        do {
            const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
            url.searchParams.set('pageSize', '100');
            if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula);
            if (offset) url.searchParams.set('offset', offset);

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Airtable API error ${res.status}: ${body}`);
            }
            const data = await res.json();
            allRecords.push(...(data.records || []));
            offset = data.offset || null;
        } while (offset);
        return allRecords;
    },

    _mapRecord(r) {
        const f = r.fields || {};
        return {
            id: r.id,
            username: f['Username'] || '',
            model: f['Model'] || '',
            status: f['Status'] || '',
            followers: Number(f['Followers']) || 0,
            daysSinceCreation: Number(f['Days Since Creation']) || 0,
            device: f['Device'] || [],
            password: f['Password'] || '',
            twoFA: f['2FA'] || '',
            vpnLocation: f['VPN Location'] || '',
            provider: f['Provider'] || '',
            loginDate: f['Login Date'] || '',
            daysSinceLogin: Number(f['Days Since Login']) || 0,
            linkInBio: f['Link in Bio'] || '',
            threadCount: Number(f['Thread Count']) || 0,
            lastPostDate: f['Last Post Date'] || '',
            creationDate: f['Creation Date'] || '',
            openThreadsUrl: f['Open Threads'] || '',
        };
    },

    async fetchAllAccounts(forceRefresh = false) {
        if (!forceRefresh && this._cache && (Date.now() - this._cacheTime < this._CACHE_TTL)) {
            return this._cache;
        }
        const { apiKey, baseId, tableName } = await this._getConfig();
        const records = await this._fetchPaginated(baseId, tableName, apiKey);
        const accounts = records.map(r => this._mapRecord(r));
        this._cache = accounts;
        this._cacheTime = Date.now();
        return accounts;
    },

    async fetchActiveAccounts() {
        const { apiKey, baseId, tableName } = await this._getConfig();
        const filter = "OR({Status}='Active',{Status}='Warm Up',{Status}='Setting Up')";
        const records = await this._fetchPaginated(baseId, tableName, apiKey, filter);
        return records.map(r => this._mapRecord(r));
    },

    async fetchDevices(forceRefresh = false) {
        if (!forceRefresh && this._deviceCache && (Date.now() - this._deviceCacheTime < this._CACHE_TTL)) {
            return this._deviceCache;
        }
        const { apiKey, baseId } = await this._getConfig();
        const records = await this._fetchPaginated(baseId, 'Device', apiKey);
        const devices = records.map(r => {
            const f = r.fields || {};
            return {
                id: r.id,
                iphoneUID: f['iPhone UID'] || '',
                handler: f['Handler'] || '',
                numberOfAccounts: Number(f['Number of Accounts']) || 0,
                serialNumber: f['Serial Number'] || '',
                phoneBrandModel: f['Phone Brand/Model'] || '',
                fullName: f['Full Name'] || '',
                workEmail: f['Work Email'] || '',
            };
        });
        this._deviceCache = devices;
        this._deviceCacheTime = Date.now();
        return devices;
    },

    async getThreadsMetrics(accounts) {
        if (!accounts) accounts = await this.fetchAllAccounts();
        const total = accounts.length;
        const statusCounts = {};
        accounts.forEach(a => {
            const s = a.status || 'Unknown';
            statusCounts[s] = (statusCounts[s] || 0) + 1;
        });
        return {
            total,
            active: statusCounts['Active'] || 0,
            warmUp: statusCounts['Warm Up'] || 0,
            settingUp: statusCounts['Setting Up'] || 0,
            suspended: statusCounts['Suspended'] || 0,
            dead: (statusCounts['Dead/Shadowbanned'] || 0) + (statusCounts['Dead'] || 0),
            loginErrors: statusCounts['Login Errors'] || 0,
            threadsAdded: statusCounts['THREADS ADDED'] || 0,
            statusCounts,
        };
    },

    async getModelBreakdown(accounts) {
        if (!accounts) accounts = await this.fetchAllAccounts();
        const models = {};
        accounts.forEach(a => {
            const m = a.model || 'Unknown';
            if (!models[m]) models[m] = { model: m, total: 0, active: 0, suspended: 0, dead: 0, warmUp: 0, loginErrors: 0 };
            models[m].total++;
            const s = a.status || '';
            if (s === 'Active') models[m].active++;
            else if (s === 'Suspended') models[m].suspended++;
            else if (s === 'Dead/Shadowbanned' || s === 'Dead') models[m].dead++;
            else if (s === 'Warm Up') models[m].warmUp++;
            else if (s === 'Login Errors') models[m].loginErrors++;
        });
        return Object.values(models).sort((a, b) => b.total - a.total);
    },

    async getVAScorecard(accounts, devices) {
        if (!accounts) accounts = await this.fetchAllAccounts();
        if (!devices) devices = await this.fetchDevices();

        // Build device ID -> handler map
        const deviceMap = {};
        devices.forEach(d => { deviceMap[d.id] = d; });

        // Group accounts by handler via device link
        const vaMap = {};
        accounts.forEach(a => {
            const deviceIds = Array.isArray(a.device) ? a.device : [];
            let handler = 'Unassigned';
            let phoneBrand = '';
            if (deviceIds.length > 0) {
                const dev = deviceMap[deviceIds[0]];
                if (dev) {
                    handler = dev.handler || dev.fullName || 'Unassigned';
                    phoneBrand = dev.phoneBrandModel || '';
                }
            }
            if (!vaMap[handler]) vaMap[handler] = { handler, phone: phoneBrand, total: 0, active: 0, suspended: 0, dead: 0, loginErrors: 0 };
            vaMap[handler].total++;
            const s = a.status || '';
            if (s === 'Active') vaMap[handler].active++;
            else if (s === 'Suspended') vaMap[handler].suspended++;
            else if (s === 'Dead/Shadowbanned' || s === 'Dead') vaMap[handler].dead++;
            else if (s === 'Login Errors') vaMap[handler].loginErrors++;
        });
        return Object.values(vaMap).sort((a, b) => b.total - a.total);
    },

    async getActionItems(accounts) {
        if (!accounts) accounts = await this.fetchAllAccounts();
        const items = [];

        // Login Errors → critical
        const loginErrors = accounts.filter(a => a.status === 'Login Errors');
        if (loginErrors.length > 0) {
            items.push({
                severity: 'critical',
                title: `${loginErrors.length} accounts with Login Errors`,
                detail: loginErrors.slice(0, 5).map(a => a.username).join(', ') + (loginErrors.length > 5 ? '...' : ''),
            });
        }

        // No Link in Bio → warning
        const noLink = accounts.filter(a => a.status === 'Active' && !a.linkInBio);
        if (noLink.length > 0) {
            items.push({
                severity: 'warning',
                title: `${noLink.length} active accounts missing Link in Bio`,
                detail: noLink.slice(0, 5).map(a => a.username).join(', ') + (noLink.length > 5 ? '...' : ''),
            });
        }

        // Setting Up for 7+ days → info
        const staleSetup = accounts.filter(a => a.status === 'Setting Up' && a.daysSinceCreation >= 7);
        if (staleSetup.length > 0) {
            items.push({
                severity: 'info',
                title: `${staleSetup.length} accounts "Setting Up" for 7+ days`,
                detail: staleSetup.slice(0, 5).map(a => `${a.username} (${a.daysSinceCreation}d)`).join(', ') + (staleSetup.length > 5 ? '...' : ''),
            });
        }

        // Stale logins (7+ days since login) → warning
        const staleLogins = accounts.filter(a => (a.status === 'Active' || a.status === 'Warm Up') && a.daysSinceLogin >= 7);
        if (staleLogins.length > 0) {
            items.push({
                severity: 'warning',
                title: `${staleLogins.length} active/warmup accounts not logged in 7+ days`,
                detail: staleLogins.slice(0, 5).map(a => `${a.username} (${a.daysSinceLogin}d)`).join(', ') + (staleLogins.length > 5 ? '...' : ''),
            });
        }

        return items;
    },

    async testConnection() {
        const { apiKey, baseId, tableName } = await this._getConfig();
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
        url.searchParams.set('pageSize', '1');
        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Airtable API error ${res.status}: ${body}`);
        }
        const data = await res.json();
        return { success: true, recordCount: data.records?.length || 0 };
    },

    async updateAccountsBatch(updates) {
        // updates = [{ id: recordId, fields: { 'Status': 'Dead/Shadowbanned', ... } }, ...]
        const { apiKey, baseId, tableName } = await this._getConfig();
        const batches = [];
        for (let i = 0; i < updates.length; i += 10) {
            batches.push(updates.slice(i, i + 10));
        }
        for (const batch of batches) {
            const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: batch })
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`Airtable batch update failed ${res.status}: ${body}`);
            }
        }
    },

    clearCache() {
        this._cache = null;
        this._cacheTime = 0;
    }
};



// ─── Threads Health Patrol ────────────────────────────────────────────────────
// Bulk-checks all active/warmup accounts via proxy scraper, writes dead status back to Airtable

// Process items in parallel with a concurrency limit (no npm dependency)
async function parallelWithLimit(items, limit, fn) {
    const results = [];
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i], i).then(
                value => ({ status: 'fulfilled', value }),
                reason => ({ status: 'rejected', reason })
            );
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}

export const ThreadsPatrolService = {
    _STORAGE_KEY: 'threadsPatrol_lastRun',

    getLastRunDate() {
        try { return localStorage.getItem(this._STORAGE_KEY) || null; } catch { return null; }
    },

    _setLastRunDate() {
        try { localStorage.setItem(this._STORAGE_KEY, new Date().toISOString().slice(0, 10)); } catch {}
    },

    canRunToday() {
        const last = this.getLastRunDate();
        if (!last) return true;
        const today = new Date().toISOString().slice(0, 10);
        return last !== today;
    },

    async runPatrol(onProgress) {
        if (!this.canRunToday()) {
            throw new Error('DAILY_LIMIT');
        }

        const toCheck = await AirtableService.fetchActiveAccounts();
        const proxyUrl = await SettingsService.getProxyUrl();
        if (!proxyUrl) throw new Error('Proxy URL not configured. Set it in Settings.');

        const results = { alive: 0, dead: 0, confirmed_dead: 0, errors: 0, rateLimited: 0, updated: [] };
        const updates = [];
        const snapshots = [];
        const today = new Date().toISOString().slice(0, 10);
        let checked = 0;

        // Load prior dead snapshots for 2-strike rule (dead on a DIFFERENT day = confirmed)
        const allPriorSnaps = await db.threadsSnapshots.where('status').equals('not_found').toArray();
        const priorDeadDays = new Map(); // username -> Set of dates they were dead
        for (const s of allPriorSnaps) {
            if (s.date === today) continue; // only count previous days
            if (!priorDeadDays.has(s.username)) priorDeadDays.set(s.username, new Set());
            priorDeadDays.get(s.username).add(s.date);
        }

        // Load most recent prior snapshot per username for threadCount comparison
        const allActiveSnaps = await db.threadsSnapshots.where('date').below(today).reverse().sortBy('date');
        const prevThreadCounts = new Map(); // username -> most recent threadCount
        for (const s of allActiveSnaps) {
            if (!prevThreadCounts.has(s.username)) prevThreadCounts.set(s.username, s.threadCount || 0);
        }

        onProgress?.({ checked: 0, total: toCheck.length, ...results });

        // Slow: 1 at a time with 3s delay to avoid Threads rate-limiting
        const CONCURRENCY = 1;
        const DELAY_MS = 3000;

        for (const acc of toCheck) {
            try {
                const res = await fetch(`${proxyUrl}/api/scrape/threads/user/stats/${acc.username}`, { headers: await getProxyHeaders(), signal: AbortSignal.timeout(30000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                const fields = {};
                const uname = acc.username.toLowerCase();

                // Save snapshot for growth tracking
                snapshots.push({
                    id: generateId(),
                    username: uname,
                    date: today,
                    followers: data.followerCount ?? 0,
                    threadCount: data.threadCount ?? 0,
                    status: data.exists ? 'active' : (data.status || 'not_found'),
                    airtableRecordId: acc.id,
                    model: acc.model || '',
                });

                if (!data.exists || data.status === 'not_found') {
                    results.dead++;
                    // 2-strike rule: only write Dead to Airtable if also dead on a previous day
                    const priorDead = priorDeadDays.get(uname);
                    if (priorDead && priorDead.size > 0) {
                        fields['Status'] = 'Dead/Shadowbanned';
                        results.confirmed_dead++;
                        results.updated.push({ username: acc.username, prevStatus: acc.status, newStatus: 'Dead/Shadowbanned', strikes: priorDead.size + 1 });
                    } else {
                        results.updated.push({ username: acc.username, prevStatus: acc.status, newStatus: 'suspect (1st strike)' });
                    }
                } else if (data.status === 'rate_limited') {
                    results.rateLimited++;
                } else {
                    // Alive — update metrics
                    if (data.followerCount !== undefined) fields['Followers'] = data.followerCount;
                    if (data.threadCount !== undefined) {
                        fields['Thread Count'] = data.threadCount;
                        // If threadCount increased vs previous snapshot, account posted — update Last Post Date
                        const prevCount = prevThreadCounts.get(uname) || 0;
                        if (data.threadCount > prevCount) {
                            fields['Last Post Date'] = today;
                        }
                    }
                    results.alive++;
                }

                if (Object.keys(fields).length > 0) {
                    updates.push({ id: acc.id, fields });
                }
            } catch {
                results.errors++;
            }

            checked++;
            onProgress?.({ checked, total: toCheck.length, ...results });

            // Delay between requests to avoid rate-limiting
            if (checked < toCheck.length) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }
        }

        // Save daily snapshots to Dexie
        if (snapshots.length > 0) {
            await db.threadsSnapshots.bulkAdd(snapshots);
        }

        // Batch update Airtable (only confirmed dead + alive metric updates)
        if (updates.length > 0) {
            await AirtableService.updateAccountsBatch(updates);
        }

        AirtableService.clearCache();
        this._setLastRunDate();

        return results;
    },

    async getGrowthDeltas() {
        const today = new Date().toISOString().slice(0, 10);
        const todaySnaps = await db.threadsSnapshots.where('date').equals(today).toArray();
        if (todaySnaps.length === 0) return {};

        // Find previous snapshots (limit to last 7 days for performance)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const allPrev = await db.threadsSnapshots
            .where('date').between(weekAgo.toISOString().slice(0, 10), today, true, false)
            .reverse().toArray();
        const prevMap = {};
        for (const s of allPrev) {
            if (!prevMap[s.username]) prevMap[s.username] = s;
        }

        const deltas = {};
        for (const snap of todaySnaps) {
            const prev = prevMap[snap.username];
            deltas[snap.username] = {
                followers: snap.followers,
                threadCount: snap.threadCount,
                followerDelta: prev ? snap.followers - prev.followers : 0,
                threadDelta: prev ? snap.threadCount - prev.threadCount : 0,
            };
        }
        return deltas;
    }
};


// ─── Threads Growth Intelligence ──────────────────────────────────────────────
// Analyzes Threads fleet data for growth insights, patterns, and recommendations

export const ThreadsGrowthService = {
    async getFleetHealth(accounts) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();
        const total = accounts.length;
        if (total === 0) return { score: 0, grade: 'N/A', breakdown: {} };

        const active = accounts.filter(a => a.status === 'Active').length;
        const warmUp = accounts.filter(a => a.status === 'Warm Up').length;
        const suspended = accounts.filter(a => a.status === 'Suspended').length;
        const dead = accounts.filter(a => a.status === 'Dead' || a.status === 'Dead/Shadowbanned').length;
        const loginErrors = accounts.filter(a => a.status === 'Login Errors').length;

        // Health score: active=100pts, warmup=80pts, suspended/errors=0pts, dead=-50pts
        const score = Math.max(0, Math.min(100, Math.round(
            ((active * 100 + warmUp * 80) / total) - (dead / total * 50)
        )));
        const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';

        // Survival rate: active / (active + dead + suspended)
        const atRisk = active + dead + suspended;
        const survivalRate = atRisk > 0 ? Math.round((active / atRisk) * 100) : 100;

        return {
            score,
            grade,
            survivalRate,
            breakdown: { total, active, warmUp, suspended, dead, loginErrors },
        };
    },

    async getModelPerformance(accounts) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();
        const models = {};
        accounts.forEach(a => {
            const m = a.model || 'Unknown';
            if (!models[m]) models[m] = {
                model: m, total: 0, active: 0, suspended: 0, dead: 0, warmUp: 0, loginErrors: 0,
                totalFollowers: 0, avgFollowers: 0, activeFollowers: 0,
                survivalRate: 0,
            };
            models[m].total++;
            models[m].totalFollowers += a.followers || 0;
            const s = a.status || '';
            if (s === 'Active') { models[m].active++; models[m].activeFollowers += a.followers || 0; }
            else if (s === 'Suspended') models[m].suspended++;
            else if (s === 'Dead/Shadowbanned' || s === 'Dead') models[m].dead++;
            else if (s === 'Warm Up') models[m].warmUp++;
            else if (s === 'Login Errors') models[m].loginErrors++;
        });

        return Object.values(models).map(m => {
            const atRisk = m.active + m.dead + m.suspended;
            m.survivalRate = atRisk > 0 ? Math.round((m.active / atRisk) * 100) : 100;
            m.avgFollowers = m.active > 0 ? Math.round(m.activeFollowers / m.active) : 0;
            return m;
        }).sort((a, b) => b.activeFollowers - a.activeFollowers);
    },

    async getVAPerformance(accounts, devices) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();
        if (!devices) devices = await AirtableService.fetchDevices();

        const deviceMap = {};
        devices.forEach(d => { deviceMap[d.id] = d; });

        const vaMap = {};
        accounts.forEach(a => {
            const deviceIds = Array.isArray(a.device) ? a.device : [];
            let handler = 'Unassigned';
            if (deviceIds.length > 0) {
                const dev = deviceMap[deviceIds[0]];
                if (dev) handler = dev.handler || dev.fullName || 'Unassigned';
            }
            if (!vaMap[handler]) vaMap[handler] = { handler, total: 0, active: 0, suspended: 0, dead: 0, loginErrors: 0, totalFollowers: 0 };
            vaMap[handler].total++;
            vaMap[handler].totalFollowers += a.followers || 0;
            const s = a.status || '';
            if (s === 'Active') vaMap[handler].active++;
            else if (s === 'Suspended') vaMap[handler].suspended++;
            else if (s === 'Dead/Shadowbanned' || s === 'Dead') vaMap[handler].dead++;
            else if (s === 'Login Errors') vaMap[handler].loginErrors++;
        });

        return Object.values(vaMap).map(v => {
            const atRisk = v.active + v.dead + v.suspended;
            v.survivalRate = atRisk > 0 ? Math.round((v.active / atRisk) * 100) : 100;
            v.healthScore = v.total > 0 ? Math.round(((v.active * 100 + (v.total - v.active - v.dead - v.suspended - v.loginErrors) * 80) / v.total) - (v.dead / v.total * 50)) : 0;
            return v;
        }).sort((a, b) => b.total - a.total);
    },

    async getAccountAgeAnalysis(accounts) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();

        // Bucket accounts by age ranges
        const buckets = [
            { label: '0-7d', min: 0, max: 7 },
            { label: '8-14d', min: 8, max: 14 },
            { label: '15-30d', min: 15, max: 30 },
            { label: '31-60d', min: 31, max: 60 },
            { label: '61-90d', min: 61, max: 90 },
            { label: '90d+', min: 91, max: Infinity },
        ];

        const result = buckets.map(b => {
            const inRange = accounts.filter(a => a.daysSinceCreation >= b.min && a.daysSinceCreation <= b.max);
            const active = inRange.filter(a => a.status === 'Active').length;
            const dead = inRange.filter(a => a.status === 'Dead' || a.status === 'Dead/Shadowbanned').length;
            const suspended = inRange.filter(a => a.status === 'Suspended').length;
            return {
                label: b.label,
                total: inRange.length,
                active,
                dead,
                suspended,
                survivalRate: inRange.length > 0 ? Math.round((active / inRange.length) * 100) : 0,
            };
        });

        return result;
    },

    async getRecommendations(accounts) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();
        const recs = [];

        const total = accounts.length;
        const active = accounts.filter(a => a.status === 'Active').length;
        const dead = accounts.filter(a => a.status === 'Dead' || a.status === 'Dead/Shadowbanned').length;
        const suspended = accounts.filter(a => a.status === 'Suspended').length;
        const loginErrors = accounts.filter(a => a.status === 'Login Errors').length;
        const warmUp = accounts.filter(a => a.status === 'Warm Up').length;
        const noLink = accounts.filter(a => a.status === 'Active' && !a.linkInBio).length;
        const staleLogins = accounts.filter(a => (a.status === 'Active' || a.status === 'Warm Up') && a.daysSinceLogin >= 7).length;

        const deathRate = total > 0 ? Math.round((dead / total) * 100) : 0;
        const suspendRate = total > 0 ? Math.round((suspended / total) * 100) : 0;

        if (deathRate > 20) {
            recs.push({ severity: 'critical', message: `Death rate is ${deathRate}% — investigate banning patterns. Consider changing VPN locations or creation methods.` });
        } else if (deathRate > 10) {
            recs.push({ severity: 'warning', message: `Death rate at ${deathRate}% — monitor closely. Check if specific models or VAs have higher death rates.` });
        }

        if (suspendRate > 15) {
            recs.push({ severity: 'critical', message: `${suspendRate}% accounts suspended — review posting cadence and content types.` });
        }

        if (loginErrors > 10) {
            recs.push({ severity: 'warning', message: `${loginErrors} accounts have login errors — VAs should re-login and update credentials.` });
        }

        if (noLink > 0) {
            recs.push({ severity: 'info', message: `${noLink} active accounts missing link in bio — add monetization links.` });
        }

        if (staleLogins > 0) {
            recs.push({ severity: 'warning', message: `${staleLogins} accounts haven't been logged into in 7+ days — at risk of going cold.` });
        }

        if (warmUp > total * 0.4) {
            recs.push({ severity: 'info', message: `${Math.round(warmUp / total * 100)}% of fleet still warming up — expected timeline to fully active: ${Math.ceil(warmUp / 20)} days at current pace.` });
        }

        if (active > 0 && deathRate < 5 && suspendRate < 5) {
            recs.push({ severity: 'success', message: `Fleet health is excellent — ${active} active accounts with low attrition. Consider scaling up.` });
        }

        return recs;
    },

    async getFollowerDistribution(accounts) {
        if (!accounts) accounts = await AirtableService.fetchAllAccounts();
        const activeAccounts = accounts.filter(a => a.status === 'Active' && a.followers > 0);

        const buckets = [
            { label: '0-100', min: 0, max: 100 },
            { label: '101-500', min: 101, max: 500 },
            { label: '501-1k', min: 501, max: 1000 },
            { label: '1k-5k', min: 1001, max: 5000 },
            { label: '5k-10k', min: 5001, max: 10000 },
            { label: '10k+', min: 10001, max: Infinity },
        ];

        return buckets.map(b => ({
            label: b.label,
            count: activeAccounts.filter(a => a.followers >= b.min && a.followers <= b.max).length,
        }));
    },
};

// ─── VA Daily Report Service ──────────────────────────────────────────────────
// Generates per-VA accountability metrics with day-over-day delta tracking

export const VAReportService = {
    async generateReportData() {
        // Fetch accounts + devices in parallel
        const [accountsResult, devicesResult] = await Promise.allSettled([
            AirtableService.fetchAllAccounts(),
            AirtableService.fetchDevices(),
        ]);
        const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
        const devices = devicesResult.status === 'fulfilled' ? devicesResult.value : [];
        if (accounts.length === 0) throw new Error('No accounts found in Airtable');

        // Build device ID -> handler map
        const deviceMap = {};
        devices.forEach(d => { deviceMap[d.id] = d; });

        // Group accounts by VA handler
        const vaMap = {};
        accounts.forEach(a => {
            const deviceIds = Array.isArray(a.device) ? a.device : [];
            let handler = 'Unassigned';
            if (deviceIds.length > 0) {
                const dev = deviceMap[deviceIds[0]];
                if (dev) handler = dev.handler || dev.fullName || 'Unassigned';
            }
            if (!vaMap[handler]) vaMap[handler] = {
                handler, total: 0, active: 0, warmUp: 0, suspended: 0, dead: 0,
                loginErrors: 0, settingUp: 0, totalFollowers: 0, staleLogins: [],
                accounts: [],
            };
            const v = vaMap[handler];
            v.total++;
            v.totalFollowers += a.followers || 0;
            v.accounts.push(a);
            const s = a.status || '';
            if (s === 'Active') v.active++;
            else if (s === 'Warm Up') v.warmUp++;
            else if (s === 'Suspended') v.suspended++;
            else if (s === 'Dead' || s === 'Dead/Shadowbanned') v.dead++;
            else if (s === 'Login Errors') v.loginErrors++;
            else if (s === 'Setting Up') v.settingUp++;

            // Stale login: active or warming accounts not logged in 3+ days
            if ((s === 'Active' || s === 'Warm Up') && a.daysSinceLogin >= 3) {
                v.staleLogins.push({ username: a.username, daysSinceLogin: a.daysSinceLogin });
            }
        });

        // Compute per-VA metrics
        const daysSincePost = (a) => {
            if (!a.lastPostDate) return a.threadCount > 0 ? 999 : -1;
            return Math.floor((Date.now() - new Date(a.lastPostDate).getTime()) / 86400000);
        };
        const vaCards = Object.values(vaMap).map(v => {
            const atRisk = v.active + v.dead + v.suspended;
            v.survivalRate = atRisk > 0 ? Math.round((v.active / atRisk) * 100) : 100;
            // Idle = active accounts not posting (0 posts or no post today)
            const activeAccs = v.accounts.filter(a => a.status === 'Active');
            const idleAccs = activeAccs.filter(a => a.threadCount === 0 || (a.lastPostDate && daysSincePost(a) >= 1));
            v.idle = idleAccs.length;
            v.idleAccountNames = idleAccs.map(a => a.username);
            v.totalThreads = activeAccs.reduce((sum, a) => sum + (a.threadCount || 0), 0);
            v.postingPct = activeAccs.length > 0 ? Math.round((activeAccs.length - idleAccs.length) / activeAccs.length * 100) : 0;
            return v;
        }).sort((a, b) => b.active - a.active);

        // Fleet summary
        const fleetHealth = await ThreadsGrowthService.getFleetHealth(accounts);
        const fleet = {
            total: accounts.length,
            active: fleetHealth.breakdown.active,
            warmUp: fleetHealth.breakdown.warmUp,
            suspended: fleetHealth.breakdown.suspended,
            dead: fleetHealth.breakdown.dead,
            loginErrors: fleetHealth.breakdown.loginErrors,
            score: fleetHealth.score,
            grade: fleetHealth.grade,
            survivalRate: fleetHealth.survivalRate,
            totalFollowers: accounts.reduce((sum, a) => sum + (a.followers || 0), 0),
        };

        // Delta tracking — load previous snapshot
        const settings = await SettingsService.getSettings();
        let prevSnapshot = null;
        try {
            const raw = settings.lastVASnapshot;
            if (raw) prevSnapshot = JSON.parse(raw);
        } catch (_) { /* no previous snapshot */ }

        const delta = { fleet: null, va: {} };
        if (prevSnapshot && prevSnapshot.fleet) {
            delta.fleet = {
                totalChange: fleet.total - (prevSnapshot.fleet.total || 0),
                activeChange: fleet.active - (prevSnapshot.fleet.active || 0),
                deadChange: fleet.dead - (prevSnapshot.fleet.dead || 0),
                followerChange: fleet.totalFollowers - (prevSnapshot.fleet.totalFollowers || 0),
            };
            // Per-VA deltas
            if (prevSnapshot.va) {
                for (const v of vaCards) {
                    const prev = prevSnapshot.va[v.handler];
                    if (prev) {
                        delta.va[v.handler] = {
                            totalChange: v.total - (prev.total || 0),
                            activeChange: v.active - (prev.active || 0),
                            deadChange: v.dead - (prev.dead || 0),
                            followerChange: v.totalFollowers - (prev.totalFollowers || 0),
                        };
                    }
                }
            }
        }

        // Red flags (skip Unassigned)
        const redFlags = [];
        for (const v of vaCards) {
            if (v.handler === 'Unassigned') continue;
            // Stale logins (3+ days)
            if (v.staleLogins.length > 0) {
                const sorted = [...v.staleLogins].sort((a, b) => b.daysSinceLogin - a.daysSinceLogin);
                const shown = sorted.slice(0, 3).map(s => `${s.username} (${s.daysSinceLogin}d)`).join(', ');
                const extra = sorted.length > 3 ? ` +${sorted.length - 3} more` : '';
                redFlags.push({ severity: 3, handler: v.handler, message: `${v.staleLogins.length} account(s) not logged in 3+ days — ${shown}${extra}` });
            }
            // Dead delta
            const vDelta = delta.va[v.handler];
            if (vDelta && vDelta.deadChange > 0) {
                redFlags.push({ severity: 2, handler: v.handler, message: `+${vDelta.deadChange} dead account(s) since yesterday` });
            }
            // Login errors
            if (v.loginErrors > 0) {
                redFlags.push({ severity: 1, handler: v.handler, message: `${v.loginErrors} account(s) with login errors` });
            }
        }
        redFlags.sort((a, b) => b.severity - a.severity);

        // Watch list
        const watchList = [];
        const fleetSurvival = fleet.survivalRate;
        for (const v of vaCards) {
            if (v.handler === 'Unassigned') continue;
            // Survival rate 10+ points below fleet avg (min 3 accounts)
            if (v.total >= 3 && v.survivalRate < fleetSurvival - 10) {
                watchList.push({ type: 'survival', handler: v.handler, message: `${v.survivalRate}% survival (fleet avg: ${fleetSurvival}%)` });
            }
        }
        // Accounts stuck in Setting Up or Warm Up 14+ days
        for (const a of accounts) {
            if ((a.status === 'Setting Up' || a.status === 'Warm Up') && a.daysSinceCreation >= 14) {
                const deviceIds = Array.isArray(a.device) ? a.device : [];
                let handler = 'Unassigned';
                if (deviceIds.length > 0) {
                    const dev = deviceMap[deviceIds[0]];
                    if (dev) handler = dev.handler || dev.fullName || 'Unassigned';
                }
                if (handler === 'Unassigned') continue;
                watchList.push({ type: 'stuck', handler, message: `${a.username} (${handler}): "${a.status}" for ${a.daysSinceCreation} days` });
            }
        }

        // Top performers (top 5 by active -> survival -> followers)
        const topPerformers = vaCards
            .filter(v => v.handler !== 'Unassigned' && v.active > 0)
            .sort((a, b) => b.active - a.active || b.survivalRate - a.survivalRate || b.totalFollowers - a.totalFollowers)
            .slice(0, 5)
            .map(v => {
                const vDelta = delta.va[v.handler];
                return {
                    handler: v.handler,
                    active: v.active,
                    survivalRate: v.survivalRate,
                    totalFollowers: v.totalFollowers,
                    followerChange: vDelta ? vDelta.followerChange : 0,
                };
            });

        return { fleet, vaCards, redFlags, watchList, topPerformers, delta };
    },

    async saveSnapshot(reportData) {
        // Lightweight snapshot: fleet + per-VA summary (no account arrays)
        const snapshot = {
            date: new Date().toISOString().slice(0, 10),
            fleet: { ...reportData.fleet },
            va: {},
        };
        for (const v of reportData.vaCards) {
            snapshot.va[v.handler] = {
                total: v.total,
                active: v.active,
                dead: v.dead,
                suspended: v.suspended,
                totalFollowers: v.totalFollowers,
            };
        }
        await SettingsService.updateSetting('lastVASnapshot', JSON.stringify(snapshot));
    },
};

// ─── OF Tracker: VA Pattern Matching ──────────────────────────────────────────

export const OFVAPatternService = {
    VA_LABEL_PATTERNS: [
        { va: 'Sarah', regex: /^SARAH\s+(P|M|PHONE|POST)\b/i },
        { va: 'Arron', regex: /^ARRON\s+(P|B|BOT|M)\b/i },
        { va: 'Cha', regex: /^CHA\s+P\b/i },
        { va: 'Jaja', regex: /^JA\s+P\b/i },
        { va: 'Jeff', regex: /^JEFF\s+(M|F|M\/S)\b/i },
        { va: 'Michon', regex: /^MICHON\s+P\b/i },
        { va: 'John', regex: /^JOHN\s+(P|M\/S)\b/i },
        { va: 'MK', regex: /^MK\s+(P|F)\b/i },
        { va: 'Kaye', regex: /^KAYE\s+P\b/i },
        { va: 'Angel', regex: /^ANGEL\s+(P|PHONE)\b/i },
        { va: 'Gabbie', regex: /^GABBIE\s+P\b/i },
        { va: 'Aira', regex: /^AIRA\s+(P|M|M\/S)\b/i },
        { va: 'Kyle', regex: /^KYLE\s+(P|TEST)\b/i },
        { va: 'Migs', regex: /^MIGS\s+P\b/i },
        { va: 'Trixie', regex: /^TRIXIE\s+(PHONE|P|E)\b/i },
        { va: 'Trixie', regex: /^erome\b/i },
        { va: 'Jaja', regex: /^JAJA\s+(P|MAIA)\b/i },
        { va: 'Amaka', regex: /^AMAKA\s+P\b/i },
        { va: 'Cozza', regex: /^COZZA\s+(S|POSTING)\b/i },
        { va: 'Den', regex: /^DEN\s+BOT\b/i },
        { va: 'Larry', regex: /^LARRY\s+P\b/i },
        { va: 'Ogug', regex: /^OGUG\s+P\b/i },
        { va: 'Anthonia', regex: /^ANTHONIA\s+P\b/i },
        { va: 'Matteo', regex: /\bmatteo\b/i },
        { va: 'Nathanael', regex: /^Nathanael\b/i },
        { va: 'Mimi', regex: /\bmimi\b/i },
        { va: 'Maxime', regex: /\bMaxime\b/i },
        { va: 'Hans', regex: /\bHANS\b/i },
        { va: 'Jake', regex: /^(JAKE|THREADS JAKE)\b/i },
    ],

    ADS_PATTERNS: [
        /onlyfinder/i, /juicy\s*(ads|traffic)/i, /juicyads/i, /vaultfinder/i,
        /creatortraffic/i, /creator traffic/i, /onlysearch/i, /porndude/i,
        /pornpics/i, /juicysearch/i, /inflow/i, /oneup/i, /one up/i,
    ],

    REDDIT_PATTERNS: [/\breddit\b/i, /\breddit\s+preggo\b/i],

    SFS_PATTERNS: [
        /^sfs\b/i, /\bsfs\b/i, /\bcrosspromo\b/i, /\bswap\b/i,
        /\bshout\s*out\b/i, /\bcollab\b/i, /\bGG\b/, /\b\d+\s*gg\b/i,
    ],

    SENTINEL_VA_IDS: { unknown: -1, ads: -2, sfs: -3, reddit: -4 },

    matchVA(label) {
        for (const { va, regex } of this.VA_LABEL_PATTERNS) {
            if (regex.test(label)) return va;
        }
        return null;
    },

    classifySource(label) {
        if (this.matchVA(label)) return 'va';
        for (const re of this.REDDIT_PATTERNS) { if (re.test(label)) return 'reddit'; }
        for (const re of this.ADS_PATTERNS) { if (re.test(label)) return 'ads'; }
        for (const re of this.SFS_PATTERNS) { if (re.test(label)) return 'sfs'; }
        return 'unknown';
    },

    detectPlatform(label, source) {
        const l = label.toLowerCase();
        const s = (source || '').toLowerCase();
        if (s === 'reddit' || l.includes('reddit')) return 'reddit';
        if (s === 'instagram' || l.includes('insta') || l.includes('ig ') || l.startsWith('ig') || l.includes('m/s')) return 'instagram';
        if (l.includes('thread')) return 'threads';
        if (s === 'twitter' || l.includes('twitter') || l.includes('x mass') || l.includes('xbot') || l.includes('cupid x')) return 'twitter';
        if (s.includes('tinder') || l.includes('tinder')) return 'tinder';
        if (s === 'onlyfinder' || l.includes('onlyfinder') || l.includes('juicy')) return 'ads';
        if (l.includes('erome')) return 'erome';
        if (l.includes('tiktok') || s === 'tiktok') return 'tiktok';
        if (l.includes('fetlife')) return 'fetlife';
        if (l.includes('telegram')) return 'telegram';
        if (l.includes('sfs') || s === 'sfs') return 'sfs';
        if (l.includes('youtube') || s === 'youtube') return 'youtube';
        if (l.includes('snap')) return 'snapchat';
        if (s.includes('dating') || l.includes('bumble') || l.includes('okcupid') || l.includes('ok cupid')) return 'dating';
        return null;
    },

    extractModelName(sheetName) {
        const match = sheetName.match(/^(.+?)\s*\(/);
        return match ? match[1].trim().replace(/[^\w\s'-]/g, '').trim() : sheetName.trim();
    },

    normalizePlatformLabel(label, category) {
        const l = label.toLowerCase().trim();
        if (category === 'ads') {
            if (l.includes('juicy')) return 'Juicy Ads';
            if (l.includes('onlyfinder')) return 'OnlyFinder';
            if (l.includes('vaultfinder')) return 'VaultFinder';
            if (l.includes('creatortraffic') || l.includes('creator traffic')) return 'Creator Traffic';
            if (l.includes('onlysearch')) return 'OnlySearch';
            if (l.includes('porndude')) return 'PornDude';
            if (l.includes('pornpics')) return 'PornPics';
            if (l.includes('juicysearch')) return 'JuicySearch';
            if (l.includes('inflow')) return 'Inflow';
            if (l.includes('oneup') || l.includes('one up')) return 'OneUp';
            return label.trim();
        }
        if (category === 'sfs') {
            const ggMatch = label.match(/^(.+?)\s+\d+\s*gg/i);
            if (ggMatch) return ggMatch[1].trim();
            return label.trim();
        }
        return label.trim();
    },

    computeCompensation(subs) {
        if (subs >= 2000) return 20;
        if (subs >= 1200) return 15;
        if (subs >= 600) return 10;
        return 0;
    }
};

// ─── OF Tracker: XLSX Import Service ──────────────────────────────────────────

export const OFImportService = {
    parseAmount(val) {
        if (val === null || val === undefined || val === '') return 0;
        const str = String(val).replace(/[$,]/g, '');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    },

    async processXLSX(arrayBuffer, filename) {
        const XLSX = (await import('xlsx')).default || await import('xlsx');
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        const importDate = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const errors = [];

        if (wb.SheetNames.length === 0) {
            return {
                importId: 0, importDate, sheetCount: 0, totalLinks: 0,
                totalNewSubs: 0, totalCumulativeSubs: 0, totalEarningsDelta: 0, totalCumulativeEarnings: 0,
                sourceBreakdown: [], models: [], unmappedLabels: [], errors: ['No sheets found in XLSX file'],
            };
        }

        const importId = generateId();
        await db.ofBulkImports.add({
            id: importId, filename, importDate, sheetCount: wb.SheetNames.length,
            totalLinks: 0, totalNewSubs: 0, totalEarningsDelta: 0, createdAt: new Date().toISOString()
        });

        // Check if this is the very first import
        const allImports = await db.ofBulkImports.toArray();
        const isFirstEverImport = allImports.length <= 1;

        const modelResults = [];
        const unmappedLabels = [];
        let totalLinks = 0, totalNewSubs = 0, totalEarningsDelta = 0;
        const globalSourceStats = new Map();

        for (const sheetName of wb.SheetNames) {
            const modelName = OFVAPatternService.extractModelName(sheetName);
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (rows.length === 0) {
                errors.push(`Sheet "${sheetName}" has no data rows`);
                continue;
            }

            // Find or create model
            let model = (await db.ofModels.where('name').equalsIgnoreCase(modelName).first());
            if (!model) {
                const modelId = generateId();
                model = { id: modelId, name: modelName, ofUsername: '', active: 1 };
                await db.ofModels.add(model);
            }
            const modelId = model.id;

            let sheetLinks = 0;
            const vaSubsMap = new Map();
            const catStatsMap = new Map();
            let modelSubs = 0, modelCumSubs = 0, modelEarnings = 0, modelCumEarnings = 0;

            for (const row of rows) {
                const label = String(row['Tracking link'] || '').trim();
                if (!label) continue;

                const source = String(row['Source'] || '').trim();
                const subsCumulative = this.parseAmount(row['Subs']);
                const earningsCumulative = this.parseAmount(row['Earnings']);
                const clicksCumulative = this.parseAmount(row['Clicks']);
                const fansWhoSpent = this.parseAmount(row['Fans who spent']);
                const profit = this.parseAmount(row['Profit']);
                const lastUpdated = String(row['Last updated'] || '').trim() || null;

                const platform = OFVAPatternService.detectPlatform(label, source);

                // Check if this link was manually assigned in config
                const existingLink = await db.ofTrackingLinks
                    .where('label').equals(label).and(r => r.ofModelId === modelId).first();

                let vaId = null;
                let category;

                if (existingLink && existingLink.ofVaId && existingLink.ofVaId > 0) {
                    // Link was manually assigned to a VA — use that
                    vaId = existingLink.ofVaId;
                    category = 'va';
                } else {
                    // Not assigned — classify source for reporting but don't auto-create anything
                    category = OFVAPatternService.classifySource(label);
                    unmappedLabels.push({ label, model: model.name, category });
                }

                // Insert link snapshot (check for dupe within same import)
                const existingSnap = await db.ofLinkSnapshots
                    .where('importId').equals(importId).and(r => r.ofModelId === modelId && r.label === label).first();
                if (!existingSnap) {
                    const sentinelId = !vaId ? (OFVAPatternService.SENTINEL_VA_IDS[category] ?? -1) : null;
                    await db.ofLinkSnapshots.add({
                        id: generateId(), importId, ofModelId: modelId,
                        ofVaId: vaId || sentinelId, label, source: source || null,
                        platform, sourceCategory: category,
                        subsCumulative, clicksCumulative, earningsCumulative,
                        fansWhoSpent, profit, lastUpdated
                    });
                }

                sheetLinks++;
                totalLinks++;

                // Delta computation — find previous snapshot for this model+label
                const prevSnapshots = await db.ofLinkSnapshots
                    .where('ofModelId').equals(modelId)
                    .and(r => r.label === label && r.importId < importId)
                    .reverse().sortBy('importId');
                const prevSnapshot = prevSnapshots[0] || null;

                let subsDelta, earningsDelta;
                if (prevSnapshot) {
                    subsDelta = Math.max(0, subsCumulative - prevSnapshot.subsCumulative);
                    earningsDelta = Math.max(0, earningsCumulative - prevSnapshot.earningsCumulative);
                } else {
                    subsDelta = isFirstEverImport ? subsCumulative : 0;
                    earningsDelta = isFirstEverImport ? earningsCumulative : 0;
                }

                // Global source stats
                const gs = globalSourceStats.get(category) || { subs: 0, cumSubs: 0, earnings: 0, cumEarnings: 0, links: 0 };
                gs.subs += subsDelta; gs.cumSubs += subsCumulative;
                gs.earnings += earningsDelta; gs.cumEarnings += earningsCumulative; gs.links++;
                globalSourceStats.set(category, gs);

                // Model totals
                modelSubs += subsDelta; modelCumSubs += subsCumulative;
                modelEarnings += earningsDelta; modelCumEarnings += earningsCumulative;
                totalNewSubs += subsDelta; totalEarningsDelta += earningsDelta;

                // VA breakdown (only for manually assigned links)
                if (category === 'va' && vaId) {
                    const va = await db.ofVas.get(vaId);
                    const vaLabel = va?.name || 'Unknown VA';
                    const existing = vaSubsMap.get(vaLabel) || { subs: 0, cumSubs: 0, earnings: 0, cumEarnings: 0, vaId };
                    existing.subs += subsDelta; existing.cumSubs += subsCumulative;
                    existing.earnings += earningsDelta; existing.cumEarnings += earningsCumulative;
                    vaSubsMap.set(vaLabel, existing);
                }

                // Non-VA category totals
                if (category !== 'va') {
                    const cs = catStatsMap.get(category) || { subs: 0, earnings: 0 };
                    cs.subs += subsDelta; cs.earnings += earningsDelta;
                    catStatsMap.set(category, cs);
                }
            }

            const vaBreakdown = Array.from(vaSubsMap.entries())
                .map(([va, s]) => ({ va, subs: s.subs, cumulativeSubs: s.cumSubs, earnings: s.earnings, cumulativeEarnings: s.cumEarnings }))
                .sort((a, b) => b.subs - a.subs);

            modelResults.push({
                name: model.name, links: sheetLinks, newSubs: modelSubs,
                cumulativeSubs: modelCumSubs, earnings: modelEarnings,
                cumulativeEarnings: modelCumEarnings, vaBreakdown,
            });

            // Upsert daily stats — VA-attributed
            for (const [vaName, stats] of vaSubsMap) {
                if (stats.subs === 0 && stats.earnings === 0) continue;
                const existingStat = await db.ofDailyStats
                    .where('statDate').equals(importDate)
                    .and(r => r.ofModelId === modelId && r.ofVaId === stats.vaId).first();
                if (existingStat) {
                    await db.ofDailyStats.update(existingStat.id, { newSubs: stats.subs, revenueTotal: stats.earnings });
                } else {
                    await db.ofDailyStats.add({
                        id: generateId(), statDate: importDate, ofModelId: modelId,
                        ofVaId: stats.vaId, newSubs: stats.subs, totalSubs: stats.subs, revenueTotal: stats.earnings
                    });
                }
            }

            // Upsert daily stats — non-VA categories (sentinel IDs)
            for (const [cat, stats] of catStatsMap) {
                if (stats.subs === 0 && stats.earnings === 0) continue;
                const sentinelId = OFVAPatternService.SENTINEL_VA_IDS[cat] ?? -1;
                const existingStat = await db.ofDailyStats
                    .where('statDate').equals(importDate)
                    .and(r => r.ofModelId === modelId && r.ofVaId === sentinelId).first();
                if (existingStat) {
                    await db.ofDailyStats.update(existingStat.id, { newSubs: stats.subs, revenueTotal: stats.earnings });
                } else {
                    await db.ofDailyStats.add({
                        id: generateId(), statDate: importDate, ofModelId: modelId,
                        ofVaId: sentinelId, newSubs: stats.subs, totalSubs: stats.subs, revenueTotal: stats.earnings
                    });
                }
            }
        }

        // Update import totals
        await db.ofBulkImports.update(importId, { totalLinks, totalNewSubs, totalEarningsDelta });

        // Deduplicate unmapped
        const seenUnmapped = new Set();
        const dedupedUnmapped = unmappedLabels.filter(u => {
            const key = `${u.model}||${u.label}`;
            if (seenUnmapped.has(key)) return false;
            seenUnmapped.add(key);
            return true;
        });

        const totalCumulativeSubs = modelResults.reduce((s, m) => s + m.cumulativeSubs, 0);
        const totalCumulativeEarnings = modelResults.reduce((s, m) => s + m.cumulativeEarnings, 0);

        // Build source breakdown
        const sourceBreakdown = [];
        for (const [cat, stats] of globalSourceStats) {
            sourceBreakdown.push({
                category: cat, subs: stats.subs, cumulativeSubs: stats.cumSubs,
                earnings: stats.earnings, cumulativeEarnings: stats.cumEarnings, linkCount: stats.links,
            });
        }
        sourceBreakdown.sort((a, b) => b.cumulativeSubs - a.cumulativeSubs);

        return {
            importId, importDate, sheetCount: wb.SheetNames.length, totalLinks,
            totalNewSubs, totalCumulativeSubs, totalEarningsDelta, totalCumulativeEarnings,
            sourceBreakdown, models: modelResults, unmappedLabels: dedupedUnmapped, errors,
        };
    },

    async getImportHistory() {
        return (await db.ofBulkImports.orderBy('importDate').reverse().toArray());
    }
};

// ─── OF Tracker: Report & Stats Service ───────────────────────────────────────

export const OFReportService = {
    async getSummary() {
        const totalModels = await db.ofModels.where('active').equals(1).count();
        const totalVAs = await db.ofVas.where('active').equals(1).count();

        // Latest import for cumulative totals
        const latestImport = await db.ofBulkImports.orderBy('id').reverse().first();
        let totalSubs = 0, totalRevenue = 0;

        if (latestImport) {
            const snaps = await db.ofLinkSnapshots.where('importId').equals(latestImport.id).toArray();
            for (const s of snaps) {
                totalSubs += s.subsCumulative || 0;
                totalRevenue += s.earningsCumulative || 0;
            }
        }

        // Today's new subs
        const today = new Date().toISOString().split('T')[0];
        const todayStats = await db.ofDailyStats.where('statDate').equals(today).toArray();
        const todayNewSubs = todayStats.reduce((sum, s) => sum + (s.newSubs || 0), 0);
        const todayEarnings = todayStats.reduce((sum, s) => sum + (s.revenueTotal || 0), 0);

        return { totalModels, totalVAs, totalSubs, totalRevenue, todayNewSubs, todayEarnings };
    },

    async getTrends(days = 30, modelId, vaId) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        let allStats = await db.ofDailyStats.toArray();
        allStats = allStats.filter(s => s.statDate >= cutoffStr);
        if (modelId) allStats = allStats.filter(s => s.ofModelId === modelId);
        if (vaId) allStats = allStats.filter(s => s.ofVaId === vaId);

        // Group by date
        const byDate = new Map();
        for (const s of allStats) {
            const d = byDate.get(s.statDate) || { date: s.statDate, newSubs: 0, revenue: 0 };
            d.newSubs += s.newSubs || 0;
            d.revenue += s.revenueTotal || 0;
            byDate.set(s.statDate, d);
        }
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    },

    async buildReport(periodLabel, start, end, prevStart, prevEnd) {
        const allStats = await db.ofDailyStats.toArray();
        const periodStats = allStats.filter(s => s.statDate >= start && s.statDate <= end);
        const prevStats = allStats.filter(s => s.statDate >= prevStart && s.statDate <= prevEnd);

        const allModels = await db.ofModels.toArray();
        const allVAs = await db.ofVas.toArray();
        const modelMap = new Map(allModels.map(m => [m.id, m]));
        const vaMap = new Map(allVAs.map(v => [v.id, v]));

        const catNames = { [-1]: 'Unknown', [-2]: 'Paid Ads', [-3]: 'SFS', [-4]: 'Reddit' };

        // Model ranking
        const modelAgg = new Map();
        for (const s of periodStats) {
            const agg = modelAgg.get(s.ofModelId) || { subs: 0, earnings: 0 };
            agg.subs += s.newSubs || 0; agg.earnings += s.revenueTotal || 0;
            modelAgg.set(s.ofModelId, agg);
        }
        const modelRanking = Array.from(modelAgg.entries())
            .map(([id, a]) => ({ model: modelMap.get(id)?.name || 'Unknown', subs: a.subs, earnings: a.earnings }))
            .sort((a, b) => b.subs - a.subs);

        // VA ranking (include all active VAs)
        const vaAgg = new Map();
        for (const s of periodStats) {
            if (s.ofVaId <= 0) continue; // skip sentinel
            const agg = vaAgg.get(s.ofVaId) || { subs: 0, earnings: 0, models: new Set() };
            agg.subs += s.newSubs || 0; agg.earnings += s.revenueTotal || 0;
            agg.models.add(s.ofModelId);
            vaAgg.set(s.ofVaId, agg);
        }
        const activeVAs = allVAs.filter(v => v.active === 1 || v.active === true);
        const vaRanking = activeVAs.map(v => {
            const stats = vaAgg.get(v.id);
            return { va: v.name, subs: stats?.subs ?? 0, earnings: stats?.earnings ?? 0, modelCount: stats?.models?.size ?? 0 };
        }).sort((a, b) => b.subs - a.subs);

        // Compensation
        const compensation = vaRanking.map(v => ({
            va: v.va, subs: v.subs, amount: OFVAPatternService.computeCompensation(v.subs),
        }));

        // Totals
        const totalSubs = modelRanking.reduce((s, r) => s + r.subs, 0);
        const totalEarnings = modelRanking.reduce((s, r) => s + r.earnings, 0);
        const previousSubs = prevStats.reduce((s, r) => s + (r.newSubs || 0), 0);
        const producingVAs = vaRanking.filter(v => v.subs > 0).length;

        // VA by model breakdown (VA + non-VA categories)
        const vaByModelMap = new Map();
        for (const s of periodStats) {
            const mName = modelMap.get(s.ofModelId)?.name || 'Unknown';
            let entry = vaByModelMap.get(mName);
            if (!entry) { entry = { model: mName, totalSubs: 0, totalEarnings: 0, vas: [] }; vaByModelMap.set(mName, entry); }
            const vaLabel = s.ofVaId > 0 ? (vaMap.get(s.ofVaId)?.name || 'Unknown VA') : (catNames[s.ofVaId] || 'Other');
            entry.vas.push({ va: vaLabel, subs: s.newSubs || 0, earnings: s.revenueTotal || 0 });
            entry.totalSubs += s.newSubs || 0;
            entry.totalEarnings += s.revenueTotal || 0;
        }
        // Merge duplicate VA entries within each model
        for (const entry of vaByModelMap.values()) {
            const merged = new Map();
            for (const v of entry.vas) {
                const e = merged.get(v.va) || { va: v.va, subs: 0, earnings: 0 };
                e.subs += v.subs; e.earnings += v.earnings;
                merged.set(v.va, e);
            }
            entry.vas = Array.from(merged.values()).sort((a, b) => b.subs - a.subs);
        }
        const vaByModel = Array.from(vaByModelMap.values()).sort((a, b) => b.totalSubs - a.totalSubs);

        // Ad & SFS platform breakdown (period-aware import lookup)
        const allImports = await db.ofBulkImports.orderBy('importDate').reverse().toArray();
        const currentImport = allImports.find(i => i.importDate <= end);
        const prevImport = allImports.find(i => i.importDate < start);
        const buildSourceBreakdown = async (category) => {
            if (!currentImport) return [];
            const currSnaps = (await db.ofLinkSnapshots.where('importId').equals(currentImport.id).toArray())
                .filter(s => s.sourceCategory === category);

            const map = new Map();
            for (const curr of currSnaps) {
                const key = OFVAPatternService.normalizePlatformLabel(curr.label, category);
                let subsDelta = curr.subsCumulative;
                let earningsDelta = curr.earningsCumulative || 0;
                if (prevImport) {
                    const prev = await db.ofLinkSnapshots
                        .where('importId').equals(prevImport.id)
                        .and(r => r.ofModelId === curr.ofModelId && r.label === curr.label).first();
                    subsDelta = prev ? Math.max(0, curr.subsCumulative - prev.subsCumulative) : 0;
                    earningsDelta = prev ? Math.max(0, (curr.earningsCumulative || 0) - (prev.earningsCumulative || 0)) : 0;
                }
                const e = map.get(key) || { subs: 0, earnings: 0 };
                e.subs += subsDelta;
                e.earnings += earningsDelta;
                map.set(key, e);
            }
            return Array.from(map.entries())
                .map(([platform, s]) => ({ platform, ...s }))
                .filter(p => p.subs > 0)
                .sort((a, b) => b.subs - a.subs);
        };

        const adPlatforms = await buildSourceBreakdown('ads');
        const sfsSources = await buildSourceBreakdown('sfs');

        // Needs attention: median-based on models (not VAs)
        const modelSubsArr = modelRanking.filter(m => m.subs > 0).map(m => m.subs).sort((a, b) => a - b);
        const median = modelSubsArr.length >= 3 ? modelSubsArr[Math.floor(modelSubsArr.length / 2)] : 0;
        const threshold = Math.max(Math.floor(median * 0.3), 1);
        const needsAttention = median > 0
            ? modelRanking.filter(m => m.subs > 0 && m.subs < threshold && m.subs < median)
                .map(m => ({ model: m.model, subs: m.subs }))
            : [];

        return {
            period: { start, end, label: periodLabel },
            modelRanking, vaRanking, vaByModel, adPlatforms, sfsSources,
            compensation, needsAttention,
            comparison: { current: totalSubs, previous: previousSubs, delta: totalSubs - previousSubs },
            totalSubs, totalEarnings, activeVAs: activeVAs.length, producingVAs,
        };
    },

    async getDailyReport(date) {
        const d = new Date(date + 'T00:00:00');
        const prev = new Date(d); prev.setDate(prev.getDate() - 1);
        return this.buildReport(`Daily - ${date}`, date, date, prev.toISOString().split('T')[0], prev.toISOString().split('T')[0]);
    },

    async getWeeklyReport(date) {
        const d = new Date(date + 'T00:00:00');
        const day = d.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        const monday = new Date(d); monday.setDate(d.getDate() + diffToMonday);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        const start = monday.toISOString().split('T')[0];
        const end = sunday.toISOString().split('T')[0];
        const prevMonday = new Date(monday); prevMonday.setDate(monday.getDate() - 7);
        const prevSunday = new Date(prevMonday); prevSunday.setDate(prevMonday.getDate() + 6);
        return this.buildReport(`Week of ${start}`, start, end, prevMonday.toISOString().split('T')[0], prevSunday.toISOString().split('T')[0]);
    },

    async getMonthlyReport(year, month) {
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
        const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
        const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;
        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return this.buildReport(`${monthNames[month]} ${year}`, start, end, prevStart, prevEnd);
    },

    async getModelStats() {
        const latestImport = await db.ofBulkImports.orderBy('id').reverse().first();
        if (!latestImport) return [];
        const snaps = await db.ofLinkSnapshots.where('importId').equals(latestImport.id).toArray();
        const allModels = await db.ofModels.where('active').equals(1).toArray();
        const allVAs = await db.ofVas.toArray();
        const vaMap = new Map(allVAs.map(v => [v.id, v.name]));

        const modelAgg = new Map();
        for (const s of snaps) {
            const agg = modelAgg.get(s.ofModelId) || { subs: 0, earnings: 0, vaMap: new Map() };
            agg.subs += s.subsCumulative || 0;
            agg.earnings += s.earningsCumulative || 0;
            if (s.ofVaId > 0) {
                const vSubs = (agg.vaMap.get(s.ofVaId) || 0) + (s.subsCumulative || 0);
                agg.vaMap.set(s.ofVaId, vSubs);
            }
            modelAgg.set(s.ofModelId, agg);
        }

        return allModels.map(m => {
            const agg = modelAgg.get(m.id);
            let topVA = null;
            if (agg?.vaMap?.size > 0) {
                const topEntry = [...agg.vaMap.entries()].sort((a, b) => b[1] - a[1])[0];
                topVA = vaMap.get(topEntry[0]) || null;
            }
            return {
                modelId: m.id, modelName: m.name, ofUsername: m.ofUsername,
                subCount: agg?.subs ?? 0, revenue: agg?.earnings ?? 0, topVA
            };
        }).sort((a, b) => b.subCount - a.subCount);
    },

    async getVAStats(period, modelId) {
        const today = new Date().toISOString().split('T')[0];
        let startDate;
        switch (period) {
            case 'today': startDate = today; break;
            case 'week': { const d = new Date(); d.setDate(d.getDate() - 7); startDate = d.toISOString().split('T')[0]; break; }
            case 'month': { const d = new Date(); d.setDate(d.getDate() - 30); startDate = d.toISOString().split('T')[0]; break; }
            default: startDate = '1970-01-01';
        }

        let stats = await db.ofDailyStats.toArray();
        stats = stats.filter(s => s.statDate >= startDate && s.statDate <= today && s.ofVaId > 0);
        if (modelId) stats = stats.filter(s => s.ofModelId === modelId);

        const vaAgg = new Map();
        for (const s of stats) {
            const agg = vaAgg.get(s.ofVaId) || { subs: 0, earnings: 0 };
            agg.subs += s.newSubs || 0; agg.earnings += s.revenueTotal || 0;
            vaAgg.set(s.ofVaId, agg);
        }

        const allVAs = await db.ofVas.where('active').equals(1).toArray();
        return allVAs.map(v => {
            const a = vaAgg.get(v.id);
            return { vaId: v.id, vaName: v.name, subs: a?.subs ?? 0, earnings: a?.earnings ?? 0 };
        }).sort((a, b) => b.subs - a.subs);
    },

    async getDailyStatsForDate(date) {
        const stats = await db.ofDailyStats.where('statDate').equals(date).toArray();
        const allModels = await db.ofModels.toArray();
        const allVAs = await db.ofVas.toArray();
        const modelMap = new Map(allModels.map(m => [m.id, m.name]));
        const vaMap = new Map(allVAs.map(v => [v.id, v.name]));
        const catNames = { [-1]: 'Unknown', [-2]: 'Paid Ads', [-3]: 'SFS', [-4]: 'Reddit' };

        return stats.map(s => ({
            modelName: modelMap.get(s.ofModelId) || 'Unknown',
            vaName: s.ofVaId > 0 ? (vaMap.get(s.ofVaId) || 'Unknown') : (catNames[s.ofVaId] || 'Unmapped'),
            newSubs: s.newSubs, totalSubs: s.totalSubs, revenueTotal: s.revenueTotal,
        })).sort((a, b) => b.newSubs - a.newSubs);
    },

    // Copy-friendly plaintext report (OF Tracker)
    async buildPlaintextReport(report) {
        const lines = [];
        lines.push(`=== ${report.period.label} ===`);
        lines.push(`Total Subs: ${report.totalSubs} | vs Previous: ${report.comparison.delta >= 0 ? '+' : ''}${report.comparison.delta}`);
        lines.push(`Active VAs: ${report.activeVAs} | Producing: ${report.producingVAs}`);
        lines.push('');

        // Model subscribers with status tags
        if (report.modelRanking.length > 0) {
            const modelSubsArr = report.modelRanking.filter(m => m.subs > 0).map(m => m.subs).sort((a, b) => a - b);
            const median = modelSubsArr.length >= 3 ? modelSubsArr[Math.floor(modelSubsArr.length / 2)] : 0;
            const topThreshold = modelSubsArr.length > 0 ? modelSubsArr[modelSubsArr.length - 1] * 0.7 : 0;
            lines.push('MODEL SUBSCRIBERS');
            for (const m of report.modelRanking) {
                let tag = '';
                if (m.subs === 0) tag = ' [ZERO]';
                else if (median > 0 && m.subs < Math.max(Math.floor(median * 0.3), 1)) tag = ' [LOW]';
                else if (m.subs >= topThreshold && topThreshold > 0) tag = ' [TOP]';
                lines.push(`  ${m.model}: ${m.subs}${tag}`);
            }
            lines.push('');
        }

        // Needs Attention
        if (report.needsAttention?.length > 0) {
            lines.push('NEEDS ATTENTION');
            for (const m of report.needsAttention) lines.push(`  ${m.model}: ${m.subs} subs (below median threshold)`);
            lines.push('');
        }

        // VA performance with status tags
        if (report.vaRanking.length > 0) {
            const topVASubs = report.vaRanking[0]?.subs || 1;
            lines.push('VA PERFORMANCE');
            for (const v of report.vaRanking) {
                let tag = '';
                if (v.subs === 0) tag = ' [ZERO]';
                else if (v.subs >= topVASubs * 0.7) tag = ' [TOP]';
                lines.push(`  ${v.va}: ${v.subs} subs (${v.modelCount} models)${tag}`);
            }
            lines.push('');
        }

        // Subs by Model (nested VA + category per model)
        if (report.vaByModel?.length > 0) {
            lines.push('SUBS BY MODEL');
            for (const m of report.vaByModel) {
                lines.push(`  ${m.model}: ${m.totalSubs} subs`);
                for (const v of m.vas) {
                    lines.push(`    ${v.va}: ${v.subs}`);
                }
            }
            lines.push('');
        }

        // Ad Platforms
        if (report.adPlatforms?.length > 0) {
            lines.push('AD PLATFORMS');
            for (const p of report.adPlatforms) lines.push(`  ${p.platform}: ${p.subs} subs`);
            lines.push('');
        }

        // SFS Sources
        if (report.sfsSources?.length > 0) {
            lines.push('SFS SOURCES');
            for (const s of report.sfsSources) lines.push(`  ${s.platform}: ${s.subs} subs`);
            lines.push('');
        }

        // Compensation
        if (report.compensation.length > 0) {
            lines.push('COMPENSATION');
            for (const c of report.compensation) lines.push(`  ${c.va}: ${c.subs} subs → $${c.amount}`);
            lines.push('');
        }

        // Period Comparison
        lines.push('COMPARISON');
        lines.push(`  Current: ${report.comparison.current}`);
        lines.push(`  Previous: ${report.comparison.previous}`);
        lines.push(`  Delta: ${report.comparison.delta >= 0 ? '+' : ''}${report.comparison.delta}`);

        return lines.join('\n');
    }
};

// ──────────────────────────────────────────────────────────────────────────────
// AI CHAT REPORT DASHBOARD — Import, Grading, and Report Services
// ──────────────────────────────────────────────────────────────────────────────

export const AIChatImportService = {
    // Parse "Mon DD, YYYY" + "HH:MM:SS" → ISO string
    parseInflowTimestamp(dateStr, timeStr) {
        if (!dateStr) return null;
        try {
            // dateStr: "Mar 5, 2026" or "Mar 05, 2026"
            const d = new Date(`${dateStr} ${timeStr || '00:00:00'}`);
            return isNaN(d.getTime()) ? null : d.toISOString();
        } catch { return null; }
    },

    // Parse "Replay time" column → seconds (handles "Xm Ys", "Xh Ym Zs", empty, "--")
    parseReplyTime(replayStr) {
        if (!replayStr || replayStr === '--' || replayStr === '0') return null;
        const s = String(replayStr).trim();
        // "0m 26s" → 26, "2m 23s" → 143, "1h 2m 3s" → 3723
        let total = 0;
        const hMatch = s.match(/(\d+)\s*h/);
        const mMatch = s.match(/(\d+)\s*m/);
        const sMatch = s.match(/(\d+)\s*s/);
        if (hMatch) total += parseInt(hMatch[1]) * 3600;
        if (mMatch) total += parseInt(mMatch[1]) * 60;
        if (sMatch) total += parseInt(sMatch[1]);
        return total > 0 ? total : null;
    },

    // "Keith B (u548162492)" → "u548162492"
    extractFanId(sentToStr) {
        if (!sentToStr) return null;
        const m = String(sentToStr).match(/\(([^)]+)\)\s*$/);
        return m ? m[1] : String(sentToStr).trim();
    },

    // "Keith B (u548162492)" → "Keith B"
    extractFanName(sentToStr) {
        if (!sentToStr) return '';
        const m = String(sentToStr).match(/^(.+?)\s*\(/);
        return m ? m[1].trim() : String(sentToStr).trim();
    },

    // Strip HTML tags, decode basic entities
    stripHtml(html) {
        if (!html) return '';
        return String(html)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .trim();
    },

    // ── Streaming CSV parser ──────────────────────────────────────────────────
    // Finds the last newline that is NOT inside a quoted field.
    // Returns -1 if no safe split point found (need more data).
    _findLastSafeNewline(text) {
        let inQuote = false;
        let lastSafe = -1;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '"') inQuote = !inQuote;
            if (!inQuote && text[i] === '\n') lastSafe = i;
        }
        return lastSafe;
    },

    // Parse a chunk of CSV text into array-of-arrays. Assumes all rows are complete.
    _parseCSVChunk(text) {
        const rows = [];
        let i = 0;
        const len = text.length;
        while (i < len) {
            const row = [];
            while (i < len) {
                if (text[i] === '"') {
                    i++;
                    let val = '';
                    while (i < len) {
                        if (text[i] === '"') {
                            if (i + 1 < len && text[i + 1] === '"') { val += '"'; i += 2; }
                            else { i++; break; }
                        } else { val += text[i]; i++; }
                    }
                    row.push(val);
                    if (i < len && text[i] === ',') i++;
                    else if (i < len && (text[i] === '\n' || text[i] === '\r')) { if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++; i++; break; }
                } else {
                    let end = i;
                    while (end < len && text[end] !== ',' && text[end] !== '\n' && text[end] !== '\r') end++;
                    row.push(text.substring(i, end));
                    i = end;
                    if (i < len && text[i] === ',') i++;
                    else if (i < len && (text[i] === '\n' || text[i] === '\r')) { if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++; i++; break; }
                    else { i++; break; }
                }
            }
            if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
        }
        return rows;
    },

    // ── Main processFile — accepts File object for CSV streaming ────────────
    async processFile(fileOrBuffer, filename, onProgress) {
        const isCSV = filename.toLowerCase().endsWith('.csv');
        const isFile = fileOrBuffer instanceof File || (fileOrBuffer?.stream && fileOrBuffer?.size);

        if (!isCSV) {
            // Excel: load into memory (xlsx files are typically much smaller)
            const arrayBuffer = isFile ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
            return this._processExcelFile(arrayBuffer, filename, onProgress);
        }

        // CSV: stream it — never load full file into memory
        return this._processCSVStream(isFile ? fileOrBuffer : new Blob([fileOrBuffer]), filename, onProgress);
    },

    async _processExcelFile(arrayBuffer, filename, onProgress) {
        const fileSize = arrayBuffer.byteLength;
        onProgress?.({ phase: 'parsing', current: 0, total: 0, label: `Reading Excel file (${(fileSize / 1024 / 1024).toFixed(0)}MB)...` });
        const XLSX = (await import('xlsx')).default || await import('xlsx');

        // Read with minimal parsing to reduce memory (no formulas, HTML, styles)
        const wb = XLSX.read(new Uint8Array(arrayBuffer), {
            type: 'array', cellFormula: false, cellHTML: false, cellStyles: false
        });
        // Free ArrayBuffer immediately
        arrayBuffer = null;

        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error('No sheets found in file');
        const ws = wb.Sheets[sheetName];
        const ref = ws['!ref'];
        if (!ref) throw new Error('Empty sheet');
        const range = XLSX.utils.decode_range(ref);
        const totalRows = range.e.r - range.s.r; // exclude header
        if (totalRows < 1) throw new Error('No data rows found');

        onProgress?.({ phase: 'parsing', current: 0, total: totalRows, label: `Found ${totalRows.toLocaleString()} rows, converting...` });

        // Convert entire sheet to CSV string — MUCH smaller than sheet_to_json objects
        // For 500K rows: sheet_to_json = 500K JS objects (~500MB) vs CSV string (~100-150MB)
        let csvText = XLSX.utils.sheet_to_csv(ws, { blankrows: false });

        // Free the entire workbook — the biggest memory consumer
        const sheetNames = wb.SheetNames;
        for (const sn of sheetNames) delete wb.Sheets[sn];
        wb.Sheets = null;
        wb.SheetNames = null;

        onProgress?.({ phase: 'parsing', current: 0, total: totalRows, label: 'Preparing stream...' });

        // Create a Blob from the CSV text so we can stream it through our CSV parser
        const csvBlob = new Blob([csvText], { type: 'text/csv' });
        // Free the CSV string — Blob holds its own copy
        csvText = null;

        // Delegate to our memory-efficient streaming CSV parser
        return this._processCSVStream(csvBlob, filename, onProgress);
    },

    async _processCSVStream(fileBlob, filename, onProgress) {
        const fileSize = fileBlob.size;
        onProgress?.({ phase: 'parsing', current: 0, total: fileSize, label: `Reading CSV (${(fileSize / 1024 / 1024).toFixed(0)}MB)...` });

        const stream = fileBlob.stream().pipeThrough(new TextDecoderStream('utf-8'));
        const reader = stream.getReader();

        // Phase 1: Stream CSV, parse rows, write messages straight to Dexie
        // Only keep lightweight per-conversation stats in memory (no message content)
        let buffer = '';
        let headerRow = null;
        let colIdx = {};
        let bytesRead = 0;
        let rowCount = 0;

        // Lightweight stats per conversation (NO message content stored in memory)
        const convStats = new Map(); // convKey → stats object
        const uniqueChatters = new Set();
        const uniqueModels = new Set();
        let firstRowDate = null;
        let totalMsgCount = 0;

        // Message batch for Dexie — flush every 2000 records
        const MSG_BATCH = [];
        const MSG_FLUSH = 2000;

        // Pre-generate convIds so messages go straight to Dexie with correct conversationId
        const convIdMap = new Map(); // convKey → convId

        // These will be set after header is parsed
        let senderIdx, creatorIdx, fanMsgIdx, chatterMsgIdx, sentToIdx, sentDateIdx, sentTimeIdx, replayTimeIdx, priceIdx, purchasedIdx, sourceIdx;

        const dateMatch = filename.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
        let importDate = dateMatch ? dateMatch[1].replace(/_/g, '-') : null;

        const importId = generateId();
        await db.aiChatImports.add({
            id: importId, importDate: importDate || new Date().toISOString().split('T')[0], filename,
            totalMessages: 0, totalConversations: 0, totalChatters: 0, totalModels: 0,
            totalRevenue: 0, status: 'processing', createdAt: new Date().toISOString()
        });

        // We need chatter/model maps but we don't know names upfront when streaming.
        // Lazily upsert as we encounter new names.
        const chatterMap = new Map(); // name → id
        const modelMap = new Map();   // name → id

        const ensureChatter = async (name) => {
            if (!name || chatterMap.has(name)) return chatterMap.get(name) || null;
            let existing = await db.aiChatters.where('name').equals(name).first();
            if (!existing) {
                const id = generateId();
                await db.aiChatters.add({ id, name, firstSeen: importDate || '', lastSeen: importDate || '' });
                existing = { id };
            } else {
                await db.aiChatters.update(existing.id, { lastSeen: importDate || '' });
            }
            chatterMap.set(name, existing.id);
            uniqueChatters.add(name);
            return existing.id;
        };

        const ensureModel = async (name) => {
            if (!name || modelMap.has(name)) return modelMap.get(name) || null;
            let existing = await db.aiChatModels.where('name').equals(name).first();
            if (!existing) {
                const id = generateId();
                await db.aiChatModels.add({ id, name });
                existing = { id };
            }
            modelMap.set(name, existing.id);
            uniqueModels.add(name);
            return existing.id;
        };

        const flushMessages = async () => {
            if (MSG_BATCH.length > 0) {
                await db.aiChatMessages.bulkAdd(MSG_BATCH.splice(0));
            }
        };

        const processRow = async (fields) => {
            const chatterName = String(fields[senderIdx] || '').trim();
            const modelName = String(fields[creatorIdx] || '').trim();
            const fanMsg = this.stripHtml(fields[fanMsgIdx]);
            const chatterMsg = this.stripHtml(fields[chatterMsgIdx]);
            const sentTo = String(fields[sentToIdx] || '').trim();
            const fanUserId = this.extractFanId(sentTo);
            const fanName = this.extractFanName(sentTo);
            const timestamp = this.parseInflowTimestamp(fields[sentDateIdx], fields[sentTimeIdx]);
            const replyTimeSec = this.parseReplyTime(fields[replayTimeIdx]);
            const price = parseFloat(String(fields[priceIdx] || '0').replace(/[$,]/g, '')) || 0;
            const purchased = String(fields[purchasedIdx] || '').toLowerCase() === 'yes';
            const source = String(fields[sourceIdx] || 'Employee').trim();

            if (!importDate && timestamp) {
                importDate = timestamp.split('T')[0];
                await db.aiChatImports.update(importId, { importDate });
            }

            if (!modelName || !fanUserId) return;

            const convKey = `${modelName}::${fanUserId}`;

            // Lazy entity upsert (only hits DB once per unique name)
            const chatterId = await ensureChatter(chatterName);
            const modelId = await ensureModel(modelName);

            // Get or create convId for this conversation
            if (!convIdMap.has(convKey)) {
                convIdMap.set(convKey, generateId());
                convStats.set(convKey, {
                    chatterId, modelId, fanUserId, fanName,
                    messageCount: 0, fanMessageCount: 0, chatterMessageCount: 0,
                    firstMessageTime: null, lastMessageTime: null,
                    replyTimeSum: 0, replyTimeCount: 0, replyTimeMax: 0,
                    ppvSent: 0, ppvPurchased: 0, ppvRevenue: 0, ppvPriceSum: 0,
                    chatterCounts: new Map()
                });
            }
            const convId = convIdMap.get(convKey);
            const stats = convStats.get(convKey);

            // Helper to add a message to batch + update stats
            const addMsg = (sender, content, ts, replySec, msgPrice, msgPurchased) => {
                MSG_BATCH.push({
                    id: generateId() + totalMsgCount,
                    conversationId: convId, sender, content, rawHtml: '',
                    timestamp: ts, replyTimeSec: replySec,
                    price: msgPrice, purchased: msgPurchased, source,
                    annotation: null
                });
                stats.messageCount++;
                totalMsgCount++;
                if (sender === 'fan') stats.fanMessageCount++;
                else {
                    stats.chatterMessageCount++;
                    if (chatterId) stats.chatterCounts.set(chatterId, (stats.chatterCounts.get(chatterId) || 0) + 1);
                }
                if (ts) {
                    if (!stats.firstMessageTime || ts < stats.firstMessageTime) stats.firstMessageTime = ts;
                    if (!stats.lastMessageTime || ts > stats.lastMessageTime) stats.lastMessageTime = ts;
                }
                if (replySec != null && replySec > 0) {
                    stats.replyTimeSum += replySec;
                    stats.replyTimeCount++;
                    if (replySec > stats.replyTimeMax) stats.replyTimeMax = replySec;
                }
                if (msgPrice > 0) {
                    stats.ppvSent++;
                    stats.ppvPriceSum += msgPrice;
                    if (msgPurchased) { stats.ppvPurchased++; stats.ppvRevenue += msgPrice; }
                }
            };

            if (fanMsg) addMsg('fan', fanMsg, timestamp, null, 0, false);
            if (chatterMsg) addMsg('chatter', chatterMsg, timestamp, replyTimeSec, price, purchased);

            // Flush message batch to Dexie periodically
            if (MSG_BATCH.length >= MSG_FLUSH) await flushMessages();
        };

        // ── Stream loop ──────────────────────────────────────────────────────
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (value) {
                    buffer += value;
                    bytesRead += value.length;
                }

                // Find safe split point (last newline not inside quotes)
                const splitAt = this._findLastSafeNewline(buffer);

                if (splitAt === -1 && !done) continue; // need more data

                const chunk = done ? buffer : buffer.substring(0, splitAt + 1);
                buffer = done ? '' : buffer.substring(splitAt + 1);

                if (chunk.length === 0 && done) break;

                const rows = this._parseCSVChunk(chunk);

                for (const row of rows) {
                    if (!headerRow) {
                        // First row = headers
                        headerRow = row;
                        const required = ['Sender', 'Creator', 'Creator Message', 'Sent time', 'Sent date', 'Sent to'];
                        const missing = required.filter(c => !headerRow.includes(c));
                        if (missing.length > 0) {
                            await db.aiChatImports.delete(importId);
                            throw new Error(`Missing columns: ${missing.join(', ')}`);
                        }
                        // Build column index
                        for (let c = 0; c < headerRow.length; c++) colIdx[headerRow[c]] = c;
                        senderIdx = colIdx['Sender'];
                        creatorIdx = colIdx['Creator'];
                        fanMsgIdx = colIdx['Fans Message'];
                        chatterMsgIdx = colIdx['Creator Message'];
                        sentToIdx = colIdx['Sent to'];
                        sentDateIdx = colIdx['Sent date'];
                        sentTimeIdx = colIdx['Sent time'];
                        replayTimeIdx = colIdx['Replay time'];
                        priceIdx = colIdx['Price'];
                        purchasedIdx = colIdx['Purchased'];
                        sourceIdx = colIdx['Source'];
                        continue;
                    }

                    await processRow(row);
                    rowCount++;

                    // Update progress every 5000 rows and yield to prevent UI freeze
                    if (rowCount % 5000 === 0) {
                        onProgress?.({
                            phase: 'parsing',
                            current: bytesRead,
                            total: fileSize,
                            label: `Parsed ${rowCount.toLocaleString()} rows (${Math.round(bytesRead / fileSize * 100)}%)...`
                        });
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

                if (done) break;
            }
        } finally {
            reader.releaseLock();
        }

        // Flush any remaining messages
        await flushMessages();

        if (!headerRow) throw new Error('No data found in CSV');
        if (rowCount === 0) throw new Error('No data rows found');

        onProgress?.({ phase: 'storing', current: 0, total: convStats.size, label: 'Creating conversation records...' });

        // Phase 2: Create conversation records from accumulated stats
        let totalRevenue = 0;
        let convIdx = 0;
        const totalConvs = convStats.size;

        for (const [convKey, stats] of convStats) {
            if (convIdx % 200 === 0) {
                onProgress?.({ phase: 'storing', current: convIdx, total: totalConvs, label: `Creating conversation ${convIdx.toLocaleString()} / ${totalConvs.toLocaleString()}...` });
                if (convIdx > 0 && convIdx % 500 === 0) await new Promise(r => setTimeout(r, 0));
            }

            const convId = convIdMap.get(convKey);
            totalRevenue += stats.ppvRevenue;

            // Determine primary chatter
            let primaryChatterId = stats.chatterId;
            let maxCount = 0;
            for (const [cid, count] of stats.chatterCounts) {
                if (count > maxCount) { primaryChatterId = cid; maxCount = count; }
            }

            await db.aiChatConversations.add({
                id: convId, importId, chatterId: primaryChatterId, modelId: stats.modelId,
                fanUserId: stats.fanUserId, fanName: stats.fanName,
                messageCount: stats.messageCount,
                fanMessageCount: stats.fanMessageCount,
                chatterMessageCount: stats.chatterMessageCount,
                firstMessageTime: stats.firstMessageTime,
                lastMessageTime: stats.lastMessageTime,
                avgReplyTimeSec: stats.replyTimeCount > 0 ? Math.round(stats.replyTimeSum / stats.replyTimeCount) : null,
                maxReplyTimeSec: stats.replyTimeMax > 0 ? stats.replyTimeMax : null,
                ppvSent: stats.ppvSent, ppvPurchased: stats.ppvPurchased,
                ppvRevenue: stats.ppvRevenue,
                ppvAvgPrice: stats.ppvSent > 0 ? Math.round(stats.ppvPriceSum / stats.ppvSent) : 0,
                stageClassification: null, graded: 0
            });
            convIdx++;
        }

        if (!importDate) importDate = new Date().toISOString().split('T')[0];

        // Update import record with final stats
        await db.aiChatImports.update(importId, {
            importDate,
            totalMessages: totalMsgCount,
            totalConversations: totalConvs,
            totalChatters: uniqueChatters.size,
            totalModels: uniqueModels.size,
            totalRevenue, status: 'imported'
        });

        onProgress?.({ phase: 'done', current: totalConvs, total: totalConvs, label: 'Import complete!' });

        return {
            importId, importDate,
            totalMessages: totalMsgCount,
            totalConversations: totalConvs,
            totalChatters: uniqueChatters.size,
            totalModels: uniqueModels.size,
            totalRevenue,
            errors: []
        };
    },

    // _processRows removed — Excel files now convert to CSV and use streaming parser

    async getImportHistory() {
        return (await db.aiChatImports.orderBy('importDate').reverse().toArray());
    },

    async deleteImport(importId) {
        // Delete in dependency order
        const convos = await db.aiChatConversations.where('importId').equals(importId).toArray();
        const convIds = convos.map(c => c.id);
        if (convIds.length > 0) {
            for (const cid of convIds) {
                await db.aiChatMessages.where('conversationId').equals(cid).delete();
            }
        }
        await db.aiChatGrades.where('importId').equals(importId).delete();
        await db.aiChatterReports.where('importId').equals(importId).delete();
        await db.aiChatConversations.where('importId').equals(importId).delete();
        await db.aiChatImports.delete(importId);
    }
};

export const AIChatGradingService = {
    // ═══════════════════════════════════════════════════════════
    // AI SYSTEM PROMPT — condensed SOP for quality grading
    // ═══════════════════════════════════════════════════════════
    buildAISystemPrompt() {
        return `You are a senior QA analyst for an OnlyFans chatting agency. Read every message carefully. Grade chatter quality against our SOP. This is workplace analytics — be thorough and specific.

## VOICE RULES (how chatters MUST text)
- Messages: 1-8 words avg, lowercase everything, abbreviations (u, ur, rn, ngl, tbh, fr, wym, idk, wbu, hbu, smth, abt)
- No apostrophes: dont, cant, wasnt, didnt, thats, its
- NO emojis 80% of time. When used: ONLY 😭 😂 💀 🫠 😏. NEVER 💕 🥰 😘 😊 ❤️ 💦 🔥 (fake girl energy)
- No periods at end of messages. Use "..." for suggestive trailing off
- Slightly unbothered but interested energy — NOT desperate, NOT cold
- Mix terms of endearment — don't say "babe" every message

## ABSOLUTE PROHIBITIONS (instant fail)
- Customer service language: "welcome", "nice to meet you", "thanks for subscribing", "I understand", "that's valid"
- Perfect grammar, complete sentences, walls of text (>15 words before sexting)
- Interview questions: "what do you like", "tell me about yourself", "what are your hobbies"
- Suggest meeting IRL or reveal real location
- Emojis like 💕🥰😘😊❤️💦🔥 or boomer :) :D ;)
- Ending conversations: "take care", "bye", "have a good day"
- Introducing yourself with full bio (name+age+city together)

## STAGE PROGRESSION (required order, each stage matters)

1. OPENER — MUST be personalized: use their name + ask where they're from + playful hook about their name/pic. NOT "hey how are you" or "what are you up to". Must feel like a real girl texting, not automated.
   GOOD: "heyyy jake! where r u from? btw my ex was named jake should i be scared 😂"
   BAD: "Hey babe! How are you doing today? 😘"

2. LOCATION_MATCH — ALWAYS pretend you're from the same area or nearby. Use local weather, landmarks, slang. "wait no way i literally just got back from south beach". This is STEP 1 of every conversation.
   GOOD: "omg im like 20 min from there"
   BAD: (skipping location entirely, going straight to questions)

3. HUMANIZE — Tell a relatable funny story about your day with SPECIFIC mundane details. "ok so dont judge me but i tried paddleboarding and fell in like 3 times lmao". Creates connection beyond sex.
   GOOD: "ok so i just burned my pasta while trying to take a selfie lmao"
   BAD: (never sharing anything personal, only asking questions)

4. PROFILE — Get name/location/job/age using 3-STEP method: (1) ask them, (2) react to their answer genuinely, (3) answer it yourself. NEVER rapid-fire interview. ONE question per message.
   GOOD: "what do u do" → "oh thats cool" → "i do nursing but rn im just vibing"
   BAD: "What's your name? Where are you from? How old are you? What do you do?"

5. CONNECTION — Find 2-3 commonalities WITH EVIDENCE (not just "me too"). Create inside jokes, nicknames, callbacks to earlier messages. Friends-with-benefits vibe, NOT girlfriend experience.
   GOOD: "wait u watch that too?? ok we need to binge it together" → later "our show is on tonight 😏"
   BAD: "Oh cool, me too! That's nice!" (generic agreement, no depth)

6. TRANSITION — INVISIBLE 4-step: (1) non-sexual teaser photo "just got home", (2) talk about what they're doing 5-10 msgs, (3) "if you were here" question (still not sexual), (4) start flirty/teasing. NEVER let them see the sale coming.
   GOOD: "im just laying in bed rn" → "what would u do if u were here"
   BAD: "Can I show you something special? 😏", "Want to have some fun?", "I'm so horny rn"

7. SEXT — SCENARIO-BASED story only (NOT real-time generic). Build: beginning → middle → end. Use their name and kinks if known. Short messages that give them space to participate. "and then..." "slowly..." "imagine..."
   GOOD: "ok so picture this... we just got back from the beach and im still in my bikini and i start..."
   BAD: "omg ur making me so wet", "I want you so bad" (generic, no scenario, no story)

8. SELL — Casual, never a sales pitch. "i made smth u might like only if u want tho". Reference what you were talking about. Start LOW (<$20 first PPV). PPV captions MUST have: pressure removal + convo link + question + their real name. ONE pitch attempt — if declined, back off and vibe. 40+ messages before first PPV with new fans.
   GOOD: "after what we were talking abt... i think ud really like this one jake. totally up to u tho"
   BAD: "I have an exclusive PPV for you! Only $50! Limited time offer! 🔥"

9. AFTERCARE — After they buy: warm but brief follow-up. "hope u liked it". Don't ghost after sale. Schedule next naturally: "i have more coming soon". Don't be clingy or over-thank.

## OBJECTION HANDLING (5-step escalation)
1. Ignore once (keep vibing)
2. Offer intangibles (dick rating, voice note)
3. Gamify: "if u can watch without finishing, next one free 😏"
4. Add 3-5 extra pics to sweeten deal
5. Renegotiate (different content for lower price, NEVER just discount)
NEVER: guilt trip ("don't you want to see me?"), get defensive, beg, over-negotiate

## WINNING CONVERSATION (full flow)
FAN: hey whats up
CHATTER: heyyy jake! where r u from? btw my ex was named jake should i be scared 😂
FAN: haha im from miami
CHATTER: wait no way i literally just got back from south beach last week
FAN: oh nice what were you doing there
CHATTER: ok so dont judge me but i tried paddleboarding and fell in like 3 times lmao
FAN: lol thats funny
CHATTER: shut uppp 😂 what do u do in miami
FAN: im a trainer
CHATTER: ok wait thats actually hot... u could probably teach me how to not fall off a paddleboard
(Opener→Location match→Humanize→Profile→Connection — all natural, correct voice, SHORT messages)

## FAILING CONVERSATION (common mistakes)
FAN: hey
CHATTER: Hey babe! How are you doing today? 😘
FAN: good u
CHATTER: I'm great! Thanks for asking! What do you like to do for fun? 😊
FAN: just chill
CHATTER: That's cool! I love chilling too! Want to see something special I made just for you? 💕
(Generic opener, customer service voice, fake emojis, interview question, visible transition, no rapport)

## WINNING SELL (natural)
CHATTER: i made smth earlier and i literally cant stop thinking about it
FAN: what is it
CHATTER: ok so picture this... we just got back from the beach right? and im still in my bikini
FAN: go on
CHATTER: and i start taking it off real slow while looking at u... jake i think ud really like this one. totally up to u tho
(Scenario-based, uses name, pressure removal, natural bridge from conversation)

## FAILING SELL (sales pitch)
CHATTER: I have an exclusive PPV for you! Only $50! Limited time offer! 🔥
FAN: idk thats a lot
CHATTER: Come on babe you won't regret it! I made it just for you! Don't you want to see me? 😘
(Sales pitch voice, guilt trip, too expensive for first PPV, no scenario, wrong emojis)

## BUY SIGNALS — critical to catch

When a fan says ANY of these, they are READY TO BUY. The chatter MUST capitalize within 2-3 messages by sending PPV or transitioning to a sell. Missing a buy signal = leaving money on the table.

EXPLICIT buy signals (fan is directly asking to buy):
- "how much", "whats the price", "send me", "show me more", "i want to see"
- "can i buy", "let me see", "i want that", "send it", "ill pay", "take my money"
- "where do i", "sign me up", "im interested", "how do i get", "i need that"
- "can u send", "i want more", "give me more", "what else u got"

IMPLICIT buy signals (fan is aroused/engaged enough to buy):
- Fan sends dick pic or explicit photo → strong signal, chatter should escalate to PPV
- Fan describes what they want to do sexually → bridge to "i actually have smth for that"
- Fan uses excited language: "omg", "thats so hot", "ur so sexy", "i love that"
- Fan asks personal/intimate questions → they're invested, good time to sell
- Fan replies fast with long messages → they're hooked
- Fan comes back after being gone → re-engagement window, pitch content

MISSED buy signal = CRITICAL event. If the fan said "show me" or "send me more" and the chatter just kept chatting without sending PPV, that's money lost.

## YOUR JOB — READ EVERY MESSAGE CAREFULLY
For each conversation, evaluate ALL of these dimensions:

1. **OPENER QUALITY** — Did they personalize with name + location question + hook? Or generic "hey how are you"?
2. **LOCATION MATCH** — Did they pretend to be from same area? Use local references? Or skip entirely?
3. **HUMANIZING** — Did they share a relatable personal story? Or stay impersonal?
4. **PROFILING METHOD** — Did they use 3-step (ask→react→share)? Or rapid-fire interview mode?
5. **CONNECTION DEPTH** — Inside jokes, callbacks, commonalities with evidence? Or surface-level "me too"?
6. **VOICE/TONE** — Natural girl texting (lowercase, abbreviations, unbothered)? Or customer service (formal, emoji spam, complete sentences)?
7. **TRANSITION** — Invisible 4-step? Or obvious ("want to see something?")?
8. **SEXTING QUALITY** — Scenario-based story with detail? Or generic "ur making me wet"?
9. **SELL TECHNIQUE** — Casual, referenced conversation, low first price, pressure removal? Or sales pitch?
10. **OBJECTION HANDLING** — Followed 5-step? Or guilt tripped/got defensive?
11. **BUY SIGNAL RECOGNITION** — Look for EVERY fan message that signals buying intent (explicit: "how much", "send me", "show me" OR implicit: dick pics, excited language, fast long replies). Did chatter capitalize within 2-3 messages by sending PPV? Or did they miss it and keep chatting?
12. **ENERGY MATCHING** — Did chatter match fan's pace and message length? Or mismatch?
13. **STAGE SKIPPING** — Which stages were followed vs skipped entirely?
14. **OVERALL ENGAGEMENT** — Did the conversation feel alive or robotic/templated?

Flag EVERY issue and every strength you find. Be thorough — read the actual words, don't just skim. Quote message snippets as evidence.
MISSED_BUY_SIGNAL is one of the most important events — flag it every time a fan showed interest and the chatter didn't send PPV within 2-3 messages.

Return ONLY valid JSON. No markdown fences.`;
    },

    // ═══════════════════════════════════════════════════════════
    // AI USER PROMPT — batches all conversations for one chatter
    // ═══════════════════════════════════════════════════════════
    buildAIUserPrompt(chatterName, conversations) {
        let prompt = `Grade these ${conversations.length} conversations by chatter "${chatterName}".\n\n`;

        for (let i = 0; i < conversations.length; i++) {
            const conv = conversations[i];
            prompt += `### CONV ${i} | fan: "${conv.fanName}" | model: "${conv.modelName}" | ${conv.messageCount} msgs | PPV: ${conv.ppvSent} sent, ${conv.ppvPurchased} bought, $${(conv.ppvRevenue || 0).toFixed(0)}\n`;
            prompt += conv.compressedText;
            prompt += '\n\n';
        }

        prompt += `## OUTPUT FORMAT
Return JSON with this EXACT structure:
{
  "conversations": [
    {
      "idx": 0,
      "aiScore": 65,
      "events": [
        {"type": "GENERIC_OPENER", "severity": "critical", "messageIndex": 0, "description": "Used 'hey how are you' — no name, no hook, no location question"},
        {"type": "GOOD_RAPPORT", "severity": "positive", "messageIndex": 8, "description": "Built genuine connection around shared interest in cooking"}
      ],
      "stageProgression": ["OPENER", "PROFILE", "SELL"],
      "verdict": "Skipped location match and humanizing. Jumped to selling at message 15."
    }
  ],
  "chatterSummary": {
    "tier": "average",
    "strengths": ["Fast replies during selling sequences", "Good at scenario-based sexting"],
    "weaknesses": ["Generic openers in 4/7 conversations — needs to personalize with name + location question", "Skips humanizing stage — never shares relatable stories"],
    "coachingFeedback": "Your biggest revenue leak is generic openers. When you open with 'hey how are you', fans don't feel special and engagement drops. Try: use their name + ask where they're from + add a playful comment. This alone could increase your conversion by 15-20%.",
    "priorityFix": "Personalize every opener with fan's name and a location question"
  }
}

AI EVENT TYPES — flag every one you find:

CRITICAL (major SOP violations, each one matters):
- GENERIC_OPENER: generic/formal greeting, no personalization, no name, no location question
- BAD_TONE: customer service voice, formal emojis (💕🥰😘), perfect grammar, complete sentences, walls of text
- MISSED_BUY_SIGNAL: fan showed buying intent ("how much", "send me", "show me") but chatter didn't capitalize
- VISIBLE_TRANSITION: obvious shift to selling ("can I show you something?", "want to have some fun?", "I'm so horny")
- NO_LOCATION_MATCH: didn't ask where fan is from or pretend to be from same area
- OBJECTION_FAILURE: guilt tripped, got defensive, begged, or just discounted on objection
- GF_EXPERIENCE: acting like girlfriend instead of friends-with-benefits (clingy, possessive, "I miss you so much baby")
- SOLD_TOO_EARLY: dropped PPV before building enough rapport — didn't vibe long enough before pitching

WARNING (needs improvement):
- DRY_CONVERSATION: robotic, low-effort messages, "okay", "cool", "haha", one-word replies from chatter
- INTERVIEW_MODE: rapid-fire questions without reacting to answers, no 3-step method, no sharing about self
- NO_HUMANIZING: never shared a relatable personal story, stayed impersonal throughout
- STAGE_SKIP: jumped from opener straight to selling, skipped rapport/connection entirely
- REAL_TIME_SEXT: generic sexting ("ur making me wet") instead of scenario-based story with detail
- WEAK_PPV_CAPTION: PPV sent without: pressure removal, convo reference, question, or fan's name

POSITIVE (good SOP execution):
- GOOD_OPENER: personalized with name + location question + playful hook
- GOOD_LOCATION_MATCH: pretended to be from same area, used local references
- GOOD_HUMANIZING: shared relatable funny story with specific details
- GOOD_RAPPORT: built genuine connection — inside jokes, callbacks, commonalities with evidence
- GOOD_PROFILING: gathered info naturally using 3-step method
- GOOD_TRANSITION: invisible escalation, fan didn't see the sell coming
- GOOD_SCENARIO_SEXT: scenario-based sexting with story structure and detail
- GOOD_TONE: natural girl texting voice, correct abbreviations, right energy
- GOOD_OBJECTION_HANDLING: followed the 5-step escalation pattern
- GOOD_ENERGY_MATCH: matched fan's pace, message length, and tone

aiScore: 0-100 rubric:
- 90-100: All stages followed perfectly, invisible transitions, great voice, scenario sexting
- 75-89: Most stages followed, minor issues (could humanize more, slight tone slip)
- 60-74: Some stages skipped, visible transition OR wrong voice OR generic sexting
- 40-59: Multiple SOP violations — premature pitch, interview mode, generic opener, customer service tone
- 0-39: Major failures — guilt tripping, defensive objections, GF experience, spamming, total stage skipping

Tier rules:
- "top": Most conversations show good technique, natural voice, proper stage progression
- "at_risk": Majority of conversations have critical issues (generic openers, bad tone, visible transitions, stage skipping)
- "average": Mix of good and bad

Be THOROUGH — read every message, flag every issue AND every strength. Quote actual message snippets as evidence (e.g. "chatter said 'Hey babe! How are you? 😘' — customer service tone with banned emoji").
Coaching feedback must be professional and constructive (managers and chatters read these reports).
Return ONLY valid JSON.`;

        return prompt;
    },

    // ═══════════════════════════════════════════════════════════
    // CONVERSATION COMPRESSION — smart truncation for AI input
    // ═══════════════════════════════════════════════════════════
    formatMessagesForAI(msgs) {
        return msgs.map(m => {
            const label = m.sender === 'fan' ? 'FAN' : 'CHATTER';
            const ppvTag = m.price > 0 ? ` [PPV $${m.price}${m.purchased ? ' PURCHASED' : ' NOT PURCHASED'}]` : '';
            const replyTag = m.replyTimeSec && m.sender === 'chatter' ? ` [reply: ${m.replyTimeSec}s]` : '';
            return `[${label}] ${(m.content || '').slice(0, 300)}${ppvTag}${replyTag}`;
        }).join('\n');
    },

    compressConversation(msgs, conv) {
        if (!msgs || msgs.length === 0) return '(empty conversation)';
        // Most conversations: send FULL text (AI needs to read everything)
        if (msgs.length <= 60) {
            return this.formatMessagesForAI(msgs);
        }
        // Very long conversations only: first 20 + PPV context (±5 around each PPV) + last 15
        const HEAD = 20, TAIL = 15, PPV_CTX = 5;
        const firstN = msgs.slice(0, HEAD);
        const lastN = msgs.slice(-TAIL);

        const usedIndices = new Set([
            ...Array.from({ length: Math.min(HEAD, msgs.length) }, (_, i) => i),
            ...Array.from({ length: Math.min(TAIL, msgs.length) }, (_, i) => msgs.length - TAIL + i)
        ]);

        const ppvContextMsgs = [];
        msgs.forEach((m, i) => {
            if (m.price > 0) {
                const start = Math.max(0, i - PPV_CTX);
                const end = Math.min(msgs.length, i + PPV_CTX + 1);
                for (let j = start; j < end; j++) {
                    if (!usedIndices.has(j)) {
                        usedIndices.add(j);
                        ppvContextMsgs.push({ idx: j, msg: msgs[j] });
                    }
                }
            }
        });
        ppvContextMsgs.sort((a, b) => a.idx - b.idx);

        let result = this.formatMessagesForAI(firstN);
        if (ppvContextMsgs.length > 0) {
            const firstPPVIdx = ppvContextMsgs[0].idx;
            const omittedBefore = firstPPVIdx - HEAD;
            if (omittedBefore > 0) result += `\n[... ${omittedBefore} messages omitted ...]\n`;
            result += this.formatMessagesForAI(ppvContextMsgs.map(p => p.msg));
        }
        const lastOmitted = msgs.length - TAIL - (ppvContextMsgs.length > 0 ? ppvContextMsgs[ppvContextMsgs.length - 1].idx + 1 : HEAD);
        if (lastOmitted > 0) result += `\n[... ${lastOmitted} messages omitted ...]\n`;
        result += this.formatMessagesForAI(lastN);

        return result;
    },

    // ═══════════════════════════════════════════════════════════
    // QUANTITATIVE RULES — 100% certain, from structured data only
    // ═══════════════════════════════════════════════════════════
    detectQuantitativeEvents(msgs, conv) {
        const events = [];
        if (!msgs || msgs.length < 2) return { events, ruleScore: 50 };

        const chatterMsgs = msgs.filter(m => m.sender === 'chatter');
        const fanMsgs = msgs.filter(m => m.sender === 'fan');
        if (chatterMsgs.length === 0) return { events, ruleScore: 50 };

        // --- PPV ANALYSIS (structured fields: price, purchased, message index) ---
        const ppvMsgs = msgs.filter(m => m.price > 0);
        const ppvPurchased = ppvMsgs.filter(m => m.purchased);
        const ppvNotPurchased = ppvMsgs.filter(m => !m.purchased);

        // SOLD_TOO_EARLY: First PPV before message #30 in a longer conversation
        if (ppvMsgs.length > 0) {
            const firstPPVIdx = msgs.indexOf(ppvMsgs[0]);
            if (firstPPVIdx < 30 && msgs.length > 35) {
                events.push({
                    type: 'SOLD_TOO_EARLY', severity: 'critical',
                    messageIndex: firstPPVIdx,
                    description: `Dropped PPV at msg #${firstPPVIdx + 1} of ${msgs.length} — didn't build enough rapport first`
                });
            }
        }

        // BAD_PRICING: First PPV > $20
        if (ppvMsgs.length > 0 && ppvMsgs[0].price > 20) {
            events.push({
                type: 'BAD_PRICING', severity: 'warning',
                messageIndex: msgs.indexOf(ppvMsgs[0]),
                description: `First PPV $${ppvMsgs[0].price} — start under $20 to get the first buy`
            });
        }

        // SUCCESSFUL_SALE / FAILED_CLOSE
        for (const pm of ppvPurchased) {
            events.push({
                type: 'SUCCESSFUL_SALE', severity: 'positive',
                messageIndex: msgs.indexOf(pm),
                description: `PPV purchased: $${pm.price}`
            });
        }
        for (const pm of ppvNotPurchased) {
            events.push({
                type: 'FAILED_CLOSE', severity: 'warning',
                messageIndex: msgs.indexOf(pm),
                description: `PPV not purchased: $${pm.price}`
            });
        }

        // NO_AFTERCARE / GOOD_PPV_LOOPING
        for (const pm of ppvPurchased) {
            const pmIdx = msgs.indexOf(pm);
            const followUp = msgs.slice(pmIdx + 1, pmIdx + 4).find(m => m.sender === 'chatter');
            if (followUp) {
                events.push({
                    type: 'GOOD_PPV_LOOPING', severity: 'positive',
                    messageIndex: pmIdx,
                    description: `Follow-up after $${pm.price} sale`
                });
            } else {
                events.push({
                    type: 'NO_AFTERCARE', severity: 'warning',
                    messageIndex: pmIdx,
                    description: `No follow-up after $${pm.price} purchase`
                });
            }
        }

        // --- REPLY SPEED (structured: replyTimeSec field) ---
        const replyTimes = [];
        for (let i = 1; i < msgs.length; i++) {
            if (msgs[i].sender === 'chatter' && msgs[i - 1].sender === 'fan') {
                const rt = msgs[i].replyTimeSec || 0;
                if (rt > 0) replyTimes.push({ idx: i, time: rt });
            }
        }

        const fastReplies = replyTimes.filter(r => r.time < 60);
        if (fastReplies.length > replyTimes.length * 0.6 && replyTimes.length >= 3) {
            events.push({
                type: 'FAST_RESPONSE', severity: 'positive',
                messageIndex: 0,
                description: `${fastReplies.length}/${replyTimes.length} replies under 1 min`
            });
        }

        // SLOW_REPLY_SELLING: >120s reply during PPV sequence
        for (const pm of ppvMsgs) {
            const pmIdx = msgs.indexOf(pm);
            const nearbySlowReplies = replyTimes.filter(r => Math.abs(r.idx - pmIdx) < 5 && r.time > 120);
            if (nearbySlowReplies.length > 0) {
                events.push({
                    type: 'SLOW_REPLY_SELLING', severity: 'critical',
                    messageIndex: nearbySlowReplies[0].idx,
                    description: `${Math.round(nearbySlowReplies[0].time / 60)}min reply during PPV sequence`
                });
                break;
            }
        }

        // IDLE_TIME: Gap > 600s
        const idleCount = replyTimes.filter(r => r.time > 600).length;
        if (idleCount > 0) {
            events.push({
                type: 'IDLE_TIME', severity: 'warning',
                messageIndex: 0,
                description: `${idleCount} gap${idleCount > 1 ? 's' : ''} over 10 minutes`
            });
        }

        // SPAMMING: 4+ consecutive chatter messages
        let maxConsecutive = 0, curConsecutive = 0, spamIdx = 0;
        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].sender === 'chatter') {
                curConsecutive++;
                if (curConsecutive > maxConsecutive) { maxConsecutive = curConsecutive; spamIdx = i; }
            } else { curConsecutive = 0; }
        }
        if (maxConsecutive >= 4) {
            events.push({
                type: 'SPAMMING', severity: 'warning',
                messageIndex: spamIdx,
                description: `${maxConsecutive} consecutive msgs without fan reply`
            });
        }

        // NO_FOLLOWUP: Last message from fan (left on read)
        if (msgs[msgs.length - 1].sender === 'fan' && msgs.length > 5) {
            events.push({
                type: 'NO_FOLLOWUP', severity: 'warning',
                messageIndex: msgs.length - 1,
                description: 'Last message from fan — left on read'
            });
        }

        // --- MISSED BUY SIGNAL detection (keyword scan on fan messages) ---
        const buyPhrases = [
            'how much', 'whats the price', 'what the price', 'send me', 'show me more',
            'i want to see', 'can i buy', 'let me see', 'i want that', 'send it',
            'ill pay', 'take my money', 'sign me up', 'im interested', 'how do i get',
            'i need that', 'can u send', 'i want more', 'give me more', 'what else u got',
            'show me', 'send more', 'i wanna see', 'lemme see', 'how much for'
        ];
        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].sender !== 'fan') continue;
            const text = (msgs[i].content || '').toLowerCase();
            const matchedPhrase = buyPhrases.find(p => text.includes(p));
            if (!matchedPhrase) continue;

            // Check if chatter sent PPV within the next 4 messages
            const nextMsgs = msgs.slice(i + 1, i + 5);
            const sentPPV = nextMsgs.some(m => m.sender === 'chatter' && m.price > 0);
            if (!sentPPV) {
                events.push({
                    type: 'MISSED_BUY_SIGNAL', severity: 'critical',
                    messageIndex: i,
                    description: `Fan said "${matchedPhrase}" but chatter didn't send PPV within next 4 messages — money left on the table`
                });
            }
        }

        // --- COMPUTE RULE SCORE ---
        let score = 60;
        const criticalCount = events.filter(e => e.severity === 'critical').length;
        const warningCount = events.filter(e => e.severity === 'warning').length;
        const positiveCount = events.filter(e => e.severity === 'positive').length;
        score -= criticalCount * 12;
        score -= warningCount * 4;
        score += positiveCount * 5;
        if (ppvPurchased.length > 0) score += 10;
        if (ppvPurchased.length >= 3) score += 5;
        if (chatterMsgs.length < 3 && msgs.length > 5) score -= 10;
        score = Math.max(0, Math.min(100, score));

        return { events, ruleScore: score };
    },

    // ═══════════════════════════════════════════════════════════
    // SCORE BLENDING — 40% rules + 60% AI with hard caps
    // ═══════════════════════════════════════════════════════════
    computeFinalScore(ruleScore, aiScore, mergedEvents) {
        if (aiScore == null) return ruleScore;
        const blended = Math.round(ruleScore * 0.4 + aiScore * 0.6);
        let final = blended;
        // Critical events cap at 65
        if (mergedEvents.some(e => e.severity === 'critical') && final > 65) final = 65;
        // 3+ positives guarantee minimum 30
        if (mergedEvents.filter(e => e.severity === 'positive').length >= 3 && final < 30) final = 30;
        return Math.max(0, Math.min(100, final));
    },

    // ═══════════════════════════════════════════════════════════
    // API CALLS — Gemini direct, OpenRouter fallback, Ollama local
    // ═══════════════════════════════════════════════════════════
    async callLLM(model, systemPrompt, userPrompt, temperature = 0.3) {
        const settings = await SettingsService.getSettings();
        const proxyUrl = (settings.proxyUrl || '').trim();
        const apiKey = (settings.aiChatApiKey || '').trim() || settings.openRouterApiKey;
        const aiBaseUrl = (settings.aiBaseUrl || '').trim() || 'https://openrouter.ai/api/v1';
        if (!proxyUrl) throw new Error('No proxy URL configured.');
        if (!apiKey) throw new Error('No OpenRouter API key configured.');

        const MAX_RETRIES = 3;
        const TIMEOUT_MS = 90000;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
            let response;
            try {
                response = await fetch(`${proxyUrl}/api/ai/generate`, {
                    method: 'POST',
                    headers: await getProxyHeaders({ 'Content-Type': 'application/json' }),
                    signal: controller.signal,
                    body: JSON.stringify({
                        aiBaseUrl: aiBaseUrl.replace(/\/$/, ''),
                        apiKey, model, max_tokens: 4096,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature
                    })
                });
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                if (fetchErr.name === 'AbortError') throw new Error('LLM call timed out');
                throw fetchErr;
            }
            clearTimeout(timeoutId);
            if (response.ok) {
                const data = await response.json();
                return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || {} };
            }
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.details?.error?.message || errData.details?.message
                || (typeof errData.details === 'string' ? errData.details : null)
                || errData.error || `LLM call failed (${response.status})`;
            const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
            const is429 = (response.status === 429) || (response.status === 500 && errStr.includes('429'));
            if (is429 && attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 8000 * Math.pow(2, attempt)));
                continue;
            }
            throw new Error(errStr);
        }
    },

    async callGemini(systemPrompt, userPrompt, temperature = 0.3) {
        const settings = await SettingsService.getSettings();
        const apiKey = (settings.aiChatGeminiKey || '').trim();
        if (!apiKey) throw new Error('No Gemini API key.');

        const TIMEOUT_MS = 60000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ parts: [{ text: userPrompt }] }],
                        generationConfig: {
                            temperature,
                            maxOutputTokens: 4096,
                            responseMimeType: 'application/json'
                        }
                    })
                }
            );
            clearTimeout(timeoutId);
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || `Gemini error (${response.status})`);
            }
            const data = await response.json();
            return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '', usage: {} };
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Gemini request timed out');
            throw err;
        }
    },

    async callGeminiWithFallback(systemPrompt, userPrompt, temperature = 0.3) {
        const settings = await SettingsService.getSettings();

        // 1. Try Gemini direct (free/cheap)
        const geminiKey = (settings.aiChatGeminiKey || '').trim();
        if (geminiKey) {
            try {
                return await this.callGemini(systemPrompt, userPrompt, temperature);
            } catch (err) {
                console.warn('[AI Grade] Gemini failed, trying fallback:', err.message);
            }
        }

        // 2. Try OpenRouter
        const hasOpenRouter = !!((settings.aiChatApiKey || settings.openRouterApiKey)?.trim()) && !!(settings.proxyUrl?.trim());
        if (hasOpenRouter) {
            try {
                return await this.callLLM('google/gemini-2.0-flash-001', systemPrompt, userPrompt, temperature);
            } catch (err) {
                console.warn('[AI Grade] OpenRouter failed:', err.message);
            }
        }

        // 3. No AI available
        throw new Error('NO_AI_AVAILABLE');
    },

    parseJsonResponse(raw) {
        let text = (raw || '').trim();
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        try { return JSON.parse(text); } catch {
            const arrMatch = text.match(/\[[\s\S]*\]/);
            if (arrMatch) try { return JSON.parse(arrMatch[0]); } catch { /* fall through */ }
            const objMatch = text.match(/\{[\s\S]*\}/);
            if (objMatch) try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
            return null;
        }
    },

    // ═══════════════════════════════════════════════════════════
    // AI GRADING — one call per chatter, all their conversations
    // ═══════════════════════════════════════════════════════════
    async aiGradeChatter(chatterId, chatterName, conversations, allMsgsMap) {
        const convsForAI = conversations.map(conv => {
            const msgs = allMsgsMap.get(conv.id) || [];
            return {
                ...conv,
                compressedText: this.compressConversation(msgs, conv)
            };
        });

        const systemPrompt = this.buildAISystemPrompt();
        const userPrompt = this.buildAIUserPrompt(chatterName, convsForAI);

        // Skip AI if prompt is too large (>800K chars ≈ 200K tokens)
        if (systemPrompt.length + userPrompt.length > 800000) {
            console.warn(`[AI Grade] Prompt too large for ${chatterName}, using rules only`);
            return null;
        }

        const result = await this.callGeminiWithFallback(systemPrompt, userPrompt, 0.3);
        const parsed = this.parseJsonResponse(result.content);

        if (!parsed || !parsed.conversations) {
            console.warn(`[AI Grade] Failed to parse response for ${chatterName}`);
            return null;
        }

        return {
            conversations: parsed.conversations,
            chatterSummary: parsed.chatterSummary,
            rawResponse: result.content
        };
    },

    // ═══════════════════════════════════════════════════════════
    // MAIN ORCHESTRATOR — 3-phase grading pipeline
    // ═══════════════════════════════════════════════════════════
    async gradeImport(importId, onProgress) {
        // Clear prior grades/reports
        await db.aiChatGrades.where('importId').equals(importId).delete();
        await db.aiChatterReports.where('importId').equals(importId).delete();
        await db.aiChatImports.update(importId, { status: 'grading' });

        const convos = await db.aiChatConversations.where('importId').equals(importId).toArray();
        const allChatters = await db.aiChatters.toArray();
        const chatterNameMap = new Map(allChatters.map(c => [c.id, c.name]));
        const allModels = await db.aiChatModels.toArray();
        const modelNameMap = new Map(allModels.map(m => [m.id, m.name]));

        // ═══════════════════════════════════════════════
        // PHASE 1: Quantitative Rules (instant, free, ALL conversations)
        // ═══════════════════════════════════════════════
        const totalConvos = convos.length;
        onProgress?.({ phase: 'rules', current: 0, total: totalConvos,
            label: `Computing metrics 0/${totalConvos}...` });

        const allMsgsMap = new Map();
        const chatterConvoMap = new Map();

        for (let i = 0; i < convos.length; i++) {
            const conv = convos[i];
            const msgs = await db.aiChatMessages.where('conversationId').equals(conv.id).toArray();
            msgs.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
            allMsgsMap.set(conv.id, msgs);

            const { events: ruleEvents, ruleScore } = this.detectQuantitativeEvents(msgs, conv);

            if (!chatterConvoMap.has(conv.chatterId)) {
                chatterConvoMap.set(conv.chatterId, {
                    convos: [], ruleResults: new Map(),
                    totalMessages: 0, totalRevenue: 0,
                    ppvSent: 0, ppvPurchased: 0, replyTimes: []
                });
            }
            const cd = chatterConvoMap.get(conv.chatterId);
            cd.convos.push(conv);
            cd.ruleResults.set(conv.id, { events: ruleEvents, ruleScore });
            cd.totalMessages += conv.messageCount || 0;
            cd.totalRevenue += conv.ppvRevenue || 0;
            cd.ppvSent += conv.ppvSent || 0;
            cd.ppvPurchased += conv.ppvPurchased || 0;
            if (conv.avgReplyTimeSec) cd.replyTimes.push(conv.avgReplyTimeSec);

            if ((i + 1) % 100 === 0 || i === convos.length - 1) {
                onProgress?.({ phase: 'rules', current: i + 1, total: totalConvos,
                    label: `Computing metrics ${i + 1}/${totalConvos}...` });
            }
        }

        // ═══════════════════════════════════════════════
        // PHASE 2: AI Quality Grading (1 call per chatter)
        // ═══════════════════════════════════════════════
        const totalChatters = chatterConvoMap.size;
        let aiAvailable = true;

        const settings = await SettingsService.getSettings();
        const geminiKey = (settings.aiChatGeminiKey || '').trim();
        const hasOpenRouter = !!((settings.aiChatApiKey || settings.openRouterApiKey)?.trim()) && !!(settings.proxyUrl?.trim());

        if (!geminiKey && !hasOpenRouter) {
            aiAvailable = false;
            onProgress?.({ phase: 'ai', current: 0, total: totalChatters,
                label: 'No AI API key — using rules only (add Gemini key in Settings for quality grading)' });
        }

        let chatterIdx = 0;
        const aiResults = new Map();

        if (aiAvailable) {
            for (const [chatterId, data] of chatterConvoMap) {
                chatterIdx++;
                const chatterName = chatterNameMap.get(chatterId) || 'Unknown';
                onProgress?.({ phase: 'ai', current: chatterIdx, total: totalChatters,
                    label: `AI grading ${chatterIdx}/${totalChatters} (${chatterName})...` });

                try {
                    const convsWithMeta = data.convos.map(c => ({
                        ...c,
                        modelName: modelNameMap.get(c.modelId) || 'Unknown'
                    }));
                    const aiResult = await this.aiGradeChatter(
                        chatterId, chatterName, convsWithMeta, allMsgsMap
                    );
                    if (aiResult) aiResults.set(chatterId, aiResult);
                } catch (err) {
                    if (err.message === 'NO_AI_AVAILABLE') {
                        aiAvailable = false;
                        console.warn('[AI Grade] AI became unavailable, switching to rules-only');
                        break;
                    }
                    console.warn(`[AI Grade] Failed for ${chatterName}:`, err.message);
                }

                // Rate limiting: 15 RPM on free tier → 4.5s between calls
                if (chatterIdx < totalChatters) {
                    await new Promise(r => setTimeout(r, 4500));
                }
            }
        }

        // ═══════════════════════════════════════════════
        // PHASE 3: Merge rule + AI events, store grades & reports
        // ═══════════════════════════════════════════════
        onProgress?.({ phase: 'merge', current: 0, total: totalChatters,
            label: 'Building reports...' });

        for (const [chatterId, data] of chatterConvoMap) {
            const aiResult = aiResults.get(chatterId);
            const aiConvMap = new Map();
            if (aiResult) {
                for (const aiConv of (aiResult.conversations || [])) {
                    aiConvMap.set(aiConv.idx, aiConv);
                }
            }

            const allEvents = [];
            const allScores = [];
            const eventCounts = {};

            for (let ci = 0; ci < data.convos.length; ci++) {
                const conv = data.convos[ci];
                const ruleResult = data.ruleResults.get(conv.id);
                const aiConv = aiConvMap.get(ci);

                // Merge events from both tiers
                const mergedEvents = [...(ruleResult?.events || [])];
                if (aiConv?.events) mergedEvents.push(...aiConv.events);

                const finalScore = this.computeFinalScore(
                    ruleResult?.ruleScore || 50,
                    aiConv?.aiScore ?? null,
                    mergedEvents
                );

                const stageProgression = aiConv?.stageProgression || [];
                const summary = aiConv?.verdict
                    || mergedEvents.filter(e => e.severity === 'critical').map(e => e.description).join('; ')
                    || 'No critical issues';

                // Store grade
                await db.aiChatGrades.add({
                    id: generateId(), importId,
                    conversationId: conv.id, chatterId, modelId: conv.modelId,
                    sopScore: finalScore,
                    events: JSON.stringify(mergedEvents),
                    stageProgression: JSON.stringify(stageProgression),
                    summary,
                    rawResponse: '',
                    model: aiResult ? 'gemini-2.0-flash' : 'rule-based',
                    tokenCount: 0, cost: 0,
                    createdAt: new Date().toISOString()
                });

                // Annotate messages with events
                const msgs = allMsgsMap.get(conv.id) || [];
                for (const evt of mergedEvents) {
                    const mi = evt.messageIndex;
                    if (mi != null && mi >= 0 && mi < msgs.length && msgs[mi].id) {
                        await db.aiChatMessages.update(msgs[mi].id, {
                            annotation: JSON.stringify({
                                type: evt.type,
                                severity: evt.severity || 'warning',
                                text: evt.description || evt.type
                            })
                        });
                    }
                }

                await db.aiChatConversations.update(conv.id, {
                    stageClassification: stageProgression.slice(-1)[0] || null,
                    graded: 1
                });

                allScores.push(finalScore);
                for (const e of mergedEvents) {
                    eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
                    allEvents.push(e);
                }
            }

            // Build chatter report
            const avgSopScore = allScores.length > 0
                ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;
            const avgReplyTimeSec = data.replyTimes.length > 0
                ? Math.round(data.replyTimes.reduce((a, b) => a + b, 0) / data.replyTimes.length) : null;
            const conversionRate = data.ppvSent > 0 ? data.ppvPurchased / data.ppvSent : 0;

            // Tier, strengths, weaknesses, coaching — from AI or fallback
            let tier = 'average';
            let strengths = [];
            let weaknesses = [];
            let coachingFeedback = '';

            if (aiResult?.chatterSummary) {
                const cs = aiResult.chatterSummary;
                tier = cs.tier || tier;
                strengths = cs.strengths || [];
                weaknesses = cs.weaknesses || [];
                coachingFeedback = cs.coachingFeedback || '';
            }

            // Override tier with quantitative check
            const criticals = allEvents.filter(e => e.severity === 'critical').length;
            if (avgSopScore >= 70 && conversionRate >= 0.15) tier = 'top';
            else if (avgSopScore < 45 || conversionRate < 0.05
                     || criticals > data.convos.length * 0.5) tier = 'at_risk';

            // Fallback coaching if no AI
            if (!coachingFeedback) {
                const ec = eventCounts;
                if (ec.GOOD_PPV_LOOPING > 0) strengths.push('Good PPV looping — follows up after purchases');
                if (ec.FAST_RESPONSE > 0) strengths.push('Fast response times');
                if (ec.SUCCESSFUL_SALE > 0) strengths.push(`${ec.SUCCESSFUL_SALE} successful sales`);
                if (conversionRate >= 0.2) strengths.push(`Strong ${(conversionRate * 100).toFixed(0)}% conversion`);
                if (ec.SOLD_TOO_EARLY > 0) weaknesses.push(`Sold too early in ${ec.SOLD_TOO_EARLY} conversations — needs more rapport before PPV`);
                if (ec.SLOW_REPLY_SELLING > 0) weaknesses.push('Slow replies during selling');
                if (ec.NO_AFTERCARE > 0) weaknesses.push(`No aftercare after ${ec.NO_AFTERCARE} purchases`);
                if (ec.NO_FOLLOWUP > 0) weaknesses.push(`${ec.NO_FOLLOWUP} conversations left on read`);
                if (ec.BAD_PRICING > 0) weaknesses.push(`Pricing issues in ${ec.BAD_PRICING} PPVs`);
                if (ec.SPAMMING > 0) weaknesses.push(`Spamming in ${ec.SPAMMING} conversations`);
                const topIssue = weaknesses[0] || 'Keep up the good work';
                coachingFeedback = weaknesses.length > 0
                    ? `Priority fix: ${topIssue}.${weaknesses.length > 1 ? ` Also work on: ${weaknesses.slice(1, 3).join('; ')}.` : ''}`
                    : `Strong performance. ${strengths.slice(0, 2).join('. ')}.`;
            }

            await db.aiChatterReports.add({
                id: generateId(), importId, chatterId,
                totalConversations: data.convos.length,
                totalMessages: data.totalMessages,
                totalRevenue: data.totalRevenue,
                totalPPVSent: data.ppvSent,
                totalPPVPurchased: data.ppvPurchased,
                conversionRate, avgReplyTimeSec, avgSopScore,
                eventCounts: JSON.stringify(eventCounts),
                tier, coachingFeedback,
                strengths: JSON.stringify(strengths),
                weaknesses: JSON.stringify(weaknesses),
                model: aiResult ? 'gemini-2.0-flash' : 'rule-based',
                tokenCount: 0, cost: 0,
                createdAt: new Date().toISOString()
            });
        }

        await db.aiChatImports.update(importId, { status: 'complete' });
        onProgress?.({ phase: 'done', label: 'Analysis complete!' });
        return { totalChatters, totalConversations: totalConvos };
    }
};


const AI_CRITICAL_TYPES = ['GENERIC_OPENER','BAD_TONE','MISSED_BUY_SIGNAL','VISIBLE_TRANSITION','NO_LOCATION_MATCH','OBJECTION_FAILURE','GF_EXPERIENCE','SOLD_TOO_EARLY','SLOW_REPLY_SELLING'];
const AI_POSITIVE_TYPES = ['GOOD_OPENER','GOOD_LOCATION_MATCH','GOOD_HUMANIZING','GOOD_RAPPORT','GOOD_PROFILING','GOOD_TRANSITION','GOOD_SCENARIO_SEXT','GOOD_TONE','GOOD_OBJECTION_HANDLING','GOOD_ENERGY_MATCH','GOOD_PPV_LOOPING','FAST_RESPONSE','SUCCESSFUL_SALE'];

export const AIChatReportService = {
    async getLeaderboard(importId) {
        const reports = await db.aiChatterReports.where('importId').equals(importId).toArray();
        const imp = await db.aiChatImports.get(importId);
        const allChatters = await db.aiChatters.toArray();
        const chatterNameMap = new Map(allChatters.map(c => [c.id, c.name]));

        // Load all grades for this import to get real examples
        const allGrades = await db.aiChatGrades.where('importId').equals(importId).toArray();
        const allConvos = await db.aiChatConversations.where('importId').equals(importId).toArray();
        const convoMap = new Map(allConvos.map(c => [c.id, c]));

        const chatters = [];
        for (const r of reports) {
            const ec = typeof r.eventCounts === 'string' ? JSON.parse(r.eventCounts || '{}') : (r.eventCounts || {});
            const topEvents = Object.entries(ec).filter(([,v]) => v > 0).map(([type, count]) => ({
                type, count,
                severity: AI_CRITICAL_TYPES.includes(type) ? 'critical' : AI_POSITIVE_TYPES.includes(type) ? 'positive' : 'warning'
            })).sort((a, b) => b.count - a.count);

            // Pull real examples: find grades for this chatter with events
            const chatterGrades = allGrades.filter(g => g.chatterId === r.chatterId);
            const realExamples = [];
            for (const g of chatterGrades) {
                const events = typeof g.events === 'string' ? JSON.parse(g.events || '[]') : (g.events || []);
                const conv = convoMap.get(g.conversationId);
                const fanName = conv?.fanName || 'Unknown';
                for (const evt of events) {
                    if (realExamples.length >= 8) break;
                    realExamples.push({
                        type: evt.type,
                        severity: AI_CRITICAL_TYPES.includes(evt.type) ? 'critical' : AI_POSITIVE_TYPES.includes(evt.type) ? 'positive' : 'warning',
                        description: evt.description || '',
                        fanName,
                        messageIndex: evt.messageIndex
                    });
                }
                if (realExamples.length >= 8) break;
            }

            // Map event types to SOP modules for review recommendations
            const moduleMap = {
                GENERIC_OPENER: 'Module 1: Openers', NO_LOCATION_MATCH: 'Module 1: Location Match',
                NO_HUMANIZING: 'Module 1: Humanizing', INTERVIEW_MODE: 'Module 1: Profiling',
                BAD_TONE: 'Module 3: Voice & Tone', DRY_CONVERSATION: 'Module 3: Conversation Energy',
                SOLD_TOO_EARLY: 'Module 5: Transitions', VISIBLE_TRANSITION: 'Module 5: Transitions',
                STAGE_SKIP: 'Module 5: Stage Progression', REAL_TIME_SEXT: 'Module 6: Sexting',
                WEAK_PPV_CAPTION: 'Module 7: PPV Captions', NO_AFTERCARE: 'Module 7: Aftercare',
                OBJECTION_FAILURE: 'Module 8: Objection Handling', BAD_PRICING: 'Module 9: Pricing',
                GF_EXPERIENCE: 'Module 2: Connection', MISSED_BUY_SIGNAL: 'Module 4: Finding Opportunities',
                SLOW_REPLY_SELLING: 'Module 12: Reply Speed', NO_FOLLOWUP: 'Module 3: Following Up',
                SPAMMING: 'Module 3: Forbidden Behaviors'
            };
            const reviewModules = [...new Set(
                topEvents.filter(e => e.severity !== 'positive' && moduleMap[e.type])
                    .map(e => moduleMap[e.type])
            )].slice(0, 3);

            chatters.push({
                chatterId: r.chatterId,
                name: chatterNameMap.get(r.chatterId) || 'Unknown',
                tier: r.tier,
                revenue: r.totalRevenue || 0,
                conversationCount: r.totalConversations || 0,
                messageCount: r.totalMessages || 0,
                conversionRate: r.conversionRate || 0,
                avgSopScore: r.avgSopScore,
                avgReplyTimeSec: r.avgReplyTimeSec,
                ppvSent: r.totalPPVSent || 0,
                ppvPurchased: r.totalPPVPurchased || 0,
                eventCounts: ec,
                topEvents,
                realExamples,
                reviewModules,
                strengths: typeof r.strengths === 'string' ? JSON.parse(r.strengths || '[]') : (r.strengths || []),
                weaknesses: typeof r.weaknesses === 'string' ? JSON.parse(r.weaknesses || '[]') : (r.weaknesses || []),
                coachingFeedback: r.coachingFeedback || ''
            });
        }
        chatters.sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = chatters.reduce((s, c) => s + c.revenue, 0);
        const totalConversations = chatters.reduce((s, c) => s + c.conversationCount, 0);
        const avgConversion = chatters.length > 0 ? chatters.reduce((s, c) => s + c.conversionRate, 0) / chatters.length : 0;

        // Needs attention: cross-import trend analysis
        const needsAttention = await this.computeNeedsAttention(chatters, importId);

        return {
            importId, importDate: imp?.importDate,
            globalStats: { totalRevenue, avgConversionRate: avgConversion, totalConversations, totalChatters: chatters.length },
            chatters,
            needsAttention
        };
    },

    async computeNeedsAttention(chatters, currentImportId) {
        const results = [];

        // Get last 5 imports sorted by date (most recent first)
        const allImports = await db.aiChatImports.orderBy('importDate').reverse().limit(5).toArray();
        const importIds = allImports.map(i => i.id);
        const importIdxMap = new Map(importIds.map((id, idx) => [id, idx]));

        // Load only reports from recent imports (indexed query, not full table scan)
        const chatterIdSet = new Set(chatters.map(c => c.chatterId));
        const recentReports = await db.aiChatterReports.where('importId').anyOf(importIds).toArray();
        const historyMap = new Map();
        for (const r of recentReports) {
            if (!chatterIdSet.has(r.chatterId)) continue;
            const idx = importIdxMap.get(r.importId);
            if (idx == null) continue;
            if (!historyMap.has(r.chatterId)) historyMap.set(r.chatterId, []);
            const ec = typeof r.eventCounts === 'string' ? JSON.parse(r.eventCounts || '{}') : (r.eventCounts || {});
            historyMap.get(r.chatterId).push({ importId: r.importId, avgSopScore: r.avgSopScore, tier: r.tier, eventCounts: ec, importIdx: idx });
        }

        // Median threshold for single-import flagging
        const withScores = chatters.filter(c => c.avgSopScore != null);
        let medianThreshold = 30;
        if (withScores.length >= 3) {
            const sorted = [...withScores].sort((a, b) => a.avgSopScore - b.avgSopScore);
            const median = sorted[Math.floor(sorted.length / 2)].avgSopScore;
            medianThreshold = Math.max(Math.floor(median * 0.6), 30);
        }

        for (const c of chatters) {
            if (c.avgSopScore == null) continue;
            const reasons = [];
            const history = (historyMap.get(c.chatterId) || []).sort((a, b) => a.importIdx - b.importIdx);

            if (history.length >= 2) {
                // 1. Score trend: declining or stuck
                const scores = history.map(h => h.avgSopScore).filter(s => s != null);
                if (scores.length >= 2) {
                    const latest = scores[scores.length - 1];
                    const previous = scores[scores.length - 2];
                    const diff = latest - previous;
                    if (diff < -5) {
                        reasons.push({ type: 'declining', text: `Score dropped ${Math.abs(diff).toFixed(0)} pts (${previous.toFixed(0)} \u2192 ${latest.toFixed(0)})` });
                    } else if (scores.length >= 3 && scores.slice(-3).every(s => s < 50)) {
                        reasons.push({ type: 'stuck', text: `Score stuck below 50 for ${scores.length} imports` });
                    }
                }

                // 2. Repeat critical events across consecutive imports
                const prevEc = history[history.length - 2]?.eventCounts || {};
                const currEc = c.eventCounts || {};
                const repeats = AI_CRITICAL_TYPES.filter(t => (prevEc[t] || 0) > 0 && (currEc[t] || 0) > 0);
                if (repeats.length > 0) {
                    const labels = repeats.map(t => t.replace(/_/g, ' ').toLowerCase()).slice(0, 3);
                    reasons.push({ type: 'repeat', text: `Repeat issues: ${labels.join(', ')}` });
                }

                // 3. Consistently at-risk tier
                const recentTiers = history.slice(-3).map(h => h.tier);
                if (recentTiers.every(t => t === 'at_risk')) {
                    reasons.push({ type: 'at_risk', text: `At-risk tier for ${recentTiers.length} consecutive imports` });
                }
            }

            // 4. Below median (fallback for single-import)
            if (c.avgSopScore < medianThreshold && reasons.length === 0) {
                reasons.push({ type: 'low_score', text: `SOP score ${c.avgSopScore.toFixed(0)} below team threshold ${medianThreshold}` });
            }

            if (reasons.length > 0) {
                const scores = history.length >= 2 ? history.map(h => h.avgSopScore).filter(s => s != null) : [];
                let trend = 'flat';
                if (scores.length >= 2) {
                    const diff = scores[scores.length - 1] - scores[scores.length - 2];
                    trend = diff > 5 ? 'improving' : diff < -5 ? 'declining' : 'flat';
                }
                results.push({
                    name: c.name, chatterId: c.chatterId, score: c.avgSopScore, tier: c.tier, trend,
                    reason: reasons.map(r => r.text).join(' \u00B7 '),
                    reasons,
                    importCount: history.length
                });
            }
        }

        // Sort: declining first, then repeat offenders, then low scores
        const priority = { declining: 0, repeat: 1, stuck: 2, at_risk: 3, low_score: 4 };
        results.sort((a, b) => {
            const aPri = Math.min(...a.reasons.map(r => priority[r.type] ?? 99));
            const bPri = Math.min(...b.reasons.map(r => priority[r.type] ?? 99));
            return aPri - bPri || a.score - b.score;
        });

        return results;
    },

    async getImportDates() {
        const imports = await db.aiChatImports.orderBy('importDate').reverse().toArray();
        return imports.map(i => ({ id: i.id, date: i.importDate, filename: i.filename, status: i.status }));
    },

    async getChatterReport(importId, chatterId) {
        const report = await db.aiChatterReports.where('importId').equals(importId).filter(r => r.chatterId === chatterId).first();
        if (!report) return null;

        const chatter = await db.aiChatters.get(chatterId);
        const convos = await db.aiChatConversations.where('importId').equals(importId).filter(c => c.chatterId === chatterId).toArray();
        const grades = await db.aiChatGrades.where('importId').equals(importId).filter(g => g.chatterId === chatterId).toArray();
        const gradeMap = new Map(grades.map(g => [g.conversationId, g]));
        const allModels = await db.aiChatModels.toArray();
        const modelNameMap = new Map(allModels.map(m => [m.id, m.name]));

        const conversations = convos.map(c => {
            const grade = gradeMap.get(c.id);
            return {
                id: c.id,
                fanName: c.fanName, fanUserId: c.fanUserId,
                modelName: modelNameMap.get(c.modelId) || 'Unknown',
                messageCount: c.messageCount,
                ppvRevenue: c.ppvRevenue || 0,
                ppvSent: c.ppvSent || 0,
                ppvPurchased: c.ppvPurchased || 0,
                avgReplyTimeSec: c.avgReplyTimeSec,
                sopScore: grade?.sopScore ?? null,
                events: grade ? (typeof grade.events === 'string' ? JSON.parse(grade.events || '[]') : grade.events) : [],
                stageProgression: grade ? (typeof grade.stageProgression === 'string' ? JSON.parse(grade.stageProgression || '[]') : grade.stageProgression) : [],
                summary: grade?.summary || ''
            };
        }).sort((a, b) => (b.ppvRevenue || 0) - (a.ppvRevenue || 0));

        // Compute team averages from all reports in this import
        const allReports = await db.aiChatterReports.where('importId').equals(importId).toArray();
        const teamCount = allReports.length;
        const teamAverages = { totalRevenue: 0, conversionRate: 0, avgReplyTimeSec: 0, avgSopScore: 0, totalPPVSent: 0, totalPPVPurchased: 0, totalConversations: 0, totalMessages: 0 };
        if (teamCount > 0) {
            for (const r of allReports) {
                teamAverages.totalRevenue += r.totalRevenue || 0;
                teamAverages.conversionRate += r.conversionRate || 0;
                teamAverages.avgReplyTimeSec += r.avgReplyTimeSec || 0;
                teamAverages.avgSopScore += r.avgSopScore || 0;
                teamAverages.totalPPVSent += r.totalPPVSent || 0;
                teamAverages.totalPPVPurchased += r.totalPPVPurchased || 0;
                teamAverages.totalConversations += r.totalConversations || 0;
                teamAverages.totalMessages += r.totalMessages || 0;
            }
            teamAverages.totalRevenue /= teamCount;
            teamAverages.conversionRate /= teamCount;
            teamAverages.avgReplyTimeSec /= teamCount;
            teamAverages.avgSopScore /= teamCount;
            teamAverages.totalPPVSent /= teamCount;
            teamAverages.totalPPVPurchased /= teamCount;
            teamAverages.totalConversations /= teamCount;
            teamAverages.totalMessages /= teamCount;
            teamAverages.offerRate = teamAverages.totalConversations > 0 ? teamAverages.totalPPVSent / teamAverages.totalConversations : 0;
        }

        return {
            chatterId, chatterName: chatter?.name || 'Unknown',
            ...report,
            eventCounts: typeof report.eventCounts === 'string' ? JSON.parse(report.eventCounts || '{}') : report.eventCounts,
            strengths: typeof report.strengths === 'string' ? JSON.parse(report.strengths || '[]') : report.strengths,
            weaknesses: typeof report.weaknesses === 'string' ? JSON.parse(report.weaknesses || '[]') : report.weaknesses,
            conversations,
            teamAverages,
            teamCount
        };
    },

    async getEventSamples(importId, chatterId, eventType) {
        const grades = await db.aiChatGrades.where('importId').equals(importId).filter(g => g.chatterId === chatterId).toArray();
        const samples = [];
        for (const g of grades) {
            const events = typeof g.events === 'string' ? JSON.parse(g.events || '[]') : (g.events || []);
            const matching = events.filter(e => e.type === eventType);
            if (matching.length === 0) continue;
            const conv = await db.aiChatConversations.get(g.conversationId);
            const msgs = await db.aiChatMessages.where('conversationId').equals(g.conversationId).toArray();
            msgs.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
            for (const evt of matching) {
                const mi = evt.messageIndex || 0;
                const start = Math.max(0, mi - 2);
                const end = Math.min(msgs.length, mi + 3);
                samples.push({
                    conversationId: g.conversationId,
                    fanName: conv?.fanName || 'Unknown',
                    modelName: conv?.modelName || '',
                    messageCount: conv?.messageCount || msgs.length,
                    description: evt.description || '',
                    severity: evt.severity || 'warning',
                    messages: msgs.slice(start, end).map(m => ({
                        sender: m.sender,
                        content: m.content,
                        timestamp: m.timestamp,
                        price: m.price,
                        purchased: m.purchased
                    }))
                });
                if (samples.length >= 3) return samples;
            }
            if (samples.length >= 3) return samples;
        }
        return samples;
    },

    async getConversationReplay(conversationId) {
        const conv = await db.aiChatConversations.get(conversationId);
        if (!conv) return null;

        const messages = await db.aiChatMessages.where('conversationId').equals(conversationId).toArray();
        messages.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

        const grade = await db.aiChatGrades.where('conversationId').equals(conversationId).first();
        const chatter = conv.chatterId ? await db.aiChatters.get(conv.chatterId) : null;
        const model = conv.modelId ? await db.aiChatModels.get(conv.modelId) : null;

        return {
            conversation: conv,
            chatterName: chatter?.name || 'Unknown',
            modelName: model?.name || 'Unknown',
            messages: messages.map(m => ({
                ...m,
                annotation: m.annotation ? (typeof m.annotation === 'string' ? JSON.parse(m.annotation) : m.annotation) : null
            })),
            grade: grade ? {
                sopScore: grade.sopScore,
                events: typeof grade.events === 'string' ? JSON.parse(grade.events || '[]') : grade.events,
                stageProgression: typeof grade.stageProgression === 'string' ? JSON.parse(grade.stageProgression || '[]') : grade.stageProgression,
                summary: grade.summary
            } : null
        };
    }
};
