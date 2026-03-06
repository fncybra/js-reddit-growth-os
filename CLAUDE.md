# Reddit Growth OS — Claude Code Instructions

## Project Overview
- **Name:** js-reddit-growth-os
- **Stack:** React 19 + Vite 7, Dexie 4 (IndexedDB), Supabase (PostgreSQL), Express proxy, multi-AI (Anthropic/Google/OpenRouter/OpenAI)
- **Deploy:** Cloudflare Workers at `js-reddit-growth-os.jake-1997.workers.dev`
- **Repo:** https://github.com/fncybra/js-reddit-growth-os.git (branch: main)
- **Architecture:** Local-first — Dexie IndexedDB is source of truth. Supabase is cloud sync layer. All business logic lives in `src/services/growthEngine.js` (~3100 lines, 16+ exported services). Background sync every 30s via CloudSyncHandler.
- **Purpose:** Reddit account management & growth automation. Manages models (creators), Reddit accounts, subreddits, posting tasks, performance tracking, and VA workflows.
- **Deep reference files:** See `~/.claude/projects/.../memory/` for sync-rules.md, bugs-and-fixes.md, architecture.md, ui-patterns.md

---

## CRITICAL RULES — Never Break These

### Sync Rules

**1. NEVER push accounts without `.handle`**
Causes FK violation crash on Supabase (NOT NULL constraint). Pre-filter:
```js
const excludedAccountIds = new Set();
const allAccounts = await db.accounts.toArray();
for (const acc of allAccounts) {
    if (!acc.handle) excludedAccountIds.add(acc.id);
}
// Filter accounts table:
cleanData = cleanData.filter(row => !!row.handle);
// Filter dependent tables (tasks, subreddits, verifications):
cleanData = cleanData.filter(row => !row.accountId || !excludedAccountIds.has(row.accountId));
```

**2. NEVER clear local tables on cloud pull**
Use merge. If cloud table is empty, skip it — keep local data. Clearing = silent data wipe every 30s.

**3. NEVER let one sync step crash the whole flow**
Every step gets its own try-catch with `parts.push()` for user feedback. Use `Promise.allSettled()`, not `Promise.all()`.

**4. NEVER run concurrent syncs**
Use `CloudSyncService.acquireLock()` / `releaseLock()`. Background and manual sync share one lock. Always release in `finally`.

**5. NEVER push before pull in manual sync (Dashboard handleSync)**
Order: pull first (get VA data) → evaluate phases → sync accounts → sync performance → snapshot → push last.

**6. NEVER downgrade task status on sync**
Rank: `generated(1) < failed(2) < closed(3)`. Higher rank always wins in both push and pull merges.
```js
const TASK_STATUS_RANK = { 'generated': 1, 'failed': 2, 'closed': 3 };
```

**7. NEVER overwrite local phase fields on pull**
Cloud schema may lack these columns. Preserve from local if cloud value is undefined/null:
`phase, phaseChangedDate, warmupStartDate, restUntilDate, consecutiveActiveDays, lastActiveDate, hasAvatar, hasBanner, hasBio, hasDisplayName, hasVerifiedEmail, hasProfileLink, lastProfileAudit, removalRate, shadowBanStatus, lastShadowCheck`

**8. NEVER add Dexie columns without Supabase migration**
Add to `supabase_missing_columns.sql` AND run it, or fields get silently stripped on round-trip sync.

**9. NEVER hard-code table list in only one place**
Push, pull, and clear all use this list — update ALL THREE when adding a table:
```js
['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances', 'settings', 'verifications', 'dailySnapshots', 'competitors']
```
Clear uses reverse dependency order (verifications first, models last).

**10. Settings merge by `key` field, not `id`**
IDs differ per device. On push: remap local IDs to cloud IDs by key. On pull: remap cloud IDs to local IDs by key.

### Phase & Data Rules

**11. NEVER check `account.status` when you mean `account.phase`**
They are DIFFERENT fields:
- `phase` = warming/ready/active/resting/burned (lifecycle — USE THIS)
- `status` = active/inactive (legacy — DEPRECATED)

**12. NEVER assume all accounts have been synced**
Handle null `ageDays`, missing `createdUtc`, empty `lastSyncDate`. Guard with `|| 0` or null checks.

**13. NEVER default phase to 'ready'**
Auto-assign based on Reddit age + karma:
- `isSuspended` → burned
- `ageDays >= 7 && karma >= 100` → active (on pull) or ready (on evaluate)
- `ageDays >= 7` → ready
- Otherwise → warming

**14. Warming detection must include BOTH conditions:**
```js
phase === 'warming' || (!phase && !lastSyncDate)
```
New unsynced accounts are implicitly warming even without a phase field.

**15. NEVER use `Promise.all()` for sync operations**
Use `Promise.allSettled()` so one failure doesn't lose all results.

### React & UI Rules

**16. NEVER put React hooks after conditional returns**
All hooks (useState, useEffect, useMemo, useCallback) must be called in same order every render. Place them BEFORE any `if (...) return` statements.

**17. New string settings MUST be added to `textKeys` array in Settings.jsx `handleSave`**
Prevents `Number()` coercion. Current textKeys:
```js
['vaPin', 'openRouterApiKey', 'aiBaseUrl', 'openRouterModel', 'supabaseUrl', 'supabaseAnonKey',
 'proxyUrl', 'telegramBotToken', 'telegramChatId', 'telegramThreadId', 'lastTelegramReportDate']
```

**18. NEVER use `Number()` on API keys, URLs, tokens, or date strings.**

### ID Rules

**19. ALWAYS use `generateId()` from `src/db/generateId.js` when creating records.**
Never rely on Dexie auto-increment for multi-device sync. IDs: `Date.now() * 1000 + counter + random_offset`.

---

## File Map

### `src/db/`
- **db.js** — Dexie schema v15 (10 tables, collision-proof IDs)
- **generateId.js** — Timestamp-based unique ID generator
- **supabase.js** — Supabase client singleton

### `src/services/`
- **growthEngine.js** (~3100 lines) — ALL services:
  - `SettingsService` — CRUD for 20+ config keys
  - `CloudSyncService` — Bidirectional Supabase sync with lock
  - `TitleGeneratorService` — AI title generation (OpenRouter/Claude/Gemini)
  - `TitleGuardService` — Title validation (similarity, banned patterns, context)
  - `SubredditLifecycleService` — Subreddit classification (testing→proven/rejected)
  - `SubredditGuardService` — Post error tracking, cooldown, constraint inference
  - `DailyPlanGenerator` — Daily task queue generation (18-step, 4-pass asset matching)
  - `AnalyticsEngine` — KPIs, health scores, leaderboards
  - `AccountLifecycleService` — Phase transitions (warming→ready→active→resting→burned)
  - `AccountSyncService` — Reddit health sync (karma, bans, profile audit)
  - `PerformanceSyncService` — Post stats sync (views, removals)
  - `SnapshotService` — Daily karma/post snapshots
  - `TelegramService` — Daily report bot
  - `DriveSyncService` — Google Drive asset import
  - `CompetitorService` — Competitor tracking
  - `VerificationService` — Account-subreddit verification
  - `generateManagerActionItems()` — 13 priority alert rules
  - `extractRedditPostIdFromUrl()` — Regex ID extraction

### `src/pages/`
- **Dashboard.jsx** — Global KPIs, leaderboard, Manager Action Items, handleSync (7 steps)
- **Models.jsx** — Creator profiles (voice, identity, niche)
- **Accounts.jsx** — Reddit account lifecycle with phase badges
- **Subreddits.jsx** — Subreddit registry, risk levels, verification
- **Library.jsx** — Content assets with reuse cooldown
- **Repurpose.jsx** — Assets ready for reuse
- **Tasks.jsx** — Daily post queue generator
- **Discovery.jsx** — Competitor scraper
- **LinkTracker.jsx** — Post link dashboard with views/karma
- **ModelDetail.jsx** — Per-creator analytics (30-day)
- **AccountDetail.jsx** — Single account deep dive
- **Settings.jsx** — API keys, proxy, limits, Telegram config
- **VADashboard.jsx** — Mobile VA terminal (PIN-gated)
- **SOP.jsx** — 6-phase training guide

### `src/components/`
- **Layout.jsx** — Root layout: Sidebar + Outlet
- **Sidebar.jsx** — Nav menu (13 items), cloud/proxy status
- **CloudSyncHandler.jsx** — Background push→pull every 30s + Telegram auto-send
- **ManagerActionItems.jsx** — Priority alert list (critical/warning/info/success)

### Root Files
- **supabase_missing_columns.sql** — Cloud schema migrations (50+ ALTER TABLEs + 3 CREATE TABLEs)
- **supabase_schema.sql** — Main cloud schema
- **vite.config.js** — Vite 7 + React plugin
- **package.json** — React 19, Dexie 4, Supabase 2, Lucide, Chart.js, date-fns, Playwright

---

## Database Schema (Dexie v15)

### models
`id, name, status, driveFolderId, usedFolderId, redgifsProfile, proxyInfo, vaPin`
Voice: `voiceProfile, voiceArchetype, voiceTone, voiceEnergy, voiceNoGo, voiceNotes`
Identity: `identityAge, identityHairColor, identityBodyType, identityEthnicity, identityCurrentState, identityNicheKeywords`

### accounts
`id, modelId, handle(!), status, proxyInfo, vaPin, dailyCap, voiceOverride`
Phase: `phase(warming|ready|active|resting|burned), phaseChangedDate, warmupStartDate, restUntilDate, consecutiveActiveDays, lastActiveDate`
Profile: `hasAvatar, hasBanner, hasBio, hasDisplayName, hasVerifiedEmail, hasProfileLink, lastProfileAudit`
Ban: `shadowBanStatus, lastShadowCheck, isSuspended, removalRate`
Reddit: `totalKarma, linkKarma, commentKarma, createdUtc, lastSyncDate, ageDays`

### subreddits
`id, modelId, name, accountId, status(testing|proven|rejected|cooldown)`
`nicheTag, cooldownUntil, requiresVerified, peakPostHour`
`postErrorHistory, postErrorCount, minRequiredKarma, minAccountAgeDays`

### assets
`id, modelId, assetType, angleTag, approved, lastUsedDate, driveFileId, externalUrl, fileName, fileBlob, movedToUsed`

### tasks
`id, date, modelId, accountId, subredditId, assetId`
`title, status(generated|failed|closed), taskType(post|warmup|comment|engage)`
`redditPostId, redditUrl, scheduledTime, postedAt, postingWindow, vaName`

### performances
`id, taskId, views24h, removed, upvotes, downvotes, commentCount, ageHours, notes`

### settings
`id, key(unique!), value` — Merge by key, not id. See textKeys list in Rule 17.

### verifications
`id, accountId, subredditId, verified(0|1), verifiedDate`

### dailySnapshots
`id, date, totalKarma, totalAccounts, activeAccounts, postsToday, removalsToday, totalUpvotes, takenAt`

### competitors
`id, modelId, handle, addedDate, totalKarma, prevKarma, topSubreddits, lastScrapedDate, notes`

---

## Sync Architecture

### Dashboard handleSync (7 steps, in order)
1. **Acquire lock** — `CloudSyncService.acquireLock()`, alert if locked
2. **Cloud Pull** — `pullCloudToLocal()` (get VA data first)
3. **Evaluate Phases** — `AccountLifecycleService.evaluateAccountPhases()`
4. **Sync Account Health** — `AccountSyncService.syncAllAccounts()` + re-evaluate phases
5. **Sync Post Performance** — `PerformanceSyncService.syncAllPendingPerformance()`
6. **Take Snapshot** — `SnapshotService.takeDailySnapshot()`
7. **Cloud Push** — `pushLocalToCloud()` (push enriched data last)
8. **Release lock** in `finally`, show `parts.join('\n')` alert, refresh metrics

### CloudSyncHandler (background)
- Push→pull every 30s + on tab focus/visibility
- Lock-guarded (skips if manual sync running)
- After sync: check Telegram auto-send (once daily, stamps `lastTelegramReportDate`)

### Push flow
FK filtering → accounts handle check → settings key merge → task status merge → column discovery (`_getCloudColumns`) → strip unknown columns → batch 500 → error recovery (table-not-found skip, FK violation skip batch, unknown-column strip+retry)

### Pull flow
Fetch all tables → skip empty → asset blob preserve (byId/byDriveId/byModelAndName maps) → subreddit accountId preserve → task status merge (never downgrade) → performance views merge (keep higher) → account phase preserve (16 fields) → phase auto-assign (burned/active/ready/warming) → settings key remap → `db[table].bulkPut()`

---

## How to Add a New Feature (Checklist)

1. **Setting?** Add default to `SettingsService.getSettings()` defaultSettings object
2. **String setting?** Add key to `textKeys` in Settings.jsx `handleSave` (line ~70)
3. **Settings UI?** Add card in Settings.jsx: `<div className="card">` → `<div className="input-group">` → `<input className="input-field">`
4. **Service?** Add to growthEngine.js as `export const NewService = { ... }`
5. **Sync step?** Add try-catch block in Dashboard.jsx handleSync, push to `parts` array
6. **Cloud column?** Add `ALTER TABLE` to `supabase_missing_columns.sql` and run it
7. **New Dexie table?** Add to db.js schema AND add to CloudSyncService table lists (push, pull, clear — all 3!)
8. **Verify:** `npm run build` must pass clean

---

## Account Lifecycle

### Phase Flow
```
warming ──→ ready ──→ active ──→ resting ──→ ready (cycle)
   │           │         │          │
   └───────────┴─────────┴──────────┴──→ burned
```

### Transition Conditions
| From | To | Condition |
|------|-----|-----------|
| warming | ready | `ageDays >= 7` AND `karma >= 100` |
| ready | active | `markAccountActiveDay()` called (first posting task) |
| active | resting | `consecutiveActiveDays >= 4` (±1 variance from staggering) |
| resting | ready | `restUntilDate <= today` |
| any | burned | `isSuspended` OR `removalRate > 60%` |

### Staggering
- `consecutiveActiveDays` initialized to `siblings.length % maxConsecutiveActiveDays(4)`
- Rest variance: random {-1, 0, +1} days
- Rest duration: base 2 days + jitter {-1, 0, +1}, minimum 1 day
- Ensures sibling accounts don't all rest on the same day

---

## CSS/UI Pattern Reference

### Color Variables
```css
--bg-base: #0a0a0b          --bg-surface: #141416
--bg-surface-elevated: #1e1e21   --bg-surface-hover: #262629
--text-primary: #ededef      --text-secondary: #a1a1aa     --text-muted: #71717a
--accent-primary: #3b82f6    --accent-hover: #2563eb
--status-success: #10b981    --status-danger: #f43f5e
--status-warning: #f59e0b    --status-info: #0ea5e9
--border-light: rgba(255,255,255,0.08)   --border-focus: rgba(255,255,255,0.16)
--radius-sm: 4px  --radius-md: 8px  --radius-lg: 12px
```

### Component Classes
- Layout: `.app-container`, `.sidebar`, `.main-content`, `.page-header`, `.page-title`, `.page-content`
- Cards: `.card` (bg-surface, border-light, radius-lg, padding 24px)
- Metrics: `.metric-card`, `.metric-label`, `.metric-value`
- Badges: `.badge`, `.badge-success`, `.badge-danger`, `.badge-warning`, `.badge-info`
- Buttons: `.btn`, `.btn-primary`, `.btn-outline`
- Tables: `.data-table-container`, `.data-table`
- Forms: `.input-group`, `.input-label`, `.input-field`
- Grid: `.grid-cards` (auto-fill, minmax(280px, 1fr), gap 24px)

### Responsive Breakpoints
- `768px` — tablet (VA dashboard stacks vertically)
- `480px` — phone (not heavily used)

---

## Deep Reference Files
For detailed code patterns, exact snippets, and comprehensive documentation:
- **Sync rules & code:** `~/.claude/projects/.../memory/sync-rules.md`
- **Bug history & fixes:** `~/.claude/projects/.../memory/bugs-and-fixes.md`
- **Service architecture:** `~/.claude/projects/.../memory/architecture.md`
- **UI patterns (copy-paste):** `~/.claude/projects/.../memory/ui-patterns.md`
