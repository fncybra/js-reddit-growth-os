import axios from 'axios';

export default async function handler(req, res) {
    const { username } = req.query;
    try {
        const response = await axios.get(`https://old.reddit.com/user/${username}/submitted.json?limit=100&sort=new`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.120.120.120 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        res.status(200).json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
