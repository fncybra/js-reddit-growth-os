import fetch from 'node-fetch';

async function testReddit() {
    console.log("Testing bad user-agent...");
    const badRes = await fetch("https://old.reddit.com/user/spez/about.json", {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.120.120.120 Safari/537.36',
            'Accept': 'application/json'
        }
    });
    console.log("Bad User-Agent Status:", badRes.status);

    console.log("\Testing good user-agent...");
    const goodRes = await fetch("https://old.reddit.com/user/spez/about.json", {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    });
    console.log("Good User-Agent Status:", goodRes.status);
    console.log("Good Body:", (await goodRes.text()).substring(0, 50));
}
testReddit();
