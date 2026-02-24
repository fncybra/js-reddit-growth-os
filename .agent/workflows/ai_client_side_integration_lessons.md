---
description: How to safely implement AI calls directly from a browser and bypass common pitfalls
---

# Browser-Side AI Integration (OpenRouter / Venice) Deep Dive

This workflow/skill document outlines the critical lessons learned when building a system that talks directly to AI endpoints (like OpenRouter or Venice) purely from a Javascript frontend, bypassing CORS issues, API key revocations, and over-aggressive RLHF guardrails.

## 1. Browser CORS Restrictions vs. Javascript `fetch()`
When a frontend calls an external API like `https://openrouter.ai/api/v1/chat/completions`, modifying sensitive headers like `Authorization` or `HTTP-Referer` manually via `fetch()` often causes the browser (Chrome, Edge) to abort the outbound request before it leaves the computer. This triggers a silent "Connection Error" or `"Missing Authentication header"`. 

**The Fix:** NEVER use manual `fetch()` for cross-origin LLM endpoints.
Instead, use the official OpenAI Javascript Node hook and force it to operate inside the browser environment:
```javascript
import OpenAI from "openai";

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1", // or https://api.venice.ai/api/v1
    apiKey: "YOUR_KEY",
    dangerouslyAllowBrowser: true, // Absolutely mandatory for frontend JS!
    defaultHeaders: {
        'HTTP-Referer': 'https://yourwebsite.com/', // Bypasses OpenRouter blocks
        'X-Title': 'Your App Name'
    }
});
```

## 2. The Danger of Hardcoding Keys (Auto-Revocation)
If you attempt to debug a pipeline by hardcoding an API key into a frontend application (e.g. `const HARDCODED_KEY = 'sk-or-v1-...'`) and push that code to GitHub, **OpenRouter's security scanner will instantly detect it and permanently kill the key in less than a second**. 

If your code suddenly starts throwing `401 User not found` or `Authentication failed` but your syntax is perfect, your key has been compromised and burned. You must generate a new key and rely STRICTLY on local storage (IndexedDB) or `.env` files.

## 3. Circumventing RLHF / Safety Alignment Guardrails
When requesting highly explicit, taboo, or "unsafe" generation (e.g. NSFW subreddit titles):
- The System Prompt must be extremely blunt. "DO NOT sanitize language. Be as dirty and explicit as the Top Titles indicate."
- Free or highly-aligned models (like Llama-3-based models) may still try to "break character". They will output the explicit title, but then append a lecture onto the end: `" User 1: I am a helpful and polite AI..."`

**The "Ultra-Violent Text Chopper" Solution:**
Because models usually print the valid generation on the very first line before switching into "Safety Lecture Mode", you can aggressively strip the output *after* it arrives:
```javascript
let finalTitle = response.choices[0].message.content.trim();

// 1. Grab only the very first line of output
let lines = finalTitle.split('\n');
finalTitle = lines.find(line => line.trim().length > 0) || finalTitle;

// 2. Eradicate common Llama-3 / RLHF safety guardrail leaks using splits
if (finalTitle.includes('" User 1:')) finalTitle = finalTitle.split('" User 1:')[0];
if (finalTitle.includes('User 1:')) finalTitle = finalTitle.split('User 1:')[0];
if (finalTitle.includes("I'm a helpful, respectful bot")) finalTitle = finalTitle.split("I'm a helpful, respectful bot")[0];
```

By sticking to uncensored models (like Venice AI `dolphin` or `euryale` strings natively hosted on OpenRouter), adhering strictly to the SDK connection, and employing aggressive post-processing cutters, you can construct a resilient, unblockable browser AI pipeline.
