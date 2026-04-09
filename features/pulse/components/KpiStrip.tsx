/**
 * KPI strip for the Pulse dashboard. Shows the counts agents actually
 * care about at-a-glance, plus the growth metrics preserved from the
 * legacy Dashboard (today / 3d / 6d / 10d new-lead counts).
 *
 * All metrics are computed from the in-memory `leads` prop — no
 * additional Supabase calls. Refreshes whenever the CRM refetches.
 */

import React, { useMemo } from 'react';
import { Lead, LeadStatus } from '../../../types';
import {
  Users,
  TrendingUp,
  Layers,
  Target,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface KpiStripProps {
  leads: Lead[];
}

const today = () => new Date().toISOString().split('T')[0];

function countInLastDays(leads: Lead[], days: number): number {
  const cutoff = new Date();
  if (days === 0) {
    cutoff.setHours(0, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() - days);
  }
  return leads.filter(l => {
    if (!l.created_at) return false;
    return new Date(l.created_at) >= cutoff;
  }).length;
}

function countSoldInLastDays(leads: Lead[], days: number): number {
  const cutoff = new Date();
  if (days === 0) {
    cutoff.setHours(0, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() - days);
  }
  return leads.filter(l => {
    if (l.status !== LeadStatus.SOLD) return false;
    if (!l.updated_at) return false;
    return new Date(l.updated_at) >= cutoff;
  }).length;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ leads }) => {
  const t = today();

  const metrics = useMemo(() => {
    const active = leads.filter(l => l.status !== 'sold' && l.status !== 'closed');
    const hot = active.filter(l => l.status === LeadStatus.HOT).length;
    const progressive = active.filter(l => l.status === LeadStatus.PROGRESSIVE).length;
    const dueToday = active.filter(l => l.follow_up_date <= t).length;

    // Conversion rate over the last 30 days: sold / (sold + closed).
    const thirtyDayCutoff = new Date();
    thirtyDayCutoff.setDate(thirtyDayCutoff.getDate() - 30);
    const recentlyResolved = leads.filter(l => {
      if (l.status !== LeadStatus.SOLD && l.status !== LeadStatus.CLOSED) return false;
      if (!l.updated_at) return false;
      return new Date(l.updated_at) >= thirtyDayCutoff;
    });
    const sold30 = recentlyResolved.filter(l => l.status === LeadStatus.SOLD).length;
    const conversion =
      recentlyResolved.length === 0
        ? 0
        : Math.round((sold30 / recentlyResolved.length) * 100);

    return {
      activeCount: active.length,
      hot,
      progressive,
      dueToday,
      conversion,
    };
  }, [leads, t]);

  const growth = useMemo(
    () => ({
      todayTaken: countInLastDays(leads, 0),
      taken3: countInLastDays(leads, 3),
      taken6: countInLastDays(leads, 6),
      taken10: countInLastDays(leads, 10),
      todayClosed: countSoldInLastDays(leads, 0),
      closed3: countSoldInLastDays(leads, 3),
      closed6: countSoldInLastDays(leads, 6),
      closed10: countSoldInLastDays(leads, 10),
    }),
    [leads]
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Primary KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile
          icon={Users}
          label="Active leads"
          value={metrics.activeCount}
          tone="brand"
        />
        <KpiTile
          icon={TrendingUp}
          label="Hot pipeline"
          value={metrics.hot}
          tone="orange"
        />
        <KpiTile
          icon={Layers}
          label="Progressive"
          value={metrics.progressive}
          tone="indigo"
          hint="Long sales cycle \u2014 keep in touch"
        />
        <KpiTile
          icon={Target}
          label="Due today"
          value={metrics.dueToday}
          tone={metrics.dueToday > 0 ? 'red' : 'muted'}
        />
        <KpiTile
          icon={CheckCircle2}
          label="Conversion 30d"
          value={`${metrics.conversion}%`}
          tone="emerald"
          hint="Closed-won rate last 30 days"
        />
      </div>

      {/* Growth + closed row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <GrowthRow
          title="Leads taken"
          today={growth.todayTaken}
          d3={growth.taken3}
          d6={growth.taken6}
          d10={growth.taken10}
          icon={Users}
        />
        <GrowthRow
          title="Leads closed (sold)"
          today={growth.todayClosed}
          d3={growth.closed3}
          d6={growth.closed6}
          d10={growth.closed10}
          icon={CheckCircle2}
        />
      </div>
    </div>
  );
};

// --- internals ---

interface KpiTileProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number | string;
  tone: 'brand' | 'orange' | 'indigo' | 'red' | 'emerald' | 'muted';
  hint?: string;
}

const toneMap: Record<KpiTileProps['tone'], { icon: string; value: string; border: string }> = {
  brand:   { icon: 'text-brand-500',    value: 'text-white',       border: 'border-brand-500/20'  },
  orange:  { icon: 'text-amber-500',    value: 'text-white',       border: 'border-amber-500/20'  },
  indigo:  { icon: 'text-indigo-400',   value: 'text-white',       border: 'border-indigo-500/20' },
  red:     { icon: 'text-red-400',      value: 'text-red-300',     border: 'border-red-500/30'    },
  emerald: { icon: 'text-emerald-400',  value: 'text-white',       border: 'border-emerald-500/20'},
  muted:   { icon: 'text-muted',        value: 'text-muted',       border: 'border-white/5'       },
};

const KpiTile: React.FC<KpiTileProps> = ({ icon: Icon, label, value, tone, hint }) => {
  const c = toneMap[tone];
  return (
    <div className={`dashboard-card p-4 border ${c.border} flex flex-col gap-2`}>
      <div className="flex items-center gap-2">
        <Icon size={14} className={c.icon} />
        <span className="text-[9px] font-black uppercase tracking-widest text-muted">{label}</span>
      </div>
      <div className={`text-2xl font-black tabular-nums ${c.value}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted leading-tight">{hint}</div>}
    </div>
  );
};

interface GrowthRowProps {
  title: string;
  today: number;
  d3: number;
  d6: number;
  d10: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const GrowthRow: React.FC<GrowthRowProps> = ({ title, today, d3, d6, d10, icon: Icon }) => (
  <div className="dashboard-card p-4 flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-brand-500" />
      <span className="text-[9px] font-black uppercase tracking-widest text-muted">{title}</span>
    </div>
    <div className="grid grid-cols-4 gap-2">
      <GrowthCell label="Today" value={today} highlight />
      <GrowthCell label="3d" value={d3} />
      <GrowthCell label="6d" value={d6} />
      <GrowthCell label="10d" value={d10} />
    </div>
  </div>
);

const GrowthCell: React.FC<{ label: string; value: number; highlight?: boolean }> = ({
  label,
  value,
  highlight,
}) => (
  <div
    className={`p-2 rounded-lg border flex flex-col items-center gap-0.5 ${
      highlight
        ? 'bg-brand-500/10 border-brand-500/20'
        : 'bg-white/[0.02] border-white/5'
    }`}
  >
    <span className="text-[8px] font-bold uppercase tracking-widest text-muted">{label}</span>
    <span className={`text-lg font-black tabular-nums ${highlight ? 'text-brand-400' : 'text-white'}`}>
      {value}
    </span>
  </div>
);
