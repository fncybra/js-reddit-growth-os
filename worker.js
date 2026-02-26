// Cloudflare Worker to serve static assets with SPA routing
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const workerVersion = 'spa-fallback-v3';

        const isNavigation = request.method === 'GET' && !url.pathname.includes('.');
        const isAssetPath = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/favicon');

        if (isNavigation && !isAssetPath) {
            const rootUrl = new URL('/', request.url);
            const navResponse = await env.ASSETS.fetch(new Request(rootUrl, request));
            const taggedResponse = new Response(navResponse.body, navResponse);
            taggedResponse.headers.set('x-growthos-worker', workerVersion);
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
        return taggedResponse;
    }
};
