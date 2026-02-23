import { GoogleAuth } from 'google-auth-library';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        return res.status(500).json({ error: 'SERVICE_ACCOUNT_JSON env var is missing.' });
    }

    const { fileId, targetFolderId } = req.body;
    if (!fileId || !targetFolderId) {
        return res.status(400).json({ error: 'fileId and targetFolderId are required' });
    }

    try {
        const credentials = JSON.parse(serviceAccountJson);
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive'],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        const accessToken = token.token;
        const headers = { Authorization: `Bearer ${accessToken}` };
        const baseUrl = 'https://www.googleapis.com/drive/v3/files';

        // Get current parents
        const getRes = await fetch(`${baseUrl}/${fileId}?fields=parents`, { headers });
        const fileData = await getRes.json();

        if (fileData.error) {
            return res.status(500).json({ error: fileData.error.message });
        }

        const prevParents = (fileData.parents || []).join(',');

        // Move file
        const moveUrl = `${baseUrl}/${fileId}?addParents=${targetFolderId}&removeParents=${prevParents}&fields=id,parents`;
        const moveRes = await fetch(moveUrl, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const moveData = await moveRes.json();

        if (moveData.error) {
            return res.status(500).json({ error: moveData.error.message });
        }

        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
