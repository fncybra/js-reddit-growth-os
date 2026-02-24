import fetch from 'node-fetch';

async function testReddit() {
    const res = await fetch("https://old.reddit.com/user/spez/about.json", {
        headers: {
            'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)',
            'Accept': 'application/json'
        }
    });
    console.log("Status:", res.status);

    const postRes = await fetch("https://old.reddit.com/by_id/t3_1h54vjk.json", {
        headers: {
            'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)',
            'Accept': 'application/json'
        }
    });
    console.log("Post status:", postRes.status);
    const postJson = await postRes.json();
    const data = postJson.data?.children[0]?.data;
    console.log("Post ups:", data?.ups, "is_robot_indexable:", data?.is_robot_indexable, "removed_by_category:", data?.removed_by_category);
}
testReddit();
