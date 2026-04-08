/**
 * Admin-only agent filter dropdown. When set, the Pulse feed + KPI
 * strip show data for just that agent; when cleared, admin sees the
 * full team aggregate.
 *
 * Non-admin users never see this control (PulseDashboard decides that).
 */

import React from 'react';
import { Users, X } from 'lucide-react';
import { User } from '../../../types';

interface AdminAgentFilterProps {
  agents: User[];
  selectedAgentId: string | null;
  onChange: (id: string | null) => void;
}

export const AdminAgentFilter: React.FC<AdminAgentFilterProps> = ({
  agents,
  selectedAgentId,
  onChange,
}) => {
  return (
    <div className="flex items-center gap-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl">
      <Users size={14} className="text-brand-500 shrink-0" />
      <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">
        Viewing:
      </span>
      <select
        value={selectedAgentId || ''}
        onChange={e => onChange(e.target.value || null)}
        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer min-w-[180px]"
      >
        <option value="" className="bg-[#111]">
          Whole team
        </option>
        {agents.map(a => (
          <option key={a.id} value={a.id} className="bg-[#111]">
            {a.name} ({a.email})
          </option>
        ))}
      </select>
      {selectedAgentId && (
        <button
          onClick={() => onChange(null)}
          className="p-1.5 text-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all"
          title="Clear filter"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};
