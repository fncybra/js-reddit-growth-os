# Reddit OS Test Matrix

This is the current Reddit-only test plan. The goal is to stop relying on memory and to run the same layered checks every time we ship.

## Test layers

1. `npm run build`
   Purpose: catch compile and bundle regressions before anything else.

2. `npm run stress:reddit`
   Purpose: hammer local data rules and destructive paths.
   Covers:
   - duplicate account merge
   - account delete cascade
   - dead-account manager logic
   - VA post-completion data updates
   - large local dataset query pressure
   - Reddit handle normalization

3. `python full_audit.py`
   Purpose: release gate for current routes, proxy reachability, auth shell, and cloud data integrity.
   Covers:
   - current Reddit routes
   - removed-route redirects
   - proxy API reachability
   - Supabase integrity checks
   - page and console regressions

4. `python crawl_reddit_deep.py`
   Purpose: post-deploy UI crawl plus seeded edge-case scenarios.
   Covers:
   - current live routes including `/va`
   - seeded operational vs dead account rendering
   - discovery account filtering
   - tasks queue rendering
   - library asset rendering
   - VA posting flow with isolated local fixture
   - proxy edge checks

5. Crawl-for-AI manual adversarial pass
   Purpose: catch DOM/layout/interaction issues that scripted checks still miss.
   Run this only after layers 1 to 4 are green.

## Scenario buckets

### A. Access and routing
- PIN gate shows on load
- wrong PIN rejects
- manager/admin unlock works
- `/va` uses terminal PIN flow
- removed routes redirect away
- lock returns to PIN gate

### B. Navigation and shell
- sidebar only shows Reddit sections
- no stale Threads, OF Tracker, or AI Chat entries
- route persistence survives refresh
- core routes render without crashes

### C. Models and account lifecycle
- add account normalizes handle
- duplicate handle is blocked
- existing duplicates merge safely
- account delete removes linked tasks and performances
- deleted account does not resurrect after sync
- dead or shadow-banned accounts move out of operational flow
- dead accounts appear in dead-account list

### D. Sync and cloud integrity
- local delete creates tombstones
- push errors do not clear pending deletes
- pull does not overwrite stronger local dead state
- cloud data has no duplicate handles
- cloud data has no orphaned accounts
- manager panel is not polluted by stale links or stale tasks

### E. Discovery and subreddit ops
- competitor scrape works
- niche search works
- import stores rules and flair metadata
- dead accounts are excluded from assignment
- assign-existing-to-account updates subreddits cleanly

### F. Task generation and queue behavior
- generate creates tasks for the selected model
- clear all removes linked outcomes too
- bad titles can regenerate
- grouped queue still renders under larger task volume
- tasks close correctly
- task delete removes linked performance rows

### G. VA worker flow
- PIN access works with global, model, and account pins
- VA name gate works
- queue filters by authorized model or account
- media preview loads or degrades cleanly
- HEIC conversion path is reachable
- title copy and regenerate work
- post verification URL accepts Reddit links
- mark-posted closes task and stores identifiers
- issue-failed path marks task failed cleanly
- completed tasks can hide or show

### H. Assets and media
- library shows seeded or synced assets
- Drive sync respects model selection
- asset enable or disable toggles cleanly
- RedGifs link handling does not break task execution
- cross-origin preview failures stay warnings, not crashes

### I. Adversarial and edge cases for Crawl-for-AI
- empty database
- very large task set
- missing asset on task
- missing subreddit rules
- invalid Reddit URL in VA flow
- sync service unavailable
- proxy unavailable
- Supabase reachable but foreign-key constrained
- mobile viewport on `/va`
- repeated refreshes during sync
- locked tab returns after 30s background cycle

## Release rule

Do not ship on confidence alone.

Minimum expected path:
- `npm run build`
- `npm run stress:reddit`
- `python full_audit.py`
- `python crawl_reddit_deep.py`

Then run the manual Crawl-for-AI pass on the deployed URL and fix anything structural or DOM-specific that the automated layers missed.
