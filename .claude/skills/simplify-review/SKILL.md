---
name: simplify-review
description: "Review recent code changes for quality, bugs, and consistency with project patterns. Use this skill whenever the user says 'review', 'review code', 'check the code', 'simplify', 'code review', 'anything wrong', 'look it over', or wants a quality check on recent changes. Also trigger after large features are built, when the user seems uncertain about code quality, or when they ask 'is this clean' or 'did I miss anything'. This is tailored to js-reddit-growth-os patterns — not generic code review."
---

# Simplify Review — Project-Aware Code Quality Check

You're reviewing recent code changes against the established patterns of js-reddit-growth-os. This isn't a generic linter — it's a project-specific review that catches the kinds of issues that actually happen in this codebase (stale references after renames, missing CloudSync registration, React pattern mismatches).

## Why project-specific review matters

This project has specific patterns that generic tools miss:
- Every new Dexie table MUST be registered in 3 CloudSync arrays (push, pull, clear) — miss one and sync breaks silently
- `growthEngine.js` services follow a specific export pattern — inconsistency confuses future sessions
- React pages use CSS-in-JS with specific color variables — mixing approaches creates visual bugs
- `generateId()` must be used for all new records — auto-increment IDs cause collision on multi-device sync

## Steps

### 1. Get the changes

Check what changed recently — last commit and any uncommitted work:

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git diff HEAD~1 --stat
```

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git diff HEAD~1
```

If there are uncommitted changes too:
```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git diff
```

### 2. Read changed files in full

Don't just look at the diff — read the complete files to understand surrounding context. A renamed variable in the diff might have other references elsewhere in the same file.

### 3. Review against project patterns

#### growthEngine.js Services
- Exported as `const` objects: `export const FooService = { ... }`
- Use `SettingsService.getProxyUrl()` for proxy URL — never hardcode
- Use `generateId()` from `../db/generateId.js` for all new Dexie records
- Use `db.tableName.bulkPut()` for batch writes
- Use `Promise.allSettled()` for parallel operations that shouldn't fail-fast
- Rate limit external APIs: Gemini 4.5s spacing, Airtable batch of 10
- Error handling: try/catch with meaningful error messages

#### React Pages
- Hooks only — `useState`, `useEffect`, `useRef` (no class components)
- Icons from `lucide-react` (not other icon libraries)
- CSS-in-JS via inline `style={}` — no CSS modules, no styled-components
- Color variables: `var(--text-primary)`, `var(--bg-surface)`, `var(--status-danger)`, `var(--border-color)`
- Table styling: `thStyle`/`tdStyle`/`thStyleNum`/`tdStyleNum` constants at bottom of file
- Number formatting via helper functions (`fmtFollowers`, `fmtThreads`)

#### Database (Dexie)
- Primary key always `++id`
- New tables require bumping version number
- Every new table must be added to ALL 3 CloudSync arrays in growthEngine.js:
  - `pushLocalToCloud` allTables array
  - `pullCloudToLocal` tables array
  - `clearCloudData` tables array
- Use `generateId()` for record IDs, never let Dexie auto-increment

#### Common Bugs to Catch
- **Stale variable references** — Variable renamed in one place but old name still used elsewhere (e.g., `last10` → `lastN` but `10` hardcoded elsewhere)
- **Missing `await`** on async calls (especially `db.table.bulkPut()`, `fetch()`)
- **Unused imports** left over from refactoring
- **Hardcoded URLs or API keys** that should use settings
- **`git add -A`** in commit instructions (should use specific files)
- **Missing error handling** on `fetch()` calls (no try/catch, no response.ok check)
- **React key warnings** — missing `key` prop in `.map()` renders
- **`setCostEstimate`-style bugs** — state setter called but state variable was removed

### 4. Report findings

Categorize each finding:

- **Critical** — Will cause runtime errors, data loss, or security issues. Must fix before shipping.
- **Warning** — Code smell, inconsistency, or potential future bug. Should fix soon.
- **Suggestion** — Could be cleaner but works fine. Nice-to-have.

For each finding, include:
- File path and line number
- What's wrong
- What should change (with code snippet if helpful)

If there are simple, safe fixes, offer to apply them. For complex changes, describe the approach and ask the user.

If nothing is found, say so: **"Code looks clean — no issues found."**
