-- ============================================================================
-- 0005_award_points_rpc.sql
-- ----------------------------------------------------------------------------
-- Atomic RPC for awarding/deducting points. Replaces the
-- read-modify-write pattern in services/db.ts:awardPoints that could
-- silently lose increments under concurrent calls.
--
-- USAGE from the client (after applying this migration):
--
--   await supabase.rpc('award_points', {
--     p_agent_id: agentId,
--     p_agent_name: agentName,
--     p_amount: 10,
--     p_reason: 'New sale',
--     p_lead_id: leadId,
--   });
--
-- The single-statement UPDATE uses `points = coalesce(points,0) + p_amount`
-- which is safe under concurrent execution.
-- ============================================================================

create or replace function public.award_points(
  p_agent_id   uuid,
  p_agent_name text,
  p_amount     integer,
  p_reason     text,
  p_lead_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_agent_id is null then
    raise exception 'award_points: p_agent_id is required';
  end if;

  update public.profiles
     set points = coalesce(points, 0) + p_amount
   where id = p_agent_id;

  insert into public.points_history(agent_id, agent_name, amount, reason, lead_id)
    values (p_agent_id, p_agent_name, p_amount, p_reason, p_lead_id);
end;
$$;

revoke all on function public.award_points(uuid, text, integer, text, uuid) from public;
grant execute on function public.award_points(uuid, text, integer, text, uuid) to authenticated;

-- ---- atomic payout processing ----------------------------------------------
-- Replaces the multi-statement processPayoutRequest flow. Takes the same
-- effect but in a single transaction so partial failures can't leave a
-- half-processed request in the DB.

create or replace function public.process_payout_request(
  p_request_id uuid,
  p_action     text, -- 'approved' | 'denied'
  p_admin_id   uuid,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id   uuid;
  v_agent_name text;
  v_amount     integer;
  v_current    integer;
begin
  if p_action not in ('approved','denied') then
    raise exception 'process_payout_request: p_action must be approved or denied';
  end if;

  select agent_id, agent_name, points_requested
    into v_agent_id, v_agent_name, v_amount
    from public.payout_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'process_payout_request: request % not found', p_request_id;
  end if;

  if p_action = 'approved' then
    select coalesce(points, 0) into v_current
      from public.profiles where id = v_agent_id
      for update;

    if v_current < v_amount then
      raise exception 'Insufficient points (% < %)', v_current, v_amount;
    end if;

    update public.profiles
       set points = v_current - v_amount
     where id = v_agent_id;

    insert into public.points_history(agent_id, agent_name, amount, reason)
      values (v_agent_id, v_agent_name, -v_amount, 'Payout Approved');
  end if;

  update public.payout_requests
     set status       = p_action,
         processed_at = now(),
         processed_by = p_admin_id,
         admin_note   = p_note
   where id = p_request_id;
end;
$$;

revoke all on function public.process_payout_request(uuid, text, uuid, text) from public;
grant execute on function public.process_payout_request(uuid, text, uuid, text) to authenticated;

-- ROLLBACK:
--   drop function if exists public.award_points(uuid, text, integer, text, uuid);
--   drop function if exists public.process_payout_request(uuid, text, uuid, text);
