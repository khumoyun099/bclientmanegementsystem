-- ============================================================================
-- 0008_profiles_active.sql
-- ----------------------------------------------------------------------------
-- Adds a soft-delete flag to profiles so admins can remove departing
-- agents without losing historical data (leads, notes, activity_logs
-- still reference their id for audit purposes).
--
-- The Team Management UI (pulse-4 / Phase D) only reads/writes this
-- column. RLS on profiles stays as-is — inactive users keep the ability
-- to log in (in case deactivation was a mistake) but the client filters
-- them out of agent lists, the admin filter dropdown, the Pulse feed,
-- etc. A follow-up migration can tighten further if needed.
--
-- Safe to re-run. Idempotent. Default `true` preserves all existing
-- users as active.
-- ============================================================================

alter table public.profiles
  add column if not exists active boolean default true not null;

-- Mark every existing row as active explicitly (in case the default
-- didn't apply on some legacy rows).
update public.profiles set active = true where active is null;

-- PostgREST schema cache reload so the new column is visible to the REST API
-- without waiting for the automatic reload.
notify pgrst, 'reload schema';
