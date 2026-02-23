import { GoogleAuth } from 'google-auth-library';

export default async function handler(req, res) {
    const { fileId } = req.query;

    const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        return res.status(500).json({ error: 'SERVICE_ACCOUNT_JSON env var is missing.' });
    }

    let credentials;
    try {
        credentials = JSON.parse(serviceAccountJson);
    } catch (parseErr) {
        return res.status(500).json({ error: 'SERVICE_ACCOUNT_JSON is not valid JSON.' });
    }

    try {
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        const accessToken = token.token;

        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

        const response = await fetch(downloadUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to download file from Google Drive' });
        }

        // Forward headers to browser for seamless download/conversion
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`);

        // ArrayBuffer to Buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.status(200).send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
