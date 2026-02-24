const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'proxy', 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

const proxyList = `
const { HttpsProxyAgent } = require('https-proxy-agent');
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
