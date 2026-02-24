const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'proxy', 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

// Replace all User-Agents uniformly
code = code.replace(
    /'Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/120\.120\.120\.120 Safari\/537\.36'/g,
    "'GrowthOS/1.0 (Internal Analytics Tool)'"
);

// Delete the second duplicate route block entirely
const duplicateRegex = /\/\/ Proxy endpoint for Live Reddit Post Stats.*?\}\);\n/s;
code = code.replace(duplicateRegex, '');

fs.writeFileSync(serverFile, code);
console.log('Fixed proxy!');
