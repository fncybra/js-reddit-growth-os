const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { google } = require('googleapis');
const heicConvert = require('heic-convert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


const { HttpsProxyAgent } = require('https-proxy-agent');

// Proxy priority:
// 1) Request header: x-proxy-info
// 2) SMARTPROXY/PROXY pool API URL env
// 3) REDDIT_PROXY_POOL env (comma/newline separated)
// 4) hardcoded fallback pool
const fallbackProxies = [
    "198.23.239.134:6540:cdlljwsf:3xtolj60p8g7",
    "107.172.163.27:6543:cdlljwsf:3xtolj60p8g7",
    "216.10.27.159:6837:cdlljwsf:3xtolj60p8g7"
];

const envProxyPoolRaw = process.env.REDDIT_PROXY_POOL || '';
const envProxyPool = envProxyPoolRaw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
const proxyPoolApiUrl = process.env.PROXY_POOL_API_URL || process.env.SMARTPROXY_API_URL || '';

let rawProxies = envProxyPool.length > 0 ? [...envProxyPool] : [...fallbackProxies];
let proxyPoolSource = envProxyPool.length > 0 ? 'env.REDDIT_PROXY_POOL' : 'fallback';
let lastProxyPoolRefreshAt = null;

function parseProxyPoolResponse(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload.map(x => String(x).trim()).filter(Boolean);
    if (typeof payload === 'string') {
        return payload
            .split(/[\n,]/)
            .map(s => s.trim())
            .filter(Boolean);
    }
    if (typeof payload === 'object') {
        if (Array.isArray(payload.data)) return parseProxyPoolResponse(payload.data);
        if (typeof payload.data === 'string') return parseProxyPoolResponse(payload.data);
        if (Array.isArray(payload.proxies)) return parseProxyPoolResponse(payload.proxies);
    }
    return [];
}

async function refreshProxyPoolFromApi() {
    if (!proxyPoolApiUrl) return { ok: false, reason: 'missing_proxy_pool_api_url' };
    const res = await axios.get(proxyPoolApiUrl, { timeout: 15000 });
    const parsed = parseProxyPoolResponse(res.data);
    if (!parsed.length) return { ok: false, reason: 'empty_proxy_pool_response' };

    rawProxies = parsed;
    proxyPoolSource = 'env.PROXY_POOL_API_URL';
    lastProxyPoolRefreshAt = new Date().toISOString();
    return { ok: true, count: rawProxies.length };
}

let proxyIndex = 0;

function normalizeProxyInfo(raw = '') {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;

    const parts = value.split(':');
    if (parts.length >= 4) {
        const [ip, port, ...rest] = parts;
        const pass = rest.pop();
        const user = rest.join(':');
        return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
    }
    if (parts.length === 2) {
        const [ip, port] = parts;
        return `http://${ip}:${port}`;
    }
    return value;
}

function getNextProxyInfo() {
    if (!rawProxies.length) return '';
    const raw = rawProxies[proxyIndex % rawProxies.length];
    proxyIndex++;
    return raw;
}

function getProxyAgentFromRaw(raw) {
    const normalized = normalizeProxyInfo(raw);
    if (!normalized) return null;
    return new HttpsProxyAgent(normalized);
}

function rotateProxySession(raw) {
    const token = `g${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const value = String(raw || '').trim();
    if (!value) return { proxyInfo: '', session: token };

    if (value.startsWith('http://') || value.startsWith('https://')) {
        const updated = value.replace(/(session-)([^:@/]+)/i, `$1${token}`);
        if (updated !== value) return { proxyInfo: updated, session: token };
        return { proxyInfo: value, session: token };
    }

    const parts = value.split(':');
    if (parts.length >= 4) {
        const [ip, port, ...rest] = parts;
        const pass = rest.pop();
        let user = rest.join(':');
        if (/(^|[-_])session[-_]/i.test(user)) {
            user = user.replace(/(session[-_])([^:_-]+)/i, `$1${token}`);
        } else {
            user = `${user}-session-${token}`;
        }
        return { proxyInfo: `${ip}:${port}:${user}:${pass}`, session: token };
    }

    return { proxyInfo: value, session: token };
}

// Resilient axios wrapper: tries up to 3 different proxies before giving up
async function axiosWithRetry(url, extraHeaders = {}, options = {}) {
    const directProxyInfo = options.proxyInfo ? String(options.proxyInfo).trim() : '';
    const maxRetries = directProxyInfo ? 1 : Math.max(rawProxies.length, 1);
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const selectedProxy = directProxyInfo || getNextProxyInfo();
            if (!selectedProxy) throw new Error('No proxy configured for Reddit scraping');
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)',
                    'Accept': 'application/json',
                    ...extraHeaders
                },
                httpsAgent: getProxyAgentFromRaw(selectedProxy),
                timeout: 10000
            });
            if (response.status === 200) return response;
            // If Reddit returns 403/429, try next proxy
            console.warn(`[Proxy] Got ${response.status}, rotating...`);
        } catch (err) {
            lastError = err;
            console.warn(`[Proxy] Request failed (${err.message}), rotating...`);
        }
    }
    throw lastError || new Error('All proxies exhausted');
}

function getRequestProxyInfo(req) {
    const headerProxy = req.headers['x-proxy-info'];
    if (typeof headerProxy === 'string' && headerProxy.trim()) return headerProxy.trim();
    if (typeof req.query.proxyInfo === 'string' && req.query.proxyInfo.trim()) return req.query.proxyInfo.trim();
    return '';
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json()); // Allow JSON body for POST requests
app.use(cors());

app.post('/api/proxy/rotate', (req, res) => {
    const sourceProxy = req.body?.proxyInfo || req.headers['x-proxy-info'] || getNextProxyInfo();
    const rotated = rotateProxySession(sourceProxy);
    res.json(rotated);
});

app.post('/api/proxy/reload', async (req, res) => {
    try {
        const result = await refreshProxyPoolFromApi();
        if (!result.ok) return res.status(400).json(result);
        return res.json({ ok: true, source: proxyPoolSource, count: rawProxies.length, lastProxyPoolRefreshAt });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/proxy/status', async (req, res) => {
    try {
        const selectedProxy = getRequestProxyInfo(req) || getNextProxyInfo();
        const ipRes = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: selectedProxy ? getProxyAgentFromRaw(selectedProxy) : null,
            timeout: 10000,
        });

        res.json({
            ok: true,
            connected: !!selectedProxy,
            currentIp: ipRes?.data?.ip || '',
            poolCount: rawProxies.length,
            source: proxyPoolSource,
            lastProxyPoolRefreshAt,
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            connected: false,
            poolCount: rawProxies.length,
            source: proxyPoolSource,
            lastProxyPoolRefreshAt,
            error: err.message,
        });
    }
});

app.get('/api/proxy/check', async (req, res) => {
    try {
        const proxyInfo = getRequestProxyInfo(req) || getNextProxyInfo();
        const response = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: proxyInfo ? getProxyAgentFromRaw(proxyInfo) : null,
            timeout: 10000,
        });
        res.json({ ok: true, ip: response.data.ip, viaProxy: !!proxyInfo, poolCount: rawProxies.length, source: proxyPoolSource });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message, poolCount: rawProxies.length, source: proxyPoolSource });
    }
});

// Initialize Google Drive API
let drive = null;
const KEY_FILE_PATH = path.join(__dirname, 'service_account.json');
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;

if (SERVICE_ACCOUNT_JSON || fs.existsSync(KEY_FILE_PATH)) {
    try {
        let authOptions;
        if (SERVICE_ACCOUNT_JSON) {
            console.log('[GrowthOS Proxy] Loading Google Drive credentials from Environment Variable');
            authOptions = {
                credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
                scopes: ['https://www.googleapis.com/auth/drive'],
            };
        } else {
            console.log('[GrowthOS Proxy] Loading Google Drive credentials from service_account.json');
            authOptions = {
                keyFile: KEY_FILE_PATH,
                scopes: ['https://www.googleapis.com/auth/drive'],
            };
        }

        const auth = new google.auth.GoogleAuth(authOptions);
        drive = google.drive({ version: 'v3', auth });
        console.log('[GrowthOS Proxy] Google Drive API Initialized');
    } catch (err) {
        console.error('[GrowthOS Proxy] Failed to initialize Google Drive:', err.message);
    }
} else {
    console.warn('[GrowthOS Proxy] No Google Drive credentials found. Use SERVICE_ACCOUNT_JSON env var or service_account.json file.');
}


// Proxy endpoint for Reddit User Scraping
app.get('/api/scrape/user/stats/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const cleanName = username.replace(/^u\//i, '');
        const url = `https://old.reddit.com/user/${cleanName}/about.json`;
        const proxyInfo = getRequestProxyInfo(req);

        const response = await axiosWithRetry(url, {}, { proxyInfo });

        const data = response.data.data;
        const sub = data.subreddit || {};

        // Debug: log raw Reddit profile fields for troubleshooting
        console.log(`[ProfileAudit] ${cleanName} raw fields:`, JSON.stringify({
            icon_img: data.icon_img,
            snoovatar_img: data.snoovatar_img,
            banner_img: sub.banner_img,
            banner_background_image: sub.banner_background_image,
            description: sub.description,
            public_description: sub.public_description,
            title: sub.title,
            display_name: sub.display_name,
            has_verified_email: data.has_verified_email,
            url: sub.url,
            social_links: sub.social_links,
        }, null, 0));

        // Bio: check both description fields
        const bioFull = sub.description || '';
        const bioShort = sub.public_description || '';
        const bioText = bioFull || bioShort;

        // Avatar: custom if snoovatar set, or icon_img is not a Reddit default
        const iconImg = data.icon_img || '';
        const snooImg = data.snoovatar_img || '';
        const isDefaultAvatar = !iconImg || /default/i.test(iconImg) || /avatars\/avatar_default/i.test(iconImg);
        const hasCustomAvatar = snooImg.length > 0 || !isDefaultAvatar;

        // Banner: new Reddit uses banner_background_image, old uses banner_img
        const bannerImg = sub.banner_img || '';
        const bannerBg = (sub.banner_background_image || '').split('?')[0]; // strip query params
        const hasBanner = bannerImg.length > 0 || bannerBg.length > 0;

        // Profile link: social links aren't in about.json — scrape new Reddit profile HTML
        let hasLink = /https?:\/\//i.test(bioText);
        if (!hasLink) {
            try {
                // Fetch directly (no proxy) — residential proxies return 404 for www.reddit.com
                const profileRes = await axios.get(`https://www.reddit.com/user/${cleanName}/`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                    timeout: 8000,
                });
                const html = typeof profileRes.data === 'string' ? profileRes.data : '';
                // Reddit embeds social links in faceplate-tracker elements with noun="social_link"
                hasLink = /noun="social_link"/i.test(html) || /social_link.*"url"\s*:/i.test(html);
                console.log(`[ProfileAudit] ${cleanName} HTML social_link scrape: hasLink=${hasLink}, htmlLen=${html.length}`);
            } catch (e) {
                console.log(`[ProfileAudit] ${cleanName} profile HTML fetch failed: ${e.message}`);
            }
        }
        console.log(`[ProfileAudit] ${cleanName} link detection: hasLink=${hasLink}`);

        res.json({
            name: data.name,
            totalKarma: data.total_karma,
            linkKarma: data.link_karma,
            commentKarma: data.comment_karma,
            created: data.created_utc,
            isGold: data.is_gold,
            isSuspended: data.is_suspended || false,
            // Profile audit fields — pre-computed booleans
            icon_img: iconImg,
            snoovatar_img: snooImg,
            banner_img: bannerImg,
            banner_background_image: bannerBg,
            description: bioText,
            display_name: sub.title || '',
            has_verified_email: data.has_verified_email || false,
            has_profile_link: hasLink,
            has_custom_avatar: hasCustomAvatar,
            has_banner: hasBanner,
        });
    } catch (error) {
        console.error("Account Stats Scrape Error:", error.message);
        res.status(500).json({ error: "Failed to fetch account stats" });
    }
});

app.get('/api/scrape/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const proxyInfo = getRequestProxyInfo(req);
        const response = await axiosWithRetry(`https://old.reddit.com/user/${username}/submitted.json?limit=100`, { 'Accept-Language': 'en-US,en;q=0.9' }, { proxyInfo });
        res.json(response.data);
    } catch (error) {
        console.error("Scraper Error:", error.message);
        if (error.response) {
            return res.status(error.response.status).json({ error: error.response.data || "Reddit API Error" });
        }
        res.status(500).json({ error: "Failed to scrape user profile" });
    }
});



// Proxy endpoint for Subreddit Rules & Flairs
app.get('/api/scrape/subreddit/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const proxyInfo = getRequestProxyInfo(req);
        const [aboutRes, rulesRes] = await Promise.all([
            axiosWithRetry(`https://old.reddit.com/r/${name}/about.json`, {}, { proxyInfo }),
            axiosWithRetry(`https://old.reddit.com/r/${name}/about/rules.json`, {}, { proxyInfo })
        ]);
        const about = aboutRes.data.data;
        const rules = rulesRes.data.rules || [];
        res.json({
            name: about.display_name,
            subscribers: about.subscribers,
            activeUsers: about.accounts_active,
            over18: about.over18,
            postFlairEnabled: about.post_flair_enabled,
            flairRequired: about.post_flair_required,
            rules: rules.map(r => ({
                title: r.short_name,
                description: r.description
            }))
        });
    } catch (error) {
        console.error("Subreddit Discovery Error:", error.message);
        res.status(500).json({ error: "Failed to fetch subreddit data" });
    }
});

// Proxy endpoint for Subreddit Search (By Keyword)
app.get('/api/scrape/search/subreddits', async (req, res) => {
    try {
        const { q } = req.query;
        const proxyInfo = getRequestProxyInfo(req);
        if (!q) return res.status(400).json({ error: "Query required" });
        const response = await axiosWithRetry(`https://old.reddit.com/subreddits/search.json?q=${encodeURIComponent(q)}&limit=50`, {}, { proxyInfo });
        const results = response.data.data.children.map(c => ({
            name: c.data.display_name,
            subscribers: c.data.subscribers,
            description: c.data.public_description,
            over18: c.data.over_18,
            title: c.data.title
        }));
        res.json(results);
    } catch (error) {
        console.error("Subreddit Search Error:", error.message);
        res.status(500).json({ error: "Failed to search subreddits" });
    }
});

// Proxy endpoint for Top Subreddit Titles
app.get('/api/scrape/subreddit/top/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const proxyInfo = getRequestProxyInfo(req);
        const response = await axiosWithRetry(`https://old.reddit.com/r/${name}/top.json?t=month&limit=50`, {}, { proxyInfo });
        const titles = response.data.data?.children?.map(c => c.data.title) || [];
        res.json(titles);
    } catch (error) {
        console.error("Top Titles Scrape Error:", error.message);
        res.status(500).json({ error: "Failed to fetch top titles" });
    }
});

// Resolve Reddit mobile share links (/s/XXXXX) to real post IDs
async function resolveShareLink(shareId, subreddit, proxyInfo = '') {
    try {
        // Follow the redirect from the share URL to get the real URL
        const shareUrl = subreddit
            ? `https://www.reddit.com/r/${subreddit}/s/${shareId}`
            : `https://www.reddit.com/s/${shareId}`;

        const response = await axios.get(shareUrl, {
            headers: { 'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)' },
            httpsAgent: getProxyAgentFromRaw(proxyInfo || getNextProxyInfo()),
            maxRedirects: 5,
            timeout: 10000
        });

        // The final URL after redirects should contain /comments/REAL_ID/
        const finalUrl = response.request?.res?.responseUrl || response.config?.url || '';
        const match = finalUrl.match(/\/comments\/([a-z0-9]+)/i);
        if (match) {
            console.log(`[ShareResolver] Resolved ${shareId} => ${match[1]}`);
            return match[1];
        }
        console.warn(`[ShareResolver] Could not extract post ID from redirected URL: ${finalUrl}`);
        return null;
    } catch (err) {
        console.error(`[ShareResolver] Failed to resolve share link ${shareId}:`, err.message);
        return null;
    }
}

// Proxy endpoint for Live Reddit Post Stats (Upvotes, Status)
// Accepts both standard post IDs (1rd8jg1) and share IDs (aOgafAtLw2)
app.get('/api/scrape/post/:postId', async (req, res) => {
    try {
        let { postId } = req.params;
        const subreddit = req.query.subreddit || '';
        const proxyInfo = getRequestProxyInfo(req);

        // Detect share link IDs (they are longer and contain uppercase)
        const isShareId = /[A-Z]/.test(postId) || postId.length > 8;

        if (isShareId) {
            console.log(`[PostScrape] Detected share ID: ${postId}, resolving...`);
            const realId = await resolveShareLink(postId, subreddit, proxyInfo);
            if (!realId) {
                return res.status(404).json({ error: "Could not resolve share link to real post ID" });
            }
            postId = realId;
        }

        const response = await axiosWithRetry(`https://old.reddit.com/by_id/t3_${postId}.json`, {}, { proxyInfo });

        const postData = response.data.data?.children[0]?.data;
        if (!postData) return res.status(404).json({ error: "Post not found or deleted" });

        res.json({
            ups: postData.ups,
            // NOTE: is_robot_indexable can be false for legitimate posts in some contexts,
            // so we only mark removed on explicit Reddit removal signals.
            removed: postData.removed_by_category !== null || postData.banned_by !== null,
            removed_category: postData.removed_by_category || (postData.banned_by ? 'banned' : null),
            realPostId: postId  // Return the resolved real ID so frontend can update
        });
    } catch (error) {
        console.error("Live Post Scrape Error:", error.message);
        res.status(500).json({ error: "Failed to scrape post stats" });
    }
});

// Google Drive: List files in a folder
app.get('/api/drive/list/:folderId', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { folderId } = req.params;

        // 1. Get the root folder metadata to find its name (default Niche Tag)
        const folderMeta = await drive.files.get({
            fileId: folderId,
            fields: 'name',
            supportsAllDrives: true
        });
        const rootTag = (folderMeta.data.name || 'general').toLowerCase();

        // 2. Recursively walk subfolders so teams can keep niche folders organized
        const foldersToVisit = [{ id: folderId, tag: rootTag }];
        const filesWithTags = [];

        while (foldersToVisit.length > 0) {
            const current = foldersToVisit.shift();
            let pageToken = undefined;

            do {
                const response = await drive.files.list({
                    q: `'${current.id}' in parents and trashed = false`,
                    fields: 'nextPageToken, files(id, name, mimeType, webContentLink, thumbnailLink)',
                    pageSize: 1000,
                    pageToken,
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true
                });

                const files = response.data.files || [];
                for (const f of files) {
                    if (f.mimeType === 'application/vnd.google-apps.folder') {
                        foldersToVisit.push({ id: f.id, tag: (f.name || current.tag || 'general').toLowerCase() });
                        continue;
                    }

                    if (f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')) {
                        filesWithTags.push({
                            ...f,
                            mappedTag: current.tag || rootTag
                        });
                    }
                }

                pageToken = response.data.nextPageToken;
            } while (pageToken);
        }

        res.json(filesWithTags);
    } catch (error) {
        const detail = error?.response?.data?.error?.message || error.message || 'Unknown error';
        const status = Number(error?.code) === 404 ? 404 : (Number(error?.code) === 403 ? 403 : 500);
        console.error("Drive List Error:", detail);
        res.status(status).json({ error: "Failed to list Drive files", detail });
    }
});

// Google Drive: Fast thumbnail endpoint (tiny cached JPEG, ~10KB instead of 2-5MB)
const thumbCache = new Map(); // In-memory cache for thumbnails
app.get('/api/drive/thumb/:fileId', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { fileId } = req.params;

        // Return cached thumbnail if available (instant)
        if (thumbCache.has(fileId)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(thumbCache.get(fileId));
        }

        // Download the file and create a small thumbnail
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const sharp = require('sharp');
        const thumbBuffer = await sharp(Buffer.from(response.data))
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 70 })
            .toBuffer();

        // Cache it for subsequent requests (max 500 thumbnails ~5MB RAM)
        if (thumbCache.size < 500) {
            thumbCache.set(fileId, thumbBuffer);
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(thumbBuffer);
    } catch (error) {
        console.error("Thumb Error:", error.message);
        res.status(500).json({ error: "Failed to generate thumbnail" });
    }
});

// Google Drive: View/stream file inline for browser preview (video/image)
app.get('/api/drive/view/:fileId', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { fileId } = req.params;

        const meta = await drive.files.get({
            fileId,
            fields: 'name,mimeType',
            supportsAllDrives: true
        });

        const response = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const mimeType = meta?.data?.mimeType || 'application/octet-stream';
        const safeName = (meta?.data?.name || fileId).replace(/"/g, '');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        res.send(Buffer.from(response.data));
    } catch (error) {
        console.error("Drive View Error:", error.message);
        res.status(500).json({ error: "Failed to preview Drive file" });
    }
});

// Google Drive: Download a file (with HEIC→JPEG conversion support)
app.get('/api/drive/download/:fileId', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { fileId } = req.params;
        const shouldConvert = req.query.convert === 'true';

        const meta = await drive.files.get({
            fileId,
            fields: 'name,mimeType',
            supportsAllDrives: true
        });
        const sourceName = meta?.data?.name || fileId;
        const sourceMime = (meta?.data?.mimeType || '').toLowerCase();
        const looksLikeHeic = sourceMime.includes('heic') || sourceMime.includes('heif') || /\.hei[cf]$/i.test(sourceName);

        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        res.setHeader('Access-Control-Allow-Origin', '*');

        if (shouldConvert) {
            // Convert HEIC/HEIF to JPEG for iPhone-origin files
            try {
                if (!looksLikeHeic) {
                    res.setHeader('Content-Disposition', `attachment; filename="${sourceName.replace(/"/g, '')}"`);
                    return res.send(Buffer.from(response.data));
                }

                let jpegBuffer;
                try {
                    const sharp = require('sharp');
                    jpegBuffer = await sharp(Buffer.from(response.data))
                        .jpeg({ quality: 90 })
                        .toBuffer();
                } catch (_sharpErr) {
                    const converted = await heicConvert({
                        buffer: Buffer.from(response.data),
                        format: 'JPEG',
                        quality: 0.9
                    });
                    jpegBuffer = Buffer.from(converted);
                }

                const jpgName = sourceName.replace(/\.hei[cf]$/i, '.jpg');
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Content-Disposition', `attachment; filename="${jpgName.replace(/"/g, '')}"`);
                res.send(jpegBuffer);
                console.log(`[Drive] Converted HEIC ${fileId} to JPEG (${jpegBuffer.length} bytes)`);
            } catch (convErr) {
                console.error("HEIC conversion failed:", convErr.message);
                return res.status(422).json({ error: "HEIC conversion failed", detail: convErr.message });
            }
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${sourceName.replace(/"/g, '')}"`);
            res.send(Buffer.from(response.data));
        }
    } catch (error) {
        console.error("Drive Download Error:", error.message);
        res.status(500).json({ error: "Failed to download Drive file" });
    }
});

function inferMimeFromFilename(name = '') {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.m4v')) return 'video/x-m4v';
    if (lower.endsWith('.avi')) return 'video/x-msvideo';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
}

function extractRedgifsUrl(payload) {
    if (!payload) return '';
    if (typeof payload === 'string' && /^https?:\/\//i.test(payload)) return payload;
    if (typeof payload !== 'object') return '';

    const candidates = [
        payload.url,
        payload.permalink,
        payload.gifUrl,
        payload.shareUrl,
        payload.data?.url,
        payload.data?.permalink,
        payload.gif?.url,
        payload.gif?.permalink,
        payload.result?.url,
        payload.result?.permalink,
    ].filter(Boolean);

    return candidates.find(c => /^https?:\/\//i.test(String(c))) || '';
}

// RedGifs upload endpoint (manager-triggered, never automatic)
app.post('/api/redgifs/upload-from-asset', async (req, res) => {
    try {
        const {
            driveFileId = '',
            sourceUrl = '',
            fileName = 'upload.mp4',
            title = '',
            tags = [],
        } = req.body || {};

        if (!driveFileId && !sourceUrl) {
            return res.status(400).json({ error: 'Provide driveFileId or sourceUrl' });
        }

        const uploadEndpoint = (process.env.REDGIFS_UPLOAD_ENDPOINT || '').trim();
        const apiToken = (process.env.REDGIFS_API_TOKEN || '').trim();
        const dryRun = String(process.env.REDGIFS_DRY_RUN || '').toLowerCase() === 'true';

        if (!dryRun && (!uploadEndpoint || !apiToken)) {
            return res.status(400).json({
                error: 'RedGifs backend not configured',
                detail: 'Set REDGIFS_UPLOAD_ENDPOINT and REDGIFS_API_TOKEN (or REDGIFS_DRY_RUN=true)'
            });
        }

        let buffer = null;
        let mimeType = inferMimeFromFilename(fileName);

        if (driveFileId) {
            if (!drive) return res.status(503).json({ error: 'Google Drive not configured on proxy' });

            const meta = await drive.files.get({
                fileId: driveFileId,
                fields: 'name,mimeType',
                supportsAllDrives: true
            });
            const driveMime = meta?.data?.mimeType || '';
            if (driveMime) mimeType = driveMime;

            const fileRes = await drive.files.get(
                { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
                { responseType: 'arraybuffer' }
            );
            buffer = Buffer.from(fileRes.data);
        } else {
            const fileRes = await axios.get(String(sourceUrl), {
                responseType: 'arraybuffer',
                timeout: 30000,
            });
            const contentType = fileRes?.headers?.['content-type'];
            if (contentType) mimeType = String(contentType);
            buffer = Buffer.from(fileRes.data);
        }

        if (!buffer || buffer.length === 0) {
            return res.status(422).json({ error: 'Asset payload is empty' });
        }

        if (dryRun) {
            return res.json({
                success: true,
                url: `https://redgifs.com/watch/mock-${Date.now()}`,
                dryRun: true,
            });
        }

        const form = new FormData();
        const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
        form.append('file', blob, String(fileName || 'upload.mp4').replace(/[^a-zA-Z0-9._-]/g, '_'));
        if (title) form.append('title', String(title).slice(0, 200));
        if (Array.isArray(tags) && tags.length > 0) {
            form.append('tags', tags.filter(Boolean).join(','));
        }

        const upstream = await fetch(uploadEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
            },
            body: form,
        });

        const upstreamText = await upstream.text();
        let upstreamPayload = null;
        try {
            upstreamPayload = JSON.parse(upstreamText);
        } catch {
            upstreamPayload = { raw: upstreamText };
        }

        if (!upstream.ok) {
            return res.status(502).json({
                error: 'RedGifs upload failed',
                detail: upstreamPayload,
                status: upstream.status,
            });
        }

        const url = extractRedgifsUrl(upstreamPayload);
        if (!url) {
            return res.status(502).json({
                error: 'RedGifs upload succeeded but no URL returned',
                detail: upstreamPayload,
            });
        }

        return res.json({ success: true, url, payload: upstreamPayload });
    } catch (err) {
        console.error('RedGifs Upload Error:', err.message);
        return res.status(500).json({ error: 'Failed RedGifs upload', detail: err.message });
    }
});

// Google Drive: Move file to "Used" folder
app.post('/api/drive/move', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { fileId, targetFolderId } = req.body;
        if (!fileId || !targetFolderId) return res.status(400).json({ error: "Missing fileId or targetFolderId" });

        // Retrieve the existing parents to remove
        const file = await drive.files.get({
            fileId: fileId,
            fields: 'parents',
            supportsAllDrives: true
        });
        const previousParents = file.data.parents ? file.data.parents.join(',') : '';

        // Move the file to the new folder
        await drive.files.update({
            fileId: fileId,
            addParents: targetFolderId,
            removeParents: previousParents,
            fields: 'id, parents',
            supportsAllDrives: true
        });

        res.json({ success: true, message: "File moved successfully" });
    } catch (error) {
        console.error("Drive Move Error:", error.message);
        res.status(500).json({ error: "Failed to move Drive file" });
    }
});

// Proxy endpoint for AI Generation (Bypasses Browser CORS / Preflight blocks)
app.post('/api/ai/generate', async (req, res) => {
    try {
        const { aiBaseUrl, apiKey, model, messages, temperature, presence_penalty } = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: "No API Key provided to proxy." });
        }

        const targetUrl = aiBaseUrl || "https://openrouter.ai/api/v1";

        // Always append /chat/completions if missing
        const completetionsUrl = targetUrl.endsWith('/chat/completions')
            ? targetUrl
            : `${targetUrl.replace(/\/$/, '')}/chat/completions`;

        const response = await axios.post(completetionsUrl, {
            model: model || "mistralai/mixtral-8x7b-instruct",
            messages: messages,
            ...(temperature !== undefined && { temperature }),
            ...(presence_penalty !== undefined && { presence_penalty })
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://js-reddit-growth-os.vercel.app/', // Required by OpenRouter
                'X-Title': 'js-reddit-growth-os'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error("AI Proxy Error:", error.message, error.response?.data);
        res.status(500).json({
            error: "Failed proxy AI generation connect",
            details: error.response?.data || error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`[GrowthOS Proxy] Scraper Engine running on http://localhost:${PORT}`);
    if (proxyPoolApiUrl) {
        refreshProxyPoolFromApi()
            .then(result => {
                if (result.ok) console.log(`[ProxyPool] Loaded ${result.count} proxies from API`);
                else console.warn(`[ProxyPool] API load skipped: ${result.reason}`);
            })
            .catch(err => console.warn(`[ProxyPool] API load failed: ${err.message}`));
    }
});
