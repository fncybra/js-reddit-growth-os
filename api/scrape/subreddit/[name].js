import axios from 'axios';

export default async function handler(req, res) {
    const { name } = req.query;
    try {
        const response = await axios.get(`https://www.reddit.com/r/${name}/about.json`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        const data = response.data.data;

        let rules = [];
        try {
            const rulesRes = await axios.get(`https://www.reddit.com/r/${name}/about/rules.json`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });
            rules = (rulesRes.data.rules || []).map(r => ({
                title: r.short_name,
                description: r.description
            }));
        } catch (e) { /* no rules */ }

        let flairRequired = false;
        let flairOptions = [];
        try {
            const flairRes = await axios.get(`https://www.reddit.com/r/${name}/api/link_flair_v2.json`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });
            flairOptions = flairRes.data || [];
            flairRequired = flairOptions.length > 0;
        } catch (e) { /* no flair */ }

        res.status(200).json({
            name: data.display_name,
            subscribers: data.subscribers,
            activeUsers: data.active_user_count,
            description: data.public_description,
            over18: data.over18,
            rules,
            flairRequired,
            flairOptions
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
