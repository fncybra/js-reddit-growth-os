// Cloudflare Worker to serve static assets with SPA routing
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

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
