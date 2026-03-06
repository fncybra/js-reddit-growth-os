---
name: ship
description: "Build, deploy, commit, and push js-reddit-growth-os to production. Use this skill whenever the user says 'ship', 'ship it', 'deploy', 'push it live', 'build and deploy', or any variation of wanting to get their code changes live. Also trigger when the user finishes a feature or fix and needs to get it deployed — even if they just say 'ok done' or 'make it live' or 'send it'. This is the standard shipping workflow that should run after every code change."
---

# Ship — Build + Deploy + Commit + Push

You're shipping code changes for js-reddit-growth-os to production. This is a 6-step pipeline that should feel like one smooth action. The goal is zero friction — the user made changes, now get them live.

## Why each step matters

1. **Check for changes first** — Don't waste time building if there's nothing to ship
2. **Build before deploy** — Catch compilation errors before they reach production
3. **Deploy before commit** — The user wants it live ASAP; git history can follow
4. **Stage specific files** — Never `git add -A` or `git add .` because that risks committing secrets (.env), build artifacts (dist/), or unrelated files
5. **Commit message style** — The project uses verb-first present tense ("Add", "Fix", "Update") to keep history scannable
6. **Push immediately** — Cloud sync and CI depend on the remote being current

## Steps

### 1. Check for changes

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git status && git diff --stat
```

If there are NO modified or untracked source files, stop and tell the user: **"Nothing to ship — no changes detected."**

### 2. Build

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && npm run build
```

If the build **fails**, stop immediately and show the error. Do NOT proceed to deploy broken code. Help the user fix the build error instead.

### 3. Deploy to Cloudflare Pages

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && npx wrangler pages deploy dist --project-name js-reddit-growth-os
```

Capture the deployment URL from the output.

### 4. Stage files

Stage only the changed **source files** — files in `src/`, `proxy/`, `public/`, config files at root level.

Never stage:
- `dist/` (build output)
- `node_modules/`
- `.env` or any credentials files
- `audit_results.json` or temporary data files

Use explicit file paths: `git add src/pages/Foo.jsx src/services/growthEngine.js`

### 5. Commit

Read the last 5 commits to match the style:
```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git log --oneline -5
```

Write a commit message that:
- Starts with a verb: Add, Fix, Update, Rewrite, Remove, Upgrade, Refactor
- Describes WHAT changed and WHY in under 72 chars for the first line
- Adds detail lines after a blank line for significant changes
- Always ends with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

Use a HEREDOC for the message to preserve formatting:
```bash
git commit -m "$(cat <<'EOF'
Verb-first summary of changes

Optional detail lines for significant changes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

### 6. Push

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git push
```

### 7. Report

After everything succeeds, give a clean summary:
- Deployment URL (from wrangler output)
- Commit hash (from git output)
- Files shipped (list of staged files)
- One-line summary of what went live

**Example output:**
```
Shipped!
Deploy: https://abc123.js-reddit-growth-os.pages.dev
Commit: a1b2c3d
Files: src/pages/ThreadsDashboard.jsx, src/services/growthEngine.js
Summary: Upgraded Threads patrol with auto-run and growth tracking
```
