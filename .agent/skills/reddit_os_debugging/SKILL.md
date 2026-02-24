---
name: reddit_os_debugging
description: "A comprehensive guide to debugging common issues specifically for the JS Reddit Growth OS application, including Dexie/Supabase sync, AI models, and Vercel deployments."
---

# JS Reddit Growth OS - Debugging & Error Mastery

This skill contains the common errors, failure points, and architectural gotchas encountered while building the **JS Reddit Growth OS**. If the user reports a bug, check this list immediately before starting manual investigation.

## 1. The "Ghost Tasks" Sync Bug (Dexie.js vs Supabase)

**Symptom:**
- The manager clicks "Delete" on a local task, but when they refresh the browser, the task instantly reappears.
- The manager clears their tasks locally, but the tasks still appear on the `/va` (VA Dashboard) screen for the workers.
- The manager hits a "Clear Pending" bulk button, but the VA dashboard doesn't update.

**Root Cause:**
Because the OS uses `Dexie.js` for local (IndexedDB) state and `Supabase` for cloud state, deleting an item via Dexie (e.g., `db.tasks.delete(id)`) **does not** automatically trigger a deletion in Supabase simply by calling `upsert`. When the app syncs, it pulls the still-existing task from Supabase and overwrites the local Dexie store, causing it to "come back from the dead."

**The Solution:**
1. Any UI action that deletes data must explicitly call a native cloud deletion function in `CloudSyncService` (e.g., `CloudSyncService.deleteFromCloud('tasks', id)`).
2. The `pullCloudToLocal` function must be written to cleanly wipe local tables *even if Supabase returns an empty array*. If Supabase returns `[]`, that means the cloud is empty, so `db[table].clear()` MUST run to wipe the local VAs dashboard.

*Example Code Fix (`Tasks.jsx`):*
```javascript
await db.tasks.delete(task.id);
await CloudSyncService.deleteFromCloud('tasks', task.id); // <- Mandatory addition
```

---

## 2. Silent AI Generation Failures / Spammy Fallback Text

**Symptom:**
- The Daily Plan Generator stops creating human-like titles and instead outputs titles with weird prefixes/suffixes like *"Honestly, <Scraped Title> <3"* or *"Not gonna lie, <Scraped Title> :)"*.
- The user reports the AI sounds "spammy" or "fake" suddenly.

**Root Cause:**
- The primary cause is **Anthropic Model Deprecation** or missing API keys. Anthropic frequently deprecates older Claude models (e.g., `claude-3-5-haiku-20241022` or `claude-3-opus-20240229`). When this happens, the API silently errors with a `404 Not Found`.
- In `TitleGeneratorService` (`src/services/growthEngine.js`), there is a `catch(err)` block when the API fails. Originally, this fallback block hardcoded spammy prefixes to ensure the code didn't break.

**The Solution:**
1. **Never use spammy fallbacks.** We removed the `Honestly`/`<3` concatenations. The fallback should simply return the raw `baseTitle` from the scraper.
2. **Update the Model String.** Change the model in `growthEngine.js` to the actively supported one (e.g., `claude-haiku-4-5` or `claude-sonnet-4-6`).
3. Ensure the user has securely entered their `anthropicApiKey` via the Settings UI, since we cannot hardcode it in Git.

---

## 3. GitHub Push Protection Failures

**Symptom:**
- You run `git push` and GitHub rejects the entire push with a `GH013: Repository rule violations found for refs/heads/main` error.

**Root Cause:**
- You accidentally hardcoded an API Key (e.g., `sk-ant-...` or `sk-proj-...`) into the frontend code (like `Settings.jsx` or `growthEngine.js`). GitHub's secret scanning strictly bans this.

**The Solution:**
1. Blank out the API key in the code (`updates.anthropicApiKey = '';`).
2. Run `git add .` and `git commit --amend --no-edit` to overwrite the commit that contained the secret.
3. Instruct the user to manually paste their key into the Settings UI of their live site (which stores it securely in their IndexedDB or Supabase instance, safe from public repositories).

---

## 4. Vercel Function Serverless Size Limits (`googleapis` package)

**Symptom:**
- Vercel deployments fail with an error stating the serverless function size exceeds the maximum limit (usually 50MB).

**Root Cause:**
- The raw `googleapis` node module is massive and cannot easily be deployed inside Next.js/Vite serverless API routes on standard Vercel tiers.

**The Solution:**
- The architecture was fundamentally split: Vercel ONLY handles the frontend React/Vite UI. A separate Node/Express server (running on **Railway**) handles the heavy `googleapis` Drive syncing and Puppeteer/Cheerio Reddit scraping.
- The UI communicates with Railway via the `proxyUrl` variable stored in the OS settings.

---

## 5. Google Drive Auto-Sync (Service Account Permissions)

**Symptom:**
- The daily plan generator throws: *"No APPROVED media assets found."*

**Root Cause:**
- The manager created "APPROVED" and "USED" folders in Google Drive, but forgot to "Share" those specific folders with the Google Service Account Email (the "Robot Email" from `service_account.json`).

**The Solution:**
- Verify the Folder ID in `ModelDetail.jsx`.
- Instruct the user to explicitly grant "Editor" permissions on those Drive folders to the service account email.
