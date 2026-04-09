-- ============================================================================
-- 0010_drop_activity_logs_lead_id_notnull.sql
-- ----------------------------------------------------------------------------
-- Hotfix #3 in the audit-trail debugging chain. After 0007 (date cast)
-- and 0009 (trigger DELETE branch), DELETEs on `leads` were STILL
-- failing with:
--
--   ERROR: 23502: null value in column "lead_id" of relation
--   "activity_logs" violates not-null constraint
--   CONTEXT: SQL statement "UPDATE ONLY public.activity_logs
--            SET lead_id = NULL WHERE ... = lead_id"
--
-- Root cause: schema drift. Our baseline migration declared
-- activity_logs.lead_id as nullable, but the production table has it
-- as NOT NULL (from a pre-baseline schema that predates version
-- control). The Phase 2 ON DELETE SET NULL FK action fires correctly
-- on every lead delete, but the cascade UPDATE that sets lead_id to
-- NULL on existing audit rows immediately fails the NOT NULL check
-- and rolls back the entire DELETE.
--
-- Fix: drop the NOT NULL constraint on activity_logs.lead_id. The
-- column was always meant to be nullable per the baseline + the
-- ON DELETE SET NULL semantics — production just had a stale schema.
--
-- After this migration, deletes work end-to-end:
--   1. DELETE leads → succeeds
--   2. ON DELETE SET NULL cascade → sets matching activity_logs rows'
--      lead_id to NULL (now allowed)
--   3. log_lead_change trigger fires → inserts a fresh audit row with
--      lead_id = NULL and the original lead UUID + name in details
--      (per 0009)
--
-- Idempotent. Safe to re-run.
-- ============================================================================

alter table public.activity_logs alter column lead_id drop not null;

-- PostgREST schema reload so the REST API picks up the constraint change.
notify pgrst, 'reload schema';
