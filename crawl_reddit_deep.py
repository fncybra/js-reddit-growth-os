"""
Deep post-deploy crawl for the Reddit-only OS.

This sits above the local stress suite:
- `npm run stress:reddit` checks local data integrity and regression logic.
- `python full_audit.py` checks the release gate and cloud connectivity.
- `python crawl_reddit_deep.py` walks current Reddit UI flows and seeded edge cases.
"""
import asyncio
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

os.environ["PYTHONIOENCODING"] = "utf-8"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from playwright.async_api import async_playwright


BASE = os.getenv("CRAWL_BASE_URL") or os.getenv("AUDIT_BASE_URL") or "https://c025c576.js-reddit-growth-os.pages.dev"
PROXY_BASE = os.getenv("CRAWL_PROXY_URL") or os.getenv("AUDIT_PROXY_URL") or "https://js-reddit-proxy-production.up.railway.app"
MASTER_PIN = os.getenv("CRAWL_MASTER_PIN") or os.getenv("AUDIT_MASTER_PIN") or "1234"

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
            body = resp.read().decode()
            return json.loads(body), resp.status
    except urllib.error.HTTPError as err:
        body = err.read().decode() if err.fp else ""
        return {"error": str(err), "body": body}, err.code
    except Exception as err:
        return {"error": str(err)}, 0


async def goto_and_wait(page, route, wait_ms=1800):
    await page.goto(BASE + route, wait_until="networkidle", timeout=30000)
    await page.wait_for_timeout(wait_ms)


async def unlock_admin(page):
    await goto_and_wait(page, "/#/")
    body = await page.inner_text("body")
    if "Unlock" not in body and "Reddit OS Access" not in body:
        return

    pin_input = page.locator('input[type="password"]').first
    await pin_input.fill(MASTER_PIN)
    await page.locator('button:has-text("Unlock")').click()
    await page.wait_for_timeout(1500)


async def seed_fixture(page, prefix, va_pin):
    return await page.evaluate(
        """async ({ prefix, vaPin }) => {
            function openDb() {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open('JSRedditGrowthOS');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            }

            function txDone(tx) {
                return new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
            }

            const db = await openDb();
            const now = Date.now();
            const today = new Date().toISOString().slice(0, 10);
            const ids = {
                modelId: now + 11,
                activeAccountId: now + 12,
                deadAccountId: now + 13,
                activeSubredditId: now + 14,
                assetId: now + 15,
                openTaskId: now + 16,
                closedTaskId: now + 17,
                perfId: now + 18
            };

            const tx = db.transaction(
                ['models', 'accounts', 'subreddits', 'assets', 'tasks', 'performances'],
                'readwrite'
            );

            tx.objectStore('models').put({
                id: ids.modelId,
                name: `${prefix}-model`,
                status: 'active'
            });

            tx.objectStore('accounts').put({
                id: ids.activeAccountId,
                modelId: ids.modelId,
                handle: `${prefix}-active`,
                status: 'active',
                phase: 'active',
                dailyCap: 10,
                vaPin
            });

            tx.objectStore('accounts').put({
                id: ids.deadAccountId,
                modelId: ids.modelId,
                handle: `${prefix}-dead`,
                status: 'dead',
                phase: 'burned',
                dailyCap: 0,
                shadowBanStatus: 'shadow_banned',
                deadReason: 'shadow_banned'
            });

            tx.objectStore('subreddits').put({
                id: ids.activeSubredditId,
                modelId: ids.modelId,
                name: `${prefix}sub`,
                status: 'active',
                accountId: ids.activeAccountId,
                rulesSummary: 'No spam\\nUse descriptive titles\\nNo emojis',
                flairRequired: 1,
                requiredFlair: 'Verified'
            });

            tx.objectStore('assets').put({
                id: ids.assetId,
                modelId: ids.modelId,
                assetType: 'image',
                approved: 1,
                fileName: `${prefix}.jpg`,
                externalUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                timesUsed: 0
            });

            tx.objectStore('tasks').put({
                id: ids.openTaskId,
                date: today,
                modelId: ids.modelId,
                accountId: ids.activeAccountId,
                subredditId: ids.activeSubredditId,
                assetId: ids.assetId,
                status: 'generated',
                taskType: 'post',
                title: `${prefix} live task`
            });

            tx.objectStore('tasks').put({
                id: ids.closedTaskId,
                date: today,
                modelId: ids.modelId,
                accountId: ids.activeAccountId,
                subredditId: ids.activeSubredditId,
                assetId: ids.assetId,
                status: 'closed',
                taskType: 'post',
                redditPostId: `${prefix}closed`,
                title: `${prefix} closed task`
            });

            tx.objectStore('performances').put({
                id: ids.perfId,
                taskId: ids.closedTaskId,
                views24h: 321,
                removed: 0
            });

            await txDone(tx);
            db.close();

            return {
                ...ids,
                prefix,
                activeHandle: `${prefix}-active`,
                deadHandle: `${prefix}-dead`,
                modelName: `${prefix}-model`,
                subredditName: `${prefix}sub`,
                openTaskTitle: `${prefix} live task`,
                closedTaskTitle: `${prefix} closed task`
            };
        }""",
        {"prefix": prefix, "vaPin": va_pin},
    )


async def select_option_if_present(page, value):
    return await page.evaluate(
        """(wantedValue) => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
                const option = Array.from(select.options).find((entry) => String(entry.value) === String(wantedValue));
                if (!option) continue;
                select.value = String(wantedValue);
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }""",
        str(value),
    )


async def collect_console(page, bucket):
    page.on("console", lambda msg: bucket.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda err: bucket.append(f"[pageerror] {err}"))


def filtered_console_errors(lines):
    allowed = (
        "cloudsync",
        "supabase",
        "failed to fetch",
        "net::err_failed",
        "net::err_blocked_by_response.notsameorigin",
        "status of 404",
        "status of 503",
        "pull error(",
    )
    errors = []
    for line in lines:
        lower = line.lower()
        if "[error]" not in lower and "[pageerror]" not in lower:
            continue
        if any(token in lower for token in allowed):
            continue
        errors.append(line)
    return errors


async def run_live_shell_crawl(page):
    logs = []
    await collect_console(page, logs)

    banner("DEEP CRAWL 1: LIVE SHELL")
    await unlock_admin(page)

    route_expectations = [
        ("/#/", "Command Center", ["Reddit Command Center", "Open Dashboard"]),
        ("/#/reddit", "Dashboard", ["Today's Posts", "Accounts", "Removal Rate"]),
        ("/#/models", "Models", ["Models"]),
        ("/#/accounts", "Accounts", ["Agency Reddit Accounts", "Operational Accounts"]),
        ("/#/subreddits", "Subreddits", ["Subreddits"]),
        ("/#/discovery", "Discovery", ["Discovery", "Scrape Competitor"]),
        ("/#/library", "Library", ["Library", "Drive"]),
        ("/#/tasks", "Tasks", ["Post Tasks"]),
        ("/#/settings", "Settings", ["System Settings", "Supabase", "Telegram"]),
        ("/#/va", "VA Terminal", ["VA Terminal Access", "Unlock Terminal"]),
    ]

    for route, label, expected in route_expectations:
        await goto_and_wait(page, route)
        body = await page.inner_text("body")
        missing = [text for text in expected if text.lower() not in body.lower()]
        if missing:
            F(f"{label}: expected UI missing", ", ".join(missing))
        else:
            P(f"{label}: current route renders expected UI")

    await goto_and_wait(page, "/#/threads")
    if "/threads" in page.url:
        F("Removed route redirect", "/#/threads is still reachable")
    else:
        P("Removed route redirect")

    shell_errors = filtered_console_errors(logs)
    if shell_errors:
        W("Live shell crawl: console noise", str(shell_errors[:5]))
    else:
        P("Live shell crawl: no unexpected console errors")


async def run_seeded_scenario_crawl(browser):
    banner("DEEP CRAWL 2: SEEDED SCENARIOS")

    context = await browser.new_context()

    async def route_handler(route):
        request = route.request
        url = request.url.lower()
        method = request.method.upper()

        if "supabase.co/rest/v1/" in url:
            await route.fulfill(
                status=503,
                content_type="application/json",
                body=json.dumps({"error": "deep crawl isolated mode"}),
            )
            return

        if "js-reddit-proxy-production.up.railway.app" in url and method not in {"GET", "HEAD", "OPTIONS"}:
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"success": True, "isolated": True}),
            )
            return

        await route.continue_()

    await context.route("**/*", route_handler)
    page = await context.new_page()

    await unlock_admin(page)

    prefix = f"deepcrawl-{int(time.time())}"
    va_pin = "9097"
    fixture = await seed_fixture(page, prefix, va_pin)
    await page.close()

    page = await context.new_page()
    logs = []
    await collect_console(page, logs)
    await unlock_admin(page)

    await goto_and_wait(page, "/#/reddit")
    body = await page.inner_text("body")
    if fixture["deadHandle"] in body and "BURNED" in body:
        P("Dashboard: dead account action item surfaces")
    else:
        W("Dashboard: dead account action item not obvious", fixture["deadHandle"])

    await goto_and_wait(page, "/#/accounts")
    await select_option_if_present(page, fixture["modelId"])
    try:
        await page.wait_for_function(
            """(activeHandle, deadHandle) => {
                const text = document.body ? document.body.innerText : '';
                return text.includes(activeHandle) && text.includes(deadHandle);
            }""",
            fixture["activeHandle"],
            fixture["deadHandle"],
            timeout=5000,
        )
    except Exception:
        await page.wait_for_timeout(1200)
    account_text = await page.evaluate(
        """() => {
            const accountAnchors = Array.from(document.querySelectorAll('a[href*="reddit.com/user/"]'))
                .map((node) => node.textContent || '');
            const bodyText = document.body ? document.body.innerText : '';
            return `${accountAnchors.join(' | ')}\n${bodyText}`;
        }"""
    )
    if fixture["activeHandle"] in account_text and fixture["deadHandle"] in account_text:
        P("Accounts: operational and dead fixture accounts both render")
    else:
        F("Accounts: seeded handles missing", f"{fixture['activeHandle']} / {fixture['deadHandle']}")

    if "Dead Accounts" in account_text and "Operational Accounts" in account_text:
        P("Accounts: sections split operational vs dead")
    else:
        F("Accounts: missing split sections")

    await goto_and_wait(page, "/#/discovery")
    await select_option_if_present(page, fixture["modelId"])
    await page.wait_for_timeout(800)
    discovery_options = await page.evaluate(
        """() => Array.from(document.querySelectorAll('select')).map((select) =>
            Array.from(select.options).map((option) => option.textContent || '')
        )"""
    )
    flat_options = " | ".join(" ".join(row) for row in discovery_options)
    if fixture["activeHandle"] in flat_options and fixture["deadHandle"] not in flat_options:
        P("Discovery: dead accounts are excluded from assignment")
    else:
        F("Discovery: account selector filtering failed", flat_options[:200])

    await goto_and_wait(page, "/#/tasks")
    await select_option_if_present(page, fixture["modelId"])
    await page.wait_for_timeout(800)
    body = await page.inner_text("body")
    if fixture["openTaskTitle"] in body:
        P("Tasks: seeded live task appears in queue")
    else:
        F("Tasks: seeded task missing", fixture["openTaskTitle"])

    if "Generate" in body:
        P("Tasks: queue controls present")
    else:
        W("Tasks: queue controls not fully visible")

    await goto_and_wait(page, "/#/library")
    await select_option_if_present(page, fixture["modelId"])
    await page.wait_for_timeout(800)
    body = await page.inner_text("body")
    if f"{prefix}.jpg" in body:
        P("Library: seeded asset appears for selected model")
    else:
        W("Library: seeded asset label not visible", f"{prefix}.jpg")

    await page.evaluate("""() => {
        localStorage.setItem('vaName', 'Deep Crawl VA');
    }""")

    await goto_and_wait(page, "/#/va")
    await page.wait_for_timeout(1200)
    body = await page.inner_text("body")
    if "Unlock Terminal" not in body:
        F("VA: pin screen missing")
    else:
        async def attempt_va_unlock():
            await page.locator('input[type="password"]').first.fill(va_pin)
            await page.locator('button:has-text("Unlock Terminal")').click()
            await page.wait_for_timeout(2500)

        await attempt_va_unlock()
        body = await page.inner_text("body")
        if "Invalid access PIN" in body or "Unlock Terminal" in body:
            await page.wait_for_timeout(1500)
            await attempt_va_unlock()

        if await page.locator('input[placeholder="Your name"]').count() > 0:
            await page.locator('input[placeholder="Your name"]').fill("Deep Crawl VA")
            await page.locator('button:has-text("Continue")').click()
            await page.wait_for_timeout(1500)

        await select_option_if_present(page, fixture["modelId"])
        await select_option_if_present(page, fixture["activeAccountId"])
        try:
            await page.wait_for_function(
                """(taskTitle) => {
                    const text = document.body ? document.body.innerText : '';
                    return text.includes(taskTitle) || text.includes('Queue Empty');
                }""",
                fixture["openTaskTitle"],
                timeout=5000,
            )
        except Exception:
            await page.wait_for_timeout(1500)

        body = await page.inner_text("body")
        if fixture["openTaskTitle"] in body and "Today's Queue" in body:
            P("VA: seeded queue loads after account PIN auth")
        else:
            F("VA: queue did not load", fixture["openTaskTitle"])

        if "Download Media" in body and "Copy Title" in body and "I Have Posted This Live" in body:
            P("VA: posting controls are present")
        else:
            F("VA: posting controls missing")

        url_input = page.locator('input[placeholder="https://www.reddit.com/r/..."]').first
        if await url_input.count() == 0:
            F("VA: verification URL input missing")
        else:
            await url_input.fill(f"https://www.reddit.com/r/{fixture['subredditName']}/comments/abc123/{prefix}/")
            await page.locator('button:has-text("I Have Posted This Live")').click()
            await page.wait_for_timeout(1500)
            body = await page.inner_text("body")
            if "DONE" in body and "abc123" in body:
                P("VA: mark-posted flow closes the seeded task locally")
            else:
                F("VA: mark-posted flow did not complete")

    scenario_errors = filtered_console_errors(logs)
    if scenario_errors:
        W("Seeded crawl: console noise", str(scenario_errors[:5]))
    else:
        P("Seeded crawl: no unexpected console errors")

    await context.close()


async def run_proxy_checks():
    banner("DEEP CRAWL 3: PROXY EDGE CHECKS")

    endpoints = [
        ("/api/proxy/status", "Proxy status"),
        ("/api/scrape/user/stats/spez", "User stats scrape"),
        ("/api/scrape/user/spez", "User listing scrape"),
        ("/api/scrape/search/subreddits?q=fitness", "Subreddit search"),
    ]

    for path, label in endpoints:
        data, code = http_get_json(f"{PROXY_BASE}{path}", timeout=15)
        if code == 200:
            P(f"{label}: reachable")
        else:
            F(f"{label}: failed", f"code={code} data={str(data)[:120]}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        live_context = await browser.new_context()
        live_page = await live_context.new_page()

        await run_live_shell_crawl(live_page)
        await live_context.close()
        await run_seeded_scenario_crawl(browser)
        await run_proxy_checks()
        await browser.close()

    banner("FINAL REPORT")
    total = len(RESULTS["pass"]) + len(RESULTS["fail"]) + len(RESULTS["warn"])
    print(f"\n  Total checks: {total}")
    print(f"  \033[92mPASS: {len(RESULTS['pass'])}\033[0m")
    print(f"  \033[91mFAIL: {len(RESULTS['fail'])}\033[0m")
    print(f"  \033[93mWARN: {len(RESULTS['warn'])}\033[0m")

    out_path = os.path.join(os.path.dirname(__file__), "crawl_results.json")
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
