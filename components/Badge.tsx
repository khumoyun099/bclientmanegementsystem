
import React from 'react';
import { TodoStatus, LeadStatus, EveryFreq } from '../types';

export const TodoBadge: React.FC<{ status: TodoStatus }> = ({ status }) => {
  const colors = {
    [TodoStatus.NEW]: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
    [TodoStatus.FOLLOWUP]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    [TodoStatus.CALLBACK]: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    [TodoStatus.SALE]: 'bg-emerald-500 text-white border-emerald-500',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${colors[status]} uppercase tracking-wider`}>
      {status}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: LeadStatus }> = ({ status }) => {
   const colors = {
    [LeadStatus.HOT]: 'bg-rose-500 text-white border-rose-500',
    [LeadStatus.WARM]: 'bg-amber-500 text-white border-amber-500',
    [LeadStatus.COLD]: 'bg-slate-800 text-slate-400 border-slate-700',
    [LeadStatus.PROGRESSIVE]: 'bg-indigo-500 text-white border-indigo-500',
    [LeadStatus.SOLD]: 'bg-emerald-500 text-white border-emerald-500',
    [LeadStatus.CLOSED]: 'bg-slate-900 text-slate-600 border-slate-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${colors[status]} uppercase tracking-wider`}>
      {status}
    </span>
  );
}

export const FrequencyBadge: React.FC<{ freq: EveryFreq }> = ({ freq }) => {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase tracking-wider whitespace-nowrap">
        {freq.replace('days', ' Days')}
      </span>
    );
  }
