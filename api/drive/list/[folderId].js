import { GoogleAuth } from 'google-auth-library';

export default async function handler(req, res) {
    const { folderId } = req.query;

    const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        return res.status(500).json({ error: 'SERVICE_ACCOUNT_JSON env var is missing.' });
    }

    let credentials;
    try {
        credentials = JSON.parse(serviceAccountJson);
    } catch (parseErr) {
        return res.status(500).json({ error: 'SERVICE_ACCOUNT_JSON is not valid JSON: ' + parseErr.message });
    }

    try {
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        const accessToken = token.token;

        const headers = { Authorization: `Bearer ${accessToken}` };
        const baseUrl = 'https://www.googleapis.com/drive/v3/files';

        // 1. Fetch sub-folders inside the main Model folder
        const folderQuery = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const foldersUrl = `${baseUrl}?q=${encodeURIComponent(folderQuery)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=100`;
        const foldersRes = await fetch(foldersUrl, { headers });
        const foldersData = await foldersRes.json();

        if (foldersData.error) {
            return res.status(500).json({ error: foldersData.error.message, code: foldersData.error.code });
        }

        const folders = foldersData.files || [];
        const folderNameMap = {};
        folders.forEach(f => folderNameMap[f.id] = f.name);

        const searchParentIds = [folderId, ...folders.map(f => f.id)];

        // 2. Fetch all images/videos 
        const parentsQuery = searchParentIds.map(id => `'${id}' in parents`).join(' or ');
        const filesQuery = `(${parentsQuery}) and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;
        const filesFields = 'nextPageToken,files(id,name,mimeType,thumbnailLink,webContentLink,parents)';

        let allFiles = [];
        let pageToken = null;

        do {
            let url = `${baseUrl}?q=${encodeURIComponent(filesQuery)}&fields=${encodeURIComponent(filesFields)}&pageSize=100`;
            if (pageToken) url += `&pageToken=${pageToken}`;

            const filesRes = await fetch(url, { headers });
            const filesData = await filesRes.json();

            if (filesData.error) {
                return res.status(500).json({ error: filesData.error.message, code: filesData.error.code });
            }

            const processedFiles = (filesData.files || []).map(file => {
                const parentId = file.parents && file.parents[0];
                const folderName = folderNameMap[parentId] || '';
                return { ...file, mappedTag: folderName };
            });

            allFiles = allFiles.concat(processedFiles);
            pageToken = filesData.nextPageToken;
        } while (pageToken);

        res.status(200).json(allFiles);
    } catch (err) {
        res.status(500).json({ error: err.message, detail: err.stack?.substring(0, 500) });
    }
}
