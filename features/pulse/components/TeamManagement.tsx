/**
 * TeamManagement — admin-only page for the Operations Monitor.
 * Lets admins invite new team members, remove departing ones (with
 * forced lead reassignment), reactivate previously-removed members,
 * and change roles. All writes go through the pulse-admin-users
 * edge function which enforces admin-only access via the service role.
 *
 * The remove flow is intentionally gated: an admin CANNOT deactivate
 * an agent until they've picked an inheritor for that agent's active
 * leads. This prevents orphaned leads (assigned to a now-inactive
 * profile) from disappearing from filtered views.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  UserMinus,
  UserCheck,
  Shield,
  Loader2,
  AlertTriangle,
  X,
  CheckCircle2,
  Crown,
  Briefcase,
  ArrowRightLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Lead, Role, User } from '../../../types';
import { db } from '../../../services/db';
import {
  listAllTeamMembers,
  inviteTeamMember,
  deactivateTeamMember,
  reactivateTeamMember,
  setTeamMemberRole,
  type TeamMember,
} from '../services/pulseApi';

interface TeamManagementProps {
  currentUser: User;
  /**
   * Leads loaded by App.tsx — used to count each agent's active leads
   * and drive the force-reassignment flow when removing someone.
   */
  leads: Lead[];
  /**
   * Parent handler to refresh the app after any write (reassignments,
   * role changes, etc.) so the rest of the UI stays consistent.
   */
  onRefresh: () => void;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({
  currentUser,
  leads,
  onRefresh,
}) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'agent' | 'admin'>('agent');

  // Remove / reassign modal
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [reassignToId, setReassignToId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listAllTeamMembers();
      setMembers(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Active-lead counts per agent (used for the reassignment flow and the
  // row badge showing how many leads each agent owns).
  const leadsByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of leads) {
      if (l.status === 'sold' || l.status === 'closed') continue;
      map.set(l.assigned_agent_id, (map.get(l.assigned_agent_id) ?? 0) + 1);
    }
    return map;
  }, [leads]);

  // ---- Invite ------------------------------------------------------------
  const submitInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Email is required.');
      return;
    }
    setWorking(true);
    try {
      const res = await inviteTeamMember({
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        role: inviteRole,
      });
      if (res.error) {
        toast.error(`Invite failed: ${res.error}`);
        return;
      }
      toast.success(`Invite sent to ${inviteEmail}.`);
      setInviteOpen(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('agent');
      await load();
    } finally {
      setWorking(false);
    }
  };

  // ---- Remove + reassign --------------------------------------------------
  const openRemove = (member: TeamMember) => {
    if (member.id === currentUser.id) {
      toast.error('You cannot remove your own account.');
      return;
    }
    setRemoveTarget(member);
    setReassignToId('');
  };

  const submitRemove = async () => {
    if (!removeTarget) return;
    const leadCount = leadsByAgent.get(removeTarget.id) ?? 0;

    // If the departing agent has active leads, require an inheritor.
    if (leadCount > 0 && !reassignToId) {
      toast.error('Pick someone to inherit their leads first.');
      return;
    }

    setWorking(true);
    try {
      // Step 1: reassign all active leads if any.
      if (leadCount > 0) {
        const leadIds = leads
          .filter(
            l =>
              l.assigned_agent_id === removeTarget.id &&
              l.status !== 'sold' &&
              l.status !== 'closed',
          )
          .map(l => l.id);
        const target = members.find(m => m.id === reassignToId);
        if (!target) {
          toast.error('Selected inheritor not found.');
          return;
        }
        await db.bulkReassignLeads(
          leadIds,
          target.id,
          target.name,
          currentUser.id,
          removeTarget.name,
        );
      }

      // Step 2: deactivate the profile via the admin edge function.
      const res = await deactivateTeamMember(removeTarget.id);
      if (res.error) {
        toast.error(`Removal failed: ${res.error}`);
        return;
      }

      toast.success(
        leadCount > 0
          ? `${removeTarget.name} removed. ${leadCount} lead${leadCount === 1 ? '' : 's'} reassigned.`
          : `${removeTarget.name} removed.`,
      );
      setRemoveTarget(null);
      setReassignToId('');
      await load();
      onRefresh();
    } finally {
      setWorking(false);
    }
  };

  // ---- Reactivate ---------------------------------------------------------
  const handleReactivate = async (member: TeamMember) => {
    if (!confirm(`Reactivate ${member.name}?`)) return;
    setWorking(true);
    try {
      const res = await reactivateTeamMember(member.id);
      if (res.error) {
        toast.error(`Reactivate failed: ${res.error}`);
        return;
      }
      toast.success(`${member.name} reactivated.`);
      await load();
      onRefresh();
    } finally {
      setWorking(false);
    }
  };

  // ---- Toggle role --------------------------------------------------------
  const handleToggleRole = async (member: TeamMember) => {
    const newRole: 'agent' | 'admin' = member.role === 'admin' ? 'agent' : 'admin';
    if (
      !confirm(
        `Change ${member.name} from ${member.role.toUpperCase()} to ${newRole.toUpperCase()}?`,
      )
    )
      return;
    setWorking(true);
    try {
      const res = await setTeamMemberRole(member.id, newRole);
      if (res.error) {
        toast.error(`Role change failed: ${res.error}`);
        return;
      }
      toast.success(`${member.name} is now ${newRole.toUpperCase()}.`);
      await load();
      onRefresh();
    } finally {
      setWorking(false);
    }
  };

  const activeMembers = members.filter(m => m.active);
  const inactiveMembers = members.filter(m => !m.active);
  const reassignCandidates = activeMembers.filter(
    m => m.id !== removeTarget?.id && m.role === 'agent',
  );
  const removeTargetLeadCount = removeTarget
    ? leadsByAgent.get(removeTarget.id) ?? 0
    : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20">
            <Users size={16} className="text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Team Management</h2>
            <p className="text-xs text-muted mt-0.5 max-w-xl">
              Invite new team members, remove people who have left, and change roles. Removed members' leads must be reassigned before they disappear from the team list.
            </p>
          </div>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-brand-500/20 transition-all"
        >
          <UserPlus size={14} /> Invite member
        </button>
      </div>

      {/* Active members */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
            Active ({activeMembers.length})
          </h3>
          {loading && <Loader2 size={12} className="animate-spin text-muted" />}
        </div>
        <div className="divide-y divide-white/5">
          {activeMembers.length === 0 && !loading && (
            <p className="text-xs text-muted text-center py-8 italic">No active members.</p>
          )}
          {activeMembers.map(member => {
            const leadCount = leadsByAgent.get(member.id) ?? 0;
            const isMe = member.id === currentUser.id;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between px-5 py-3 gap-4 hover:bg-white/[0.01]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white truncate">{member.name}</span>
                    {member.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400">
                        <Crown size={9} /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-brand-500/10 border border-brand-500/20 text-brand-400">
                        <Briefcase size={9} /> Agent
                      </span>
                    )}
                    {isMe && (
                      <span className="text-[9px] font-bold uppercase text-muted">(you)</span>
                    )}
                    {leadCount > 0 && (
                      <span className="text-[9px] font-bold uppercase text-muted">
                        · {leadCount} active lead{leadCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">{member.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleRole(member)}
                    disabled={isMe || working}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-muted hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    title={isMe ? "You can't change your own role" : 'Toggle role'}
                  >
                    <Shield size={10} /> Role
                  </button>
                  <button
                    onClick={() => openRemove(member)}
                    disabled={isMe || working}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    title={isMe ? "You can't remove yourself" : 'Remove member'}
                  >
                    <UserMinus size={10} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inactive / removed members */}
      {inactiveMembers.length > 0 && (
        <div className="dashboard-card overflow-hidden opacity-75">
          <div className="px-5 py-3 border-b border-white/5 bg-white/[0.02]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
              Removed ({inactiveMembers.length})
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {inactiveMembers.map(member => (
              <div
                key={member.id}
                className="flex items-center justify-between px-5 py-3 gap-4 hover:bg-white/[0.01]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-muted line-through truncate">
                      {member.name}
                    </span>
                    <span className="text-[9px] font-bold uppercase text-muted">
                      · {member.role}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">{member.email}</p>
                </div>
                <button
                  onClick={() => handleReactivate(member)}
                  disabled={working}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase tracking-widest text-emerald-400 transition-all disabled:opacity-30"
                >
                  <UserCheck size={10} /> Reactivate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => !working && setInviteOpen(false)}
        >
          <div
            className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-white/10 rounded-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]">
              <UserPlus size={16} className="text-brand-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                Invite team member
              </h3>
              <button
                onClick={() => !working && setInviteOpen(false)}
                className="ml-auto text-muted hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-muted leading-relaxed">
                An invite email will be sent. When they click the link they'll be asked to set a password, and they'll automatically show up in this list with the role you pick below.
              </p>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1.5 block">
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="new.agent@company.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  disabled={working}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1.5 block">
                  Full name (optional)
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  disabled={working}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1.5 block">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'agent' | 'admin')}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  disabled={working}
                >
                  <option value="agent" className="bg-[#111]">Agent</option>
                  <option value="admin" className="bg-[#111]">Admin</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => !working && setInviteOpen(false)}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white hover:bg-white/5 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submitInvite}
                disabled={working || !inviteEmail.trim()}
                className="px-5 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-30 text-white text-sm font-bold rounded-lg shadow-lg shadow-brand-500/20 flex items-center gap-2"
              >
                {working ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Send invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove + reassign modal */}
      {removeTarget && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => !working && setRemoveTarget(null)}
        >
          <div
            className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-red-500/20 rounded-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3 bg-red-500/5">
              <AlertTriangle size={16} className="text-red-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                Remove {removeTarget.name}?
              </h3>
              <button
                onClick={() => !working && setRemoveTarget(null)}
                className="ml-auto text-muted hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {removeTargetLeadCount > 0 ? (
                <>
                  <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <ArrowRightLeft size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300 leading-relaxed">
                      {removeTarget.name} owns <strong>{removeTargetLeadCount}</strong> active lead
                      {removeTargetLeadCount === 1 ? '' : 's'}. Pick who inherits them before removing.
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1.5 block">
                      Reassign their leads to
                    </label>
                    <select
                      value={reassignToId}
                      onChange={e => setReassignToId(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                      disabled={working}
                    >
                      <option value="" className="bg-[#111]">
                        — Select an agent —
                      </option>
                      {reassignCandidates.map(m => (
                        <option key={m.id} value={m.id} className="bg-[#111]">
                          {m.name} ({leadsByAgent.get(m.id) ?? 0} active leads)
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted leading-relaxed">
                  {removeTarget.name} has no active leads. Removal will deactivate their profile but keep their historical records intact.
                </p>
              )}
              <p className="text-[11px] text-muted italic leading-relaxed">
                Removal is reversible — you can reactivate them anytime from the "Removed" list below.
              </p>
            </div>
            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => !working && setRemoveTarget(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white hover:bg-white/5 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submitRemove}
                disabled={
                  working ||
                  (removeTargetLeadCount > 0 && !reassignToId)
                }
                className="px-5 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center gap-2"
              >
                {working ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                {removeTargetLeadCount > 0 ? 'Reassign & Remove' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
