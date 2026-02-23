import puppeteer from 'puppeteer';
import fs from 'fs';

const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // Listen for dialogs (window.alert)
    page.on('dialog', async dialog => {
        console.log(`\n==========================================`);
        console.log(`🚨 ALERT POPUP CAUGHT: ${dialog.message()}`);
        console.log(`==========================================\n`);
        await dialog.dismiss();
    });

    console.log("Navigating to dashboard...");
    await page.goto('http://localhost:5173');
    await delay(1000);

    // Read CSV
    const csvContent = fs.readFileSync('c:\\Users\\User\\OneDrive\\Desktop\\reddit_sfw_selfie_subs.csv.txt', 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim().length > 0).slice(1);
    const subredditsToAdd = lines.map(line => {
        const parts = line.split(',');
        return {
            name: parts[0] ? parts[0].replace('r/', '') : 'unknown',
            url: parts[1] || '',
            status: 'testing',
            nicheTag: 'sfw selfie',
            riskLevel: 'low',
            contentComplexity: 'general',
            totalTests: 0,
            avg24hViews: 0,
            removalPct: 0,
            lastTestedDate: null
        };
    }).filter(sub => sub.name !== 'unknown');

    try {
        console.log(`Injecting DB data via DOM Context... (${subredditsToAdd.length} subreddits)`);
        await page.evaluate(async (subs) => {
            return new Promise((resolve, reject) => {
                const req = window.indexedDB.open("JSRedditGrowthOS", 3);
                req.onerror = e => reject("DB Open Error");
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    const tx = db.transaction(["models", "accounts", "subreddits", "assets", "tasks"], "readwrite");

                    // Clear everything to reset test safely
                    tx.objectStore("models").clear();
                    tx.objectStore("accounts").clear();
                    tx.objectStore("subreddits").clear();
                    tx.objectStore("assets").clear();
                    tx.objectStore("tasks").clear();

                    // Insert Model
                    tx.objectStore("models").put({
                        id: 1, name: 'Mia pregnant', primaryNiche: 'Fitness', weeklyViewTarget: 50000, weeklyPostTarget: 50, status: 'active'
                    });
                    // Insert Account using handle 'u/miapreggo'
                    tx.objectStore("accounts").put({
                        id: 1, modelId: 1, handle: 'u/miapreggo', dailyCap: 10, status: 'active', cqsStatus: 'High', removalRate: 0, notes: ''
                    });

                    // Insert all subreddits mapped from the CSV
                    let subIdCounter = 1;
                    subs.forEach(s => {
                        s.id = subIdCounter++;
                        s.modelId = 1;
                        tx.objectStore("subreddits").put(s);
                    });

                    // Insert Asset
                    tx.objectStore("assets").put({
                        id: 1, modelId: 1, assetType: 'image', angleTag: 'mia_pregnancy_pic', locationTag: '', reuseCooldownSetting: 30, approved: 1, lastUsedDate: null, timesUsed: 0, fileBlob: null, fileName: 'mia_bump_mirror.png'
                    });

                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject("TX Error");
                };
            });
        }, subredditsToAdd);

        console.log("Database seeded successfully with model, u/miapreggo account, and full subreddits list!");

        console.log("Navigating to Tasks page...");
        await page.goto('http://localhost:5173/tasks');
        await delay(2000); // let queries load

        console.log("Clicking Generate Daily Plan...");
        const buttons = await page.$$('button');
        for (let btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn).catch(() => "");
            if (text.includes("Generate Daily Plan")) {
                await btn.click();
                console.log("Clicked! Waiting for generation...");
                break;
            }
        }

        await delay(3000);

        console.log("Taking screenshots...");
        await page.screenshot({ path: 'tasks-screenshot.png' });

        console.log("Navigating to VA Dashboard (http://localhost:5173/va)");
        await page.goto('http://localhost:5173/va');
        await delay(1000);

        // Enter PIN 1234
        const pinInput = await page.$('input[type="password"]');
        if (pinInput) {
            await pinInput.type('1234');
            await page.keyboard.press('Enter');
        }

        await delay(1000);
        await page.screenshot({ path: 'va-dashboard-screenshot.png' });

        console.log("Done! Check 'tasks-screenshot.png' and 'va-dashboard-screenshot.png' to see the results.");

    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        await browser.close();
    }
})();
