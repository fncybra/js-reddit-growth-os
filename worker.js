const REDDIT_HEADERS = {
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
};

const SAFE_USERNAME = /^[a-zA-Z0-9_-]{1,30}$/;
const SAFE_SUBREDDIT = /^[a-zA-Z0-9_]{1,30}$/;
const ALLOWED_SUBREDDIT_SORTS = new Set(['hot', 'new', 'top']);
const ALLOWED_USER_SORTS = new Set(['new', 'hot', 'top', 'controversial']);
const ALLOWED_TIME_WINDOWS = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

function corsHeaders(extra = {}) {
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type,x-api-token',
        ...extra,
    };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders({
            'content-type': 'application/json; charset=UTF-8',
            ...extraHeaders,
        }),
    });
}

function textResponse(body, status = 200, extraHeaders = {}) {
    return new Response(body, {
        status,
        headers: corsHeaders(extraHeaders),
    });
}

function requireAuth(request, env) {
    const expected = String(env.PROXY_API_TOKEN || '').trim();
    if (!expected) return null;
    const provided = String(request.headers.get('x-api-token') || '').trim();
    if (provided === expected) return null;
    return jsonResponse({ error: 'Unauthorized' }, 401);
}

function toBoundedInt(value, fallback, min, max) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

async function fetchJson(url) {
    return fetch(url, {
        method: 'GET',
        headers: REDDIT_HEADERS,
        redirect: 'follow',
    });
}

async function resolveShareLink(shareId, subreddit = '') {
    const shareUrl = subreddit
        ? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/s/${shareId}`
        : `https://www.reddit.com/s/${shareId}`;
    const response = await fetch(shareUrl, { method: 'GET', redirect: 'follow' });
    const finalUrl = String(response.url || '');
    const match = finalUrl.match(/\/comments\/([a-z0-9]+)/i);
    return match?.[1] || null;
}

async function handleScrapeFallback(request, url, env) {
    if (request.method === 'OPTIONS') {
        return textResponse('', 204);
    }

    const authFailure = requireAuth(request, env);
    if (authFailure) return authFailure;

    const pathname = url.pathname;

    if (pathname === '/api/proxy/status' || pathname === '/api/proxy/check') {
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipRes.json().catch(() => ({}));
            return jsonResponse({
                ok: true,
                connected: true,
                viaFallback: true,
                currentIp: ipData.ip || '',
                poolCount: 0,
                source: 'cloudflare-worker-direct',
            });
        } catch (err) {
            return jsonResponse({
                ok: false,
                connected: false,
                viaFallback: true,
                poolCount: 0,
                source: 'cloudflare-worker-direct',
                error: err?.message || String(err),
            }, 500);
        }
    }

    if (pathname.startsWith('/api/scrape/user/stats/')) {
        const username = decodeURIComponent(pathname.split('/').pop() || '').replace(/^u\//i, '');
        if (!SAFE_USERNAME.test(username)) return jsonResponse({ error: 'Invalid username' }, 400);

        const aboutRes = await fetchJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
        if (!aboutRes.ok) return jsonResponse({ error: 'Failed to fetch account stats' }, aboutRes.status);

        const aboutPayload = await aboutRes.json().catch(() => ({}));
        const data = aboutPayload?.data;
        if (!data?.name) return jsonResponse({ error: 'Account not found' }, 404);

        const sub = data.subreddit || {};
        const bioFull = sub.description || '';
        const bioShort = sub.public_description || '';
        const bioText = bioFull || bioShort;
        const iconImg = data.icon_img || '';
        const snooImg = data.snoovatar_img || '';
        const bannerImg = sub.banner_img || '';
        const bannerBg = String(sub.banner_background_image || '').split('?')[0];
        const isDefaultAvatar = !iconImg || /default/i.test(iconImg) || /avatars\/avatar_default/i.test(iconImg);
        const hasCustomAvatar = !!snooImg || !isDefaultAvatar;
        const hasBanner = !!bannerImg || !!bannerBg;

        let hasLink = /https?:\/\//i.test(bioText);
        if (!hasLink) {
            try {
                const profileRes = await fetch(`https://www.reddit.com/user/${encodeURIComponent(username)}/`, {
                    method: 'GET',
                    redirect: 'follow',
                });
                const html = await profileRes.text();
                hasLink = /noun="social_link"/i.test(html) || /social_link.*"url"\s*:/i.test(html);
            } catch {
                hasLink = false;
            }
        }

        return jsonResponse({
            name: data.name,
            totalKarma: data.total_karma,
            linkKarma: data.link_karma,
            commentKarma: data.comment_karma,
            created: data.created_utc,
            isGold: data.is_gold,
            isSuspended: data.is_suspended || false,
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
    }

    if (pathname.startsWith('/api/scrape/user/')) {
        const username = decodeURIComponent(pathname.split('/').pop() || '');
        if (!SAFE_USERNAME.test(username)) return jsonResponse({ error: 'Invalid username' }, 400);

        const limit = toBoundedInt(url.searchParams.get('limit'), 100, 1, 100);
        const sort = ALLOWED_USER_SORTS.has(String(url.searchParams.get('sort') || '').toLowerCase())
            ? String(url.searchParams.get('sort')).toLowerCase()
            : 'new';
        const after = String(url.searchParams.get('after') || '').trim();
        const timeWindow = ALLOWED_TIME_WINDOWS.has(String(url.searchParams.get('t') || '').toLowerCase())
            ? String(url.searchParams.get('t')).toLowerCase()
            : 'week';
        const params = new URLSearchParams({ limit: String(limit), sort });
        if (after) params.set('after', after);
        if (sort === 'top' || sort === 'controversial') params.set('t', timeWindow);

        const response = await fetchJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?${params.toString()}`);
        const payload = await response.text();
        return textResponse(payload, response.status, { 'content-type': 'application/json; charset=UTF-8' });
    }

    if (pathname.startsWith('/api/scrape/subreddit/posts/')) {
        const name = decodeURIComponent(pathname.split('/').pop() || '');
        if (!SAFE_SUBREDDIT.test(name)) return jsonResponse({ error: 'Invalid subreddit name' }, 400);

        const sort = ALLOWED_SUBREDDIT_SORTS.has(String(url.searchParams.get('sort') || '').toLowerCase())
            ? String(url.searchParams.get('sort')).toLowerCase()
            : 'hot';
        const limit = toBoundedInt(url.searchParams.get('limit'), 25, 1, 100);
        const timeWindow = ALLOWED_TIME_WINDOWS.has(String(url.searchParams.get('t') || '').toLowerCase())
            ? String(url.searchParams.get('t')).toLowerCase()
            : 'week';
        const params = new URLSearchParams({ limit: String(limit) });
        if (sort === 'top') params.set('t', timeWindow);

        const response = await fetchJson(`https://www.reddit.com/r/${encodeURIComponent(name)}/${sort}.json?${params.toString()}`);
        const payload = await response.text();
        return textResponse(payload, response.status, { 'content-type': 'application/json; charset=UTF-8' });
    }

    if (pathname.startsWith('/api/scrape/subreddit/top/')) {
        const name = decodeURIComponent(pathname.split('/').pop() || '');
        if (!SAFE_SUBREDDIT.test(name)) return jsonResponse({ error: 'Invalid subreddit name' }, 400);

        const response = await fetchJson(`https://www.reddit.com/r/${encodeURIComponent(name)}/top.json?t=month&limit=50`);
        if (!response.ok) return jsonResponse({ error: 'Failed to fetch top titles' }, response.status);
        const payload = await response.json().catch(() => ({}));
        const titles = payload?.data?.children?.map((child) => child?.data?.title).filter(Boolean) || [];
        return jsonResponse(titles);
    }

    if (pathname.startsWith('/api/scrape/subreddit/')) {
        const name = decodeURIComponent(pathname.split('/').pop() || '');
        if (!SAFE_SUBREDDIT.test(name)) return jsonResponse({ error: 'Invalid subreddit name' }, 400);

        const [aboutRes, rulesRes] = await Promise.all([
            fetchJson(`https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`),
            fetchJson(`https://www.reddit.com/r/${encodeURIComponent(name)}/about/rules.json`),
        ]);
        if (!aboutRes.ok || !rulesRes.ok) {
            return jsonResponse({ error: 'Failed to fetch subreddit data' }, !aboutRes.ok ? aboutRes.status : rulesRes.status);
        }

        const aboutPayload = await aboutRes.json().catch(() => ({}));
        const rulesPayload = await rulesRes.json().catch(() => ({}));
        const about = aboutPayload?.data || {};
        const rules = rulesPayload?.rules || [];

        return jsonResponse({
            name: about.display_name,
            subscribers: about.subscribers,
            activeUsers: about.accounts_active,
            over18: about.over18,
            postFlairEnabled: about.post_flair_enabled,
            flairRequired: about.post_flair_required,
            rules: rules.map((rule) => ({
                title: rule.short_name,
                description: rule.description,
            })),
        });
    }

    if (pathname === '/api/scrape/search/subreddits') {
        const q = String(url.searchParams.get('q') || '').trim();
        if (!q) return jsonResponse({ error: 'Query required' }, 400);

        const response = await fetchJson(`https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(q)}&limit=50`);
        if (!response.ok) return jsonResponse({ error: 'Failed to search subreddits' }, response.status);
        const payload = await response.json().catch(() => ({}));
        const results = payload?.data?.children?.map((child) => ({
            name: child?.data?.display_name,
            subscribers: child?.data?.subscribers,
            description: child?.data?.public_description,
            over18: child?.data?.over_18,
            title: child?.data?.title,
        })).filter((item) => item?.name) || [];
        return jsonResponse(results);
    }

    if (pathname.startsWith('/api/scrape/post/')) {
        let postId = decodeURIComponent(pathname.split('/').pop() || '');
        const subreddit = String(url.searchParams.get('subreddit') || '').trim();
        const isShareId = /[A-Z]/.test(postId) || postId.length > 8;
        if (isShareId) {
            const realId = await resolveShareLink(postId, subreddit);
            if (!realId) return jsonResponse({ error: 'Could not resolve share link to real post ID' }, 404);
            postId = realId;
        }

        const response = await fetchJson(`https://www.reddit.com/by_id/t3_${encodeURIComponent(postId)}.json`);
        if (!response.ok) return jsonResponse({ error: 'Failed to scrape post stats' }, response.status);
        const payload = await response.json().catch(() => ({}));
        const postData = payload?.data?.children?.[0]?.data;
        if (!postData) return jsonResponse({ error: 'Post not found or deleted' }, 404);

        return jsonResponse({
            ups: postData.ups,
            removed: postData.removed_by_category !== null || postData.banned_by !== null,
            removed_category: postData.removed_by_category || (postData.banned_by ? 'banned' : null),
            realPostId: postId,
        });
    }

    return null;
}

// Cloudflare Worker to serve static assets with SPA routing
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const workerVersion = 'spa-fallback-v3';

        if (url.pathname.startsWith('/api/proxy/') || url.pathname.startsWith('/api/scrape/')) {
            const apiResponse = await handleScrapeFallback(request, url, env);
            if (apiResponse) {
                apiResponse.headers.set('x-growthos-worker', workerVersion);
                apiResponse.headers.set('x-growthos-scrape-fallback', 'cloudflare-worker');
                return apiResponse;
            }
        }

        if (url.pathname === '/api/redgifs/upload-from-asset' && request.method === 'POST') {
            try {
                const body = await request.json();
                const driveFileId = String(body?.driveFileId || '').trim();
                const sourceUrl = String(body?.sourceUrl || '').trim();
                const proxyUrl = String(body?.proxyUrl || '').trim();
                const fileName = String(body?.fileName || 'upload.mp4');
                const title = String(body?.title || '').trim();
                const tags = Array.isArray(body?.tags) ? body.tags.filter(Boolean).map(String) : [];
                const bodyUploadEndpoint = String(body?.redgifsUploadEndpoint || '').trim();
                const bodyApiToken = String(body?.redgifsApiToken || '').trim();

                let resolvedSource = sourceUrl;
                if (!resolvedSource && driveFileId && proxyUrl) {
                    resolvedSource = `${proxyUrl.replace(/\/$/, '')}/api/drive/download/${driveFileId}`;
                }
                if (!resolvedSource) {
                    return Response.json({ error: 'Missing sourceUrl (or driveFileId + proxyUrl)' }, { status: 400 });
                }

                const srcRes = await fetch(resolvedSource);
                if (!srcRes.ok) {
                    return Response.json({ error: `Failed to fetch source media (${srcRes.status})` }, { status: 502 });
                }
                const mediaBlob = await srcRes.blob();

                const dryRun = String(env.REDGIFS_DRY_RUN || '').toLowerCase() === 'true';
                if (dryRun) {
                    return Response.json({
                        success: true,
                        dryRun: true,
                        url: `https://redgifs.com/watch/mock-${Date.now()}`
                    });
                }

                const uploadEndpoint = bodyUploadEndpoint || String(env.REDGIFS_UPLOAD_ENDPOINT || '').trim();
                const apiToken = bodyApiToken || String(env.REDGIFS_API_TOKEN || '').trim();
                if (!uploadEndpoint || !apiToken) {
                    return Response.json({ error: 'RedGifs not configured for this model (or worker fallback)' }, { status: 400 });
                }

                const form = new FormData();
                form.append('file', mediaBlob, fileName.replace(/[^a-zA-Z0-9._-]/g, '_'));
                if (title) form.append('title', title.slice(0, 200));
                if (tags.length > 0) form.append('tags', tags.join(','));

                const upRes = await fetch(uploadEndpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                    },
                    body: form,
                });

                const txt = await upRes.text();
                let data = null;
                try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

                if (!upRes.ok) {
                    return Response.json({ error: 'RedGifs upload failed', detail: data, status: upRes.status }, { status: 502 });
                }

                const candidate = data?.url || data?.permalink || data?.gifUrl || data?.shareUrl || data?.data?.url || data?.gif?.url || '';
                if (!candidate) {
                    return Response.json({ error: 'Upload response missing URL', detail: data }, { status: 502 });
                }

                return Response.json({ success: true, url: candidate, payload: data });
            } catch (err) {
                return Response.json({ error: 'Upload handler failed', detail: err?.message || String(err) }, { status: 500 });
            }
        }

        const isNavigation = request.method === 'GET' && !url.pathname.includes('.');
        const isAssetPath = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/favicon');

        if (isNavigation && !isAssetPath) {
            const rootUrl = new URL('/', request.url);
            const navResponse = await env.ASSETS.fetch(new Request(rootUrl, request));
            const taggedResponse = new Response(navResponse.body, navResponse);
            taggedResponse.headers.set('x-growthos-worker', workerVersion);
            taggedResponse.headers.set('cache-control', 'no-store, no-cache, must-revalidate');
            return taggedResponse;
        }

        // Try to serve the asset directly
        const response = await env.ASSETS.fetch(request);

        // If asset not found (404), serve index.html for SPA routing
        if (response.status === 404) {
            const indexUrl = new URL('/index.html', request.url);
            return env.ASSETS.fetch(new Request(indexUrl, request));
        }

        const taggedResponse = new Response(response.body, response);
        taggedResponse.headers.set('x-growthos-worker', workerVersion);
        if (url.pathname === '/' || url.pathname === '/index.html') {
            taggedResponse.headers.set('cache-control', 'no-store, no-cache, must-revalidate');
        }
        return taggedResponse;
    }
};
