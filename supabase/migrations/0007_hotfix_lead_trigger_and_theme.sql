-- ============================================================================
-- 0007_hotfix_lead_trigger_and_theme.sql
-- ----------------------------------------------------------------------------
-- Two production hotfixes discovered after Phase 2 + Phase 6 went live:
--
-- 1. `log_lead_change()` trigger crashes when follow_up_date changes.
--    My trigger assumed `leads.follow_up_date` is TEXT (what types.ts and
--    the baseline migration declare), but production has it as DATE.
--    `coalesce(date_col, '—')` tries to cast the em-dash to date and fails
--    with "22007: invalid input syntax for type date". The fix is to cast
--    every potentially-nullable column to text BEFORE coalescing the '—'
--    placeholder — this works whether the underlying column is text or date.
--
-- 2. `profiles.theme_preference` column is missing in production.
--    The baseline migration used CREATE TABLE IF NOT EXISTS, so the column
--    was never added to the pre-existing profiles table. The client fires
--    updateThemePreference on every re-render, each one 400s with
--    PGRST204 "Could not find the 'theme_preference' column". Noisy but
--    not breaking any feature.
--
-- Safe to re-run. Idempotent. No RLS changes, no data changes.
-- ============================================================================

-- ---- Fix 1: patched log_lead_change() trigger function ---------------------
-- Only change vs 0004: every column is cast to ::text before coalesce so the
-- '—' placeholder is always a safe type match. Everything else is identical.
create or replace function public.log_lead_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.assigned_agent_id);
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'status_changed',
                format('Status: %s → %s (trigger)',
                       coalesce(old.status::text, '—'),
                       coalesce(new.status::text, '—')));
    end if;
    if new.todo is distinct from old.todo then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'todo_changed',
                format('Todo: %s → %s (trigger)',
                       coalesce(old.todo::text, '—'),
                       coalesce(new.todo::text, '—')));
    end if;
    if new.follow_up_date is distinct from old.follow_up_date then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'date_changed',
                format('Follow-up date: %s → %s (trigger)',
                       coalesce(old.follow_up_date::text, '—'),
                       coalesce(new.follow_up_date::text, '—')));
    end if;
    if new.every is distinct from old.every then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'frequency_changed',
                format('Frequency: %s → %s (trigger)',
                       coalesce(old.every::text, '—'),
                       coalesce(new.every::text, '—')));
    end if;
    if new.cold_status is distinct from old.cold_status then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'cold_status_changed',
                format('Cold status: %s → %s (trigger)',
                       coalesce(old.cold_status::text, '—'),
                       coalesce(new.cold_status::text, '—')));
    end if;
    if new.assigned_agent_id is distinct from old.assigned_agent_id then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'reassigned',
                format('Reassigned: %s → %s (trigger)',
                       coalesce(old.assigned_agent_name, old.assigned_agent_id::text, '—'),
                       coalesce(new.assigned_agent_name, new.assigned_agent_id::text, '—')));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.activity_logs(lead_id, agent_id, action, details)
      values (old.id, coalesce(auth.uid(), old.assigned_agent_id), 'deleted',
              format('Lead "%s" permanently deleted (trigger)',
                     coalesce(old.name, old.id::text)));
    return old;
  end if;
  return null;
end;
$$;

-- Trigger itself is unchanged — the function body replacement is what fixes it.

-- ---- Fix 2: add missing profiles.theme_preference column -------------------
alter table public.profiles
  add column if not exists theme_preference text default 'dark';

-- Tell PostgREST to reload its schema cache so the new column is visible
-- to the REST API immediately (no need to wait for the automatic reload).
notify pgrst, 'reload schema';
