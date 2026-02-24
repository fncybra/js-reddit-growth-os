import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

const raw = "198.23.239.134:6540:cdlljwsf:3xtolj60p8g7";
const [ip, port, user, pass] = raw.split(':');
const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
const agent = new HttpsProxyAgent(proxyUrl);

async function resolve(shareId, subreddit) {
    const url = `https://www.reddit.com/r/${subreddit}/s/${shareId}`;
    console.log("Fetching:", url);

    const resp = await axios.get(url, {
        headers: { 'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)' },
        httpsAgent: agent,
        maxRedirects: 5,
        timeout: 15000
    });

    const finalUrl = resp.request?.res?.responseUrl || '';
    console.log("Final URL:", finalUrl);

    const match = finalUrl.match(/\/comments\/([a-z0-9]+)/i);
    if (match) {
        console.log("Resolved post ID:", match[1]);
    } else {
        console.log("Could not extract ID. Response URL:", finalUrl);
        console.log("Status:", resp.status);
    }
}

resolve("aOgafAtLw2", "pregnantporn");
