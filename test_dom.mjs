import puppeteer from 'puppeteer';

(async () => {
    console.log("Starting debug on DOM...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    let logs = [];
    page.on('console', msg => {
        logs.push(`[CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
        console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
        logs.push(`[PAGEERROR] ${err.toString()}`);
        console.log(`[PAGEERROR] ${err.toString()}`);
    });

    await page.goto(`file://${process.cwd()}/test_browser.html`);

    // waiting to see if test_browser.html prints an error
    await new Promise(r => setTimeout(r, 5000));

    await browser.close();
})();
