/**
 * Pulse feature type definitions.
 *
 * These mirror the `pulse_*` tables in `features/pulse/db/0006_pulse.sql`
 * and the return shape of the `get_pulse_feed` RPC. Keep them in sync.
 */

import { LeadStatus, TodoStatus } from '../../../types';

/** One row per active lead, refreshed every 15 minutes by pg_cron. */
export interface PulseSignal {
  lead_id: string;
  agent_id: string;
  status: LeadStatus;
  todo: TodoStatus | null;
  every_days: number | null;
  cadence_source: 'explicit' | 'inferred' | 'fallback' | null;
  days_since_last_touch: number | null;
  days_overdue: number | null;
  silence_score: number | null;
  reschedule_streak: number | null;
  notes_7d: number | null;
  notes_14d: number | null;
  cold_checks_missing: number | null;
  last_touch_at: string | null;
  computed_at: string;
}

/** Category of an actionable pulse item, returned by get_pulse_feed(). */
export type PulseCategory =
  | 'overdue'
  | 'sleeping_progressive'
  | 'warm_slipping'
  | 'reschedule'
  | 'promised'
  | 'cold_missing_checks'
  | 'agent_health';

/** Row shape returned by the `get_pulse_feed(p_agent_id)` RPC. */
export interface PulseFeedItem {
  lead_id: string;
  agent_id: string;
  agent_name: string | null;
  lead_name: string;
  status: LeadStatus;
  todo: TodoStatus | null;
  follow_up_date: string;
  category: PulseCategory;
  silence_score: number | null;
  days_overdue: number | null;
  days_since_last_touch: number | null;
  reschedule_streak: number | null;
  every_days: number | null;
  cadence_source: 'explicit' | 'inferred' | 'fallback' | null;
  notes_7d: number | null;
  cold_checks_missing: number | null;
  last_note_text: string | null;
  last_note_at: string | null;
  computed_at: string;
  /** AI narrative (Pulse-2+); undefined in Pulse-1. */
  ai_title?: string | null;
  ai_body?: string | null;
}

/** AI narrative cached per (lead, kind); populated in Pulse-2. */
export interface PulseInsight {
  id: string;
  lead_id: string;
  agent_id: string;
  kind: 'lead_summary' | 'next_action' | 'risk' | 'silence' | 'broken_promise';
  title: string;
  body: string;
  priority: number;
  category: PulseCategory;
  meta: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
}

/** Daily morning briefing; populated in Pulse-3. */
export interface PulseBriefing {
  id: string;
  agent_id: string;
  for_date: string;
  body_md: string;
  priority_lead_ids: string[];
  meta: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

/** Admin-curated sales doctrine. One row is active at a time. */
export interface PulsePlaybook {
  id: string;
  version: number;
  content_md: string;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
