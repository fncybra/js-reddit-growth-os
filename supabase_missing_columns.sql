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
