-- Run this in Supabase SQL Editor to add columns that Dexie uses
-- but are missing from the cloud schema. Without these, data gets
-- silently stripped on every push and lost on round-trip.
--
-- Safe to run multiple times (IF NOT EXISTS).

-- models: voice profile from AI Persona Builder
ALTER TABLE models ADD COLUMN IF NOT EXISTS "voiceProfile" TEXT;

-- accounts: VA PIN and daily cap
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "vaPin" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "dailyCap" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "voiceOverride" TEXT;

-- subreddits: account binding and cooldown state
ALTER TABLE subreddits ADD COLUMN IF NOT EXISTS "accountId" BIGINT REFERENCES accounts("id") ON DELETE SET NULL;
ALTER TABLE subreddits ADD COLUMN IF NOT EXISTS "cooldownUntil" TEXT;

-- assets: moved-to-used tracking flag
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "movedToUsed" INTEGER;

-- tasks: posting window
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "postingWindow" TEXT;

-- accounts: lifecycle phase system (Phase 1A)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "phase" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "phaseChangedDate" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "warmupStartDate" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "restUntilDate" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "consecutiveActiveDays" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "lastActiveDate" TEXT;

-- accounts: shadow-ban detection (Phase 1C)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "shadowBanStatus" TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "lastShadowCheck" TEXT;

-- tasks: engagement task types (Phase 2B)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "taskType" TEXT;

-- tasks: posting stagger (Phase 2C)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "scheduledTime" TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "postedAt" TEXT;

-- accounts: profile audit fields (Phase 4A)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "hasAvatar" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "hasBanner" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "hasBio" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "hasDisplayName" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "hasVerifiedEmail" INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "lastProfileAudit" TEXT;

-- daily snapshots table (Phase 4C)
CREATE TABLE IF NOT EXISTS "dailySnapshots" (
    "id" BIGSERIAL PRIMARY KEY,
    "date" TEXT,
    "totalKarma" INTEGER,
    "totalAccounts" INTEGER,
    "activeAccounts" INTEGER,
    "postsToday" INTEGER,
    "removalsToday" INTEGER,
    "totalUpvotes" INTEGER,
    "takenAt" TEXT
);

-- subreddits: verification required flag (Phase 3B)
ALTER TABLE subreddits ADD COLUMN IF NOT EXISTS "requiresVerified" INTEGER;

-- verifications: account-subreddit verification tracking (Phase 3B)
CREATE TABLE IF NOT EXISTS verifications (
    "id" BIGSERIAL PRIMARY KEY,
    "accountId" BIGINT REFERENCES accounts("id") ON DELETE CASCADE,
    "subredditId" BIGINT REFERENCES subreddits("id") ON DELETE CASCADE,
    "verified" INTEGER DEFAULT 0,
    "verifiedDate" TEXT
);
