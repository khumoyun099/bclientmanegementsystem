/**
 * A collapsible section of the Pulse feed (one per category).
 * Header shows a colored icon, title, count, and the human blurb.
 * Expanded state is per-section and persisted in component state only
 * (not localStorage — we want collapse state to reset with each login).
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  Moon,
  Thermometer,
  Repeat,
  HandshakeIcon,
  Snowflake,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { PulseCategory, PulseFeedItem } from '../types/pulse.types';
import { CATEGORY_META } from '../lib/categorize';
import { PulseItem } from './PulseItem';

interface PulseSectionProps {
  category: PulseCategory;
  items: PulseFeedItem[];
  onOpen: (leadId: string) => void;
  showAgent?: boolean;
  defaultExpanded?: boolean;
}

const iconMap = {
  AlertTriangle,
  Moon,
  Thermometer,
  Repeat,
  HandshakeIcon,
  Snowflake,
  Users,
};

export const PulseSection: React.FC<PulseSectionProps> = ({
  category,
  items,
  onOpen,
  showAgent,
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const meta = CATEGORY_META[category];
  const Icon = iconMap[meta.icon as keyof typeof iconMap] || AlertTriangle;

  if (items.length === 0) return null;

  return (
    <div className={`rounded-xl border ${meta.border} ${meta.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3 text-left">
          <div className={`p-2 rounded-lg ${meta.bg} border ${meta.border}`}>
            <Icon size={14} className={meta.accent} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className={`text-sm font-bold uppercase tracking-wider ${meta.accent}`}>
                {meta.title}
              </h3>
              <span className="text-[10px] font-black text-muted bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                {items.length}
              </span>
            </div>
            <p className="text-[10px] text-muted mt-0.5 leading-tight">{meta.blurb}</p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {expanded && (
        // Items flow into two columns on lg+ screens (≥1024px). The
        // outer container has a 1-pixel column gap with a subtle line
        // background, which becomes the vertical separator between
        // the two columns. Each item carries its own bottom border for
        // the row separators within each column. On narrow screens it
        // collapses back to a single column.
        <div className="border-t border-white/5 bg-[#0c0c0c]/40">
          <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-px lg:bg-white/5">
            {items.map(item => (
              <div key={item.lead_id} className="bg-[#0c0c0c]/60">
                <PulseItem item={item} onOpen={onOpen} showAgent={showAgent} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
