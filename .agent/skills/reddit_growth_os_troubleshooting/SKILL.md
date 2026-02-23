---
name: Reddit Growth OS Troubleshooting & Learnings
description: A knowledge base of critical bugs, API issues, and workflow limitations solved while building the JS Reddit Growth OS.
---

# Reddit Growth OS - Troubleshooting & Solutions

This skill contains the historical context, bugs, and API limitations we encountered while building the "JS Reddit Growth OS", an application designed to scrape subreddits, generate AI titles based on viral posts, and orchestrate daily Reddit posts.

## 1. Scraping & Network Limitations (CORS/Rate Limits)
- **Problem:** Attempting to fetch Reddit data (User feeds, Top subreddit titles, Rules) directly from the client-side browser using standard fetch APIs failed due to CORS restrictions and Reddit rate limiting.
- **Solution:** A local Node.js `Express.js` proxy server (`proxy/server.js`) was built to intercept traffic. This server handles rate limits respectfully by routing HTTP requests internally and masking them with a customized `User-Agent`. Every client-side call was refactored to hit `http://localhost:3001/api/...`.

## 2. OpenAI Generation Issues
- **Problem 1 (Copying/Not Unique):** When asking the LLM to generate titles similar to top successful posts, it initially recreated those posts identically. 
  - **Solution:** The prompt must explicitly command: *"Your goal is to recreate something SIMILAR in "vibe" to the viral titles, but completely UNIQUE. Do NOT copy the top titles exactly."* We also track past generated titles in the local DB and feed them into the prompt with a *"DO NOT generate any title containing words or themes you have used before"* rule.
- **Problem 2 (Emoji Bans):** Top Reddit posts often use emojis, so the LLM learned to use them. However, numerous fast-growing or strict subreddits use Auto-Moderator bots to shadow-ban or instantly remove posts containing emojis.
  - **Solution:** An aggressive safety rule was injected into the top of the LLM Prompt: *"CRITICAL RULES: absolutely NO EMOJIS! Do not use ANY emojis under any circumstances."* Similarly, hardcoded mock generation fallbacks were stripped of default emojis.
- **Problem 3 (Unreliable API Keys/Rate Limits):** If an OpenAI API key hits a 429 Rate Limit Error (common when testing or if billing is not updated).
  - **Solution:** The code wraps the OpenAI API call in a `try...catch` block. If the API fails, the catch block elegantly falls through to a deterministic "mock" title generator utilizing an array of safe, emoji-free prefixes/suffixes and the scraped actual titles so the application doesn't completely crash and daily tasks still get generated.

## 3. Daily Planner Asset Reuse Loops
- **Problem:** The system was successfully looping through accounts and subreddits assigning tasks, but it selected the identical image/video asset multiple times in the same day when an account needed to post to *different* subreddits.
- **Solution:** 
  1. Instantiated a `Set` called `usedAssetsInSession` at the start of the daily post generator. Over the lifetime of that specific user click ("Generate"), any selected asset instantly has its ID added to the Set and bypassed in future loop iterations.
  2. The cool-down check mechanism (`assetReuseCooldownDays`) was broadened to query the tasks DB globally for *any* historical use of that asset ID, as opposed to scoping it locally to the specific subreddit being targeted.

## 4. Manual Additions Bypassing Discovery Logic
- **Problem:** When manually adding a subreddit via the "Add Subreddit" form (instead of discovering it algorithmically), the background deep-scraping step (fetching subreddit rules and flair requirements) was skipped. This resulted in empty flair data and missing `rulesSummary` in the database.
- **Solution:** The `handleSubmit` event inside `Subreddits.jsx` was enhanced to instantly ping the background proxy scrape endpoint `/api/scrape/subreddit/` the moment the user hits "Add". The resulting deep metadata is seamlessly spread into the new database record.

## 5. End-to-End Testing Environment
- **Problem:** End-to-end `Puppeteer` testing encountered two main blockers: (1) Selectors broke completely when UI elements changed names in iterations, and (2) The bot AI couldn't inherently click the OS-level file upload dialogue box for Assets.
- **Solution:** We hardened the selector logic to query arrays of objects dynamically (e.g., using `$$` across all inputs and filtering by `placeholder` attributes), and bypassed the actual OS-level file picker by triggering `elementHandle.uploadFile()` directly on the DOM node.
