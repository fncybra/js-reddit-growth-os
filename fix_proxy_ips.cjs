const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'proxy', 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

const proxyList = `
const { HttpsProxyAgent } = require('https-proxy-agent');
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

function getRandomProxyAgent() {
    const raw = rawProxies[Math.floor(Math.random() * rawProxies.length)];
    const [ip, port, user, pass] = raw.split(':');
    const proxyUrl = \`http://\${user}:\${pass}@\${ip}:\${port}\`;
    return new HttpsProxyAgent(proxyUrl);
}

const getAxiosConfig = () => ({
    headers: {
        'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)',
        'Accept': 'application/json'
    },
    httpsAgent: getRandomProxyAgent()
});
`;

if (!code.includes("getRandomProxyAgent")) {
    const lines = code.split('\n');
    lines.splice(7, 0, proxyList);
    code = lines.join('\n');
}

// Replace all hardcoded axios objects:
// { headers: { 'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)', 'Accept': 'application/json' } }
// with getAxiosConfig()
code = code.replace(/\{\s*headers:\s*\{\s*'User-Agent':\s*'GrowthOS\/1\.0 \(Internal Analytics Tool\)',\s*'Accept':\s*'application\/json'\s*\}\s*\}/g, 'getAxiosConfig()');


fs.writeFileSync(serverFile, code);
console.log('Fixed proxy with new Webshare arrays.');
