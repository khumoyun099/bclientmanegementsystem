
import React, { useMemo, useState, useEffect } from 'react';
import { User, Lead, ActivityLog, Role, LeadStatus } from '../types';
import { getTodayString, db } from '../services/db';
import { AlertTriangle, Users, UserCog, LineChart, Info, ChevronDown, ChevronUp, X, ArrowRightLeft, MessageSquareWarning } from 'lucide-react';
import { LeadTable } from './LeadTable';
import { StrategyModal } from './StrategyModal';
import toast from 'react-hot-toast';

interface AccountabilityDashboardProps {
  users: User[];
  leads: Lead[];
  logs: ActivityLog[];
  onSelectLead: (lead: Lead) => void;
  onRefresh: () => void;
}

// --- Violation detection helpers ---

function daysBetween(dateStr: string, todayStr: string): number {
  const d1 = new Date(dateStr);
  const d2 = new Date(todayStr);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
}

function isOverdue(lead: Lead, today: string): boolean {
  return lead.follow_up_date < today && !['sold', 'closed'].includes(lead.status);
}

function isStale(lead: Lead, today: string): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  try {
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    const sortedNotes = [...notes].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const lastNoteDate = sortedNotes[0]?.created_at;
    const compareDate = lastNoteDate || lead.created_at;
    if (!compareDate) return false;
    return daysBetween(compareDate, today) > 10;
  } catch {
    return false;
  }
}

function isMissingFreq(lead: Lead): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  return ['warm', 'progressive'].includes(lead.status) && !lead.every;
}

function isRepeatedReschedule(lead: Lead, logs: ActivityLog[]): boolean {
  if (lead.status === 'sold' || lead.status === 'closed') return false;
  if (!logs || logs.length === 0) return false;
  // Get all activity for this lead, sorted chronologically
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

type ViolationType = 'OVERDUE' | 'STALE' | 'RESCHEDULED' | 'NO FREQUENCY';

interface FlaggedLead {
  lead: Lead;
  violations: ViolationType[];
}

function isAtRisk(lead: Lead, today: string): boolean {
  if (['sold', 'closed'].includes(lead.status)) return false;
  const d = daysBetween(today, lead.follow_up_date);
  return d >= 0 && d <= 2;
}

export const AccountabilityDashboard: React.FC<AccountabilityDashboardProps> = ({ users, leads, logs: rawLogs, onSelectLead, onRefresh }) => {
  const logs = Array.isArray(rawLogs) ? rawLogs : [];
  const agents = users.filter(u => u.role === Role.AGENT);
  const today = getTodayString();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showTeamList, setShowTeamList] = useState(false);
  const [strategyAgent, setStrategyAgent] = useState<User | null>(null);

  // New state for expanded problem leads, warnings, and reassignment
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(new Set());
  const [warningAgentId, setWarningAgentId] = useState<string | null>(null);
  const [warningText, setWarningText] = useState('');
  const [warningCounts, setWarningCounts] = useState<Record<string, number>>({});
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [reassignTargetAgentId, setReassignTargetAgentId] = useState<string>('');
  const [reassignLoading, setReassignLoading] = useState(false);

  // Dummy admin user for table context — guard against empty users array
  const adminUser: User | undefined = users.find(u => u.role === Role.ADMIN) || users[0];

  // Fetch warning counts for all agents
  const agentIds = useMemo(() => agents.map(a => a.id).join(','), [agents]);
  useEffect(() => {
    if (agents.length === 0) return;
    const fetchWarnings = async () => {
      const counts: Record<string, number> = {};
      await Promise.all(agents.map(async (agent) => {
        counts[agent.id] = await db.getAgentWarnings(agent.id);
      }));
      setWarningCounts(counts);
    };
    fetchWarnings();
  }, [agentIds]);

  // --- Existing agentStats logic preserved + new violation logic added ---
  const agentStats = useMemo(() => {
    return agents.map(agent => {
        const agentLeads = leads.filter(l => l.assigned_agent_id === agent.id);
        const overdueLeads = agentLeads.filter(l => l.follow_up_date < today && l.status !== 'sold' && l.status !== 'closed');

        // Cold Rule Violation check:
        // A violation is: Lead is Cold/Unreached and they haven't checked the box for a day that has passed.
        const coldViolations = agentLeads.filter(l => {
           if (l.status === LeadStatus.COLD && l.cold_status === 'Unreached' && l.cold_start_date) {
               const history = l.cold_check_history || [];
               // Simple logic: if they are on day X but haven't checked for today, and it's past their start date.
               // For this implementation, we'll flag if they have an active Cold/Unreached lead where history.length < elapsed days.
               const startDate = new Date(l.cold_start_date);
               const now = new Date(today);
               const elapsedDays = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 3600 * 24));

               // Rule: Must have history.length >= min(4, elapsedDays + 1)
               return history.length < Math.min(4, elapsedDays + 1);
           }
           return false;
        });

        const ignoredLeads = overdueLeads.filter(lead => {
            const hasActivityToday = (logs || []).some(log => {
                const logDate = (log.created_at || '').split('T')[0];
                return log.lead_id === lead.id && log.agent_id === agent.id && log.action === 'note_added' && logDate === today;
            });
            return !hasActivityToday;
        });

        // --- New violation detection ---
        const flaggedLeads: FlaggedLead[] = [];
        const overdueSet = new Set<string>();
        const staleSet = new Set<string>();
        const rescheduledSet = new Set<string>();
        const missingFreqSet = new Set<string>();

        agentLeads.forEach(lead => {
          const violations: ViolationType[] = [];
          if (isOverdue(lead, today)) { violations.push('OVERDUE'); overdueSet.add(lead.id); }
          if (isStale(lead, today)) { violations.push('STALE'); staleSet.add(lead.id); }
          if (isRepeatedReschedule(lead, logs)) { violations.push('RESCHEDULED'); rescheduledSet.add(lead.id); }
          if (isMissingFreq(lead)) { violations.push('NO FREQUENCY'); missingFreqSet.add(lead.id); }
          if (violations.length > 0) flaggedLeads.push({ lead, violations });
        });

        const hasViolation = flaggedLeads.length > 0 || coldViolations.length > 0;
        const hasAtRisk = !hasViolation && agentLeads.some(l => isAtRisk(l, today));

        // Count reassigned-away leads
        const reassignedAway = logs.filter(
          l => l.action === 'reassigned' && (l.details || '').includes(`from ${agent.name}`)
        ).length;

        return {
            agent,
            overdueCount: overdueSet.size,
            staleCount: staleSet.size,
            rescheduledCount: rescheduledSet.size,
            missingFreqCount: missingFreqSet.size,
            ignoredCount: ignoredLeads.length + coldViolations.length,
            ignoredLeadsList: [...new Set([...ignoredLeads, ...coldViolations])],
            violationCount: coldViolations.length,
            flaggedLeads,
            hasViolation,
            hasAtRisk,
            reassignedAway,
            cardColor: hasViolation ? 'red' : hasAtRisk ? 'yellow' : 'green',
        };
    });
  }, [agents, leads, logs, today]);

  const handleToggleRole = async (user: User) => {
    const newRole = user.role === Role.ADMIN ? Role.AGENT : Role.ADMIN;
    if (confirm(`Change ${user.name}'s role to ${newRole.toUpperCase()}?`)) {
        await db.updateLead(user.id, { role: newRole } as any, adminUser);
        alert("Role updated. Please refresh.");
        onRefresh();
    }
  };

  const handleAddWarning = async () => {
    if (!warningAgentId || !warningText.trim() || !adminUser) return;
    try {
      await db.logAdminWarning(warningAgentId, warningText.trim(), adminUser.id);
      const agentName = agents.find(a => a.id === warningAgentId)?.name || 'Agent';
      toast.success(`Warning logged for ${agentName}`);
      setWarningCounts(prev => ({ ...prev, [warningAgentId]: (prev[warningAgentId] || 0) + 1 }));
      setWarningAgentId(null);
      setWarningText('');
      onRefresh();
    } catch {
      toast.error('Failed to log warning.');
    }
  };

  const handleReassign = async () => {
    if (!reassignTargetAgentId || selectedLeadIds.size === 0) return;
    setReassignLoading(true);
    try {
      const targetAgent = agents.find(a => a.id === reassignTargetAgentId);
      if (!targetAgent) return;

      const selectedLeadsList = leads.filter(l => selectedLeadIds.has(l.id));
      const bySource = new Map<string, string[]>();
      for (const lead of selectedLeadsList) {
        const srcName = lead.assigned_agent_name || 'Unknown';
        if (!bySource.has(srcName)) bySource.set(srcName, []);
        bySource.get(srcName)!.push(lead.id);
      }

      await Promise.all(
        Array.from(bySource.entries()).map(([srcName, ids]) =>
          db.bulkReassignLeads(ids, targetAgent.id, targetAgent.name, adminUser.id, srcName)
        )
      );

      const count = selectedLeadIds.size;
      toast.success(`${count} lead${count > 1 ? 's' : ''} reassigned to ${targetAgent.name}`);
      setSelectedLeadIds(new Set());
      setReassignTargetAgentId('');
      onRefresh();
    } catch {
      toast.error('Failed to reassign leads.');
    } finally {
      setReassignLoading(false);
    }
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const selectedAgentStats = selectedAgentId ? agentStats.find(s => s.agent.id === selectedAgentId) : null;

  const borderColorClass = (color: string) => {
    if (color === 'red') return 'border-red-500/60';
    if (color === 'yellow') return 'border-yellow-500/50';
    return 'border-emerald-500/40';
  };

  const getLastNoteDate = (lead: Lead): string => {
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    if (notes.length === 0) return '—';
    const sorted = [...notes].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return (sorted[0]?.created_at || '').split('T')[0] || '—';
  };

  const getInactiveDays = (lead: Lead): { days: number; noNotes: boolean } => {
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    if (notes.length === 0) {
      return { days: lead.created_at ? daysBetween(lead.created_at, today) : 0, noNotes: true };
    }
    const sorted = [...notes].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return { days: daysBetween(sorted[0].created_at, today), noNotes: false };
  };

  const inactiveColorClass = (days: number): string => {
    if (days >= 11) return 'text-red-400 font-bold';
    if (days >= 6) return 'text-orange-400';
    return 'text-yellow-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400">
              <Users size={18} />
              <h2 className="text-sm font-bold uppercase tracking-wider">Admin Control Panel</h2>
          </div>
          <button
            onClick={() => setShowTeamList(!showTeamList)}
            className="text-xs font-bold text-brand-400 hover:text-brand-300 flex items-center gap-2 bg-brand-500/10 px-3 py-1.5 rounded-lg border border-brand-500/20"
          >
            <UserCog size={14} />
            {showTeamList ? 'Show Accountability' : 'Manage Team'}
          </button>
      </div>

      {showTeamList ? (
          <div className="bg-[#202020] rounded-xl shadow-sm border border-[#2f2f2f] overflow-hidden animate-fade-in">
              <table className="min-w-full divide-y divide-[#2f2f2f]">
                  <thead className="bg-[#252525]">
                      <tr>
                          <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-500 uppercase">User</th>
                          <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-500 uppercase">Email</th>
                          <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-500 uppercase">Role</th>
                          <th className="px-6 py-3 text-right text-[10px] font-bold text-gray-500 uppercase">Actions</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2f2f2f]">
                      {users.map(user => (
                          <tr key={user.id} className="hover:bg-[#252525] transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">{user.name}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.email}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${user.role === Role.ADMIN ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-brand-500/10 text-brand-400 border-brand-500/20'}`}>
                                      {user.role}
                                  </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                  <button
                                    disabled={user.id === adminUser.id}
                                    onClick={() => handleToggleRole(user)}
                                    className="text-xs text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                      Change Role
                                  </button>
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      ) : (
          <div className="bg-[#202020] rounded-xl shadow-sm border border-[#2f2f2f] p-6">
             <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                    <AlertTriangle className="text-amber-500" size={20}/>
                    Agent Accountability
                </h2>
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded text-[10px] font-black text-red-400 uppercase tracking-widest">
                    <Info size={12}/> Cold Follow-Up Rules Active
                </div>
             </div>

             {agents.length === 0 ? (
                 <div className="py-8 text-center bg-[#1a1a1a] rounded-lg border border-dashed border-[#333]">
                     <Users className="mx-auto text-gray-600 mb-3" size={32} />
                     <p className="text-gray-400 font-medium">No Agents Registered Yet</p>
                 </div>
             ) : (
                 <div className="space-y-4">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {agentStats.map(stat => (
                      <div key={stat.agent.id} className="flex flex-col">
                        <div
                          onClick={() => setSelectedAgentId(stat.agent.id === selectedAgentId ? null : stat.agent.id)}
                          className={`p-4 rounded-lg border-2 transition-all flex flex-col cursor-pointer ${borderColorClass(stat.cardColor)} ${selectedAgentId === stat.agent.id ? 'ring-1 ring-brand-500 bg-brand-900/10' : 'hover:bg-[#252525]'}`}
                        >
                           <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${stat.cardColor === 'red' ? 'bg-red-500' : stat.cardColor === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500'} animate-pulse`} />
                                  <div>
                                    <h3 className="font-semibold text-gray-200">{stat.agent.name}</h3>
                                    <p className="text-xs text-gray-500">{stat.agent.email}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {(warningCounts[stat.agent.id] || 0) > 0 && (
                                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gray-500/20 text-gray-400 border border-gray-500/20">
                                    {warningCounts[stat.agent.id]} warnings
                                  </span>
                                )}
                                <div className="text-right">
                                  <div className={`text-2xl font-bold ${stat.ignoredCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                      {stat.ignoredCount}
                                  </div>
                                  {stat.violationCount > 0 && (
                                      <p className="text-[8px] font-black text-red-400 uppercase">{stat.violationCount} Violations</p>
                                  )}
                                </div>
                              </div>
                           </div>

                           {/* Metric badges row */}
                           <div className="flex flex-wrap gap-1.5 mb-3">
                             <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${stat.overdueCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-600'}`}>
                               {stat.overdueCount} Overdue
                             </span>
                             <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${stat.staleCount > 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-white/5 text-gray-600'}`}>
                               {stat.staleCount} Stale
                             </span>
                             <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${stat.rescheduledCount > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-gray-600'}`}>
                               {stat.rescheduledCount} Rescheduled
                             </span>
                             <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${stat.missingFreqCount > 0 ? 'bg-gray-500/20 text-gray-400' : 'bg-white/5 text-gray-600'}`}>
                               {stat.missingFreqCount} Missing Freq
                             </span>
                           </div>

                           {stat.reassignedAway > 0 && (
                             <p className="text-[10px] text-gray-500 mb-2">{stat.reassignedAway} leads reassigned away</p>
                           )}

                           <div className="mt-auto flex flex-col gap-2">
                              <div className="text-[10px] font-bold text-gray-500 flex justify-between uppercase tracking-tight">
                                  <span>Action Items</span>
                                  <span className={stat.ignoredCount > 0 ? 'text-red-400' : 'text-green-400'}>
                                    {stat.ignoredCount > 0 ? 'Needs Review' : 'Good Standing'}
                                  </span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setStrategyAgent(stat.agent); }}
                                  className="flex-1 py-2 bg-[#2f2f2f] hover:bg-brand-600 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 group"
                                >
                                   <LineChart size={14} className="text-brand-400 group-hover:text-white" />
                                   Strategy Portal
                                </button>
                              </div>
                              <div className="flex gap-2">
                                {stat.flaggedLeads.length > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedAgentIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(stat.agent.id)) {
                                          next.delete(stat.agent.id);
                                          setSelectedLeadIds(sel => {
                                            const cleaned = new Set(sel);
                                            stat.flaggedLeads.forEach(fl => cleaned.delete(fl.lead.id));
                                            return cleaned;
                                          });
                                        } else {
                                          next.add(stat.agent.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                  >
                                    {expandedAgentIds.has(stat.agent.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    View Problem Leads ({stat.flaggedLeads.length})
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setWarningAgentId(stat.agent.id);
                                    setWarningText('');
                                  }}
                                  className="py-2 px-3 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                                >
                                  <MessageSquareWarning size={14} />
                                  Add Warning
                                </button>
                              </div>
                           </div>
                        </div>

                        {/* Expanded problem leads table - inline below card */}
                        {expandedAgentIds.has(stat.agent.id) && stat.flaggedLeads.length > 0 && (
                          <div className="mt-2 bg-[#1a1a1a] rounded-lg border border-[#2f2f2f] overflow-hidden animate-fade-in">
                            <table className="min-w-full divide-y divide-[#2f2f2f]">
                              <thead className="bg-[#202020]">
                                <tr>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase w-8">
                                    <input
                                      type="checkbox"
                                      checked={stat.flaggedLeads.length > 0 && stat.flaggedLeads.every(fl => selectedLeadIds.has(fl.lead.id))}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const ids = stat.flaggedLeads.map(fl => fl.lead.id);
                                        setSelectedLeadIds(prev => {
                                          const next = new Set(prev);
                                          if (e.target.checked) {
                                            ids.forEach(id => next.add(id));
                                          } else {
                                            ids.forEach(id => next.delete(id));
                                          }
                                          return next;
                                        });
                                      }}
                                      className="w-5 h-5 rounded border-gray-600 bg-transparent cursor-pointer accent-orange-500"
                                    />
                                  </th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Lead</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Violation</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Inactive For</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Last Note</th>
                                  <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Follow-up</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#2f2f2f]">
                                {stat.flaggedLeads.map(({ lead, violations }) => {
                                  const inactive = getInactiveDays(lead);
                                  return (
                                  <tr key={lead.id} className="hover:bg-[#252525] transition-colors">
                                    <td className="px-3 py-2.5">
                                      <input
                                        type="checkbox"
                                        checked={selectedLeadIds.has(lead.id)}
                                        onChange={() => toggleLeadSelection(lead.id)}
                                        className="w-5 h-5 rounded border-gray-600 bg-transparent cursor-pointer accent-orange-500"
                                      />
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <button
                                        onClick={() => onSelectLead(lead)}
                                        className="text-sm text-brand-400 hover:text-brand-300 font-medium hover:underline text-left"
                                      >
                                        {lead.name}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex flex-wrap gap-1">
                                        {violations.map(v => (
                                          <span key={v} className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                                            v === 'OVERDUE' ? 'bg-red-500/20 text-red-400' :
                                            v === 'STALE' ? 'bg-orange-500/20 text-orange-400' :
                                            v === 'RESCHEDULED' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-gray-500/20 text-gray-400'
                                          }`}>
                                            {v}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td className={`px-3 py-2.5 text-xs ${inactiveColorClass(inactive.days)}`}>
                                      {inactive.days} day{inactive.days !== 1 ? 's' : ''}{inactive.noNotes ? ' (no notes ever)' : ''}
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-gray-400">{getLastNoteDate(lead)}</td>
                                    <td className="px-3 py-2.5 text-xs text-gray-400">{lead.follow_up_date}</td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                   </div>
                 </div>
             )}
          </div>
      )}

      {strategyAgent && (
          <StrategyModal agent={strategyAgent} onClose={() => setStrategyAgent(null)} />
      )}

      {/* Existing: Accountability Review LeadTable for selected agent (preserved) */}
      {!showTeamList && selectedAgentStats && selectedAgentStats.ignoredLeadsList.length > 0 && (
          <div className="animate-fade-in">
              <h3 className="text-md font-semibold text-gray-400 mb-3 italic">Accountability Review for <span className="text-gray-200">{selectedAgentStats.agent.name}</span></h3>
              <LeadTable
                leads={selectedAgentStats.ignoredLeadsList}
                activeTab={LeadStatus.COLD} // Shows cold headers if applicable
                currentUser={adminUser}
                onUpdate={onRefresh}
                onPatch={() => {}}
                showAgentColumn={false}
              />
          </div>
      )}

      {/* Warning Modal */}
      {warningAgentId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setWarningAgentId(null)}>
          <div className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-white/10 rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <MessageSquareWarning size={16} className="text-yellow-500" />
                Add Warning — {agents.find(a => a.id === warningAgentId)?.name}
              </h3>
              <button onClick={() => setWarningAgentId(null)} className="text-muted hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6">
              <textarea
                value={warningText}
                onChange={(e) => setWarningText(e.target.value)}
                placeholder="Describe the issue or warning..."
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 transition-all placeholder:text-muted resize-none"
              />
            </div>
            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => setWarningAgentId(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddWarning}
                disabled={!warningText.trim()}
                className="px-5 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-bold rounded-lg shadow-lg shadow-yellow-500/20 transition-all"
              >
                Log Warning
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating action bar for cross-agent reassignment */}
      {selectedLeadIds.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-white/10 px-6 py-4 animate-slide-up"
        >
          <div className="max-w-[1920px] mx-auto flex items-center justify-between gap-4 flex-wrap">
            <span className="text-sm font-bold text-white">
              {selectedLeadIds.size} lead{selectedLeadIds.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-3">
              <select
                value={reassignTargetAgentId}
                onChange={(e) => setReassignTargetAgentId(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer"
              >
                <option value="" className="bg-gray-900">Select agent...</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id} className="bg-gray-900">{agent.name}</option>
                ))}
              </select>
              <button
                onClick={handleReassign}
                disabled={!reassignTargetAgentId || reassignLoading}
                className="px-5 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-lg shadow-brand-500/20 transition-all flex items-center gap-2"
              >
                <ArrowRightLeft size={14} />
                {reassignLoading ? 'Reassigning...' : 'Reassign'}
              </button>
              <button
                onClick={() => {
                  setSelectedLeadIds(new Set());
                  setReassignTargetAgentId('');
                }}
                className="text-sm text-gray-400 hover:text-white underline transition-colors"
              >
                Clear selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
