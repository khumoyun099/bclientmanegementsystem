-- ============================================================================
-- 0004_audit_triggers.sql
-- ----------------------------------------------------------------------------
-- Belt-and-braces audit trail: a Postgres trigger that writes an
-- `activity_logs` row on every meaningful UPDATE/DELETE of leads.
--
-- Phase 1 already added client-side audit logging inside db.updateLead,
-- but a bad client, a service-role script, or a direct SQL edit would
-- bypass it. This trigger catches ALL paths.
--
-- Tracked fields: status, todo, follow_up_date, every, cold_status,
-- assigned_agent_id. Changes to updated_at alone are ignored (those are
-- produced by the trigger's own UPDATE, not user-meaningful).
--
-- On DELETE: one `deleted` entry with the lead's name for forensic recall.
--
-- IMPORTANT: `activity_logs.lead_id` was declared with ON DELETE CASCADE,
-- which would wipe the audit trail the instant a lead is deleted. This
-- migration relaxes that FK to ON DELETE SET NULL so the audit row survives
-- beyond the lead itself. The human-readable details column still contains
-- the lead name for forensic recall.
-- ============================================================================

-- ---- relax activity_logs FK so audit rows survive lead deletion ------------
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.activity_logs'::regclass
    and contype = 'f'
    and array_to_string(conkey, ',') = (
      select array_to_string(array[attnum], ',')
      from pg_attribute
      where attrelid = 'public.activity_logs'::regclass and attname = 'lead_id'
    );
  if v_constraint is not null then
    execute format('alter table public.activity_logs drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.activity_logs
  add constraint activity_logs_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;


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
                format('Status: %s → %s (trigger)', coalesce(old.status,'—'), coalesce(new.status,'—')));
    end if;
    if new.todo is distinct from old.todo then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'todo_changed',
                format('Todo: %s → %s (trigger)', coalesce(old.todo,'—'), coalesce(new.todo,'—')));
    end if;
    if new.follow_up_date is distinct from old.follow_up_date then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'date_changed',
                format('Follow-up date: %s → %s (trigger)', coalesce(old.follow_up_date,'—'), coalesce(new.follow_up_date,'—')));
    end if;
    if new.every is distinct from old.every then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'frequency_changed',
                format('Frequency: %s → %s (trigger)', coalesce(old.every,'—'), coalesce(new.every,'—')));
    end if;
    if new.cold_status is distinct from old.cold_status then
      insert into public.activity_logs(lead_id, agent_id, action, details)
        values (new.id, v_actor, 'cold_status_changed',
                format('Cold status: %s → %s (trigger)', coalesce(old.cold_status,'—'), coalesce(new.cold_status,'—')));
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
              format('Lead "%s" permanently deleted (trigger)', coalesce(old.name, old.id::text)));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_lead_change on public.leads;
create trigger trg_log_lead_change
  after update or delete on public.leads
  for each row execute function public.log_lead_change();

-- ROLLBACK:
--   drop trigger if exists trg_log_lead_change on public.leads;
--   drop function if exists public.log_lead_change();
