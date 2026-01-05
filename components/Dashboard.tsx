
import React from 'react';
import { Lead, LeadStatus, User } from '../types';
import { TrendingUp, Users, Target, CheckCircle2, ArrowUpRight, ArrowDownRight, Zap, Layers } from 'lucide-react';
import { PointsDashboard } from './PointsDashboard';

interface DashboardProps {
  leads: Lead[];
  currentUser: User;
  onUpdate: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ leads, currentUser, onUpdate }) => {
  const totalLeads = leads.length;
  const hotLeads = leads.filter(l => l.status === LeadStatus.HOT).length;
  const soldLeads = leads.filter(l => l.status === LeadStatus.SOLD).length;
  const followUpToday = leads.filter(l => l.follow_up_date <= new Date().toISOString().split('T')[0]).length;

  const StatCard = ({ title, value, icon: Icon, colorClass, description }: any) => (
    <div className="dashboard-card p-6 flex flex-col gap-4 relative overflow-hidden group">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-white/5 border border-white/5 ${colorClass.replace('bg-', 'text-')}`}>
          <Icon size={18} />
        </div>
        <h3 className="text-xs font-semibold text-white tracking-tight uppercase">{title}</h3>
      </div>
      <div>
        <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
        <p className="text-[11px] text-muted mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowUpRight size={14} className="text-muted" />
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-white tracking-tight">System Infrastructure</h2>
        <p className="text-sm text-muted font-light">Real-time oversight of lead acquisition and backend matching.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Leads"
          value={totalLeads}
          icon={Users}
          colorClass="bg-brand-500"
          description="Total Postgres leads currently tracked in database."
        />
        <StatCard
          title="Priority Hot"
          value={hotLeads}
          icon={TrendingUp}
          colorClass="bg-accent-orange"
          description="High-intent opportunities requiring immediate action."
        />
        <StatCard
          title="Pipeline Due"
          value={followUpToday}
          icon={Target}
          colorClass="bg-indigo-400"
          description="Scheduled tasks awaiting server-side completion."
        />
        <StatCard
          title="Conversion"
          value={soldLeads}
          icon={CheckCircle2}
          colorClass="bg-accent-emerald"
          description="Qualified deals successfully matched in CRM."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 dashboard-card p-8 grid-bg min-h-[300px] flex flex-col">
          <div className="flex justify-between items-center mb-10">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Layers size={14} className="text-brand-500" /> Realtime Data Sync
              </h3>
              <p className="text-[11px] text-muted">Latency monitored across global edge functions.</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-500 text-[10px] font-bold">
              CONNECTED
            </div>
          </div>

          <div className="flex-1 flex items-end justify-between gap-2 px-2">
            {[45, 60, 55, 85, 40, 75, 95, 80, 65, 50, 70, 90, 60, 40, 80].map((h, i) => (
              <div key={i} className="flex-1 group relative">
                <div
                  style={{ height: `${h}%` }}
                  className={`w-full rounded-t-sm transition-all duration-700 ${i === 6 ? 'bg-brand-500' : 'bg-white/10 group-hover:bg-white/20'}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-card p-6 flex flex-col">
          <div className="flex flex-col gap-1 mb-8">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Growth Metrics</h3>
            <p className="text-[11px] text-muted">New leads added to CRM over time.</p>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-4">
            {[
              { label: 'Today', days: 0, color: 'text-brand-500', bg: 'bg-brand-500/10', border: 'border-brand-500/20' },
              { label: 'Last 3 Days', days: 3, color: 'text-white', bg: 'bg-white/5', border: 'border-white/10' },
              { label: 'Last 6 Days', days: 6, color: 'text-white', bg: 'bg-white/5', border: 'border-white/10' },
              { label: 'Last 10 Days', days: 10, color: 'text-muted', bg: 'bg-white/5', border: 'border-white/5' }
            ].map(stat => {
              const count = leads.filter(l => {
                const date = new Date(l.created_at);
                const cutoff = new Date();
                if (stat.days === 0) {
                  // Today: compare just the date part
                  cutoff.setHours(0, 0, 0, 0);
                } else {
                  cutoff.setDate(cutoff.getDate() - stat.days);
                }
                return date >= cutoff;
              }).length;

              return (
                <div key={stat.label} className={`flex items-center justify-between p-3 rounded-lg border ${stat.border} ${stat.bg}`}>
                  <span className="text-xs font-bold text-muted uppercase tracking-wider">{stat.label}</span>
                  <span className={`text-xl font-black ${stat.color}`}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PointsDashboard currentUser={currentUser} onUpdate={onUpdate} />
    </div>
  );
};
