const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'proxy', 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

const regex = /const response = await axios\.get\(`https:\/\/old\.reddit\.com\/user\/\$\{username\}\/submitted\.json\?limit=100`, \{\s*headers: \{\s*'User-Agent': 'GrowthOS\/1\.0 \(Internal Analytics Tool\)',\s*'Accept': 'application\/json',\s*'Accept-Language': 'en-US,en;q=0\.9'\s*\}\s*\}\);/m;

const replacement = `const config = getAxiosConfig();
        config.headers['Accept-Language'] = 'en-US,en;q=0.9';
        const response = await axios.get(\`https://old.reddit.com/user/\${username}/submitted.json?limit=100\`, config);`;

code = code.replace(regex, replacement);

fs.writeFileSync(serverFile, code);
console.log('Fixed regex.');
