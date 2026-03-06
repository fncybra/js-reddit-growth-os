---
name: status
description: "Quick health check of the js-reddit-growth-os project. Use this skill whenever the user asks 'status', 'what's going on', 'where are we', 'what's the state', 'catch me up', 'what did we do', or wants a summary of the project's current state. Great for the start of a new session to understand recent work, uncommitted changes, and pending items. Also trigger when the user seems unsure about what was done or what's left to do."
---

# Status — Project Health Check

You're giving the user a fast, comprehensive snapshot of where the js-reddit-growth-os project stands. This is typically used at the start of a session or when context has been lost. The goal is to orient quickly — not give a history lesson.

## Steps

### 1. Recent work

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git log --oneline --date=short --format="%h %ad %s" -10
```

### 2. Uncommitted changes

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git status && git diff --stat
```

### 3. Build health

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && npm run build 2>&1 | tail -5
```

### 4. WIP and pending items

Read the memory file for context on what's in progress:
`C:\Users\User\.claude\projects\c--Users-User\memory\MEMORY.md`

### 5. Report

Present a clean, scannable report:

```
## Recent Work (last 5 commits)
- a1b2c3d (Mar 6) Add buy signal detection to AI grading
- d4e5f6g (Mar 6) Upgrade Threads patrol with auto-run
...

## Uncommitted Changes
Clean — nothing pending
(or list modified files)

## Build
Clean ✓ (or show errors)

## WIP / Pending
- AI Chat grading: needs accuracy tuning after real data test
- Threads: growth deltas will show after 2nd patrol run
...
```

Keep it brief. The user wants orientation, not a novel.
