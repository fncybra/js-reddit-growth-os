import { GoogleAuth } from 'google-auth-library';
import heicConvert from 'heic-convert';

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

        // ArrayBuffer to Buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let finalBuffer = buffer;
        let finalContentType = response.headers.get('content-type') || 'application/octet-stream';
        let finalFilename = fileId;

        // Auto-convert to JPEG on the backend if requested
        if (req.query.convert === 'true') {
            try {
                finalBuffer = await heicConvert({
                    buffer: buffer,
                    format: 'JPEG',
                    quality: 0.9
                });
                finalContentType = 'image/jpeg';
                finalFilename = finalFilename.replace(/\.hei[cf]$/i, '') + '.jpg';
            } catch (convertErr) {
                console.warn(`[Backend] Failed to convert HEIC file ${fileId}:`, convertErr);
                // Fallback to sending the raw file if conversion fails
            }
        }

        // Forward headers to browser for seamless download
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', finalContentType);
        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
        res.status(200).send(finalBuffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
