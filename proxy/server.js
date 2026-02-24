const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');


const { HttpsProxyAgent } = require('https-proxy-agent');

// Only verified-working proxies (tested 2026-02-24)
const rawProxies = [
    "198.23.239.134:6540:cdlljwsf:3xtolj60p8g7",
    "107.172.163.27:6543:cdlljwsf:3xtolj60p8g7",
    "216.10.27.159:6837:cdlljwsf:3xtolj60p8g7"
];

let proxyIndex = 0;
function getNextProxyAgent() {
    const raw = rawProxies[proxyIndex % rawProxies.length];
    proxyIndex++;
    const [ip, port, user, pass] = raw.split(':');
    const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
    console.log(`[Proxy] Using ${ip}:${port}`);
    return new HttpsProxyAgent(proxyUrl);
}

// Resilient axios wrapper: tries up to 3 different proxies before giving up
async function axiosWithRetry(url, extraHeaders = {}) {
    const maxRetries = rawProxies.length;
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)',
                    'Accept': 'application/json',
                    ...extraHeaders
                },
                httpsAgent: getNextProxyAgent(),
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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json()); // Allow JSON body for POST requests
app.use(cors());

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

        const response = await axiosWithRetry(url);

        const data = response.data.data;
        res.json({
            name: data.name,
            totalKarma: data.total_karma,
            linkKarma: data.link_karma,
            commentKarma: data.comment_karma,
            created: data.created_utc,
            isGold: data.is_gold,
            isSuspended: data.is_suspended || false
        });
    } catch (error) {
        console.error("Account Stats Scrape Error:", error.message);
        res.status(500).json({ error: "Failed to fetch account stats" });
    }
});

app.get('/api/scrape/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const response = await axiosWithRetry(`https://old.reddit.com/user/${username}/submitted.json?limit=100`, { 'Accept-Language': 'en-US,en;q=0.9' });
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
        const [aboutRes, rulesRes] = await Promise.all([
            axiosWithRetry(`https://old.reddit.com/r/${name}/about.json`),
            axiosWithRetry(`https://old.reddit.com/r/${name}/about/rules.json`)
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
        if (!q) return res.status(400).json({ error: "Query required" });
        const response = await axiosWithRetry(`https://old.reddit.com/subreddits/search.json?q=${encodeURIComponent(q)}&limit=50`);
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
        const response = await axiosWithRetry(`https://old.reddit.com/r/${name}/top.json?t=month&limit=50`);
        const titles = response.data.data?.children?.map(c => c.data.title) || [];
        res.json(titles);
    } catch (error) {
        console.error("Top Titles Scrape Error:", error.message);
        res.status(500).json({ error: "Failed to fetch top titles" });
    }
});

// Resolve Reddit mobile share links (/s/XXXXX) to real post IDs
async function resolveShareLink(shareId, subreddit) {
    try {
        // Follow the redirect from the share URL to get the real URL
        const shareUrl = subreddit
            ? `https://www.reddit.com/r/${subreddit}/s/${shareId}`
            : `https://www.reddit.com/s/${shareId}`;

        const response = await axios.get(shareUrl, {
            headers: { 'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)' },
            httpsAgent: getNextProxyAgent(),
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

        // Detect share link IDs (they are longer and contain uppercase)
        const isShareId = /[A-Z]/.test(postId) || postId.length > 8;

        if (isShareId) {
            console.log(`[PostScrape] Detected share ID: ${postId}, resolving...`);
            const realId = await resolveShareLink(postId, subreddit);
            if (!realId) {
                return res.status(404).json({ error: "Could not resolve share link to real post ID" });
            }
            postId = realId;
        }

        const response = await axiosWithRetry(`https://old.reddit.com/by_id/t3_${postId}.json`);

        const postData = response.data.data?.children[0]?.data;
        if (!postData) return res.status(404).json({ error: "Post not found or deleted" });

        res.json({
            ups: postData.ups,
            removed: postData.removed_by_category !== null || postData.banned_by !== null || postData.is_robot_indexable === false,
            removed_category: postData.removed_by_category || (!postData.is_robot_indexable ? 'shadowban/spam_filter' : null),
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

        // 1. Get the folder metadata to find its name (this becomes our Niche Tag)
        const folderMeta = await drive.files.get({
            fileId: folderId,
            fields: 'name'
        });
        const folderName = folderMeta.data.name;

        // 2. List the files
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
            fields: 'files(id, name, mimeType, webContentLink, thumbnailLink)',
        });

        // 3. Map the folder name to each file so the frontend can auto-tag them
        const filesWithTags = response.data.files.map(f => ({
            ...f,
            mappedTag: folderName.toLowerCase()
        }));

        res.json(filesWithTags);
    } catch (error) {
        console.error("Drive List Error:", error.message);
        res.status(500).json({ error: "Failed to list Drive files" });
    }
});

// Google Drive: Download a file (for HEIC conversions on frontend)
app.get('/api/drive/download/:fileId', async (req, res) => {
    if (!drive) return res.status(503).json({ error: "Google Drive not configured" });

    try {
        const { fileId } = req.params;
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'stream' }
        );
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`);
        response.data.pipe(res);
    } catch (error) {
        console.error("Drive Download Error:", error.message);
        res.status(500).json({ error: "Failed to download Drive file" });
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
        });
        const previousParents = file.data.parents ? file.data.parents.join(',') : '';

        // Move the file to the new folder
        await drive.files.update({
            fileId: fileId,
            addParents: targetFolderId,
            removeParents: previousParents,
            fields: 'id, parents',
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
        const { aiBaseUrl, apiKey, model, messages } = req.body;

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
            messages: messages
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
});
