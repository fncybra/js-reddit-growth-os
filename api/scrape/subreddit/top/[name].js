import axios from 'axios';

export default async function handler(req, res) {
    const { name } = req.query;
    try {
        const response = await axios.get(`https://www.reddit.com/r/${name}/top.json?t=month&limit=50`, {
            headers: { 'User-Agent': 'GrowthOS/1.0' }
        });
        const titles = response.data.data.children.map(post => post.data.title);
        res.status(200).json(titles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
