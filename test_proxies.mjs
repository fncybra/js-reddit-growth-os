import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

const rawProxies = [
    "31.59.20.176:6754:cdlljwsf:3xtolj60p8g7",
    "23.95.150.145:6114:cdlljwsf:3xtolj60p8g7",
    "198.23.239.134:6540:cdlljwsf:3xtolj60p8g7",
    "45.38.107.97:6014:cdlljwsf:3xtolj60p8g7",
    "107.172.163.27:6543:cdlljwsf:3xtolj60p8g7",
    "198.105.121.200:6462:cdlljwsf:3xtolj60p8g7",
    "64.137.96.74:6641:cdlljwsf:3xtolj60p8g7",
    "216.10.27.159:6837:cdlljwsf:3xtolj60p8g7",
    "142.111.67.146:5611:cdlljwsf:3xtolj60p8g7",
    "23.26.53.37:6003:cdlljwsf:3xtolj60p8g7"
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
