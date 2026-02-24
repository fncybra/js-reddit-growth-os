const axios = require('axios');

async function test() {
    try {
        console.log("Testing direct proxy...");
        const res = await axios.post('https://js-reddit-proxy-production.up.railway.app/api/ai/generate', {
            aiBaseUrl: 'https://openrouter.ai/api/v1',
            apiKey: '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',
            model: 'sao10k/l3.1-euryale-70b',
            messages: [{ role: 'user', content: 'Say hello' }]
        });
        console.log("Success:", res.data);
    } catch (e) {
        console.error("Failed:", e.response?.data || e.message);
    }
}
test();
