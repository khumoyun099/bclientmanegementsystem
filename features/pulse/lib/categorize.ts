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
    title: 'Overdue — act today',
    accent: 'text-red-300',
    bg: 'bg-red-500/5',
    border: 'border-red-500/20',
    icon: 'AlertTriangle',
    blurb: 'Follow-up date has passed. Call or message today.',
    priority: 1,
  },
  sleeping_progressive: {
    key: 'sleeping_progressive',
    title: 'Quiet long-cycle leads',
    accent: 'text-amber-300',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    icon: 'Moon',
    blurb: 'Long-cycle leads you haven\u2019t touched in a while \u2014 the ones that quietly walk away.',
    priority: 2,
  },
  warm_slipping: {
    key: 'warm_slipping',
    title: 'Warm leads going quiet',
    accent: 'text-yellow-300',
    bg: 'bg-yellow-500/5',
    border: 'border-yellow-500/20',
    icon: 'Thermometer',
    blurb: 'Warm leads fading because nobody\u2019s reached out lately.',
    priority: 3,
  },
  reschedule: {
    key: 'reschedule',
    title: 'Stuck rescheduling',
    accent: 'text-blue-300',
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/20',
    icon: 'Repeat',
    blurb: 'Date has been pushed three or more times without a note. Try something different.',
    priority: 4,
  },
  promised: {
    key: 'promised',
    title: 'You said you\u2019d follow up',
    accent: 'text-emerald-300',
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/20',
    icon: 'HandshakeIcon',
    blurb: 'Your last note mentioned a follow-up you haven\u2019t delivered yet.',
    priority: 5,
  },
  cold_missing_checks: {
    key: 'cold_missing_checks',
    title: 'Cold follow-ups missed',
    accent: 'text-sky-300',
    bg: 'bg-sky-500/5',
    border: 'border-sky-500/20',
    icon: 'Snowflake',
    blurb: 'Cold leads missing their daily check-in.',
    priority: 6,
  },
  agent_health: {
    key: 'agent_health',
    title: 'Agents needing attention',
    accent: 'text-purple-300',
    bg: 'bg-purple-500/5',
    border: 'border-purple-500/20',
    icon: 'Users',
    blurb: 'Team-level view for admins.',
    priority: 99,
  },
};

/** Short badge shown inline next to the lead name. Plain English only. */
export function formatSignalBadge(item: PulseFeedItem): string | null {
  switch (item.category) {
    case 'overdue': {
      const d = item.days_overdue ?? 0;
      return `${d} day${d === 1 ? '' : 's'} overdue`;
    }
    case 'sleeping_progressive':
    case 'warm_slipping': {
      const d = item.days_since_last_touch ?? 0;
      return `silent ${d} day${d === 1 ? '' : 's'}`;
    }
    case 'reschedule': {
      const n = item.reschedule_streak ?? 0;
      return `pushed ${n}×, no notes`;
    }
    case 'promised':
      return 'follow-up promised';
    case 'cold_missing_checks': {
      const n = item.cold_checks_missing ?? 0;
      return `${n} check-in${n === 1 ? '' : 's'} missed`;
    }
    default:
      return null;
  }
}

/** Deterministic one-line narrative. AI replaces this in Pulse-2. Plain English. */
export function formatNarrative(item: PulseFeedItem): string {
  switch (item.category) {
    case 'overdue': {
      const days = item.days_overdue ?? 0;
      if (days >= 7) return `${days} days past due. Call or message today before they book elsewhere.`;
      return `${days} day${days === 1 ? '' : 's'} past due. Reach out today.`;
    }
    case 'sleeping_progressive': {
      const d = item.days_since_last_touch ?? 0;
      const expected = item.every_days ?? 10;
      if (d > expected * 2) {
        return `Haven\u2019t reached out in ${d} days \u2014 way past when you normally would. Re-engage today before they forget about you.`;
      }
      return `Last touch was ${d} days ago. Drop a quick check-in today so they stay warm.`;
    }
    case 'warm_slipping': {
      const d = item.days_since_last_touch ?? 0;
      return `Warm lead going quiet \u2014 ${d} days since last contact. Re-engage now or they\u2019ll drift to cold.`;
    }
    case 'reschedule': {
      const n = item.reschedule_streak ?? 0;
      return `Date has been pushed ${n} times with no notes in between. Whatever you\u2019re doing isn\u2019t landing \u2014 try a call instead of a message.`;
    }
    case 'promised': {
      return `Your last note said you\u2019d follow up, but it hasn\u2019t happened yet. Customers notice \u2014 deliver today.`;
    }
    case 'cold_missing_checks': {
      const n = item.cold_checks_missing ?? 0;
      return `${n} cold check-in${n === 1 ? '' : 's'} missed out of the 4 required.`;
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
