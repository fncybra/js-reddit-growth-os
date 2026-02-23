---
description: Coding Standards and Architecture Patterns for JS Reddit Growth OS
---

# JS Reddit Growth OS - Development Standards

Following these rules ensures the system remains stable, bypasses Reddit's strict blocks, and maintains agency-grade performance.

## 1. Bypassing CORS & Reddit Blocks
- **pattern:** NEVER call Reddit directly from the frontend (it will fail via CORS).
- **solution:** Use the proxy server in `/proxy/server.js`.
- **headers:** Always include `'User-Agent': 'GrowthOS/1.0 (Internal Analytics Tool)'` in proxy requests.
- **endpoints:** 
  - `/api/scrape/user/:username`
  - `/api/scrape/post/:postId`
  - `/api/scrape/subreddit/:name`

## 2. Database (Dexie.js)
- **Schema Updates:** When adding a new field or table, increment the `db.version(X)` in `db.js`.
- **Reactive UI:** Use the `useLiveQuery` hook for all data-fetching in React components. This ensures the UI updates instantly when the VA marks a task.
- **Integrity:** Always update `timesUsed` and `lastUsedDate` on the `assets` table when a task is marked as `closed`.

## 3. VA Dashboard Architecture
- **Isolation:** The `/va` route must exist OUTSIDE the `Layout` component to hide the sidebar and admin navigation.
- **PIN Gate:** All VA routes must check for `vaPin` authentication (stored in `settings`).
- **Speed UX:** Provide "Copy to Clipboard" buttons for Titles and Subreddit names. 

## 4. Performance Metrics (Tracking Logic)
- **Views Placeholder:** Since Reddit doesn't expose real view counts via JSON, use `ups` (upvotes) as the primary performance metric.
- **Removal Detection:** A post is considered "Removed" if `post.removed_by_category !== null` OR `post.is_robot_indexable === false`.

## 5. Multiple Account Logic (Deconfliction)
- **Deconfliction Rule:** NO two accounts for the same `modelId` can post to the same `subredditId` on the same `date`.
- **Asset Cooldown:** Do not re-assign an `assetId` to the same `subredditId` within the `assetReuseCooldownDays` limit (default 30).

## 6. CSS & Styling
- **Theme:** Use the Premium Dark Mode palette defined in `index.css`.
- **Responsive:** Ensure VA cards look good on tablets (where VAs often work).
