# 🚀 JS Reddit Growth OS: Braindead Easy Deployment Guide

Follow these 3 steps to move your Agency OS to the cloud and give your VAs access. Everything will be OFF your computer.

---

## 1. The Database (Supabase) - "The Central Brain"
This allows multiple VAs to see the same tasks and content.

1.  **Direct Link**: Go to [Supabase.com](https://supabase.com/) and create a free project.
2.  **Run the Schema**: 
    *   Find the **SQL Editor** tab (looks like `>_`).
    *   Paste the entire content of your `supabase_schema.sql` file and click **Run**.
3.  **Get Your Keys**:
    *   Go to **Project Settings** > **API**.
    *   Copy the **Project URL** and the **anon public key**.
4.  **Save in OS**: Open your Growth OS (local or live), go to **Settings**, paste them, and hit **Save**.

---

## 2. The Engine (Railway) - "The Reddit Scraper & Drive Mover"
This runs the automation (scraping rules and moving photos) 24/7.

1.  **Direct Link**: Go to [Railway.app](https://railway.app/).
2.  **Setup**:
    *   Click **New Project** > **Deploy from GitHub** (or just use their CLI to upload your `/proxy` folder).
    *   IMPORTANT: Railway will ask for variables. Add one called `SERVICE_ACCOUNT_JSON` and paste the entire content of your Google `service_account.json` file inside it.
3.  **Get Your Link**: 
    *   Railway will give you a link (e.g., `https://your-engine.up.railway.app`).
4.  **Save in OS**: Go to Growth OS **Settings**, paste this under "Production Scraper Engine URL", and hit **Save**.

---

## 3. The Website (Vercel) - "The Link for VAs"
This is the URL you actually send to your VAs.

1.  **Direct Link**: Go to [Vercel.com](https://vercel.com).
2.  **Setup**:
    *   Drag and drop the **entire project folder** onto the Vercel dashboard.
    *   Vercel will build it and give you a link like `https://reddit-growth-os.vercel.app`.
3.  **VA Dashboard**: Send your VAs the link: `https://your-link.vercel.app/va`.

---

## 🎯 Final Workflow
1.  **You (The Manager)**: Open your Vercel link, add subreddits, and generate the daily plan. Hit **"Push Local to Cloud"** in Settings.
2.  **The VAs**: Open the `/va` link. The cloud sync automatically "Pulls" the new tasks. They start posting.
3.  **The Automation**: When they mark a post "Posted", the Engine (on Railway) moves the photo in Google Drive and updates the stats in the Cloud (Supabase).

---

## 📁 Google Drive Setup (A-Z Guide for Managers)
To make your images sync into the Growth OS and automatically move to a "Used" folder when posted, follow these exact steps:

### 1. Get your "Robot Email"
Open the `mercurial-kit-...json` file in notepad. Find the line that says `"client_email"`. 
It will look something like: `redd-731@mercurial-kit-....iam.gserviceaccount.com`. 
Copy that exact email address.

### 2. Create Your Two Folders
Go to your normal Google Drive (where your photos actually live).
For every Model, you need **two** folders:
*   **The Source Folder** (e.g., "Jane Doe - APPROVED PHOTOS") - This is where you drop fresh content.
*   **The Used Folder** (e.g., "Jane Doe - USED (GRAVEYARD)") - This is where the system automatically moves a photo after a VA posts it to Reddit.

### 3. Share the Folders with the Robot
Right-click your **Source Folder** and click **Share**.
Paste the "Robot Email" you copied in Step 1.
Give the Robot **"Editor"** access (so it can read and move files).
Repeat this exact same sharing process for your **Used Folder**.

### 4. Get the Folder IDs
Open your **Source Folder** in Google Drive so you are looking inside it.
Look at the URL link at the very top of your browser.
It will look like `https://drive.google.com/drive/folders/1abc123xyzXYZ_987...`
Copy **ONLY** the random string of letters and numbers at the end (e.g., `1abc123xyzXYZ_987...`).
This is your **Folder ID**.
Do the same thing to get the Folder ID for your **Used Folder**.

### 5. Plug them into Growth OS
Open your JS Reddit Growth OS, and go to the **Models** tab.
Click the **Edit** button next to your model (or create a new one).
Paste the ID of your Source Folder into the **"APPROVED Folder ID"** box.
Paste the ID of your Used Folder into the **"USED Folder ID"** box.
Click **Save Changes**.

**Everything is now automated and off your PC.**
