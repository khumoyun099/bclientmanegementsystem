/**
 * Pure display helpers for Pulse feed items. These turn the raw numeric
 * signals from the `get_pulse_feed` RPC into short strings for badges
 * and narratives. No i18n yet, no AI — deterministic only.
 *
 * When Pulse-2 lands, AI will OVERRIDE the narrative via `item.ai_body`.
 * These helpers remain as the fallback when AI is unavailable, rate
 * limited, or when the edge function is down.
 */

import type { PulseCategory, PulseFeedItem } from '../types/pulse.types';

export interface CategoryMeta {
  key: PulseCategory;
  title: string;
  accent: string;        // Tailwind text color for the section title
  bg: string;            // Tailwind background for the section card
  border: string;        // Tailwind border for the section card
  icon: string;          // lucide icon name
  blurb: string;         // sub-title shown once per section
  priority: number;      // lower = renders first
}

export const CATEGORY_ORDER: PulseCategory[] = [
  'overdue',
  'sleeping_progressive',
  'warm_slipping',
  'reschedule',
  'promised',
  'cold_missing_checks',
  'agent_health',
];

export const CATEGORY_META: Record<PulseCategory, CategoryMeta> = {
  overdue: {
    key: 'overdue',
    title: 'Overdue & urgent',
    accent: 'text-red-300',
    bg: 'bg-red-500/5',
    border: 'border-red-500/20',
    icon: 'AlertTriangle',
    blurb: 'Leads past their follow-up date on HOT or WARM status.',
    priority: 1,
  },
  sleeping_progressive: {
    key: 'sleeping_progressive',
    title: 'Sleeping progressive',
    accent: 'text-amber-300',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    icon: 'Moon',
    blurb: 'Progressive leads overdue against their own cadence — the silent killers.',
    priority: 2,
  },
  warm_slipping: {
    key: 'warm_slipping',
    title: 'Warm but slipping',
    accent: 'text-yellow-300',
    bg: 'bg-yellow-500/5',
    border: 'border-yellow-500/20',
    icon: 'Thermometer',
    blurb: 'Warm leads with no touch recently. Momentum dying.',
    priority: 3,
  },
  reschedule: {
    key: 'reschedule',
    title: 'Repeated reschedules',
    accent: 'text-blue-300',
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/20',
    icon: 'Repeat',
    blurb: 'Three or more date changes with no notes in between. Change approach.',
    priority: 4,
  },
  promised: {
    key: 'promised',
    title: 'Promised actions',
    accent: 'text-emerald-300',
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/20',
    icon: 'HandshakeIcon',
    blurb: 'Leads where your last note mentioned a follow-up you haven\'t delivered.',
    priority: 5,
  },
  cold_missing_checks: {
    key: 'cold_missing_checks',
    title: 'Cold check-ins overdue',
    accent: 'text-sky-300',
    bg: 'bg-sky-500/5',
    border: 'border-sky-500/20',
    icon: 'Snowflake',
    blurb: 'Cold leads missing required daily check-ins.',
    priority: 6,
  },
  agent_health: {
    key: 'agent_health',
    title: 'Agents needing attention',
    accent: 'text-purple-300',
    bg: 'bg-purple-500/5',
    border: 'border-purple-500/20',
    icon: 'Users',
    blurb: 'Team-level signals (admin view).',
    priority: 99,
  },
};

/** Short badge shown inline next to the lead name. */
export function formatSignalBadge(item: PulseFeedItem): string | null {
  switch (item.category) {
    case 'overdue':
      return `${item.days_overdue ?? 0}d overdue`;
    case 'sleeping_progressive':
    case 'warm_slipping':
      if (item.silence_score != null && item.every_days != null) {
        return `${item.days_since_last_touch ?? 0}d silent · ${item.silence_score.toFixed(1)}× cadence`;
      }
      return `${item.days_since_last_touch ?? 0}d silent`;
    case 'reschedule':
      return `${item.reschedule_streak ?? 0} reschedules, no note`;
    case 'promised':
      return 'broken promise';
    case 'cold_missing_checks':
      return `${item.cold_checks_missing ?? 0} check-ins missing`;
    default:
      return null;
  }
}

/** Deterministic one-line narrative. AI replaces this in Pulse-2. */
export function formatNarrative(item: PulseFeedItem): string {
  switch (item.category) {
    case 'overdue': {
      const days = item.days_overdue ?? 0;
      return `Past the follow-up date by ${days} day${days === 1 ? '' : 's'}. Prioritize today.`;
    }
    case 'sleeping_progressive': {
      const silence = item.silence_score ?? 0;
      const cadence = item.every_days ?? 10;
      if (silence >= 2) {
        return `Momentum is dying. ${silence.toFixed(1)}× past the ${cadence}-day cadence — re-engage now before the customer bolts.`;
      }
      return `Past the ${cadence}-day cadence (${silence.toFixed(1)}× silence). A check-in today keeps the rhythm alive.`;
    }
    case 'warm_slipping': {
      const cadence = item.every_days ?? 10;
      return `Warm lead silent for longer than the ${cadence}-day cadence. Either re-engage or move to cold.`;
    }
    case 'reschedule': {
      const n = item.reschedule_streak ?? 0;
      return `${n} consecutive reschedules with no notes between them. Whatever you're doing isn't landing — change the approach.`;
    }
    case 'promised': {
      return `Your last note hinted at a follow-up you haven't delivered. Customers notice. Deliver it today.`;
    }
    case 'cold_missing_checks': {
      const n = item.cold_checks_missing ?? 0;
      return `${n} cold check-in${n === 1 ? '' : 's'} missing against the 4-day protocol.`;
    }
    default:
      return '';
  }
}

/** Group a flat feed into sections, preserving priority ordering. */
export function groupByCategory(
  items: PulseFeedItem[]
): Array<{ category: PulseCategory; items: PulseFeedItem[] }> {
  const buckets: Record<string, PulseFeedItem[]> = {};
  for (const item of items) {
    if (!item.category) continue;
    (buckets[item.category] ||= []).push(item);
  }
  return CATEGORY_ORDER
    .filter(cat => buckets[cat]?.length)
    .map(cat => ({ category: cat, items: buckets[cat] }));
}
