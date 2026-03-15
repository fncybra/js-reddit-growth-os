/* global process */
import { spawn } from 'child_process';
import net from 'net';
import puppeteer from 'puppeteer';

const baseUrl = process.env.STRESS_BASE_URL || 'http://127.0.0.1:5173/#/reddit';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parsed = new URL(baseUrl.replace('/#/', '/'));

async function waitForPort(host, port, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ok = await new Promise((resolve) => {
            const socket = net.createConnection({ host, port }, () => {
                socket.end();
                resolve(true);
            });
            socket.on('error', () => resolve(false));
        });
        if (ok) return;
        await delay(500);
    }
    throw new Error(`Timed out waiting for ${host}:${port}`);
}

async function main() {
    let devServer = null;
    if (!process.env.STRESS_BASE_URL) {
        devServer = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', String(parsed.port || 5173)], {
            shell: true,
            stdio: 'inherit',
        });
        await waitForPort(parsed.hostname, Number(parsed.port || 5173));
    }

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    page.on('console', (msg) => {
        const text = msg.text();
        if (text) console.log(`[browser:${msg.type()}] ${text}`);
    });
    page.on('pageerror', (err) => {
        console.error(`[pageerror] ${err.message}`);
    });

    try {
        console.log(`Opening ${baseUrl}`);
        await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await delay(1500);

        const summary = await page.evaluate(async () => {
            const mod = await import('/src/tests/redditStressSuite.js');
            return mod.runRedditStressSuite();
        });

        console.log('\nReddit stress summary');
        console.log(JSON.stringify(summary, null, 2));

        if (summary.failed > 0) {
            process.exitCode = 1;
        }
    } finally {
        await browser.close();
        if (devServer) {
            devServer.kill();
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
