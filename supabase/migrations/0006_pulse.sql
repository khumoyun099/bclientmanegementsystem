-- ============================================================================
-- 0006_pulse.sql — Pulse: AI Coaching Layer (Phase 6)
-- ----------------------------------------------------------------------------
-- Adds the database substrate for the Pulse coaching feature:
--   * pulse_playbook   — admin-curated sales doctrine, versioned
--   * pulse_signals    — numeric, deterministic per-lead signals (no AI)
--   * pulse_insights   — AI narrative cache (used by Pulse-2+)
--   * pulse_briefings  — daily morning briefing per agent (used by Pulse-3+)
--   * pulse_feedback   — thumbs up/down on AI insights (used by Pulse-5)
--
-- Plus:
--   * refresh_pulse_signals() — pure SQL recompute, runs every 15 min
--   * get_pulse_feed()        — RPC the client calls to render the feed
--   * pg_cron schedule        — recompute every 15 min
--   * default playbook seed   — admin can edit immediately
--
-- All tables have RLS aligned with the Phase 2 model:
--   agents see only their own rows, admins see everything.
-- ============================================================================

-- ---- pulse_playbook --------------------------------------------------------
create table if not exists public.pulse_playbook (
  id          uuid primary key default gen_random_uuid(),
  version     int  not null,
  content_md  text not null,
  active      boolean not null default false,
  notes       text,                       -- "why I changed it"
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz default now() not null
);

-- Only one row may be `active = true` at a time
create unique index if not exists pulse_playbook_one_active
  on public.pulse_playbook (active) where active = true;

alter table public.pulse_playbook enable row level security;

drop policy if exists "playbook_read"  on public.pulse_playbook;
drop policy if exists "playbook_write" on public.pulse_playbook;

create policy "playbook_read" on public.pulse_playbook
  for select using (auth.role() = 'authenticated');

create policy "playbook_write" on public.pulse_playbook
  for all using (public.is_admin())
  with check (public.is_admin());

-- ---- pulse_signals ---------------------------------------------------------
create table if not exists public.pulse_signals (
  lead_id               uuid primary key references public.leads(id) on delete cascade,
  agent_id              uuid not null references auth.users(id) on delete cascade,
  status                text not null,
  todo                  text,
  every_days            int,
  cadence_source        text,             -- 'explicit' | 'inferred' | 'fallback'
  days_since_last_touch int,
  days_overdue          int,
  silence_score         numeric(5,2),
  reschedule_streak     int,
  notes_7d              int,
  notes_14d             int,
  cold_checks_missing   int,
  last_touch_at         timestamptz,
  computed_at           timestamptz default now() not null
);

create index if not exists idx_pulse_signals_agent        on public.pulse_signals(agent_id);
create index if not exists idx_pulse_signals_silence      on public.pulse_signals(silence_score desc);
create index if not exists idx_pulse_signals_days_overdue on public.pulse_signals(days_overdue desc);

alter table public.pulse_signals enable row level security;

drop policy if exists "signals_read" on public.pulse_signals;
create policy "signals_read" on public.pulse_signals
  for select using (public.is_admin() or agent_id = auth.uid());
-- writes happen exclusively via SECURITY DEFINER refresh function

-- ---- pulse_insights (table only; populated in Pulse-2) ---------------------
create table if not exists public.pulse_insights (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads(id) on delete cascade,
  agent_id         uuid not null references auth.users(id) on delete cascade,
  kind             text not null,             -- 'lead_summary' | 'next_action' | 'risk' | 'silence' | 'broken_promise'
  title            text not null,
  body             text not null,
  priority         int  not null default 50,
  category         text not null,
  meta             jsonb,
  created_at       timestamptz default now() not null,
  expires_at       timestamptz not null,
  read_at          timestamptz,
  dismissed_at     timestamptz,
  dismissed_reason text
);

create index if not exists idx_pulse_insights_agent_active
  on public.pulse_insights(agent_id, expires_at)
  where dismissed_at is null;
create index if not exists idx_pulse_insights_lead on public.pulse_insights(lead_id);

alter table public.pulse_insights enable row level security;

drop policy if exists "insights_read"        on public.pulse_insights;
drop policy if exists "insights_update_own"  on public.pulse_insights;

create policy "insights_read" on public.pulse_insights
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "insights_update_own" on public.pulse_insights
  for update using (public.is_admin() or agent_id = auth.uid())
  with check (public.is_admin() or agent_id = auth.uid());

-- ---- pulse_briefings (table only; populated in Pulse-3) --------------------
create table if not exists public.pulse_briefings (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references auth.users(id) on delete cascade,
  for_date          date not null,
  body_md           text not null,
  priority_lead_ids uuid[] default '{}',
  meta              jsonb,
  created_at        timestamptz default now() not null,
  read_at           timestamptz,
  unique(agent_id, for_date)
);

create index if not exists idx_pulse_briefings_agent_date
  on public.pulse_briefings(agent_id, for_date desc);

alter table public.pulse_briefings enable row level security;

drop policy if exists "briefings_read"       on public.pulse_briefings;
drop policy if exists "briefings_update_own" on public.pulse_briefings;

create policy "briefings_read" on public.pulse_briefings
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "briefings_update_own" on public.pulse_briefings
  for update using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

-- ---- pulse_feedback (table only; populated in Pulse-5) ---------------------
create table if not exists public.pulse_feedback (
  id          uuid primary key default gen_random_uuid(),
  insight_id  uuid references public.pulse_insights(id) on delete cascade,
  briefing_id uuid references public.pulse_briefings(id) on delete cascade,
  agent_id    uuid not null references auth.users(id) on delete cascade,
  rating      int  not null check (rating in (-1, 0, 1)),
  reason      text,
  created_at  timestamptz default now() not null
);

alter table public.pulse_feedback enable row level security;

drop policy if exists "feedback_rw" on public.pulse_feedback;
create policy "feedback_rw" on public.pulse_feedback
  for all using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

-- ============================================================================
-- refresh_pulse_signals() — recomputes the entire pulse_signals table from
-- leads + notes + activity_logs. Pure SQL math, no AI. Safe to run repeatedly.
--
-- Notes on field semantics:
--   every_days     = lead.every::int when set, else 10 (fallback)
--   silence_score  = days_since_last_note / every_days  (>1.0 = overdue rhythm)
--   days_overdue   = max(0, today - follow_up_date)
--   reschedule_streak = consecutive `date_changed` events with no `note_added`
--                       between them
--   cold_checks_missing = expected daily cold check-ins minus actual
--                         (capped at 4 since cold cadence is 4 days)
-- ============================================================================
create or replace function public.refresh_pulse_signals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.pulse_signals;

  insert into public.pulse_signals (
    lead_id, agent_id, status, todo, every_days, cadence_source,
    days_since_last_touch, days_overdue, silence_score,
    reschedule_streak, notes_7d, notes_14d, cold_checks_missing, last_touch_at
  )
  with last_note as (
    select lead_id, max(created_at) as last_at
    from public.notes
    group by lead_id
  ),
  last_status_change as (
    select lead_id, max(created_at) as last_at
    from public.activity_logs
    where action in ('status_changed','date_changed','todo_changed','note_added')
    group by lead_id
  ),
  reschedule_count as (
    -- Count `date_changed` events that occurred AFTER the last `note_added`
    -- (or all of them if there's never been a note).
    select
      l.id as lead_id,
      coalesce(count(*) filter (
        where al.action = 'date_changed'
          and al.created_at > coalesce(
            (select max(al2.created_at)
               from public.activity_logs al2
              where al2.lead_id = l.id and al2.action = 'note_added'),
            '1970-01-01'::timestamptz)
      ), 0)::int as streak
    from public.leads l
    left join public.activity_logs al on al.lead_id = l.id
    group by l.id
  ),
  notes_window as (
    select
      lead_id,
      count(*) filter (where created_at > now() - interval '7 days')::int  as n7,
      count(*) filter (where created_at > now() - interval '14 days')::int as n14
    from public.notes
    group by lead_id
  )
  select
    l.id,
    l.assigned_agent_id,
    l.status,
    l.todo,
    coalesce(nullif(l.every, '')::int, 10) as every_days,
    case when l.every is not null and l.every <> '' then 'explicit' else 'fallback' end,
    -- days since the most recent of: last note, last status change, lead creation
    extract(day from (
      now() - greatest(
        coalesce(ln.last_at, l.created_at),
        coalesce(lsc.last_at, l.created_at),
        l.created_at
      )
    ))::int as days_since_last_touch,
    greatest(0, (current_date - l.follow_up_date::date))::int as days_overdue,
    round(
      extract(day from (now() - coalesce(ln.last_at, l.created_at)))::numeric
      / nullif(coalesce(nullif(l.every, '')::int, 10), 0),
      2
    ) as silence_score,
    coalesce(rc.streak, 0) as reschedule_streak,
    coalesce(nw.n7, 0)  as notes_7d,
    coalesce(nw.n14, 0) as notes_14d,
    -- Cold compliance: expected 4 check-ins per cold lead. Production
    -- does not track `cold_start_date`, so we can't compute "how many
    -- should they have done by now"; we fall back to a simpler rule —
    -- flag any cold lead that has fewer than 4 recorded check-ins.
    case
      when l.status = 'cold' then
        greatest(0, 4 - coalesce(array_length(l.cold_check_history, 1), 0))
      else 0
    end::int as cold_checks_missing,
    greatest(
      coalesce(ln.last_at, l.created_at),
      l.updated_at
    ) as last_touch_at
  from public.leads l
  left join last_note          ln  on ln.lead_id = l.id
  left join last_status_change lsc on lsc.lead_id = l.id
  left join reschedule_count   rc  on rc.lead_id = l.id
  left join notes_window       nw  on nw.lead_id = l.id
  where l.status not in ('sold', 'closed');
end;
$$;

revoke all on function public.refresh_pulse_signals() from public;
grant execute on function public.refresh_pulse_signals() to service_role;

-- ============================================================================
-- get_pulse_feed(p_agent_id) — returns the categorized feed the UI renders.
-- If p_agent_id is null, returns the caller's own feed (or admin's view of
-- the whole team if caller is admin).
--
-- The category column is computed in SQL so the rules cannot drift between
-- the client (lib/leadRules.ts) and the database.
-- ============================================================================
create or replace function public.get_pulse_feed(p_agent_id uuid default null)
returns table (
  lead_id              uuid,
  agent_id             uuid,
  agent_name           text,
  lead_name            text,
  status               text,
  todo                 text,
  follow_up_date       text,
  category             text,
  silence_score        numeric,
  days_overdue         int,
  days_since_last_touch int,
  reschedule_streak    int,
  every_days           int,
  cadence_source       text,
  notes_7d             int,
  cold_checks_missing  int,
  last_note_text       text,
  last_note_at         timestamptz,
  computed_at          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      s.*,
      l.name             as lead_name,
      l.follow_up_date,
      l.assigned_agent_name,
      (select n.text       from public.notes n where n.lead_id = l.id order by n.created_at desc limit 1) as last_note_text,
      (select n.created_at from public.notes n where n.lead_id = l.id order by n.created_at desc limit 1) as last_note_at
    from public.pulse_signals s
    join public.leads l on l.id = s.lead_id
    where (
      public.is_admin()
      or s.agent_id = auth.uid()
    )
    and (
      p_agent_id is null
      or s.agent_id = p_agent_id
    )
  )
  select
    lead_id,
    agent_id,
    assigned_agent_name as agent_name,
    lead_name,
    status,
    todo,
    follow_up_date,
    case
      when days_overdue > 0 and status in ('hot','warm') then 'overdue'
      when status = 'progressive' and silence_score > 1.0 then 'sleeping_progressive'
      when status = 'warm' and silence_score > 1.0 then 'warm_slipping'
      when reschedule_streak >= 3 then 'reschedule'
      when last_note_text is not null
        and (
          last_note_text ilike '%will call%'
          or last_note_text ilike '%call back%'
          or last_note_text ilike '%send quote%'
          or last_note_text ilike '%follow up%'
          or last_note_text ilike '%let me check%'
          or last_note_text ilike '%i will send%'
          or last_note_text ilike '%i''ll send%'
        )
        and days_since_last_touch > 2
        then 'promised'
      when status = 'cold' and cold_checks_missing > 0 then 'cold_missing_checks'
      else null
    end as category,
    silence_score,
    days_overdue,
    days_since_last_touch,
    reschedule_streak,
    every_days,
    cadence_source,
    notes_7d,
    cold_checks_missing,
    last_note_text,
    last_note_at,
    computed_at
  from base
  where (
    days_overdue > 0
    or silence_score > 0.8
    or reschedule_streak >= 3
    or cold_checks_missing > 0
    or (last_note_text is not null and (
      last_note_text ilike '%will call%'
      or last_note_text ilike '%call back%'
      or last_note_text ilike '%send quote%'
      or last_note_text ilike '%follow up%'
      or last_note_text ilike '%let me check%'
      or last_note_text ilike '%i will send%'
      or last_note_text ilike '%i''ll send%'
    ) and days_since_last_touch > 2)
  )
  order by
    case when days_overdue > 0 then 0 else 1 end,
    silence_score desc nulls last,
    days_overdue desc;
$$;

revoke all on function public.get_pulse_feed(uuid) from public;
grant execute on function public.get_pulse_feed(uuid) to authenticated;

-- ============================================================================
-- pg_cron: refresh signals every 15 minutes
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- unschedule any prior version with the same name (idempotent)
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'refresh_pulse_signals_15m';

    perform cron.schedule(
      'refresh_pulse_signals_15m',
      '*/15 * * * *',
      $cron$ select public.refresh_pulse_signals(); $cron$
    );
  else
    raise notice 'pg_cron extension not installed; skipping schedule. Run refresh_pulse_signals() manually or enable pg_cron.';
  end if;
end $$;

-- One immediate refresh so the first dashboard load has data
select public.refresh_pulse_signals();

-- ============================================================================
-- Default Playbook — seeded if no playbook rows exist yet.
-- Admin can edit, version, and roll back via the PlaybookEditor UI.
-- This is the same content as features/pulse/prompts/playbook.default.md so
-- the AI immediately speaks the team's industry from its very first call.
-- ============================================================================
insert into public.pulse_playbook (version, content_md, active, notes)
select
  1,
  $playbook$# Sales Doctrine — Default

## Lead Status Meanings
- **HOT**: ready to book within 7 days. Follow up daily.
- **WARM**: interested but evaluating. Follow up every 3-5 days.
- **PROGRESSIVE**: wants to buy but not urgent. Follow up every 7-10 days.
- **COLD**: unresponsive. 4 check-ins over 4 days before closing.
- **SOLD**: deal closed.
- **CLOSED**: lost / not interested / wrong fit.

## Travel Industry Patterns
- "Needs to check with spouse/partner" → 7-10 day window before momentum dies.
  After 14 days, the customer has moved on.
- "Needs dates" → send 2-3 date options proactively, don't wait for them to choose.
- Progressive customers respond to TRAVEL INSPIRATION, not pressure.
  Send a destination article or new package, not "just checking in".
- Repeated reschedules without notes = wrong approach. Change channel
  (email → call, or call → message) after 3 reschedules.
- Family/group trips have a longer decision cycle than solo trips. Don't
  push hard before week 2.

## Coaching Style
- When silence score > 1.5x cadence: this lead is being lost. Recommend an
  urgent re-engagement TODAY.
- When reschedule streak >= 3: stop rescheduling. Recommend a different tactic.
- When notes contain "will send" or "call back" but no follow-through: broken
  promise. The customer noticed. Recommend immediate delivery.
- Tone: direct, supportive, never preachy. Maximum 60 words per insight.
- Always reference the lead by name. Never invent facts.
$playbook$,
  true,
  'Initial default doctrine — admin should edit this for industry specifics.'
where not exists (select 1 from public.pulse_playbook);
