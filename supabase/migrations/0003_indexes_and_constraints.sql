-- ============================================================================
-- 0003_indexes_and_constraints.sql
-- ----------------------------------------------------------------------------
-- Performance indexes + enum CHECK constraints.
--
-- Indexes: speed up the queries the app actually runs (per-agent list,
-- per-status filter, recent-activity sort). Without these, Postgres does
-- a full table scan every time getLeads() runs.
--
-- CHECK constraints: prevent the "case sensitivity" landmine where a bad
-- INSERT with status='HOT' (uppercase) makes a lead silently unfindable by
-- the client filters that lowercase both sides. With these, Postgres
-- rejects the bad value at write time.
--
-- NOTE: if existing rows violate a CHECK (e.g. mixed-case legacy data),
-- the `alter table ... add constraint ... not valid` pattern is used so
-- the migration never fails mid-flight. Run the VALIDATE step manually
-- after cleaning the data.
-- ============================================================================

-- ---- indexes ---------------------------------------------------------------
create index if not exists idx_leads_assigned_agent    on public.leads(assigned_agent_id);
create index if not exists idx_leads_status            on public.leads(status);
create index if not exists idx_leads_todo              on public.leads(todo);
create index if not exists idx_leads_follow_up_date    on public.leads(follow_up_date);
create index if not exists idx_leads_updated_at        on public.leads(updated_at desc);
create index if not exists idx_leads_agent_status      on public.leads(assigned_agent_id, status);

create index if not exists idx_notes_lead_id           on public.notes(lead_id);
create index if not exists idx_notes_created_at        on public.notes(created_at desc);

create index if not exists idx_activity_logs_lead_id   on public.activity_logs(lead_id);
create index if not exists idx_activity_logs_agent     on public.activity_logs(agent_id);
create index if not exists idx_activity_logs_action    on public.activity_logs(action);
create index if not exists idx_activity_logs_created   on public.activity_logs(created_at desc);
create index if not exists idx_activity_logs_agent_action on public.activity_logs(agent_id, action);

create index if not exists idx_points_history_agent    on public.points_history(agent_id);
create index if not exists idx_points_history_created  on public.points_history(created_at desc);

create index if not exists idx_payout_requests_agent   on public.payout_requests(agent_id);
create index if not exists idx_payout_requests_status  on public.payout_requests(status);

create index if not exists idx_personal_tasks_user     on public.personal_tasks(user_id);
create index if not exists idx_useful_links_user       on public.useful_links(user_id);

-- ---- enum CHECK constraints (NOT VALID first for safety) -------------------
-- The "not valid" variant adds the constraint only for NEW writes. Existing
-- rows are not checked. After cleaning legacy data, run:
--     alter table public.leads validate constraint leads_status_check;
-- to promote the constraint to fully enforced.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_status_check') then
    alter table public.leads
      add constraint leads_status_check
      check (status in ('hot','warm','cold','progressive','sold','closed'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_todo_check') then
    alter table public.leads
      add constraint leads_todo_check
      check (todo in ('new','followup','callback','sale'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('agent','admin'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payout_requests_status_check') then
    alter table public.payout_requests
      add constraint payout_requests_status_check
      check (status in ('pending','approved','denied'))
      not valid;
  end if;
end $$;

-- ---- data cleanup helpers (run manually; NOT part of auto-apply) -----------
-- Find any rows that would violate the new constraints before VALIDATEing:
--
--   select id, status from public.leads where status not in
--     ('hot','warm','cold','progressive','sold','closed');
--   select id, todo from public.leads where todo not in
--     ('new','followup','callback','sale');
--   select id, role from public.profiles where role not in ('agent','admin');
--
-- Fix any offenders (usually with lower()), then promote the constraints:
--
--   alter table public.leads validate constraint leads_status_check;
--   alter table public.leads validate constraint leads_todo_check;
--   alter table public.profiles validate constraint profiles_role_check;
--   alter table public.payout_requests validate constraint payout_requests_status_check;
