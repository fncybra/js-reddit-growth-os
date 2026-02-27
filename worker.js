// Cloudflare Worker to serve static assets with SPA routing
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const workerVersion = 'spa-fallback-v3';

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
