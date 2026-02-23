import puppeteer from 'puppeteer';
import fs from 'fs';

const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log("Starting Puppeteer Proof Script...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    // Create a dummy image
    fs.writeFileSync('dummy2.jpg', Buffer.from('dummy image data'));

    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    console.log("0. Clearing DB");
    await page.goto('http://localhost:5173/');
    await page.evaluate(async () => {
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('JSRedditGrowthOS');
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });
    await delay(1000);

    console.log("1. Creating Model...");
    await page.goto('http://localhost:5173/models');
    await delay(1000);
    await page.type('input[placeholder="e.g. Jane Doe"]', 'Test Model 2');
    await page.type('input[placeholder="e.g. Fitness"]', 'Test Niche');
    await page.click('button.btn-primary');
    await delay(500);

    console.log("2. Creating Account...");
    await page.goto('http://localhost:5173/accounts');
    await delay(1000);
    const selectModel = await page.$('select');
    if (selectModel) {
        const options = await page.evaluate(() => Array.from(document.querySelectorAll('select option')).map(o => ({ v: o.value, t: o.textContent })));
        const modelId = options.find(o => o.t === 'Test Model 2')?.v;
        if (modelId) {
            await page.select('select', modelId);
            await page.type('input[placeholder="u/username"]', 'u/tester2');
            const btns = await page.$$('button.btn-primary');
            for (let b of btns) {
                const t = await page.evaluate(el => el.textContent, b);
                if (t.includes('Add Account')) await b.click();
            }
        }
    }
    await delay(500);

    console.log("3. Uploading Asset...");
    await page.goto('http://localhost:5173/library');
    await delay(1000);
    const libSelects = await page.$$('select');
    for (const sel of libSelects) {
        const hasOptions = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model 2') != null, sel);
        if (hasOptions) {
            const mId = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model 2').value, sel);
            await sel.select(mId);
            break;
        }
    }
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 1) {
        await fileInputs[1].uploadFile('./dummy2.jpg');
        await delay(1000);
    }

    console.log("4. Adding Subreddit Manually...");
    await page.goto('http://localhost:5173/subreddits');
    await delay(1000);
    await page.type('input[placeholder="e.g. funny"]', 'cats');

    const subSelects = await page.$$('select');
    if (subSelects.length > 0) {
        const hasOptions = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model 2') != null, subSelects[0]);
        if (hasOptions) {
            const mId = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model 2').value, subSelects[0]);
            await subSelects[0].select(mId);
        }
    }

    const addSubBtns = await page.$$('button.btn-primary');
    for (let b of addSubBtns) {
        const t = await page.evaluate(el => el.textContent, b);
        if (t.includes('Add Subreddit')) {
            await b.click();
            break;
        }
    }
    await delay(3000); // Wait for proxy scrape to finish

    console.log("5. Generating Tasks...");
    await page.goto('http://localhost:5173/tasks');
    await delay(1000);
    const tasksBtns = await page.$$('button.btn-primary');
    for (let b of tasksBtns) {
        const t = await page.evaluate(el => el.textContent, b);
        if (t.includes('Generate Daily Plan')) {
            await b.click();
            break;
        }
    }
    await delay(4000);

    console.log("6. Checking VA Dashboard...");
    await page.goto('http://localhost:5173/va');
    await delay(2000);
    const pinInputs = await page.$$('input[type="password"]');
    if (pinInputs.length > 0) {
        await pinInputs[0].type('1234');
        const unlockBtns = await page.$$('button.btn-primary');
        if (unlockBtns.length > 0) {
            await unlockBtns[0].click();
            await delay(2000);
        }
    }

    // Select the model in VA dashboard if needed
    const vaSelects = await page.$$('select');
    if (vaSelects.length > 0) {
        const options = await page.evaluate(() => Array.from(document.querySelectorAll('select option')).map(o => ({ v: o.value, t: o.textContent })));
        const modelId = options.find(o => o.t === 'Test Model 2')?.v;
        if (modelId) {
            await page.select('select', modelId);
            await delay(1000);
        }
    }

    await page.screenshot({ path: 'va_dashboard_proof.png', fullPage: true });
    console.log("Success! Saved va_dashboard_proof.png");
    await browser.close();
})();
