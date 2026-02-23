import axios from 'axios';

export default async function handler(req, res) {
    const { id } = req.query;
    try {
        const response = await axios.get(`https://old.reddit.com/comments/${id}.json`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.120.120.120 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        const post = response.data[0].data.children[0].data;
        res.status(200).json({
            title: post.title,
            views: post.view_count || post.score,
            upvotes: post.ups,
            downvotes: post.downs,
            isRemoved: post.removed_by_category !== null,
            numComments: post.num_comments
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
