import fs from 'fs';
import { spawn } from 'child_process';

const val = fs.readFileSync('C:/Users/User/Downloads/sa_oneline.txt', 'utf8').trim();
console.log('Value length:', val.length);

const proc = spawn('npx', ['vercel', 'env', 'add', 'SERVICE_ACCOUNT_JSON', 'production'], {
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
});

proc.stdin.write(val + '\n');
proc.stdin.end();

proc.on('close', (code) => {
    console.log('Done. Exit code:', code);
});
