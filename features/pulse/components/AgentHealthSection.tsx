/**
 * AgentHealthSection — admin-only, renders in the Dashboard when
 * viewing the whole team. Rolls up per-agent signals (overdue, stale,
 * missing frequencies, reschedule streaks, average silence) using the
 * existing `computeAgentHealth` helper and surfaces the agents whose
 * pipelines look unhealthy today.
 *
 * Clicking an agent card jumps into the per-agent filtered view via
 * `onSelectAgent` — the parent (`PulseDashboard`) sets the admin
 * agent filter, which collapses this section and reveals the usual
 * Pulse feed narrated for just that agent.
 *
 * Pure deterministic rules. No AI call here (that's Pulse-4b later).
 */

import React, { useMemo } from 'react';
import { UsersRound, AlertTriangle, Activity, Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityLog, Lead, Role, User } from '../../../types';
import { computeAgentHealth, type AgentHealthRollup } from '../lib/leadRules';

interface AgentHealthSectionProps {
  users: User[];
  leads: Lead[];
  activityLogs: ActivityLog[];
  onSelectAgent: (agentId: string) => void;
}

interface ScoredAgent {
  user: User;
  rollup: AgentHealthRollup;
  concern: number;
  flags: string[];
}

/**
 * Higher concern = needs more attention. Weights are tuned so that
 * overdue leads + missing-frequency dominate, staleness matters less,
 * and reschedule streak is a strong but narrow signal.
 */
function concernScore(r: AgentHealthRollup): number {
  return (
    r.overdueCount * 3 +
    r.missingFreqCount * 2 +
    r.rescheduledCount * 4 +
    r.staleCount * 1 +
    Math.max(0, r.averageSilenceScore - 1) * 2
  );
}

function flagsFor(r: AgentHealthRollup): string[] {
  const out: string[] = [];
  if (r.overdueCount > 0) out.push(`${r.overdueCount} overdue`);
  if (r.rescheduledCount > 0) out.push(`${r.rescheduledCount} stuck rescheduling`);
  if (r.missingFreqCount > 0) out.push(`${r.missingFreqCount} no cadence`);
  if (r.staleCount > 0) out.push(`${r.staleCount} stale`);
  if (r.averageSilenceScore > 1.3) {
    out.push(`${r.averageSilenceScore.toFixed(1)}× avg silence`);
  }
  return out;
}

export const AgentHealthSection: React.FC<AgentHealthSectionProps> = ({
  users,
  leads,
  activityLogs,
  onSelectAgent,
}) => {
  const [expanded, setExpanded] = React.useState(true);

  const scored: ScoredAgent[] = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const agents = users.filter(u => u.role === Role.AGENT);
    return agents
      .map(u => {
        const rollup = computeAgentHealth(u.id, leads, activityLogs, today);
        return {
          user: u,
          rollup,
          concern: concernScore(rollup),
          flags: flagsFor(rollup),
        };
      })
      .filter(s => s.concern > 0)
      .sort((a, b) => b.concern - a.concern);
  }, [users, leads, activityLogs]);

  if (scored.length === 0) return null;

  return (
    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-purple-500/[0.03] transition-colors"
      >
        <div className="flex items-center gap-3 text-left">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <UsersRound size={14} className="text-purple-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300">
                Agents needing attention
              </h3>
              <span className="text-[10px] font-black text-muted bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                {scored.length}
              </span>
            </div>
            <p className="text-[10px] text-muted mt-0.5 leading-tight">
              Team-level signals — click an agent to drill in.
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/5 divide-y divide-white/5 bg-[#0c0c0c]/40">
          {scored.map(({ user, rollup, flags, concern }) => (
            <AgentHealthRow
              key={user.id}
              user={user}
              rollup={rollup}
              flags={flags}
              concern={concern}
              onSelect={() => onSelectAgent(user.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface AgentHealthRowProps {
  user: User;
  rollup: AgentHealthRollup;
  flags: string[];
  concern: number;
  onSelect: () => void;
}

const AgentHealthRow: React.FC<AgentHealthRowProps> = ({
  user,
  rollup,
  flags,
  concern,
  onSelect,
}) => {
  // Color the concern by severity
  const severity = concern >= 25 ? 'high' : concern >= 10 ? 'med' : 'low';
  const severityColor =
    severity === 'high'
      ? 'text-red-300 bg-red-500/10 border-red-500/20'
      : severity === 'med'
      ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
      : 'text-muted bg-white/5 border-white/10';

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full group flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
            {user.name}
          </span>
          <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${severityColor}`}>
            {severity === 'high' ? (
              <><Flame size={9} className="inline mr-0.5 -mt-0.5" /> hot spot</>
            ) : severity === 'med' ? (
              <><AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" /> at risk</>
            ) : (
              <><Activity size={9} className="inline mr-0.5 -mt-0.5" /> watch</>
            )}
          </span>
          <span className="text-[10px] text-muted">
            {rollup.totalLeads} active
          </span>
        </div>
        {flags.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
            {flags.join(' · ')}
          </p>
        )}
      </div>
      <div className="shrink-0 ml-3 text-[10px] font-black uppercase tracking-widest text-purple-400 group-hover:text-purple-300">
        View →
      </div>
    </button>
  );
};
