/**
 * Deterministic lead-health rules shared between the Pulse feature and
 * the legacy AccountabilityDashboard. These are the CLIENT-SIDE mirror of
 * the signal math in `features/pulse/db/0006_pulse.sql::refresh_pulse_signals`.
 *
 * Keep these in sync with the SQL. If you change one, change the other.
 *
 * Extracted (unchanged behavior) from `components/AccountabilityDashboard.tsx`
 * lines 18–79. The legacy component re-exports from here so there is a
 * single source of truth.
 */

import { Lead, ActivityLog, LeadStatus } from '../../../types';

export function daysBetween(dateStr: string, todayStr: string): number {
  const d1 = new Date(dateStr);
  const d2 = new Date(todayStr);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
}

export function isOverdue(lead: Lead, today: string): boolean {
  return lead.follow_up_date < today && !['sold', 'closed'].includes(lead.status);
}

export function isStale(lead: Lead, today: string): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  try {
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    const sortedNotes = [...notes].sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
    const lastNoteDate = sortedNotes[0]?.created_at;
    const compareDate = lastNoteDate || lead.created_at;
    if (!compareDate) return false;
    return daysBetween(compareDate, today) > 10;
  } catch {
    return false;
  }
}

export function isMissingFreq(lead: Lead): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  return ['warm', 'progressive'].includes(lead.status) && !lead.every;
}

export function isRepeatedReschedule(lead: Lead, logs: ActivityLog[]): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  if (!logs || logs.length === 0) return false;

  const leadLogs = logs
    .filter(l => l.lead_id === lead.id && l.created_at)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  let consecutiveReschedules = 0;
  for (const log of leadLogs) {
    if (log.action === 'date_changed') {
      consecutiveReschedules++;
    } else if (log.action === 'note_added') {
      consecutiveReschedules = 0;
    }
  }
  return consecutiveReschedules >= 3;
}

export function isAtRisk(lead: Lead, today: string): boolean {
  if (['sold', 'closed'].includes(lead.status)) return false;
  const d = daysBetween(today, lead.follow_up_date);
  return d >= 0 && d <= 2;
}

/**
 * Effective cadence for a lead: explicit `every` if set, else 10 days fallback.
 * The SQL signal function uses the same 10-day fallback.
 */
export function effectiveCadence(lead: Lead): number {
  const explicit = lead.every ? parseInt(String(lead.every), 10) : NaN;
  return Number.isFinite(explicit) && explicit > 0 ? explicit : 10;
}

/**
 * Days since the most recent note OR the lead's creation (whichever is more
 * recent). Mirrors the `days_since_last_touch` calculation in SQL.
 */
export function daysSinceLastNote(lead: Lead, todayStr: string): number {
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  const sorted = [...notes].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );
  const lastAt = sorted[0]?.created_at || lead.created_at;
  if (!lastAt) return 0;
  return daysBetween(lastAt, todayStr);
}

/** Silence score: days since last note divided by effective cadence. */
export function silenceScore(lead: Lead, todayStr: string): number {
  const cadence = effectiveCadence(lead);
  const silence = daysSinceLastNote(lead, todayStr);
  return cadence === 0 ? 0 : Math.round((silence / cadence) * 100) / 100;
}

/**
 * Agent-level rollup used by the admin "Agents needing attention" section
 * in Pulse-4. Safe to call in Pulse-1 even though nothing renders it yet.
 */
export interface AgentHealthRollup {
  agentId: string;
  totalLeads: number;
  overdueCount: number;
  staleCount: number;
  missingFreqCount: number;
  rescheduledCount: number;
  averageSilenceScore: number;
}

export function computeAgentHealth(
  agentId: string,
  leads: Lead[],
  logs: ActivityLog[],
  today: string
): AgentHealthRollup {
  const myLeads = leads.filter(l => l.assigned_agent_id === agentId);
  const active = myLeads.filter(l => l.status !== 'sold' && l.status !== 'closed');

  const silenceScores = active.map(l => silenceScore(l, today));
  const avg =
    silenceScores.length === 0
      ? 0
      : Math.round(
          (silenceScores.reduce((a, b) => a + b, 0) / silenceScores.length) * 100
        ) / 100;

  return {
    agentId,
    totalLeads: active.length,
    overdueCount: active.filter(l => isOverdue(l, today)).length,
    staleCount: active.filter(l => isStale(l, today)).length,
    missingFreqCount: active.filter(l => isMissingFreq(l)).length,
    rescheduledCount: active.filter(l => isRepeatedReschedule(l, logs)).length,
    averageSilenceScore: avg,
  };
}
