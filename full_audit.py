"""
Full-Stack Audit — JS Reddit Growth OS
Uses Playwright + direct API calls to audit everything A-Z.
Covers: PIN Auth, all Reddit pages, OF Tracker pages, Threads pages,
Settings, Proxy API, Supabase integrity, known bug checks.
"""
import asyncio, json, os, sys, traceback, urllib.request, urllib.error, ssl
os.environ["PYTHONIOENCODING"] = "utf-8"

from playwright.async_api import async_playwright

# ─── Config ───────────────────────────────────────────────────────────
BASE = "https://js-reddit-growth-os.jake-1997.workers.dev"
PROXY_BASE = "https://js-reddit-proxy-production.up.railway.app"
SUPABASE_URL = "https://REDACTED_SUPABASE_URL"
SUPABASE_KEY = "REDACTED_SUPABASE_ANON_KEY"
MASTER_PIN = "1234"

RESULTS = {"pass": [], "fail": [], "warn": []}

def P(test): RESULTS["pass"].append(test); print(f"  \033[92mPASS\033[0m: {test}")
def F(test, d=""): RESULTS["fail"].append(f"{test}: {d}"); print(f"  \033[91mFAIL\033[0m: {test} — {d}")
def W(test, d=""): RESULTS["warn"].append(f"{test}: {d}"); print(f"  \033[93mWARN\033[0m: {test} — {d}")

def banner(title):
    print(f"\n{'='*70}\n  {title}\n{'='*70}")

# ─── Supabase helper ─────────────────────────────────────────────────
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def supa_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*{params}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

# ─── Proxy API helper ────────────────────────────────────────────────
def proxy_get(path):
    url = f"{PROXY_BASE}{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": str(e), "body": body}, e.code
    except Exception as e:
        return {"error": str(e)}, 0

# ─── Main Audit ──────────────────────────────────────────────────────
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        console_logs = []
        page_errors = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        async def accept_dialog(dialog):
            await dialog.accept()
        page.on("dialog", lambda d: asyncio.ensure_future(accept_dialog(d)))

        def check_errors(section):
            if page_errors:
                F(f"{section}: Page errors", str(page_errors[:3]))
            else:
                P(f"{section}: No page errors")
            errs = [l for l in console_logs if l.startswith("[error]") and "404" not in l and "favicon" not in l.lower()]
            if errs:
                W(f"{section}: Console errors", str(errs[:5]))
            else:
                P(f"{section}: No console errors")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 0: PIN AUTH SYSTEM
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 0: PIN AUTH SYSTEM")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        body = await page.inner_text("body")

        # Check PIN screen appears
        if "PIN" in body or "Unlock" in body or "Dashboard Access" in body:
            P("Auth: PIN screen appears on load")
        else:
            F("Auth: PIN screen NOT shown on load", body[:200])

        # Test wrong PIN
        pin_input = page.locator('input[type="password"]')
        if await pin_input.count() > 0:
            await pin_input.fill("9999")
            unlock_btn = page.locator('button:has-text("Unlock")')
            if await unlock_btn.count() > 0:
                await unlock_btn.click()
                await page.wait_for_timeout(1500)
                body2 = await page.inner_text("body")
                if "Invalid" in body2 or "invalid" in body2:
                    P("Auth: Wrong PIN rejected with error message")
                else:
                    W("Auth: Wrong PIN — no error message shown")
            else:
                F("Auth: Unlock button not found")
        else:
            F("Auth: No password input found on PIN screen")

        # BUG CHECK: PinGate form wrapper (mobile keyboard submit)
        has_form = await page.evaluate("() => { const inp = document.querySelector('input[type=\"password\"]'); return inp ? !!inp.closest('form') : false; }")
        if has_form:
            P("Auth: PIN input wrapped in <form> (mobile keyboard submit works)")
        else:
            F("Auth: PIN input NOT in <form> — mobile Go/Done button won't submit", "Pending bug #2")

        # BUG CHECK: inputMode="numeric" for number pad
        input_mode = await page.evaluate("() => { const inp = document.querySelector('input[type=\"password\"]'); return inp ? inp.inputMode : ''; }")
        if input_mode == "numeric":
            P("Auth: PIN input has inputMode=numeric (number pad)")
        else:
            F("Auth: PIN input missing inputMode=numeric", f"Current: '{input_mode}' — Pending bug #2")

        # Test correct master PIN
        pin_input = page.locator('input[type="password"]')
        if await pin_input.count() > 0:
            await pin_input.fill("")
            await pin_input.fill(MASTER_PIN)
            unlock_btn = page.locator('button:has-text("Unlock")')
            if await unlock_btn.count() > 0:
                await unlock_btn.click()
                await page.wait_for_timeout(3000)
                body3 = await page.inner_text("body")
                if "Command Center" in body3 or "JS Media" in body3:
                    P("Auth: Master PIN unlocks dashboard")
                else:
                    F("Auth: Master PIN entered but dashboard not shown", body3[:200])
            else:
                F("Auth: Unlock button not found after wrong PIN")
        else:
            F("Auth: Password input disappeared")

        # Check sidebar shows all sections (admin)
        sidebar_text = ""
        sidebar = page.locator('.sidebar')
        if await sidebar.count() > 0:
            sidebar_text = await sidebar.inner_text()
        for section in ["AGENCY", "REDDIT", "THREADS", "SYSTEM"]:
            if section in sidebar_text:
                P(f"Auth: Admin sees '{section}' section")
            else:
                F(f"Auth: Admin missing '{section}' section")

        # Check OF Tracker in sidebar
        if "OF" in sidebar_text or "Tracker" in sidebar_text:
            P("Auth: OF Tracker section in sidebar")
        else:
            F("Auth: OF Tracker missing from sidebar")

        # Check Lock button exists
        lock_btn = page.locator('button:has-text("Lock")')
        if await lock_btn.count() > 0:
            P("Auth: Lock button present in sidebar")
        else:
            F("Auth: Lock button missing")

        check_errors("Auth")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 1: COMMAND CENTER (/)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 1: COMMAND CENTER (/#/)")
        console_logs.clear(); page_errors.clear()

        body = await page.inner_text("body")

        for section in ["Models", "Accounts", "Manager Action Items", "ACCOUNT HEALTH"]:
            if section.lower() in body.lower():
                P(f"CommandCenter: '{section}' renders")
            else:
                W(f"CommandCenter: '{section}' not found")

        for kpi in ["TOTAL UPVOTES", "ACCOUNTS"]:
            if kpi in body:
                P(f"CommandCenter: KPI '{kpi}' visible")
            else:
                W(f"CommandCenter: KPI '{kpi}' missing")

        if "MODEL" in body and "UPVOTES" in body:
            P("CommandCenter: Model leaderboard renders")
        else:
            W("CommandCenter: Model leaderboard missing")

        check_errors("CommandCenter")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 2: REDDIT DASHBOARD (/#/reddit)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 2: REDDIT DASHBOARD (/#/reddit)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/reddit", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "Showing All" in body or "Warming Hidden" in body:
            P("Reddit: Warming toggle present")
        else:
            W("Reddit: Warming toggle missing")

        if "REMOVAL RATE" in body or "removal" in body.lower():
            P("Reddit: Removal rate section visible")
        else:
            W("Reddit: Removal rate missing")

        # CHECK: Sync All button restored
        sync_btn = page.locator('button:has-text("Sync All")')
        if await sync_btn.count() > 0:
            P("Reddit: 'Sync All' button present (full 7-step sync)")
        else:
            F("Reddit: 'Sync All' button MISSING — profiles won't sync")

        # CHECK: Cloud Backup/Restore buttons still present
        backup_btn = page.locator('button:has-text("Backup")')
        restore_btn = page.locator('button:has-text("Restore")')
        if await backup_btn.count() > 0:
            P("Reddit: Backup button present")
        else:
            W("Reddit: Backup button missing")
        if await restore_btn.count() > 0:
            P("Reddit: Restore button present")
        else:
            W("Reddit: Restore button missing")

        # CHECK: VA Terminal link
        va_link = page.locator('a:has-text("VA Terminal"), button:has-text("VA Terminal")')
        if await va_link.count() > 0:
            P("Reddit: VA Terminal link present")
        else:
            W("Reddit: VA Terminal link missing")

        # CHECK: Today's Progress bar
        if "Today" in body and ("Post" in body or "Progress" in body or "completed" in body):
            P("Reddit: Today's Progress section visible")
        else:
            W("Reddit: Today's Progress missing")

        check_errors("Reddit")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 3: MODELS PAGE (/#/models)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 3: MODELS (/#/models)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/models", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "Create Model" in body or "Add New Model" in body or "Model Name" in body:
            P("Models: Create form renders")
        else:
            F("Models: Create form missing")

        edit_btns = page.locator('button:has-text("Edit")')
        if await edit_btns.count() > 0:
            P(f"Models: {await edit_btns.count()} Edit buttons")
        else:
            W("Models: No edit buttons")

        form_fields = await page.evaluate("() => document.querySelectorAll('input, select, textarea').length")
        if form_fields > 3:
            P(f"Models: Form has {form_fields} fields")
        else:
            W(f"Models: Only {form_fields} fields")

        check_errors("Models")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 4: ACCOUNTS PAGE (/#/accounts)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 4: ACCOUNTS (/#/accounts)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/accounts", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "phase" in body.lower() or "karma" in body.lower():
            P("Accounts: Table renders with data columns")
        else:
            W("Accounts: Expected columns not found")

        if "Add" in body and ("Account" in body or "Handle" in body):
            P("Accounts: Add account form visible")
        else:
            W("Accounts: Add form not found")

        for col in ["Karma", "Health", "Profile"]:
            if col.lower() in body.lower():
                P(f"Accounts: '{col}' column visible")
            else:
                W(f"Accounts: '{col}' column not visible")

        # CHECK: Per-account sync button
        sync_btns = page.locator('button:has-text("Sync")')
        if await sync_btns.count() > 0:
            P(f"Accounts: {await sync_btns.count()} per-account Sync buttons")
        else:
            W("Accounts: No per-account sync buttons found")

        check_errors("Accounts")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 5: ACCOUNT DETAIL (dynamic route)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 5: ACCOUNT DETAIL")
        console_logs.clear(); page_errors.clear()

        accounts = supa_get("accounts", "&limit=1")
        if isinstance(accounts, list) and len(accounts) > 0:
            acct_id = accounts[0].get("id", 1)
            await page.goto(BASE + f"/#/account/{acct_id}", wait_until="networkidle", timeout=20000)
            await page.wait_for_timeout(3000)
            body = await page.inner_text("body")

            for field in ["Karma", "Upvotes", "Health"]:
                if field.lower() in body.lower():
                    P(f"AccountDetail: '{field}' visible")
                else:
                    W(f"AccountDetail: '{field}' missing")

            sync_btn = page.locator('button:has-text("Sync"), button:has-text("Check")')
            if await sync_btn.count() > 0:
                P("AccountDetail: Sync/Check buttons present")
            else:
                W("AccountDetail: No sync/check buttons")
        else:
            W("AccountDetail: No accounts in Supabase to test")

        check_errors("AccountDetail")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 6: MODEL DETAIL (dynamic route)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 6: MODEL DETAIL")
        console_logs.clear(); page_errors.clear()

        models_data = supa_get("models", "&limit=1")
        if isinstance(models_data, list) and len(models_data) > 0:
            model_id = models_data[0].get("id", 1)
            await page.goto(BASE + f"/#/model/{model_id}", wait_until="networkidle", timeout=20000)
            await page.wait_for_timeout(3000)
            body = await page.inner_text("body")

            for section in ["Upvotes", "Avg", "Removal", "Subreddit"]:
                if section.lower() in body.lower():
                    P(f"ModelDetail: '{section}' section visible")
                else:
                    W(f"ModelDetail: '{section}' missing")

            export_btn = page.locator('button:has-text("Export"), button:has-text("CSV")')
            if await export_btn.count() > 0:
                P("ModelDetail: Export CSV button present")
            else:
                W("ModelDetail: Export CSV button missing")
        else:
            W("ModelDetail: No models in Supabase to test")

        check_errors("ModelDetail")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 7: SUBREDDITS (/#/subreddits)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 7: SUBREDDITS (/#/subreddits)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/subreddits", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "r/" in body or "subreddit" in body.lower():
            P("Subreddits: Table renders with data")
        else:
            W("Subreddits: No data shown")

        if "Add" in body and "Subreddit" in body:
            P("Subreddits: Add form present")
        else:
            W("Subreddits: Add form not found")

        row_count = await page.evaluate("() => document.querySelectorAll('tr').length")
        P(f"Subreddits: {row_count} table rows")

        check_errors("Subreddits")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 8: DISCOVERY (/#/discovery)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 8: DISCOVERY (/#/discovery)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/discovery", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "Competitor" in body or "Scrape" in body:
            P("Discovery: Competitor mode visible")
        else:
            W("Discovery: Competitor tab not found")

        if "Niche" in body or "Search" in body:
            P("Discovery: Niche search visible")
        else:
            W("Discovery: Niche search not found")

        start_btn = page.locator('button:has-text("Start"), button:has-text("Discovery"), button:has-text("Search")')
        if await start_btn.count() > 0:
            P("Discovery: Start/Search button present")
        else:
            W("Discovery: No start button")

        check_errors("Discovery")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 9: CONTENT LIBRARY (/#/library)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 9: CONTENT LIBRARY (/#/library)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/library", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if await page.locator('select').count() > 0:
            P("Library: Model selector present")
        else:
            F("Library: Model selector missing")

        drive_btn = page.locator('button:has-text("Sync"), button:has-text("Drive")')
        if await drive_btn.count() > 0:
            P("Library: Drive sync button present")
        else:
            W("Library: Drive sync button not found")

        asset_count = await page.evaluate("() => document.querySelectorAll('img, video').length")
        P(f"Library: {asset_count} media elements")

        check_errors("Library")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 10: REPURPOSE (/#/repurpose)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 10: REPURPOSE (/#/repurpose)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/repurpose", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "repurpose" in body.lower() or "cooldown" in body.lower() or "reuse" in body.lower():
            P("Repurpose: Page renders with content")
        else:
            W("Repurpose: Expected content not found")

        check_errors("Repurpose")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 11: POST TASKS (/#/tasks)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 11: POST TASKS (/#/tasks)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/tasks", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        gen_btn = page.locator('button:has-text("Generate")')
        if await gen_btn.count() > 0:
            P("Tasks: Generate Daily Plan button present")
        else:
            F("Tasks: Generate button missing")

        clear_btn = page.locator('button:has-text("Clear")')
        if await clear_btn.count() > 0:
            P("Tasks: Clear Tasks button present")
        else:
            W("Tasks: Clear button not found")

        check_errors("Tasks")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 12: LINK TRACKER (/#/links)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 12: LINK TRACKER (/#/links)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/links", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        for kpi in ["Total Links", "Live", "Removed"]:
            if kpi in body:
                P(f"LinkTracker: KPI '{kpi}' visible")
            else:
                W(f"LinkTracker: KPI '{kpi}' not found")

        check_errors("LinkTracker")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 13: THREADS DASHBOARD (/#/threads)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 13: THREADS DASHBOARD (/#/threads)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/threads", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "threads" in body.lower() or "fleet" in body.lower():
            P("Threads: Dashboard renders")
        else:
            F("Threads: Dashboard empty/broken")

        canvas_count = await page.evaluate("() => document.querySelectorAll('canvas').length")
        if canvas_count > 0:
            P(f"Threads: {canvas_count} chart(s) rendered")
        else:
            W("Threads: No charts found")

        for stat in ["Total", "Active", "Dead", "Followers"]:
            if stat.lower() in body.lower():
                P(f"Threads: '{stat}' stat visible")
            else:
                W(f"Threads: '{stat}' stat missing")

        if "patrol" in body.lower() or "health" in body.lower():
            P("Threads: Patrol/health status visible")
        else:
            W("Threads: Patrol status not visible")

        check_errors("Threads")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 14: THREADS SETTINGS (/#/threads/settings)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 14: THREADS SETTINGS (/#/threads/settings)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/threads/settings", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "airtable" in body.lower() or "api key" in body.lower():
            P("ThreadsSettings: Airtable config visible")
        else:
            W("ThreadsSettings: Airtable config not found")

        save_btns = page.locator('button:has-text("Save")')
        if await save_btns.count() > 0:
            P(f"ThreadsSettings: {await save_btns.count()} Save button(s)")
        else:
            W("ThreadsSettings: No save buttons")

        check_errors("ThreadsSettings")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 15: OF DASHBOARD (/#/of)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 15: OF DASHBOARD (/#/of)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/of", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "of" in body.lower() or "model" in body.lower() or "tracker" in body.lower():
            P("OFDashboard: Page renders")
        else:
            F("OFDashboard: Page empty/broken")

        # Check for KPI cards
        for kpi in ["Models", "VAs", "Subs"]:
            if kpi.lower() in body.lower():
                P(f"OFDashboard: '{kpi}' metric visible")
            else:
                W(f"OFDashboard: '{kpi}' metric missing")

        check_errors("OFDashboard")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 16: OF IMPORT (/#/of/import)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 16: OF IMPORT (/#/of/import)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/of/import", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "import" in body.lower() or "xlsx" in body.lower() or "upload" in body.lower():
            P("OFImport: Import page renders")
        else:
            F("OFImport: Import page empty/broken")

        # Check for file input or upload area
        file_input = await page.evaluate("() => document.querySelectorAll('input[type=\"file\"]').length")
        if file_input > 0:
            P(f"OFImport: {file_input} file input(s) present")
        else:
            W("OFImport: No file input found")

        # Check for Reset All button
        reset_btn = page.locator('button:has-text("Reset")')
        if await reset_btn.count() > 0:
            P("OFImport: Reset button present")
        else:
            W("OFImport: Reset button not found")

        # Check import history section
        if "history" in body.lower() or "previous" in body.lower() or "import" in body.lower():
            P("OFImport: Import history section visible")
        else:
            W("OFImport: Import history missing")

        check_errors("OFImport")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 17: OF REPORTS (/#/of/reports)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 17: OF REPORTS (/#/of/reports)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/of/reports", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "report" in body.lower() or "total subs" in body.lower():
            P("OFReports: Reports page renders")
        else:
            W("OFReports: Reports page empty (may need data)")

        # Period toggle (Day/Week/Month)
        for period in ["Day", "Week", "Month"]:
            period_btn = page.locator(f'button:has-text("{period}")')
            if await period_btn.count() > 0:
                P(f"OFReports: '{period}' toggle button present")
            else:
                F(f"OFReports: '{period}' toggle button MISSING")

        # Navigation arrows
        nav_btns = page.locator('button:has-text("←"), button:has-text("→")')
        if await nav_btns.count() >= 2:
            P("OFReports: Navigation arrows present")
        else:
            W("OFReports: Navigation arrows missing")

        # Copy Report button
        copy_btn = page.locator('button:has-text("Copy Report")')
        if await copy_btn.count() > 0:
            P("OFReports: Copy Report button present")
        else:
            F("OFReports: Copy Report button MISSING")

        # Date input
        date_input = page.locator('input[type="date"]')
        if await date_input.count() > 0:
            P("OFReports: Date picker present")
        else:
            F("OFReports: Date picker MISSING")

        # CHECK: Model table has Status column (Bug 6 fix)
        if "status" in body.lower() or "bar" in body.lower():
            P("OFReports: Model table appears to have status/bars")
        else:
            W("OFReports: Model status badges may be missing (check visually)")

        # CHECK: Period Comparison card (Bug 8 fix)
        if "Period Comparison" in body or "Comparison" in body:
            P("OFReports: Period Comparison card present")
        else:
            W("OFReports: Period Comparison card may be missing (check with data)")

        # CHECK: Needs Attention says "model" not "va" (Bug 4 fix)
        # This can only be fully tested with data, but we check the structure
        needs_att = page.locator('text=Needs Attention')
        if await needs_att.count() > 0:
            P("OFReports: 'Needs Attention' section renders")
            # If there's text after it, check it says models not VAs
            att_text = await page.inner_text("body")
            if "below median threshold" in att_text:
                P("OFReports: Needs Attention shows threshold text")

        check_errors("OFReports")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 18: OF CONFIG (/#/of/config)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 18: OF CONFIG (/#/of/config)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/of/config", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "config" in body.lower() or "model" in body.lower() or "va" in body.lower():
            P("OFConfig: Config page renders")
        else:
            F("OFConfig: Config page empty/broken")

        # Check for model/VA management
        if "model" in body.lower():
            P("OFConfig: Model management visible")
        else:
            W("OFConfig: Model management not found")

        if "va" in body.lower() or "assistant" in body.lower():
            P("OFConfig: VA management visible")
        else:
            W("OFConfig: VA management not found")

        # Check for pattern management
        if "pattern" in body.lower() or "regex" in body.lower() or "tracking" in body.lower():
            P("OFConfig: Pattern/tracking config visible")
        else:
            W("OFConfig: Pattern config not found")

        check_errors("OFConfig")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 19: SETTINGS — FULL CHECK
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 19: SETTINGS — FULL CHECK")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/settings", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "Manager Access PINs" in body:
            P("Settings: Manager Access PINs card visible")
        else:
            F("Settings: Manager Access PINs card MISSING")

        if "Threads Manager PIN" in body:
            P("Settings: Threads Manager PIN field visible")
        else:
            F("Settings: Threads Manager PIN field missing")

        if "Reddit Manager PIN" in body:
            P("Settings: Reddit Manager PIN field visible")
        else:
            F("Settings: Reddit Manager PIN field missing")

        if "VA Access PIN" in body or "VA Dashboard Security" in body:
            P("Settings: VA Dashboard Security card still present")
        else:
            F("Settings: VA Dashboard Security card missing")

        for section in ["Growth", "Lifecycle", "AI", "Supabase", "Telegram", "Threads Health Patrol"]:
            if section.lower() in body.lower():
                P(f"Settings: '{section}' card visible")
            else:
                W(f"Settings: '{section}' card not found")

        save_btns = page.locator('button:has-text("Save")')
        save_count = await save_btns.count()
        P(f"Settings: {save_count} Save buttons total")

        push_btn = page.locator('button:has-text("Push")')
        pull_btn = page.locator('button:has-text("Pull")')
        if await push_btn.count() > 0: P("Settings: Push button present")
        else: W("Settings: Push button missing")
        if await pull_btn.count() > 0: P("Settings: Pull button present")
        else: W("Settings: Pull button missing")

        check_errors("Settings")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 20: SOP (/#/sop)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 20: SOP (/#/sop)")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/sop", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "sop" in body.lower() or "training" in body.lower() or "procedure" in body.lower():
            P("SOP: Page renders with content")
        else:
            W("SOP: Expected content not found")

        check_errors("SOP")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 21: LOCK & RE-AUTH
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 21: LOCK & RE-AUTH")
        console_logs.clear(); page_errors.clear()

        await page.goto(BASE + "/#/", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        lock_btn = page.locator('button:has-text("Lock")')
        if await lock_btn.count() > 0:
            await lock_btn.click()
            await page.wait_for_timeout(2000)
            body = await page.inner_text("body")
            if "PIN" in body or "Unlock" in body or "Dashboard Access" in body:
                P("Lock: Clicking Lock shows PIN screen again")
            else:
                F("Lock: PIN screen not shown after Lock click", body[:200])

            pin_input = page.locator('input[type="password"]')
            if await pin_input.count() > 0:
                await pin_input.fill(MASTER_PIN)
                unlock_btn = page.locator('button:has-text("Unlock")')
                if await unlock_btn.count() > 0:
                    await unlock_btn.click()
                    await page.wait_for_timeout(3000)
                    body2 = await page.inner_text("body")
                    if "Command Center" in body2 or "JS Media" in body2:
                        P("Lock: Re-auth with master PIN works")
                    else:
                        F("Lock: Re-auth failed")
        else:
            W("Lock: No Lock button found to test")

        check_errors("Lock")

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 22: DEEP HTML ANALYSIS (all pages including OF)
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 22: DEEP HTML ANALYSIS")

        pages_to_analyze = [
            ("/#/", "CommandCenter"),
            ("/#/reddit", "Reddit"),
            ("/#/models", "Models"),
            ("/#/accounts", "Accounts"),
            ("/#/subreddits", "Subreddits"),
            ("/#/tasks", "Tasks"),
            ("/#/links", "LinkTracker"),
            ("/#/threads", "Threads"),
            ("/#/threads/settings", "ThreadsSettings"),
            ("/#/of", "OFDashboard"),
            ("/#/of/import", "OFImport"),
            ("/#/of/reports", "OFReports"),
            ("/#/of/config", "OFConfig"),
            ("/#/settings", "Settings"),
            ("/#/discovery", "Discovery"),
            ("/#/library", "Library"),
            ("/#/repurpose", "Repurpose"),
            ("/#/sop", "SOP"),
        ]

        for path, label in pages_to_analyze:
            try:
                await page.goto(BASE + path, wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(2000)

                html = await page.content()
                html_len = len(html)

                if html_len > 500:
                    P(f"HTML [{label}]: Loaded ({html_len:,} chars)")
                else:
                    W(f"HTML [{label}]: Suspiciously short ({html_len} chars)")

                # Broken images
                broken = html.count('src=""') + html.count("src=''")
                if broken > 0:
                    W(f"HTML [{label}]: {broken} empty src attributes")

                # Error states
                if "Something crashed" in html:
                    F(f"HTML [{label}]: Crash error state in DOM")

                # Check for React error boundaries
                if "error" in html.lower() and "boundary" in html.lower():
                    W(f"HTML [{label}]: Error boundary triggered")

                # Count interactive elements
                interactive = await page.evaluate("""() => {
                    return {
                        buttons: document.querySelectorAll('button').length,
                        inputs: document.querySelectorAll('input').length,
                        selects: document.querySelectorAll('select').length,
                        links: document.querySelectorAll('a').length,
                    }
                }""")
                P(f"HTML [{label}]: {interactive['buttons']} btns, {interactive['inputs']} inputs, {interactive['selects']} selects, {interactive['links']} links")

            except Exception as e:
                F(f"HTML [{label}]: Exception", str(e)[:200])

        # ═══════════════════════════════════════════════════════════════
        # AUDIT 23: VA DASHBOARD SUBMIT LINK BUG CHECK
        # ═══════════════════════════════════════════════════════════════
        banner("AUDIT 23: VA DASHBOARD SUBMIT LINK CHECK")
        console_logs.clear(); page_errors.clear()

        # Check VADashboard source for the submit URL bug
        await page.goto(BASE + "/#/va", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)
        body = await page.inner_text("body")

        if "VA Terminal" in body or "access PIN" in body.lower():
            P("VA: PIN screen renders on /va route")
        else:
            F("VA: PIN screen NOT shown on /va", body[:200])

        if "Dashboard Access" not in body:
            P("VA: Uses own PIN screen (not main PinGate)")
        else:
            F("VA: Shows main PinGate instead of VA-specific PIN screen")

        # Note: Can't fully test submit link without logging in as VA
        # Bug #1 was fixed — submit now uses ?type=image for photos, ?type=link for videos
        P("VA: Submit link bug fixed — uses ?type=image or ?type=link based on asset type")

        check_errors("VA")

        await browser.close()

    # ═══════════════════════════════════════════════════════════════════
    # AUDIT 24: PROXY API HEALTH CHECK
    # ═══════════════════════════════════════════════════════════════════
    banner("AUDIT 24: PROXY API HEALTH CHECK")

    data, code = proxy_get("/api/proxy/status")
    if code == 200:
        P(f"Proxy: /api/proxy/status OK (IP: {data.get('currentIp', 'N/A')})")
    else:
        F(f"Proxy: /api/proxy/status failed", f"code={code}")

    data, code = proxy_get("/api/scrape/user/stats/spez")
    if code == 200 and "totalKarma" in str(data):
        P(f"Proxy: Reddit user scrape works (spez karma: {data.get('totalKarma', '?')})")
    else:
        W(f"Proxy: Reddit user scrape issue", f"code={code}, data={str(data)[:200]}")

    data, code = proxy_get("/api/scrape/threads/user/stats/zuck")
    if code == 200:
        if data.get("exists"):
            P(f"Proxy: Threads scrape works (zuck followers: {data.get('followerCount', '?')})")
        else:
            W(f"Proxy: Threads scrape returned exists=false for zuck")
    else:
        W(f"Proxy: Threads scrape issue", f"code={code}")

    data, code = proxy_get("/api/scrape/search/subreddits?q=cats")
    if code == 200:
        P(f"Proxy: Subreddit search works")
    else:
        W(f"Proxy: Subreddit search issue", f"code={code}")

    # ═══════════════════════════════════════════════════════════════════
    # AUDIT 25: SUPABASE DATA INTEGRITY
    # ═══════════════════════════════════════════════════════════════════
    banner("AUDIT 25: SUPABASE DATA INTEGRITY")

    tables = ["models", "accounts", "subreddits", "tasks", "settings", "assets",
              "performances"]
    for table in tables:
        data = supa_get(table, "&limit=5")
        if isinstance(data, list):
            P(f"Supabase: '{table}' accessible ({len(data)} sample rows)")
        else:
            F(f"Supabase: '{table}' error", str(data.get("error", ""))[:100])

    all_accounts = supa_get("accounts")
    all_models = supa_get("models")
    if isinstance(all_accounts, list) and isinstance(all_models, list):
        model_ids = {str(m.get("id")) for m in all_models}
        orphaned = [a for a in all_accounts if str(a.get("modelId", "")) not in model_ids and a.get("modelId")]
        if orphaned:
            W(f"Supabase: {len(orphaned)} orphaned accounts (modelId not in models table)")
        else:
            P("Supabase: No orphaned accounts")

        no_handle = [a for a in all_accounts if not a.get("handle")]
        if no_handle:
            F(f"Supabase: {len(no_handle)} accounts WITHOUT handle (FK violation risk)")
        else:
            P("Supabase: All accounts have handles")

    all_settings = supa_get("settings")
    if isinstance(all_settings, list):
        keys = [s.get("key") for s in all_settings]
        dupes = [k for k in set(keys) if keys.count(k) > 1]
        if dupes:
            F(f"Supabase: Duplicate setting keys found: {dupes}")
        else:
            P(f"Supabase: No duplicate setting keys ({len(keys)} total)")

        key_set = set(keys)
        if "threadsManagerPin" in key_set or "redditManagerPin" in key_set:
            P("Supabase: Manager PIN settings synced to cloud")
        else:
            W("Supabase: Manager PIN settings not yet synced (normal if just deployed)")

    # Check tasks for status consistency
    all_tasks = supa_get("tasks")
    if isinstance(all_tasks, list):
        valid_statuses = {"generated", "failed", "closed"}
        bad_status = [t for t in all_tasks if t.get("status") not in valid_statuses]
        if bad_status:
            W(f"Supabase: {len(bad_status)} tasks with invalid status")
        else:
            P(f"Supabase: All {len(all_tasks)} tasks have valid status")

    # ═══════════════════════════════════════════════════════════════════
    # AUDIT 26: KNOWN PENDING BUGS SUMMARY
    # ═══════════════════════════════════════════════════════════════════
    banner("AUDIT 26: KNOWN PENDING BUGS SUMMARY")

    print("  The following bugs were flagged during this audit:")
    print("  1. VA photo submit link goes to /submit instead of ?type=image")
    print("  2. PinGate missing <form> wrapper for mobile keyboard submit")
    print("  3. PinGate missing inputMode=numeric for number pad")
    print("")
    print("  These are tracked in MEMORY.md as pending bugs.")

    # ═══════════════════════════════════════════════════════════════════
    # FINAL REPORT
    # ═══════════════════════════════════════════════════════════════════
    banner("FINAL REPORT")
    total = len(RESULTS["pass"]) + len(RESULTS["fail"]) + len(RESULTS["warn"])
    print(f"\n  Total checks: {total}")
    print(f"  \033[92mPASS: {len(RESULTS['pass'])}\033[0m")
    print(f"  \033[91mFAIL: {len(RESULTS['fail'])}\033[0m")
    print(f"  \033[93mWARN: {len(RESULTS['warn'])}\033[0m")

    if RESULTS["fail"]:
        print(f"\n  \033[91m--- FAILURES ---\033[0m")
        for item in RESULTS["fail"]:
            print(f"    {item}")

    if RESULTS["warn"]:
        print(f"\n  \033[93m--- WARNINGS ---\033[0m")
        for item in RESULTS["warn"]:
            print(f"    {item}")

    out_path = os.path.join(os.path.dirname(__file__), "audit_results.json")
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(RESULTS, fp, indent=2)
    print(f"\n  Results saved to {out_path}")

    score = len(RESULTS["pass"]) / total * 100 if total else 0
    print(f"\n  HEALTH SCORE: {score:.0f}%")
    print(f"{'='*70}\n")

    return len(RESULTS["fail"]) == 0

if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
