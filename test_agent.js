import puppeteer from 'puppeteer';
import fs from 'fs';

const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log("Starting Puppeteer E2E test for Reddit Growth OS...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // Create a dummy image
    fs.writeFileSync('dummy.jpg', Buffer.from('dummy image data'));

    page.on('dialog', async dialog => {
        console.log(`Alert: ${dialog.message()}`);
        await dialog.accept();
    });

    console.log("1. Creating Model...");
    await page.goto('http://localhost:5173/models');
    await delay(2000);
    await page.type('input[placeholder="e.g. Jane Doe"]', 'Test Model Puppeteer');
    await page.type('input[placeholder="e.g. Fitness"]', 'Test Niche');
    await page.type('input[type="number"]', '10000'); // weekly view target
    const numberInputs = await page.$$('input[type="number"]');
    if (numberInputs.length > 1) {
        await numberInputs[1].evaluate(el => el.value = '');
        await numberInputs[1].type('10'); // weekly post target
    }
    await page.click('button.btn-primary');
    await delay(1000);

    console.log("2. Creating Account...");
    await page.goto('http://localhost:5173/accounts');
    await delay(2000);
    const selectModel = await page.$('select');
    if (selectModel) {
        // Find the option
        const options = await page.evaluate(() => Array.from(document.querySelectorAll('select option')).map(o => ({ v: o.value, t: o.textContent })));
        const modelId = options.find(o => o.t === 'Test Model Puppeteer')?.v;
        if (modelId) {
            await page.select('select', modelId);
            await page.type('input[placeholder="u/username"]', 'u/tester_puppeteer');

            // Daily cap
            const numberInputs = await page.$$('input[type="number"]');
            if (numberInputs.length > 0) {
                await numberInputs[0].evaluate(el => el.value = '');
                await numberInputs[0].type('5');
            }

            const btns = await page.$$('button.btn-primary');
            for (let b of btns) {
                const t = await page.evaluate(el => el.textContent, b);
                if (t.includes('Add Account')) await b.click();
            }
            await delay(1000);
        }
    }

    console.log("3. Uploading Asset to Content Library...");
    await page.goto('http://localhost:5173/library');
    await delay(2000);
    // Find model select
    const libSelects = await page.$$('select');
    for (const sel of libSelects) {
        const hasOptions = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model Puppeteer') != null, sel);
        if (hasOptions) {
            const mId = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model Puppeteer').value, sel);
            await sel.select(mId);
            break;
        }
    }

    // Upload image
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 1) {
        await fileInputs[1].uploadFile('./dummy.jpg');
        await delay(2000);
    }

    console.log("4. Adding Subreddit Manually...");
    await page.goto('http://localhost:5173/subreddits');
    await delay(2000);
    await page.type('input[placeholder="e.g. funny"]', 'funny');

    const subSelects = await page.$$('select');
    if (subSelects.length > 0) {
        const hasOptions = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model Puppeteer') != null, subSelects[0]);
        if (hasOptions) {
            const mId = await page.evaluate(el => Array.from(el.querySelectorAll('option')).find(o => o.textContent === 'Test Model Puppeteer').value, subSelects[0]);
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
    await delay(1000);

    console.log("5. Generating Tasks...");
    await page.goto('http://localhost:5173/tasks');
    await delay(2000);
    const tasksBtns = await page.$$('button.btn-primary');
    for (let b of tasksBtns) {
        const t = await page.evaluate(el => el.textContent, b);
        if (t.includes('Generate Daily Plan')) {
            await b.click();
            break;
        }
    }

    await delay(4000);
    await page.screenshot({ path: 'test_agent_results.png', fullPage: true });
    console.log("E2E Test completed. Check test_agent_results.png for the generated tasks screen.");
    await browser.close();
})();
