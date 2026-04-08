/**
 * A single row in the Pulse feed. Shows the lead name, a signal badge
 * explaining WHY it's here, the last note snippet, and an action.
 *
 * In Pulse-1 the narrative is deterministic (computed from signals).
 * In Pulse-2 the row will read an AI-generated title/body from the
 * pulse_insights table; the shape is already wired via `item.ai_title`
 * / `item.ai_body`.
 */

import React from 'react';
import { ExternalLink, Clock, Zap } from 'lucide-react';
import type { PulseFeedItem } from '../types/pulse.types';
import { formatSignalBadge, formatNarrative } from '../lib/categorize';

interface PulseItemProps {
  item: PulseFeedItem;
  onOpen: (leadId: string) => void;
  showAgent?: boolean;
}

export const PulseItem: React.FC<PulseItemProps> = ({ item, onOpen, showAgent }) => {
  const narrative = item.ai_body || formatNarrative(item);
  const badge = formatSignalBadge(item);

  return (
    <div className="group flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] border-b border-white/5 last:border-b-0 transition-colors">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onOpen(item.lead_id)}
            className="text-sm font-bold text-white hover:text-brand-400 transition-colors truncate text-left"
          >
            {item.lead_name}
          </button>
          <StatusPill status={item.status} />
          {badge && (
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 border border-white/10 text-muted">
              {badge}
            </span>
          )}
          {showAgent && item.agent_name && (
            <span className="text-[9px] font-bold uppercase text-muted">
              · {item.agent_name}
            </span>
          )}
        </div>

        {narrative && (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{narrative}</p>
        )}

        {item.last_note_text && (
          <p className="text-[11px] text-muted italic line-clamp-1">
            <Clock size={9} className="inline mr-1 opacity-50" />
            Last note: &ldquo;{item.last_note_text}&rdquo;
          </p>
        )}
      </div>

      <button
        onClick={() => onOpen(item.lead_id)}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest text-brand-400 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <Zap size={10} />
        Act
        <ExternalLink size={9} />
      </button>
    </div>
  );
};

const statusColors: Record<string, string> = {
  hot:         'bg-red-500/10 text-red-400 border-red-500/20',
  warm:        'bg-amber-500/10 text-amber-400 border-amber-500/20',
  progressive: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  cold:        'bg-blue-500/10 text-blue-400 border-blue-500/20',
  sold:        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  closed:      'bg-white/5 text-muted border-white/10',
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${
      statusColors[status] || statusColors.closed
    }`}
  >
    {status}
  </span>
);
