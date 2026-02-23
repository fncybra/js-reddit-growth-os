import axios from 'axios';

export default async function handler(req, res) {
    const { name } = req.query;
    try {
        const response = await axios.get(`https://old.reddit.com/r/${name}/top.json?t=month&limit=50`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.120.120.120 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        const titles = response.data.data.children.map(post => post.data.title);
        res.status(200).json(titles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
