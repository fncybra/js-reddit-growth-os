# Deploy JS Reddit Growth OS to Cloudflare Pages (FREE FOREVER)

## Why Cloudflare Pages?
- **$0/month** — Unlimited bandwidth, unlimited requests
- **Faster than Vercel** — Global edge CDN
- **No serverless function limits** — All API calls go through your Railway proxy

## Setup Steps (5 minutes)

### 1. Go to Cloudflare Pages
1. Visit https://pages.cloudflare.com/
2. Click **"Create a project"**
3. Sign up with your email if you don't have an account

### 2. Connect Your GitHub
1. Click **"Connect to Git"**
2. Select **GitHub** and authorize Cloudflare
3. Choose the repository: **fncybra/js-reddit-growth-os**

### 3. Configure Build Settings
- **Production branch**: `main`
- **Framework preset**: Select **"Vite"** (or "None" and fill manually)
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Node.js version**: `18` (or `20`)

### 4. Deploy!
Click **"Save and Deploy"**. Cloudflare will build and deploy your app.

### 5. Custom Domain (Optional)
After deployment, you can add a custom domain or use the free `.pages.dev` subdomain.

## That's It!
- Every `git push` to `main` will auto-deploy
- No serverless function costs — Drive/Scrape API calls route through your Railway proxy
- The `.pages.dev` URL works exactly like Vercel but costs $0 forever

## What About Vercel?
You can safely delete the Vercel project after confirming Cloudflare works.
Your `/api/` folder in the repo is no longer used — all API calls go through Railway.
