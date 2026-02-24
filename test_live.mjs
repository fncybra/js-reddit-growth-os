import puppeteer from 'puppeteer';

const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log("Starting debug on live site...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    let logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[PAGE ERROR] ${err.toString()}`));

    await page.goto('https://js-reddit-growth-os.vercel.app/settings');
    await delay(2000);

    // Set OpenRouter Key
    const inputs = await page.$$('input[type="password"]');
    for (let input of inputs) {
        const ph = await page.evaluate(el => el.placeholder, input);
        if (ph && ph.includes('sk-or')) {
            await input.type('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');
        }
    }

    const btns = await page.$$('button');
    for (let b of btns) {
        const t = await page.evaluate(el => el.textContent, b);
        if (t === 'Save AI Key') {
            await b.click();
            await delay(500);
        }
    }

    // Go to tasks and generate
    await page.goto('https://js-reddit-growth-os.vercel.app/tasks');
    await delay(2000);

    const tasksBtns = await page.$$('button');
    for (let b of tasksBtns) {
        const t = await page.evaluate(el => el.textContent, b);
        if (t.includes('Generate Daily Plan')) {
            console.log("Clicking Generate...");
            await b.click();
            break;
        }
    }

    await delay(10000); // wait for completion

    console.log("=== BROWSER LOGS ===");
    console.log(logs.join('\n'));
    console.log("====================");

    await browser.close();
})();
