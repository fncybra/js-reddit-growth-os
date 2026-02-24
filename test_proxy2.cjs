const axios = require('axios');
async function test() {
    try {
        const url = 'http://localhost:3001/api/scrape/user/stats/spez';
        console.log("Fetching: " + url);
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        console.log("Result:", res.data);
    } catch (e) {
        if (e.response) {
            console.error(e.response.status, e.response.statusText, e.response.data);
        } else {
            console.error(e.message);
        }
    }
}
test();
