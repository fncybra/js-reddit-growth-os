---
name: save
description: "Save current session work to persistent memory files for future sessions. Use this skill whenever the user says 'save', 'save for now', 'save this', 'remember this', 'save progress', 'save to memory', or any indication they want the current session's work preserved for next time. Also trigger at the end of a session when the user says 'we're done for now' or 'that's it for today'. This ensures continuity between Claude Code sessions."
---

# Save — Persist Session Work to Memory

You're saving what was accomplished in this session so future sessions can pick up seamlessly. The memory system uses markdown files that persist across conversations — they're auto-loaded into context at session start.

## Why this matters

Without saving, the next session starts from scratch. The user manages multiple projects and complex features that span sessions. Good memory saves mean less time re-explaining context and fewer repeated mistakes.

## Memory Directory

`C:\Users\User\.claude\projects\c--Users-User\memory\`

## Critical Rules

- **MEMORY.md** is always loaded into context — lines after 200 get truncated, so keep it concise
- Topic files have no length limit — put details there, not in MEMORY.md
- Never duplicate information that's already saved
- Update existing entries rather than adding new duplicate sections
- If something was WIP before and is now done, update its status
- Don't save session-specific temporary state (current task in progress, debugging steps)
- Do save: architecture decisions, bugs fixed, features completed, patterns discovered, user preferences

## Steps

### 1. Understand what happened this session

```bash
cd C:/Users/User/.gemini/antigravity/scratch/js-reddit-growth-os && git log --oneline -10
```

Also review the conversation history — what was discussed, decided, built, or fixed.

### 2. Read ALL existing memory files

Read every file to understand what's already saved:

- `C:\Users\User\.claude\projects\c--Users-User\memory\MEMORY.md` (master index)
- `C:\Users\User\.claude\projects\c--Users-User\memory\project-master.md`
- `C:\Users\User\.claude\projects\c--Users-User\memory\ai-chat-grading.md`
- `C:\Users\User\.claude\projects\c--Users-User\memory\va-tracker.md`
- `C:\Users\User\.claude\projects\c--Users-User\memory\of-chatbot-errors.md`
- `C:\Users\User\.claude\projects\c--Users-User\memory\of-chatbot-api.md`
- `C:\Users\User\.claude\projects\c--Users-User\memory\react-automation-patterns.md`

Also check for any other .md files in that directory.

### 3. Identify what's NEW

Compare what happened this session against what's already in memory. Only save things that are:
- New features or capabilities added
- Bugs that were fixed (and how)
- Architecture changes or decisions
- New patterns or conventions established
- Status changes (WIP → done, or new WIP items)
- User preferences discovered

### 4. Update files

**MEMORY.md** — Update the relevant project section with concise bullet points. This is a quick-reference index. If a section is getting long, move details to a topic file and link to it.

**Topic files** — If significant work was done in a specific area (AI chat grading, Threads, OF tracker, etc.), update or create the relevant topic file with detailed notes.

### 5. Verify line count

Check that MEMORY.md stays under 200 lines:
```bash
wc -l "C:/Users/User/.claude/projects/c--Users-User/memory/MEMORY.md"
```

If over 200, trim by moving detailed sections to topic files.

### 6. Report

Tell the user what was saved and where. List the files updated and the key facts preserved.
