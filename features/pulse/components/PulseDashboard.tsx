/**
 * PulseDashboard — the top-level replacement for the legacy
 * `components/Dashboard.tsx`. Preserves the same prop signature so the
 * existing Dashboard.tsx can be a 1-line re-export shim and `App.tsx`
 * doesn't need to change.
 *
 * Layout (see plan Phase 6):
 *   1. Morning Briefing slot            (Pulse-3 — stub div in Pulse-1)
 *   2. KPI strip                        (Pulse-1)
 *   3. Admin agent filter               (Pulse-1, admin-only)
 *   4. Pulse feed                       (Pulse-1, rules-only)
 *   5. Legacy PointsDashboard           (unchanged, re-mounted)
 */

import React, { useMemo, useState } from 'react';
import { Lead, Role, User } from '../../../types';
import { PointsDashboard } from '../../../components/PointsDashboard';
import { KpiStrip } from './KpiStrip';
import { PulseFeed } from './PulseFeed';
import { AdminAgentFilter } from './AdminAgentFilter';
import { LeadDetailModal } from '../../../components/LeadDetailModal';

interface PulseDashboardProps {
  leads: Lead[];
  currentUser: User;
  onUpdate: () => void;
  isLoading?: boolean;
  /** All users — needed for the admin agent filter. Optional for agents. */
  allUsers?: User[];
  /** Handler from App.tsx that knows how to patch a lead in place. */
  onPatch?: (id: string, updates: Partial<Lead>) => void;
}

export const PulseDashboard: React.FC<PulseDashboardProps> = ({
  leads,
  currentUser,
  onUpdate,
  isLoading,
  allUsers = [],
  onPatch,
}) => {
  const isAdmin = currentUser.role === Role.ADMIN;

  // Admin-only filter: which agent to view. null = whole team.
  const [adminFilterAgentId, setAdminFilterAgentId] = useState<string | null>(null);
  const effectiveAgentId = isAdmin ? adminFilterAgentId : currentUser.id;

  // Lead selected for detail view
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // The leads slice we show in the KPI strip. For admins viewing the
  // whole team we show ALL leads; for admins filtered to one agent, or
  // for agents, we show only that agent's leads.
  const visibleLeads = useMemo(() => {
    if (!effectiveAgentId && isAdmin) return leads; // whole team
    return leads.filter(l => l.assigned_agent_id === effectiveAgentId);
  }, [leads, effectiveAgentId, isAdmin]);

  // Agents eligible to appear in the admin filter (non-admin only)
  const filterAgents = useMemo(
    () => allUsers.filter(u => u.role === Role.AGENT),
    [allUsers]
  );

  const selectedLead = useMemo(
    () => leads.find(l => l.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-white tracking-tight">Pulse</h2>
        <p className="text-sm text-muted font-light">
          Your AI-powered coaching dashboard &mdash; leads that need you, ranked.
        </p>
      </div>

      {/* (Pulse-3 slot) Morning briefing. In Pulse-1 this is nothing. */}
      {/* <MorningBriefing agentId={effectiveAgentId ?? currentUser.id} /> */}

      {/* KPI strip */}
      <KpiStrip leads={visibleLeads} />

      {/* Admin-only agent filter */}
      {isAdmin && filterAgents.length > 0 && (
        <AdminAgentFilter
          agents={filterAgents}
          selectedAgentId={adminFilterAgentId}
          onChange={setAdminFilterAgentId}
        />
      )}

      {/* Pulse feed — the coach */}
      <PulseFeed
        agentId={effectiveAgentId}
        showAgent={isAdmin && !adminFilterAgentId}
        onOpenLead={(id) => setSelectedLeadId(id)}
      />

      {/* Legacy points dashboard, unchanged */}
      <PointsDashboard currentUser={currentUser} onUpdate={onUpdate} />

      {/* Lead detail modal, opened by Pulse items */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          currentUser={currentUser}
          onClose={() => setSelectedLeadId(null)}
          onUpdate={onUpdate}
          onPatch={onPatch}
        />
      )}
    </div>
  );
};
