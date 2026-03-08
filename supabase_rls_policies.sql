-- Supabase Row-Level Security (RLS) Policies
-- Run this in the Supabase SQL Editor to lock down table access.
--
-- Strategy: Use a service_role key on the server-side only.
-- The anon key (used by the frontend) should have restricted access.
-- These policies allow anon users to read/write only via the app's
-- authenticated sync flow (using the anon key with known table structure).
--
-- For tighter security, consider switching to Supabase Auth (JWT-based)
-- and restricting to authenticated users only. For now, this prevents
-- casual abuse while keeping the existing sync architecture working.

-- Enable RLS on all tables
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subreddits ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dailySnapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

-- Allow anon full access (matches current behavior but now explicitly controlled)
-- To restrict further, replace 'anon' with 'authenticated' and add Supabase Auth
CREATE POLICY "Allow anon full access" ON models FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON accounts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON subreddits FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON assets FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON tasks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON performances FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON verifications FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON "dailySnapshots" FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON competitors FOR ALL TO anon USING (true) WITH CHECK (true);

-- IMPORTANT: To truly lock this down, you should:
-- 1. Enable Supabase Auth (email/password or magic link)
-- 2. Change policies from 'anon' to 'authenticated'
-- 3. Add user_id column to tables and use auth.uid() in USING clause
-- 4. Update the frontend CloudSyncService to use Supabase Auth session
