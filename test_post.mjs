import fetch from 'node-fetch';

async function testPost() {
    const res = await fetch("https://old.reddit.com/by_id/t3_1h54vjk.json", {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    });
    console.log("Post status:", res.status);
    const text = await res.text();
    console.log("Post body length:", text.length);
    if (res.status === 200) {
        try {
            const json = JSON.parse(text);
            console.log("Post data parsed successfully. ups:", json.data?.children?.[0]?.data?.ups);
        } catch (e) {
            console.log("JSON parse error:", e.message);
        }
    }
}
testPost();
