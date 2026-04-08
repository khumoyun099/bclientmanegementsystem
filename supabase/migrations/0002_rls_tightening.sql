-- ============================================================================
-- 0002_rls_tightening.sql
-- ----------------------------------------------------------------------------
-- Replaces the wide-open `FOR ALL USING (auth.role() = 'authenticated')`
-- policies with role-aware ones.
--
-- BEFORE: any authenticated user could SELECT/UPDATE/DELETE any row in
-- leads, notes, activity_logs, points_history, payout_requests, etc. The
-- UI filtered by agent but the database did not. This was the single
-- largest data-integrity vector behind the "we lose leads" reports.
--
-- AFTER:
--   • Agents see/update only their own leads (and their notes/logs).
--   • Admins see/update everything.
--   • DELETE on leads is admin-only.
--   • Payouts: agents create & read their own; admins approve/update.
--   • Personal tasks & useful links: strict owner-only.
--
-- ROLLBACK: the bottom of this file has a commented-out block that
-- re-creates the old permissive policies. To roll back, uncomment and run.
--
-- PRE-FLIGHT CHECK (do this BEFORE applying to prod):
--   1. Apply this migration to a Supabase branch / staging project.
--   2. Log in as an agent, verify CRM page still shows their leads.
--   3. Log in as an admin, verify AccountabilityDashboard sees everyone.
--   4. Verify addLead, updateLead, reassign, bulk delete all still work.
--   5. Only then apply to production, during low-traffic window.
-- ============================================================================

-- ---- is_admin() helper -----------------------------------------------------
-- SECURITY DEFINER so it can read `profiles` under the tightened policies.
-- search_path is pinned to prevent search_path-based privilege escalation.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---- drop old permissive policies ------------------------------------------
do $$ begin
  drop policy if exists "Auth all" on public.leads;
  drop policy if exists "Auth all" on public.notes;
  drop policy if exists "Auth all" on public.activity_logs;
  drop policy if exists "Auth all" on public.points_history;
  drop policy if exists "Auth all" on public.payout_requests;
  drop policy if exists "Auth all" on public.agent_targets;
  drop policy if exists "Auth all" on public.agent_strategies;
  drop policy if exists "Auth all" on public.personal_tasks;
  drop policy if exists "Auth all" on public.useful_links;
end $$;

-- ---- leads -----------------------------------------------------------------
create policy "leads_select" on public.leads
  for select
  using (public.is_admin() or assigned_agent_id = auth.uid());

create policy "leads_insert" on public.leads
  for insert
  with check (public.is_admin() or assigned_agent_id = auth.uid());

create policy "leads_update" on public.leads
  for update
  using (public.is_admin() or assigned_agent_id = auth.uid())
  with check (public.is_admin() or assigned_agent_id = auth.uid());

create policy "leads_delete" on public.leads
  for delete
  using (public.is_admin());

-- ---- notes (readable/writable by owning lead's agent or any admin) ---------
create policy "notes_select" on public.notes
  for select using (
    public.is_admin() or exists (
      select 1 from public.leads l
      where l.id = notes.lead_id and l.assigned_agent_id = auth.uid()
    )
  );

create policy "notes_insert" on public.notes
  for insert with check (
    public.is_admin() or exists (
      select 1 from public.leads l
      where l.id = notes.lead_id and l.assigned_agent_id = auth.uid()
    )
  );

create policy "notes_update" on public.notes
  for update using (
    public.is_admin() or author_id = auth.uid()
  );

create policy "notes_delete" on public.notes
  for delete using (public.is_admin());

-- ---- activity_logs (append-only audit trail) -------------------------------
create policy "activity_logs_select" on public.activity_logs
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "activity_logs_insert" on public.activity_logs
  for insert with check (auth.uid() is not null);

-- No UPDATE or DELETE policy on activity_logs — audit trail is immutable.
-- (Admins wanting to prune stale logs can do so via a service-role RPC.)

-- ---- points_history --------------------------------------------------------
create policy "points_history_select" on public.points_history
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "points_history_insert" on public.points_history
  for insert with check (public.is_admin() or agent_id = auth.uid());

-- ---- payout_requests -------------------------------------------------------
create policy "payout_requests_select" on public.payout_requests
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "payout_requests_insert" on public.payout_requests
  for insert with check (agent_id = auth.uid());

create policy "payout_requests_update" on public.payout_requests
  for update using (public.is_admin());

-- ---- agent_targets ---------------------------------------------------------
create policy "agent_targets_select" on public.agent_targets
  for select using (public.is_admin() or agent_id = auth.uid());

create policy "agent_targets_write" on public.agent_targets
  for all using (public.is_admin())
  with check (public.is_admin());

-- ---- agent_strategies (private per agent) ----------------------------------
create policy "agent_strategies_rw" on public.agent_strategies
  for all
  using (agent_id = auth.uid() or public.is_admin())
  with check (agent_id = auth.uid() or public.is_admin());

-- ---- personal_tasks (strict owner only) ------------------------------------
create policy "personal_tasks_rw" on public.personal_tasks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- useful_links (strict owner only) --------------------------------------
create policy "useful_links_rw" on public.useful_links
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- ROLLBACK (uncomment + run to restore the permissive baseline)
-- ============================================================================
-- drop policy if exists "leads_select"          on public.leads;
-- drop policy if exists "leads_insert"          on public.leads;
-- drop policy if exists "leads_update"          on public.leads;
-- drop policy if exists "leads_delete"          on public.leads;
-- drop policy if exists "notes_select"          on public.notes;
-- drop policy if exists "notes_insert"          on public.notes;
-- drop policy if exists "notes_update"          on public.notes;
-- drop policy if exists "notes_delete"          on public.notes;
-- drop policy if exists "activity_logs_select"  on public.activity_logs;
-- drop policy if exists "activity_logs_insert"  on public.activity_logs;
-- drop policy if exists "points_history_select" on public.points_history;
-- drop policy if exists "points_history_insert" on public.points_history;
-- drop policy if exists "payout_requests_select" on public.payout_requests;
-- drop policy if exists "payout_requests_insert" on public.payout_requests;
-- drop policy if exists "payout_requests_update" on public.payout_requests;
-- drop policy if exists "agent_targets_select"  on public.agent_targets;
-- drop policy if exists "agent_targets_write"   on public.agent_targets;
-- drop policy if exists "agent_strategies_rw"   on public.agent_strategies;
-- drop policy if exists "personal_tasks_rw"     on public.personal_tasks;
-- drop policy if exists "useful_links_rw"       on public.useful_links;
-- create policy "Auth all" on public.leads            for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.notes            for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.activity_logs    for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.points_history   for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.payout_requests  for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.agent_targets    for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.agent_strategies for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.personal_tasks   for all using (auth.role() = 'authenticated');
-- create policy "Auth all" on public.useful_links     for all using (auth.role() = 'authenticated');
