# JS Reddit Growth OS

## Skills
Use these Codex skills when the task matches.

- `reddit_os_debugging`
  - Use for app bugs, sync issues, deleted records reappearing, duplicate accounts, Dexie/Supabase merge problems, AI generation regressions, proxy failures, or deployment-specific Reddit OS gotchas.
  - Installed at [C:\Users\User\.codex\skills\reddit_os_debugging\SKILL.md](/C:/Users/User/.codex/skills/reddit_os_debugging/SKILL.md)

- `reddit_growth_os_troubleshooting`
  - Use for historical bugs, architecture caveats, scraper/proxy limitations, title generation failures, and prior workarounds specific to this project.
  - Installed at [C:\Users\User\.codex\skills\reddit_growth_os_troubleshooting\SKILL.md](/C:/Users/User/.codex/skills/reddit_growth_os_troubleshooting/SKILL.md)

- `simplify-review`
  - Use for project-aware review of recent changes before shipping.
  - Installed at [C:\Users\User\.codex\skills\simplify-review\SKILL.md](/C:/Users/User/.codex/skills/simplify-review/SKILL.md)

- `status`
  - Use when the user asks for current project state, recent work, or a quick health check.
  - Installed at [C:\Users\User\.codex\skills\status\SKILL.md](/C:/Users/User/.codex/skills/status/SKILL.md)

- `ship`
  - Use whenever the user wants the current Reddit OS changes built, deployed, committed, and pushed.
  - Installed at [C:\Users\User\.codex\skills\ship\SKILL.md](/C:/Users/User/.codex/skills/ship/SKILL.md)

- `save`
  - Use when the user wants progress or project context preserved for future sessions.
  - Installed at [C:\Users\User\.codex\skills\save\SKILL.md](/C:/Users/User/.codex/skills/save/SKILL.md)

- `security-best-practices`
  - Use for secret handling, auth, production hardening, and safe deployment guidance.
  - Installed at [C:\Users\User\.codex\skills\security-best-practices\SKILL.md](/C:/Users/User/.codex/skills/security-best-practices/SKILL.md)

## Project rules
- Prefer fixing the root cause in local code over patching around symptoms.
- Before deleting local records, make sure cloud sync tombstones or cloud deletes are handled so records do not come back.
- Normalize Reddit handles before comparing or creating account records.
- Treat `full_audit.py` as the current release audit script for this repo.
- Before shipping, run:
  - `npm run build`
  - `python full_audit.py`
- Do not commit `.env*`, `dist/`, transient audit artifacts, or unrelated generated files unless the user explicitly asks.

## Shipping
- When asked to deploy or push live, use the `ship` skill workflow.
- Stage only the intended source/config files.
- Summarize the deployment URL, commit hash, and shipped files after pushing.
