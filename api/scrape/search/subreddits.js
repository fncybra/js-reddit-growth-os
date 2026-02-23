import axios from 'axios';

export default async function handler(req, res) {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

    try {
        const response = await axios.get(`https://old.reddit.com/subreddits/search.json?q=${encodeURIComponent(q)}&limit=25`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.120.120.120 Safari/537.36' }
        });
        const subs = response.data.data.children.map(s => ({
            name: s.data.display_name,
            subscribers: s.data.subscribers,
            over18: s.data.over18,
            description: s.data.public_description
        }));
        res.status(200).json(subs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
