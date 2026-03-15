"""
Current-stack audit for JS Reddit Growth OS.
Audits the currently shipped app surface instead of legacy removed pages.
"""
import asyncio
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

os.environ["PYTHONIOENCODING"] = "utf-8"

from playwright.async_api import async_playwright


BASE = os.getenv("AUDIT_BASE_URL", "https://js-reddit-growth-os.jake-1997.workers.dev")
PROXY_BASE = os.getenv("AUDIT_PROXY_URL", "https://js-reddit-proxy-production.up.railway.app")
SUPABASE_URL = os.getenv("AUDIT_SUPABASE_URL", "https://bwckevjsjlvsfwfbnske.supabase.co")
SUPABASE_KEY = os.getenv("AUDIT_SUPABASE_KEY", "sb_publishable_zJdDCrJNoZNGU5arum893A_mxmdvoCH")
MASTER_PIN = os.getenv("AUDIT_MASTER_PIN", "1234")

RESULTS = {"pass": [], "fail": [], "warn": []}


def P(test):
    RESULTS["pass"].append(test)
    print(f"  \033[92mPASS\033[0m: {test}")


def F(test, detail=""):
    RESULTS["fail"].append(f"{test}: {detail}")
    print(f"  \033[91mFAIL\033[0m: {test} - {detail}")


def W(test, detail=""):
    RESULTS["warn"].append(f"{test}: {detail}")
    print(f"  \033[93mWARN\033[0m: {test} - {detail}")


def banner(title):
    print(f"\n{'=' * 70}\n  {title}\n{'=' * 70}")


SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def http_get_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as err:
        body = err.read().decode() if err.fp else ""
        return {"error": str(err), "body": body}, err.code
    except Exception as err:
        return {"error": str(err)}, 0


def supa_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*{params}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    data, _status = http_get_json(url, headers=headers, timeout=15)
    return data


def proxy_get(path):
    return http_get_json(f"{PROXY_BASE}{path}", timeout=15)


def normalize_handle(raw_value):
    value = str(raw_value or "").strip().lower()
    if not value:
        return ""
    for prefix in ("https://www.reddit.com/", "https://reddit.com/"):
        if value.startswith(prefix):
            value = value[len(prefix):]
    if value.startswith("user/"):
        value = value[5:]
    if value.startswith("u/"):
        value = value[2:]
    return value.strip("/")


async def goto_and_wait(page, route):
    await page.goto(BASE + route, wait_until="networkidle", timeout=25000)
    await page.wait_for_timeout(2000)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        console_logs = []
        page_errors = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.accept()))

        def check_errors(section):
            if page_errors:
                F(f"{section}: Page errors", str(page_errors[:3]))
            else:
                P(f"{section}: No page errors")

            errs = [
                line for line in console_logs
                if line.startswith("[error]")
                and "favicon" not in line.lower()
                and "404" not in line
            ]
            if errs:
                W(f"{section}: Console errors", str(errs[:5]))
            else:
                P(f"{section}: No console errors")

        banner("AUDIT 0: PIN AUTH")
        await goto_and_wait(page, "/#/")
        body = await page.inner_text("body")
        if "Dashboard Access" in body or "Unlock" in body:
            P("Auth: PIN screen appears on load")
        else:
            F("Auth: PIN screen missing", body[:200])

        pin_input = page.locator('input[type="password"]')
        if await pin_input.count() > 0:
            in_form = await page.evaluate(
                "() => !!document.querySelector('input[type=\"password\"]')?.closest('form')"
            )
            if in_form:
                P("Auth: PIN input wrapped in form")
            else:
                F("Auth: PIN input not wrapped in form")

            input_mode = await page.evaluate(
                "() => document.querySelector('input[type=\"password\"]')?.inputMode || ''"
            )
            if input_mode == "numeric":
                P("Auth: PIN input uses numeric inputMode")
            else:
                F("Auth: PIN input missing numeric inputMode", input_mode)

            await pin_input.fill("9999")
            await page.locator('button:has-text("Unlock")').click()
            await page.wait_for_timeout(1200)
            wrong_body = await page.inner_text("body")
            if "Invalid access PIN" in wrong_body:
                P("Auth: Wrong PIN rejected")
            else:
                W("Auth: Wrong PIN message missing")

            await pin_input.fill(MASTER_PIN)
            await page.locator('button:has-text("Unlock")').click()
            await page.wait_for_timeout(2000)
            unlocked_body = await page.inner_text("body")
            if "Command Center" in unlocked_body or "JS Media" in unlocked_body:
                P("Auth: Master PIN unlocks dashboard")
            else:
                F("Auth: Unlock failed", unlocked_body[:200])
        else:
            F("Auth: PIN input missing")

        sidebar_text = await page.locator(".sidebar").inner_text()
        for section in ["AGENCY", "REDDIT", "THREADS", "AI CHAT", "SYSTEM"]:
            if section in sidebar_text:
                P(f"Auth: Sidebar shows {section}")
            else:
                F(f"Auth: Sidebar missing {section}")
        check_errors("Auth")

        route_expectations = [
            ("/#/", "Command Center", ["Command Center", "Threads", "Reddit"]),
            ("/#/reddit", "Reddit Dashboard", ["Removal", "Today", "Accounts"]),
            ("/#/models", "Models", ["Models", "Create", "Edit"]),
            ("/#/accounts", "Accounts", ["Accounts", "Karma", "Phase"]),
            ("/#/subreddits", "Subreddits", ["Subreddits", "Add", "Testing"]),
            ("/#/discovery", "Discovery", ["Discovery", "Competitor", "Niche"]),
            ("/#/library", "Library", ["Library", "Drive", "Model"]),
            ("/#/tasks", "Tasks", ["Tasks", "Generate", "Clear"]),
            ("/#/threads", "Threads", ["Threads", "Active", "Dead"]),
            ("/#/settings", "Settings", ["Settings", "Supabase", "Telegram"]),
            ("/#/of/ai-chat-import", "AI Chat Import", ["AI Chat Import", "Import"]),
        ]

        for route, label, expectations in route_expectations:
            banner(f"AUDIT: {label} ({route})")
            console_logs.clear()
            page_errors.clear()
            await goto_and_wait(page, route)
            body = await page.inner_text("body")
            for expected in expectations:
                if expected.lower() in body.lower():
                    P(f"{label}: {expected} visible")
                else:
                    W(f"{label}: {expected} missing")
            check_errors(label)

        banner("AUDIT: LOCK FLOW")
        lock_button = page.locator('button:has-text("Lock")')
        if await lock_button.count() > 0:
            await lock_button.click()
            await page.wait_for_timeout(1000)
            body = await page.inner_text("body")
            if "Dashboard Access" in body or "Unlock" in body:
                P("Lock: Returns to PIN gate")
            else:
                F("Lock: Did not return to PIN gate")
        else:
            F("Lock: Button missing")

        banner("AUDIT: PROXY API")
        data, code = proxy_get("/api/proxy/status")
        if code == 200:
            P(f"Proxy: status OK ({data.get('currentIp', 'N/A')})")
        else:
            F("Proxy: status failed", f"code={code} data={str(data)[:120]}")

        data, code = proxy_get("/api/scrape/user/stats/spez")
        if code == 200 and "totalKarma" in str(data):
            P("Proxy: reddit user scrape works")
        else:
            F("Proxy: reddit user scrape failed", f"code={code} data={str(data)[:120]}")

        data, code = proxy_get("/api/scrape/search/subreddits?q=cats")
        if code == 200:
            P("Proxy: subreddit search works")
        else:
            F("Proxy: subreddit search failed", f"code={code} data={str(data)[:120]}")

        data, code = proxy_get("/api/scrape/threads/user/stats/zuck")
        if code == 200 and data.get("exists"):
            P("Proxy: threads scrape works")
        else:
            W("Proxy: threads scrape issue", f"code={code} data={str(data)[:120]}")

        banner("AUDIT: SUPABASE DATA INTEGRITY")
        tables = ["models", "accounts", "subreddits", "tasks", "settings", "assets", "performances"]
        supabase_ok = True
        table_data = {}
        for table in tables:
            data = supa_get(table, "&limit=5")
            table_data[table] = data
            if isinstance(data, list):
                P(f"Supabase: {table} reachable ({len(data)} sample rows)")
            else:
                supabase_ok = False
                F(f"Supabase: {table} unreachable", str(data.get("error", ""))[:140])

        if supabase_ok:
            all_accounts = supa_get("accounts")
            all_models = supa_get("models")
            all_settings = supa_get("settings")
            all_tasks = supa_get("tasks")

            if isinstance(all_accounts, list) and isinstance(all_models, list):
                model_ids = {str(row.get("id")) for row in all_models}
                orphaned = [row for row in all_accounts if row.get("modelId") and str(row.get("modelId")) not in model_ids]
                if orphaned:
                    W("Supabase: orphaned accounts found", str(len(orphaned)))
                else:
                    P("Supabase: no orphaned accounts")

                missing_handle = [row for row in all_accounts if not row.get("handle")]
                if missing_handle:
                    F("Supabase: accounts missing handle", str(len(missing_handle)))
                else:
                    P("Supabase: all accounts have handles")

                normalized = [normalize_handle(row.get("handle")) for row in all_accounts if row.get("handle")]
                dupes = sorted({handle for handle in normalized if normalized.count(handle) > 1 and handle})
                if dupes:
                    F("Supabase: duplicate account handles", ", ".join(dupes[:10]))
                else:
                    P("Supabase: no duplicate account handles")

            if isinstance(all_settings, list):
                keys = [row.get("key") for row in all_settings]
                dupes = sorted({key for key in keys if key and keys.count(key) > 1})
                if dupes:
                    F("Supabase: duplicate setting keys", ", ".join(dupes[:10]))
                else:
                    P("Supabase: no duplicate setting keys")

            if isinstance(all_tasks, list):
                valid_statuses = {"generated", "failed", "closed"}
                invalid = [row for row in all_tasks if row.get("status") not in valid_statuses]
                if invalid:
                    W("Supabase: tasks with invalid status", str(len(invalid)))
                else:
                    P("Supabase: task statuses valid")

        await browser.close()

    banner("FINAL REPORT")
    total = len(RESULTS["pass"]) + len(RESULTS["fail"]) + len(RESULTS["warn"])
    print(f"\n  Total checks: {total}")
    print(f"  \033[92mPASS: {len(RESULTS['pass'])}\033[0m")
    print(f"  \033[91mFAIL: {len(RESULTS['fail'])}\033[0m")
    print(f"  \033[93mWARN: {len(RESULTS['warn'])}\033[0m")

    if RESULTS["fail"]:
        print("\n  \033[91m--- FAILURES ---\033[0m")
        for item in RESULTS["fail"]:
            print(f"    {item}")

    if RESULTS["warn"]:
        print("\n  \033[93m--- WARNINGS ---\033[0m")
        for item in RESULTS["warn"]:
            print(f"    {item}")

    out_path = os.path.join(os.path.dirname(__file__), "audit_results.json")
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(RESULTS, fp, indent=2)
    print(f"\n  Results saved to {out_path}")

    score = len(RESULTS["pass"]) / total * 100 if total else 0
    print(f"\n  HEALTH SCORE: {score:.0f}%")
    print(f"{'=' * 70}\n")
    return len(RESULTS["fail"]) == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
