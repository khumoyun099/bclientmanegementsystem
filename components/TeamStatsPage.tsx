import React, { useState, useEffect } from 'react';
import { User, AgentStats, AgentTarget } from '../types';
import { db } from '../services/db';
import { supabase } from '../services/supabase';
import { TrendingUp, Target, CalendarDays, Loader2, Users, Save, Edit2 } from 'lucide-react';

export const TeamStatsPage: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const [teamStats, setTeamStats] = useState<AgentStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{agentId: string, field: string} | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  useEffect(() => {
    loadStats();
  }, [month]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const team = await db.calculateTeamStats(month);
      setTeamStats(team);
      
      const { data: agents } = await supabase.from('profiles').select('id').eq('role', 'agent');
      if (agents) {
        const stats = await Promise.all(agents.map(a => db.calculateAgentStats(a.id, month)));
        setAgentStats(stats);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualEdit = (agentId: string, field: string, currentValue: number) => {
    setEditingCell({ agentId, field });
    setEditValue(currentValue.toString());
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { agentId, field } = editingCell;
    const val = parseFloat(editValue || '0');
    
    // Find agent name for the target record
    const agent = agentStats.find(a => a.agent_id === agentId);
    if (!agent) return;

    await db.setAgentTarget({
      agent_id: agentId,
      agent_name: agent.agent_name,
      month: `${month}-01`,
      [field]: val
    });

    setEditingCell(null);
    loadStats();
  };

  const headerLabelClass = "px-4 py-3 text-left text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-[#2f2f2f]";
  const cellClass = "px-4 py-3 text-xs font-medium text-gray-400 border-b border-[#2a2a2a]";
  const editableCellClass = "px-4 py-3 text-xs font-black text-brand-400 border-b border-[#2a2a2a] cursor-pointer hover:bg-brand-500/5 transition-colors group relative";
  const boldCellClass = "px-4 py-3 text-sm font-black text-white border-b border-[#2a2a2a]";

  if (loading && agentStats.length === 0) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
       <Loader2 className="animate-spin text-brand-500" size={48} />
       <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Loading Board...</p>
    </div>
  );

  const EditableCell = ({ agentId, field, value, prefix = "", isMoney = false }: { agentId: string, field: string, value: number, prefix?: string, isMoney?: boolean }) => {
    const isEditing = editingCell?.agentId === agentId && editingCell?.field === field;
    
    return (
      <td className={editableCellClass} onClick={() => handleManualEdit(agentId, field, value)}>
        {isEditing ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input 
              autoFocus
              type="number"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveEdit()}
              onBlur={saveEdit}
              className="bg-[#1a1a1a] border border-brand-500 text-brand-400 text-xs px-2 py-0.5 rounded w-20 outline-none"
            />
            <Save size={12} className="text-brand-500" />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span>{prefix}{isMoney ? value.toLocaleString() : value}</span>
            <Edit2 size={10} className="text-gray-700 opacity-0 group-hover:opacity-100" />
          </div>
        )}
      </td>
    );
  };

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      
      {/* Month Picker & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#202020] p-6 rounded-3xl border border-[#2f2f2f] shadow-xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-brand-500/10 rounded-2xl border border-brand-500/20 text-brand-500">
             <TrendingUp size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">Team Statistics</h2>
            <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mt-1">Manual Performance Input Active</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
           <CalendarDays size={18} className="text-gray-500" />
           <input 
              type="month" 
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-2 text-gray-200 text-xs font-bold focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
           />
        </div>
      </div>

      {/* OVERALL PERFORMANCE TABLE (TABLE 2) */}
      <div className="bg-[#202020] rounded-3xl border border-[#2f2f2f] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2f2f2f] bg-[#252525] flex justify-between items-center">
           <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-3">
              <Users size={14} className="text-brand-500" />
              Monthly Performance Actuals
           </h3>
           <span className="text-[9px] text-gray-600 font-bold uppercase italic">Click any blue value to edit</span>
        </div>
        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                 <tr>
                    <th className={headerLabelClass}>Names</th>
                    <th className={headerLabelClass}>New GP</th>
                    <th className={headerLabelClass}>Return GP</th>
                    <th className={headerLabelClass}>Total GP</th>
                    <th className={headerLabelClass}>Sales Num</th>
                    <th className={headerLabelClass}>TP GP</th>
                    <th className={headerLabelClass}>TP Number</th>
                    <th className={headerLabelClass}>Created Leads</th>
                    <th className={headerLabelClass}>Taken Lead</th>
                    <th className={headerLabelClass}>Total Leads</th>
                    <th className={headerLabelClass}>GP Per Lead</th>
                 </tr>
              </thead>
              <tbody>
                 {/* Team Total Row */}
                 {teamStats && (
                    <tr className="bg-brand-500/5 transition-colors">
                       <td className={boldCellClass}>Team Total</td>
                       <td className={cellClass}>${teamStats.new_gp.toLocaleString()}</td>
                       <td className={cellClass}>${teamStats.return_gp.toLocaleString()}</td>
                       <td className={boldCellClass}>${teamStats.total_gp.toLocaleString()}</td>
                       <td className={cellClass}>{teamStats.sales_num}</td>
                       <td className={cellClass}>${teamStats.tp_gp.toLocaleString()}</td>
                       <td className={cellClass}>{teamStats.tp_number}</td>
                       <td className={cellClass}>{teamStats.created_leads}</td>
                       <td className={cellClass}>{teamStats.taken_leads}</td>
                       <td className={cellClass}>{teamStats.total_leads}</td>
                       <td className={cellClass}>${teamStats.gp_per_lead.toFixed(2)}</td>
                    </tr>
                 )}
                 {/* Individual Agents */}
                 {agentStats.map(s => (
                    <tr key={s.agent_id} className="hover:bg-white/[0.01] transition-colors">
                       <td className={cellClass}>{s.agent_name}</td>
                       <EditableCell agentId={s.agent_id} field="manual_new_gp" value={s.new_gp} prefix="$" isMoney />
                       <EditableCell agentId={s.agent_id} field="manual_return_gp" value={s.return_gp} prefix="$" isMoney />
                       <td className={cellClass}>${s.total_gp.toLocaleString()}</td>
                       <EditableCell agentId={s.agent_id} field="manual_sales_num" value={s.sales_num} />
                       <EditableCell agentId={s.agent_id} field="manual_tp_gp" value={s.tp_gp} prefix="$" isMoney />
                       <EditableCell agentId={s.agent_id} field="manual_tp_num" value={s.tp_number} />
                       <EditableCell agentId={s.agent_id} field="manual_created_leads" value={s.created_leads} />
                       <EditableCell agentId={s.agent_id} field="manual_taken_leads" value={s.taken_leads} />
                       <EditableCell agentId={s.agent_id} field="manual_total_leads" value={s.total_leads} />
                       <td className={cellClass}>${s.gp_per_lead.toFixed(2)}</td>
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         
         {/* WEEKLY BREAKDOWN (TABLE 3) */}
         <div className="bg-[#202020] rounded-3xl border border-[#2f2f2f] shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#2f2f2f] bg-[#252525]">
               <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-3">
                  <CalendarDays size={14} className="text-brand-500" />
                  Weekly GP Tracking
               </h3>
            </div>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr>
                        <th className={headerLabelClass}>Names</th>
                        <th className={headerLabelClass}>1st week</th>
                        <th className={headerLabelClass}>2nd week</th>
                        <th className={headerLabelClass}>3rd week</th>
                        <th className={headerLabelClass}>4th week</th>
                     </tr>
                  </thead>
                  <tbody>
                     {agentStats.map(s => (
                        <tr key={s.agent_id} className="hover:bg-white/[0.01]">
                           <td className={cellClass}>{s.agent_name}</td>
                           <EditableCell agentId={s.agent_id} field="manual_week1" value={s.week1} prefix="$" isMoney />
                           <EditableCell agentId={s.agent_id} field="manual_week2" value={s.week2} prefix="$" isMoney />
                           <EditableCell agentId={s.agent_id} field="manual_week3" value={s.week3} prefix="$" isMoney />
                           <EditableCell agentId={s.agent_id} field="manual_week4" value={s.week4} prefix="$" isMoney />
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

         {/* TARGETS & PROGRESS (TABLE 4) */}
         <div className="bg-[#202020] rounded-3xl border border-[#2f2f2f] shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#2f2f2f] bg-[#252525]">
               <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-3">
                  <Target size={14} className="text-brand-500" />
                  Targets & Accomplishments
               </h3>
            </div>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr>
                        <th className={headerLabelClass}>Names</th>
                        <th className={headerLabelClass}>GP Target</th>
                        <th className={headerLabelClass}>GP %</th>
                        <th className={headerLabelClass}>TP Target</th>
                        <th className={headerLabelClass}>TP %</th>
                        <th className={headerLabelClass}>Sales Tgt</th>
                        <th className={headerLabelClass}>Sales %</th>
                     </tr>
                  </thead>
                  <tbody>
                     {agentStats.map(s => (
                        <tr key={s.agent_id} className="hover:bg-white/[0.01]">
                           <td className={cellClass}>{s.agent_name}</td>
                           <EditableCell agentId={s.agent_id} field="gp_target" value={s.gp_target} prefix="$" isMoney />
                           <td className={cellClass}>
                              <span className={s.gp_progress >= 100 ? 'text-green-500 font-black' : 'text-amber-500'}>
                                 {s.gp_progress.toFixed(1)}%
                              </span>
                           </td>
                           <EditableCell agentId={s.agent_id} field="tp_target" value={s.tp_target} prefix="$" isMoney />
                           <td className={cellClass}>{s.tp_progress.toFixed(1)}%</td>
                           <EditableCell agentId={s.agent_id} field="sales_target" value={s.sales_target} />
                           <td className={cellClass}>{s.sales_progress.toFixed(1)}%</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

      </div>
    </div>
  );
};