import axios from 'axios';

export default async function handler(req, res) {
    const { username } = req.query;
    try {
        const response = await axios.get(`https://www.reddit.com/user/${username}/submitted.json?limit=100&sort=new`, {
            headers: { 'User-Agent': 'GrowthOS/1.0' }
        });
        res.status(200).json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
