// Cloudflare Worker to serve static assets with SPA routing
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        const isNavigation = request.method === 'GET' && !url.pathname.includes('.');
        const isAssetPath = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/favicon');

        if (isNavigation && !isAssetPath) {
            const rootUrl = new URL('/', request.url);
            return env.ASSETS.fetch(new Request(rootUrl, request));
        }

        // Try to serve the asset directly
        const response = await env.ASSETS.fetch(request);

        // If asset not found (404), serve index.html for SPA routing
        if (response.status === 404) {
            const indexUrl = new URL('/index.html', request.url);
            return env.ASSETS.fetch(new Request(indexUrl, request));
        }

        return response;
    }
};
