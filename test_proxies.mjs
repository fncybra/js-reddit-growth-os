import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

const rawProxies = [
    "31.59.20.176:6754:REDACTED_PROXY_CREDS",
    "23.95.150.145:6114:REDACTED_PROXY_CREDS",
    "REDACTED_PROXY_1",
    "45.38.107.97:6014:REDACTED_PROXY_CREDS",
    "REDACTED_PROXY_2",
    "198.105.121.200:6462:REDACTED_PROXY_CREDS",
    "64.137.96.74:6641:REDACTED_PROXY_CREDS",
    "REDACTED_PROXY_3",
    "142.111.67.146:5611:REDACTED_PROXY_CREDS",
    "23.26.53.37:6003:REDACTED_PROXY_CREDS"
];

async function testProxy(raw) {
    const [ip, port, user, pass] = raw.split(':');
    const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    try {
        const res = await fetch('https://old.reddit.com/user/spez/about.json', {
            agent,
            headers: { 'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });
        const ok = res.status === 200;
        console.log(`${ok ? '✅' : '❌'} ${ip}:${port} => Status: ${res.status}`);
        return ok;
    } catch (e) {
        console.log(`❌ ${ip}:${port} => FAILED: ${e.message}`);
        return false;
    }
}

console.log("Testing ALL 10 proxy IPs against Reddit...\n");
const working = [];
for (let i = 0; i < rawProxies.length; i++) {
    const ok = await testProxy(rawProxies[i]);
    if (ok) working.push(rawProxies[i]);
}
console.log(`\n${working.length} / ${rawProxies.length} proxies work.`);
console.log("\nWorking proxies:");
working.forEach(p => console.log(`  "${p}"`));
