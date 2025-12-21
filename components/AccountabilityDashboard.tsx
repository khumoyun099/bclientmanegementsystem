
import React, { useMemo, useState } from 'react';
import { User, Lead, ActivityLog, Role, LeadStatus } from '../types';
import { getTodayString, db } from '../services/db';
import { AlertTriangle, CheckCircle2, Users, Shield, UserCog, LineChart, Info } from 'lucide-react';
import { LeadTable } from './LeadTable';
import { StrategyModal } from './StrategyModal';

interface AccountabilityDashboardProps {
  users: User[];
  leads: Lead[];
  logs: ActivityLog[];
  onSelectLead: (lead: Lead) => void;
  onRefresh: () => void;
}

export const AccountabilityDashboard: React.FC<AccountabilityDashboardProps> = ({ users, leads, logs, onSelectLead, onRefresh }) => {
  const agents = users.filter(u => u.role === Role.AGENT);
  const today = getTodayString();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showTeamList, setShowTeamList] = useState(false);
  const [strategyAgent, setStrategyAgent] = useState<User | null>(null);

  // Dummy admin user for table context
  const adminUser = users.find(u => u.role === Role.ADMIN) || users[0];

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
            const hasActivityToday = logs.some(log => {
                const logDate = log.created_at.split('T')[0];
                return log.lead_id === lead.id && log.agent_id === agent.id && log.action === 'note_added' && logDate === today;
            });
            return !hasActivityToday;
        });

        return {
            agent,
            overdueCount: overdueLeads.length,
            ignoredCount: ignoredLeads.length + coldViolations.length,
            ignoredLeadsList: [...new Set([...ignoredLeads, ...coldViolations])],
            violationCount: coldViolations.length
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

  const selectedAgentStats = selectedAgentId ? agentStats.find(s => s.agent.id === selectedAgentId) : null;

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
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {agentStats.map(stat => (
                        <div 
                          key={stat.agent.id} 
                          onClick={() => setSelectedAgentId(stat.agent.id)}
                          className={`p-4 rounded-lg border transition-all flex flex-col ${selectedAgentId === stat.agent.id ? 'ring-1 ring-brand-500 border-brand-500 bg-brand-900/10' : 'border-[#333] hover:border-[#444] hover:bg-[#252525]'}`}
                        >
                           <div className="flex justify-between items-start mb-4">
                              <div className="cursor-pointer">
                                  <h3 className="font-semibold text-gray-200">{stat.agent.name}</h3>
                                  <p className="text-xs text-gray-500">{stat.agent.email}</p>
                              </div>
                              <div className="text-right">
                                  <div className={`text-2xl font-bold ${stat.ignoredCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                      {stat.ignoredCount}
                                  </div>
                                  {stat.violationCount > 0 && (
                                      <p className="text-[8px] font-black text-red-400 uppercase">{stat.violationCount} Violations</p>
                                  )}
                              </div>
                           </div>
                           
                           <div className="mt-auto flex flex-col gap-3">
                              <div className="text-[10px] font-bold text-gray-500 flex justify-between uppercase tracking-tight">
                                  <span>Action Items</span>
                                  <span className={stat.ignoredCount > 0 ? 'text-red-400' : 'text-green-400'}>
                                    {stat.ignoredCount > 0 ? 'Needs Review' : 'Good Standing'}
                                  </span>
                              </div>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setStrategyAgent(stat.agent); }}
                                className="w-full py-2 bg-[#2f2f2f] hover:bg-brand-600 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 group"
                              >
                                 <LineChart size={14} className="text-brand-400 group-hover:text-white" />
                                 Strategy Portal
                              </button>
                           </div>
                        </div>
                    ))}
                 </div>
             )}
          </div>
      )}

      {strategyAgent && (
          <StrategyModal agent={strategyAgent} onClose={() => setStrategyAgent(null)} />
      )}

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
    </div>
  );
};
