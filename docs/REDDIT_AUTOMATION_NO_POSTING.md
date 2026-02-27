# Reddit Automation (No Posting)

Use this as the operating prompt when you want automation support without any posting/execution actions.

## Scope (Allowed)
- competitor discovery and subreddit scraping
- subreddit qualification and account attachment
- account-level and niche-level analytics
- title quality checks and regeneration
- task planning and queue cleanup
- cloud sync validation across manager and VA views

## Hard Block (Not Allowed)
- no posting actions
- no click/submit flows on Reddit
- no auto-post, scheduled post, or bulk post
- no posting API integrations

## Operating Rules
1. Keep manager and VA data parity.
2. Every mutation must be durable local + cloud.
3. If cloud schema mismatch occurs, fail soft and keep local success.
4. If title output contains API/auth/error text, regenerate or fallback.
5. Keep account-scoped workflow: model -> account -> attached subreddits.

## Required Output For Each Run
- pass/fail status
- changed files
- what manager sees
- what VA sees
- explicit confirmation: "No posting actions were performed"
