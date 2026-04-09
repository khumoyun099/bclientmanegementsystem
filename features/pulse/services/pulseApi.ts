/**
 * Pulse data-access layer. All Supabase reads for the Pulse feature live
 * here and nowhere else. Kept out of the main `services/db.ts` so the
 * legacy service is untouched and the Pulse feature is deletable as a unit.
 */

import { supabase } from '../../../services/supabase';
import type { PulseFeedItem, PulsePlaybook } from '../types/pulse.types';

/**
 * Return the categorized Pulse feed for the given agent. If `agentId` is
 * omitted, the RPC returns the caller's own feed (or the full team feed
 * when the caller is admin). Enforcement happens inside the SQL function
 * via `public.is_admin()` + `auth.uid()`, not here.
 */
export async function getPulseFeed(agentId?: string | null): Promise<PulseFeedItem[]> {
  const { data, error } = await supabase.rpc('get_pulse_feed', {
    p_agent_id: agentId ?? null,
  });
  if (error) {
    console.error('getPulseFeed failed:', error);
    return [];
  }
  return (data ?? []) as PulseFeedItem[];
}

/**
 * Fetch the currently active playbook row. Returns null if no active row
 * exists (shouldn't happen post-migration but we handle it gracefully).
 */
export async function getActivePlaybook(): Promise<PulsePlaybook | null> {
  const { data, error } = await supabase
    .from('pulse_playbook')
    .select('*')
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.error('getActivePlaybook failed:', error);
    return null;
  }
  return data as PulsePlaybook | null;
}

/** List every playbook version (newest first) for the admin editor. */
export async function listPlaybookVersions(): Promise<PulsePlaybook[]> {
  const { data, error } = await supabase
    .from('pulse_playbook')
    .select('*')
    .order('version', { ascending: false });
  if (error) {
    console.error('listPlaybookVersions failed:', error);
    return [];
  }
  return (data ?? []) as PulsePlaybook[];
}

/**
 * Save a new playbook version. The new version becomes the only active row
 * (the unique partial index on `active` enforces this). We perform the flip
 * as two statements so the window where zero rows are active is minimal;
 * if the insert fails, the old active row stays active.
 */
export async function savePlaybook(params: {
  content_md: string;
  notes?: string;
  created_by: string;
}): Promise<PulsePlaybook | null> {
  // Find current highest version so we can increment.
  const { data: latest } = await supabase
    .from('pulse_playbook')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;

  // Insert the new row first (inactive), then flip active in a transaction-
  // like sequence. Because the unique partial index allows only one active
  // row, we must deactivate the old one in the same step.
  const { data: inserted, error: insertErr } = await supabase
    .from('pulse_playbook')
    .insert({
      version: nextVersion,
      content_md: params.content_md,
      notes: params.notes ?? null,
      created_by: params.created_by,
      active: false,
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    console.error('savePlaybook insert failed:', insertErr);
    throw insertErr;
  }

  // Deactivate previously active row(s)
  const { error: deactErr } = await supabase
    .from('pulse_playbook')
    .update({ active: false })
    .eq('active', true);
  if (deactErr) {
    console.error('savePlaybook deactivate failed:', deactErr);
    throw deactErr;
  }

  // Activate the new version
  const { data: activated, error: actErr } = await supabase
    .from('pulse_playbook')
    .update({ active: true })
    .eq('id', inserted.id)
    .select()
    .single();

  if (actErr || !activated) {
    console.error('savePlaybook activate failed:', actErr);
    throw actErr;
  }

  return activated as PulsePlaybook;
}

/** Roll back to an older playbook version by making it active. */
export async function activatePlaybookVersion(id: string): Promise<void> {
  const { error: deactErr } = await supabase
    .from('pulse_playbook')
    .update({ active: false })
    .eq('active', true);
  if (deactErr) throw deactErr;

  const { error: actErr } = await supabase
    .from('pulse_playbook')
    .update({ active: true })
    .eq('id', id);
  if (actErr) throw actErr;
}

// NOTE: `refresh_pulse_signals()` is granted to service_role only (see
// features/pulse/db/0006_pulse.sql). Clients do NOT trigger recomputes;
// the pg_cron job runs every 15 minutes. The UI refresh button simply
// re-reads `get_pulse_feed` so agents see the latest stored snapshot.

// ---------------------------------------------------------------------------
// Pulse-2: AI insight generation via the `pulse-generate-insight` edge fn.
// ---------------------------------------------------------------------------

import type { PulseCategory } from '../types/pulse.types';

export interface AiInsight {
  lead_id: string;
  kind: string;
  title: string;
  body: string;
  category: PulseCategory | string;
  expires_at: string;
}

export interface GenerateInsightsRequest {
  /** The agent the insights are FOR (admin may differ from caller). */
  agent_id: string;
  agent_name?: string;
  leads: Array<{
    lead_id: string;
    name: string;
    status: string;
    category: string;
    silence_score: number | null;
    days_overdue: number | null;
    days_since_last_touch: number | null;
    reschedule_streak: number | null;
    every_days: number | null;
    last_note_text: string | null;
  }>;
}

export interface GenerateInsightsResponse {
  insights: AiInsight[];
  generated: number;
  cached: number;
  skipped: number;
  ai_enabled: boolean;
  ai_error?: boolean;
  rate_limited?: boolean;
  error?: string;
}

/**
 * Invoke the Pulse insight generation edge function. The function handles
 * caching, rate limiting, and the kill switch internally; the client just
 * passes in the current feed and receives insights back.
 *
 * Fails soft: on ANY error it returns an empty response so the UI falls
 * back to the deterministic narrative from Pulse-1 without crashing.
 */
export async function generateInsightsBatch(
  req: GenerateInsightsRequest,
): Promise<GenerateInsightsResponse> {
  try {
    const { data, error } = await supabase.functions.invoke<GenerateInsightsResponse>(
      'pulse-generate-insight',
      { body: req },
    );
    if (error) {
      console.warn('pulse-generate-insight invoke error:', error.message);
      return {
        insights: [],
        generated: 0,
        cached: 0,
        skipped: 0,
        ai_enabled: false,
        ai_error: true,
      };
    }
    return (
      data ?? {
        insights: [],
        generated: 0,
        cached: 0,
        skipped: 0,
        ai_enabled: false,
      }
    );
  } catch (err) {
    console.warn('pulse-generate-insight threw:', err);
    return {
      insights: [],
      generated: 0,
      cached: 0,
      skipped: 0,
      ai_enabled: false,
      ai_error: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Pulse-3: morning briefing via the `pulse-generate-briefing` edge fn.
// ---------------------------------------------------------------------------

export interface BriefingRow {
  id: string;
  agent_id: string;
  for_date: string;
  body_md: string;
  priority_lead_ids: string[];
  meta: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

export interface BriefingResponse {
  briefing: BriefingRow | null;
  generated: boolean;
  cached: boolean;
  ai_enabled: boolean;
  ai_error?: boolean;
  error?: string;
}

/** Read today's briefing for an agent directly from the table (cache-only). */
export async function getTodayBriefing(agentId: string): Promise<BriefingRow | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('pulse_briefings')
    .select('id, agent_id, for_date, body_md, priority_lead_ids, meta, created_at, read_at')
    .eq('agent_id', agentId)
    .eq('for_date', today)
    .maybeSingle();
  if (error) {
    console.warn('getTodayBriefing failed:', error.message);
    return null;
  }
  return (data ?? null) as BriefingRow | null;
}

/**
 * Invoke the briefing edge function. It returns the cached row if one
 * already exists for today, or generates a new one on the fly. Fails soft.
 */
export async function generateBriefing(params: {
  agent_id: string;
  agent_name?: string;
}): Promise<BriefingResponse> {
  try {
    const { data, error } = await supabase.functions.invoke<BriefingResponse>(
      'pulse-generate-briefing',
      { body: params },
    );
    if (error) {
      console.warn('pulse-generate-briefing invoke error:', error.message);
      return {
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: false,
        ai_error: true,
      };
    }
    return data ?? { briefing: null, generated: false, cached: false, ai_enabled: false };
  } catch (err) {
    console.warn('pulse-generate-briefing threw:', err);
    return {
      briefing: null,
      generated: false,
      cached: false,
      ai_enabled: false,
      ai_error: true,
    };
  }
}

/** Mark today's briefing as read/dismissed. */
export async function dismissBriefing(id: string): Promise<void> {
  const { error } = await supabase
    .from('pulse_briefings')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.warn('dismissBriefing failed:', error.message);
}

/**
 * Fetch any currently-cached insights for a given agent from the
 * `pulse_insights` table directly (bypasses the edge function). Useful
 * for immediate paint before the edge function round-trips. Returns an
 * empty array on any failure.
 */
export async function getCachedInsights(agentId: string): Promise<AiInsight[]> {
  try {
    const { data, error } = await supabase
      .from('pulse_insights')
      .select('lead_id, kind, title, body, category, expires_at')
      .eq('agent_id', agentId)
      .is('dismissed_at', null)
      .gt('expires_at', new Date().toISOString());
    if (error) {
      console.warn('getCachedInsights failed:', error.message);
      return [];
    }
    return (data ?? []) as AiInsight[];
  } catch (err) {
    console.warn('getCachedInsights threw:', err);
    return [];
  }
}
