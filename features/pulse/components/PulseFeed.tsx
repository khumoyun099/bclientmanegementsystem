/**
 * The Pulse feed — a ranked, categorized list of leads that need
 * attention today. In Pulse-1 this is 100% rule-driven (no AI).
 *
 * Reads from the `get_pulse_feed` RPC via `usePulseFeed`. Agents see
 * only their own leads; admins can pass an agentId to filter to a
 * single agent or `null` to see the whole team.
 */

import React from 'react';
import { Brain, RefreshCw, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { usePulseFeed } from '../hooks/usePulseFeed';
import { groupByCategory } from '../lib/categorize';
import { PulseSection } from './PulseSection';

interface PulseFeedProps {
  agentId: string | null;       // null = caller's own feed (or whole team if admin)
  showAgent?: boolean;          // admin aggregate view — show the agent name on each item
  onOpenLead: (leadId: string) => void;
}

export const PulseFeed: React.FC<PulseFeedProps> = ({ agentId, showAgent, onOpenLead }) => {
  const { data, loading, error, refresh, lastRefreshedAt, narrating, aiEnabled } =
    usePulseFeed(agentId);
  const groups = groupByCategory(data);
  const totalCount = data.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-500/10 border border-brand-500/20">
            <Brain size={14} className="text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Pulse &mdash; leads that need you today
            </h2>
            <p className="text-[10px] text-muted mt-0.5 flex items-center gap-1.5">
              {loading && totalCount === 0
                ? 'Looking for leads that need attention…'
                : totalCount === 0
                ? 'Nothing urgent. Keep it up.'
                : `${totalCount} lead${totalCount === 1 ? '' : 's'} that need attention, most important first`}
              {lastRefreshedAt && ` · updated ${lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              {narrating && (
                <span className="inline-flex items-center gap-1 text-brand-400/70">
                  · <Sparkles size={9} className="animate-pulse" /> coach thinking…
                </span>
              )}
              {!aiEnabled && !narrating && totalCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-400/70">
                  · AI off — showing plain tips
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-muted hover:text-white transition-all disabled:opacity-50"
          title="Refresh"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-300">
          Could not load Pulse feed. Showing last-known data.
        </div>
      )}

      {!loading && totalCount === 0 && (
        <EmptyState />
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map(g => (
            <PulseSection
              key={g.category}
              category={g.category}
              items={g.items}
              onOpen={onOpenLead}
              showAgent={showAgent}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="dashboard-card p-10 text-center animate-fade-in">
    <div className="inline-flex p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
      <CheckCircle2 size={24} className="text-emerald-400" />
    </div>
    <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
      All clear
    </h3>
    <p className="text-xs text-muted max-w-sm mx-auto">
      No leads need urgent attention right now. Pulse refreshes every 15 minutes
      as your leads move through the pipeline.
    </p>
  </div>
);
