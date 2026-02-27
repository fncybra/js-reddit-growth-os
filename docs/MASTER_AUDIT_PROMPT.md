You are auditing the entire JS Reddit Growth OS codebase.

Goal:
Make sure every manager flow and VA flow is WORKING, synced, and production-safe.

Critical keyword and acceptance gate:
WORKING means no broken UI path, no silent data loss, no cloud/local drift, no stale queue mismatch, no role mismatch, no crash.

Scope:
- Audit all app code in `src/**`, plus `worker.js`, `proxy/**`, and DB/schema definitions.
- Treat manager and VA as separate users on different machines.

Required checks:
1) Build/runtime health
- Verify app builds successfully.
- Identify crash risks (hook-order violations, undefined handlers, bad imports).

2) Manager-VA parity
- Every create/update/delete action in manager that should be visible to VA must sync and appear on VA.
- Every VA action that should be visible to manager must sync and appear on manager.
- Flag any one-sided action.

3) Cloud sync durability
- For each table (`models`, `accounts`, `subreddits`, `assets`, `tasks`, `performances`, `settings`):
  - confirm push path exists
  - confirm pull path exists
  - confirm delete path exists where relevant
- Check schema mismatch handling (fail-soft vs fail-hard).

4) Queue/date consistency
- Ensure queue views are not broken by timezone/date-equality issues.
- Ensure both manager and VA can see the same active queue.

5) Role/access consistency
- Verify manager/global pin, model pin, and account pin behavior are deterministic.
- Ensure restricted users only see intended model/account scope.

6) Task/title/media readiness
- Ensure bad AI title outputs (API errors, auth messages) are blocked or repairable.
- Ensure manual recovery exists (regen/fix button) where needed.
- Ensure media preview/download fallbacks work for drive/local/HEIC/video.

7) Subreddit/account mapping
- Confirm discovery import writes account attachment when selected.
- Confirm subreddit page shows attached account correctly and filtering is intuitive.

8) Delete/clear integrity
- Confirm clear/delete actions remove dependent rows correctly (local + cloud).
- Confirm deleted items do not reappear after refresh/pull.

Output format:
- `PASS/FAIL` summary first.
- Then list `Critical`, `High`, `Medium` issues with file paths.
- For each issue: impact, exact cause, minimal fix.
- End with "WORKING checklist" showing what is fully working now.
