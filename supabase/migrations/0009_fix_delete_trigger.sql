-- ============================================================================
-- 0009_fix_delete_trigger.sql
-- ----------------------------------------------------------------------------
-- Hotfix: every DELETE on `leads` was failing because of a latent bug in
-- the Phase 2 audit trigger from 0004_audit_triggers.sql.
--
-- WHY IT BROKE:
--   The AFTER DELETE branch of `log_lead_change` tried to insert an
--   audit row into `activity_logs` with `lead_id = old.id`. By the time
--   the trigger fires, the lead row has already been removed from
--   `leads`. The FK constraint on `activity_logs.lead_id` then rejects
--   the insert because the referenced lead no longer exists, and the
--   whole DELETE rolls back. Result: "Failed to delete lead" /
--   "Bulk delete failed" toasts on every delete attempt.
--
--   The ON DELETE SET NULL FK fix in 0004 only handles existing audit
--   rows that referenced the deleted lead. It does NOT help new INSERTs
--   that try to reference the just-deleted lead within the same
--   statement.
--
-- THE FIX:
--   On DELETE, insert with `lead_id = NULL`. The lead reference is gone
--   anyway (the row was just removed), and the original lead name +
--   UUID are preserved in the human-readable `details` text so admin
--   forensics still work — they just search activity_logs by name
--   instead of by lead_id.
--
--   UPDATE branches are unchanged — they always run before the row is
--   gone, so their FK references are valid.
--
-- Safe to re-run. Idempotent (CREATE OR REPLACE).
-- ============================================================================

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
    -- CRITICAL: lead_id MUST be NULL here. The lead row has already
    -- been removed by the time this AFTER DELETE trigger fires, so
    -- referencing old.id would violate the FK constraint and roll back
    -- the entire DELETE statement. Storing the original UUID + name in
    -- the human-readable `details` column preserves forensic value
    -- without breaking the foreign key.
    insert into public.activity_logs(lead_id, agent_id, action, details)
      values (
        NULL,
        coalesce(auth.uid(), old.assigned_agent_id),
        'deleted',
        format('Lead "%s" (id: %s) permanently deleted (trigger)',
               coalesce(old.name, '—'),
               old.id::text)
      );
    return old;
  end if;
  return null;
end;
$$;
