
import { Lead, User, Role, LeadStatus, TodoStatus, ActivityLog, Note, DeletionStatus, PointsHistory, AgentTarget, AgentStats, PersonalTask, PayoutRequest, UsefulLink } from '../types';

// Distinguishes "the DB schema isn't set up" from "the network is flaky".
// The UI should only fall back to the DatabaseSetup screen for the former.
export const isSchemaMissingError = (err: any): boolean => {
  if (!err) return false;
  if (err.code === '42P01') return true;
  const msg = String(err.message || err).toLowerCase();
  return msg.includes('does not exist') || msg.includes('relation') && msg.includes('does not exist');
};
import { supabase } from './supabase';

export const getTodayString = () => new Date().toISOString().split('T')[0];

class DBService {

  async checkTableExists(tableName: string): Promise<boolean> {
    try {
      const { error } = await supabase.from(tableName).select('count', { count: 'exact', head: true });
      if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentProfile(): Promise<User | null> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) return null;

    const user = session.user;
    const userEmail = (user.email || '').toLowerCase();

    try {
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching profile:', fetchError);
        throw fetchError;
      }

      if (!profile) {
        console.log('No profile found, creating new profile for user:', user.id);
        
        // Try INSERT first (for new users)
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            role: userEmail.includes('admin') ? Role.ADMIN : Role.AGENT,
            points: 0,
            theme_preference: 'dark'
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating profile:', insertError);
          // If insert fails, try to fetch again (maybe RLS issue)
          const { data: retryProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
          
          if (retryProfile) {
            return {
              id: user.id,
              email: user.email || '',
              name: retryProfile.name,
              role: (retryProfile.role || Role.AGENT) as Role,
              points: retryProfile.points || 0,
              theme_preference: retryProfile.theme_preference || 'dark'
            };
          }
          throw insertError;
        }
        
        return {
          id: user.id,
          email: user.email || '',
          name: newProfile.name,
          role: newProfile.role as Role,
          points: newProfile.points || 0,
          theme_preference: newProfile.theme_preference || 'dark'
        };
      }

      return {
        id: user.id,
        email: user.email || '',
        name: profile.name,
        role: (profile.role || Role.AGENT) as Role,
        points: profile.points || 0,
        theme_preference: profile.theme_preference || 'dark'
      };
    } catch (err: any) {
      console.error('getCurrentProfile error:', err);
      return null;
    }
  }

  async updateThemePreference(userId: string, theme: 'system' | 'dark' | 'light'): Promise<void> {
    await supabase.from('profiles').update({ theme_preference: theme }).eq('id', userId);
  }

  async promoteToAdmin(userId: string): Promise<void> {
    await supabase.from('profiles').update({ role: Role.ADMIN }).eq('id', userId);
  }

  async getAllProfiles(): Promise<User[]> {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    return data || [];
  }

  async getLeads(user: User, options?: { page?: number; pageSize?: number }): Promise<{ data: Lead[]; count: number; hasMore: boolean }> {
    const exists = await this.checkTableExists('leads');
    if (!exists) return { data: [], count: 0, hasMore: false };

    // Default page size lowered from 10000 to 500, sorted by most-recently-touched.
    // This prevents the silent truncation bug where the oldest `follow_up_date`
    // rows filled the array and the newest activity fell off the bottom.
    const pageSize = options?.pageSize ?? 500;
    const page = options?.page ?? 0;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from('leads').select('*, notes(*)', { count: 'exact' });
    if (user.role === Role.AGENT) {
      query = query.eq('assigned_agent_id', user.id);
    }
    const { data, error, count } = await query
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(from, to);
    if (error) throw error;
    const total = count || 0;
    const rows = data || [];
    // Ensure embedded notes are always in chronological order. The Supabase
    // embed join does not guarantee order; UI code assumes `notes[last]` is
    // the newest, and HistoryModal reverses the array — both break on
    // out-of-order rows.
    for (const lead of rows) {
      if (Array.isArray((lead as any).notes)) {
        (lead as any).notes.sort((a: any, b: any) => {
          const ta = a?.created_at ? Date.parse(a.created_at) : 0;
          const tb = b?.created_at ? Date.parse(b.created_at) : 0;
          return ta - tb;
        });
      }
    }
    return { data: rows, count: total, hasMore: total > (from + rows.length) };
  }

  async addLead(
    leadData: Partial<Lead>,
    user: User,
    targetAgent?: { id: string; name: string }
  ): Promise<Lead> {
    // An admin can create a lead on behalf of another agent via targetAgent.
    // If not provided, the creator owns the lead (the default path for agents).
    const ownerId = targetAgent?.id ?? user.id;
    const ownerName = targetAgent?.name ?? user.name;

    const { data, error } = await supabase.from('leads').insert({
      ...leadData,
      assigned_agent_id: ownerId,
      assigned_agent_name: ownerName,
      follow_up_date: leadData.follow_up_date || getTodayString(),
    }).select().single();
    if (error) throw error;

    // Audit: log who created the lead and whether it was an admin-proxy create.
    const detail = targetAgent && targetAgent.id !== user.id
      ? `Created by ${user.name} on behalf of ${ownerName}`
      : `Created by ${user.name}`;
    this.logActivity(data.id, user.id, 'created', detail).catch(() => {});

    return data;
  }

  async updateLead(leadId: string, updates: Partial<Lead>, user: User): Promise<void> {
    // Read-before-write so we can diff and write an audit trail for any
    // tracked field change. Failing the pre-read should NOT block the update
    // — a missing log is better than a missing update.
    let before: any = null;
    try {
      const { data } = await supabase.from('leads').select('status,todo,follow_up_date,every,cold_status,assigned_agent_id').eq('id', leadId).maybeSingle();
      before = data;
    } catch {
      before = null;
    }

    const { error } = await supabase.from('leads').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', leadId);
    if (error) {
      console.error("Supabase update error:", error);
      throw error;
    }

    // Audit log: one row per field that actually changed. Best-effort; never throws.
    if (before) {
      const fieldMap: Array<{ key: keyof Lead; action: ActivityLog['action']; label: string }> = [
        { key: 'status', action: 'status_changed', label: 'Status' },
        { key: 'todo', action: 'todo_changed', label: 'Todo' },
        { key: 'follow_up_date', action: 'date_changed', label: 'Follow-up date' },
        { key: 'every', action: 'frequency_changed', label: 'Frequency' },
        { key: 'cold_status', action: 'cold_status_changed', label: 'Cold status' },
        { key: 'assigned_agent_id', action: 'reassigned', label: 'Assigned agent' },
      ];
      for (const f of fieldMap) {
        const newVal = (updates as any)[f.key];
        if (newVal === undefined) continue;
        const oldVal = before[f.key];
        if (newVal === oldVal) continue;
        this.logActivity(leadId, user.id, f.action, `${f.label}: ${oldVal ?? '—'} → ${newVal ?? '—'}`).catch(() => {});
      }
    }
  }

  async deleteLead(leadId: string, user?: User): Promise<void> {
    // Audit the deletion BEFORE the row goes away, so the trail survives.
    if (user) {
      this.logActivity(leadId, user.id, 'deleted', `Lead permanently deleted`).catch(() => {});
    }
    const { error } = await supabase.from('leads').delete().eq('id', leadId);
    if (error) throw error;
  }

  async bulkDeleteLeads(leadIds: string[], user: User): Promise<void> {
    if (!leadIds.length) return;
    // Audit first (best-effort) so the trail survives even if delete partially fails.
    try {
      const rows = leadIds.map(id => ({
        lead_id: id,
        agent_id: user.id,
        action: 'deleted' as const,
        details: `Lead permanently deleted via bulk action`,
      }));
      await supabase.from('activity_logs').insert(rows);
    } catch (e) {
      console.warn('Bulk delete audit log failed (non-fatal):', e);
    }
    const { error } = await supabase.from('leads').delete().in('id', leadIds);
    if (error) throw error;
  }

  async updateProfileRole(userId: string, role: Role): Promise<void> {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
    if (error) throw error;
  }

  async requestDeletion(leadId: string, user: User): Promise<void> {
    const deletionRequest = {
      status: DeletionStatus.PENDING,
      requestedBy: user.name,
      requestedAt: new Date().toISOString()
    };
    await supabase.from('leads').update({ deletionRequest }).eq('id', leadId);
    await this.logActivity(leadId, user.id, 'rule_violation', `Requested deletion for lead`);
  }

  async addNote(leadId: string, text: string, user: User): Promise<void> {
    await supabase.from('notes').insert({
      lead_id: leadId,
      text,
      author_id: user.id,
      author_name: user.name
    });
  }

  async logActivity(leadId: string, agentId: string, action: string, details: string): Promise<void> {
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      agent_id: agentId,
      action,
      details
    });
  }

  async getActivityLogs(): Promise<ActivityLog[]> {
    const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  }

  // Fetch every audit entry for a specific lead. Used by the lead detail
  // modal's "Full History" panel so investigations into "where did this
  // lead go?" have a clear per-lead forensic trail.
  async getLeadActivityLogs(leadId: string): Promise<ActivityLog[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('getLeadActivityLogs failed:', error);
      return [];
    }
    return data || [];
  }

  // Returns every lead that currently has a pending deletion request
  // flagged by an agent. Used by the admin deletion-review panel.
  async getPendingDeletionRequests(): Promise<Lead[]> {
    const { data, error } = await supabase
      .from('leads')
      .select('*, notes(*)')
      .not('deletionRequest', 'is', null)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('getPendingDeletionRequests failed:', error);
      return [];
    }
    return (data || []) as any;
  }

  async handleDeletionRequest(leadId: string, approve: boolean): Promise<void> {
    if (approve) {
      await supabase.from('leads').delete().eq('id', leadId);
    } else {
      await supabase.from('leads').update({ deletionRequest: null }).eq('id', leadId);
    }
  }

  async awardPoints(agentId: string, agentName: string, amount: number, reason: string, lead_id?: string): Promise<void> {
    // Prefer the atomic RPC added in 0005_award_points_rpc.sql. If the
    // function doesn't exist yet (migration not applied), fall back to the
    // legacy read-modify-write path so the app keeps working.
    const { error: rpcError } = await supabase.rpc('award_points', {
      p_agent_id: agentId,
      p_agent_name: agentName,
      p_amount: amount,
      p_reason: reason,
      p_lead_id: lead_id ?? null,
    });
    if (!rpcError) return;

    // Fallback — logs but does not throw so callers see the same behaviour.
    console.warn('award_points RPC unavailable, using legacy path:', rpcError.message);
    await supabase.from('points_history').insert({ agent_id: agentId, agent_name: agentName, amount, reason, lead_id });
    const { data: profile } = await supabase.from('profiles').select('points').eq('id', agentId).single();
    await supabase.from('profiles').update({ points: (profile?.points || 0) + amount }).eq('id', agentId);
  }

  async getPointsHistory(agentId: string): Promise<PointsHistory[]> {
    const { data, error } = await supabase.from('points_history').select('*').eq('agent_id', agentId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getPayoutRequests(admin: boolean = false): Promise<PayoutRequest[]> {
    let query = supabase.from('payout_requests').select('*');
    if (!admin) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) query = query.eq('agent_id', session.user.id);
    }
    const { data, error } = await query.order('requested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async processPayoutRequest(requestId: string, action: 'approved' | 'denied', adminId: string, note?: string): Promise<void> {
    // Prefer the atomic RPC added in 0005_award_points_rpc.sql so the
    // insufficient-points check, points deduction, history insert, and
    // status update all happen in a single transaction.
    const { error: rpcError } = await supabase.rpc('process_payout_request', {
      p_request_id: requestId,
      p_action: action,
      p_admin_id: adminId,
      p_note: note ?? null,
    });
    if (!rpcError) return;

    // Fallback to legacy multi-statement flow if the RPC isn't available.
    console.warn('process_payout_request RPC unavailable, using legacy path:', rpcError.message);
    const { data: request, error: fetchError } = await supabase
      .from('payout_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) throw new Error("Request not found");

    if (action === 'approved') {
      const { data: profile } = await supabase.from('profiles').select('points').eq('id', request.agent_id).single();
      const currentPoints = profile?.points || 0;
      if (currentPoints < request.points_requested) throw new Error("Insufficient points");

      await supabase.from('profiles').update({ points: currentPoints - request.points_requested }).eq('id', request.agent_id);

      await supabase.from('points_history').insert({
        agent_id: request.agent_id,
        agent_name: request.agent_name,
        amount: -request.points_requested,
        reason: 'Payout Approved',
      });
    }

    await supabase.from('payout_requests').update({
      status: action,
      processed_at: new Date().toISOString(),
      processed_by: adminId,
      admin_note: note
    }).eq('id', requestId);
  }

  // ----- TeamStatsPage computed stats (intentional stubs) --------------------
  // These return zero-filled stats on purpose: the TeamStatsPage allows
  // admins to manually enter real values via EditableCell + setAgentTarget,
  // so the automatic aggregation is not used in production. They are kept
  // as no-ops (rather than deleted) so the page's state machine does not
  // break. If/when real aggregation is implemented, compute from `leads`
  // + `points_history` + `agent_targets` inside these methods.
  async calculateTeamStats(_month: string): Promise<AgentStats> {
    return this.emptyStats('Team Total');
  }

  async calculateAgentStats(_agentId: string, _month: string): Promise<AgentStats> {
    return this.emptyStats('Agent');
  }

  async setAgentTarget(target: Partial<AgentTarget>): Promise<void> {
    if (!target.agent_id || !target.month) throw new Error("Missing agent_id or month");
    const { error } = await supabase.from('agent_targets').upsert(target, { onConflict: 'agent_id,month' });
    if (error) throw error;
  }

  private emptyStats(name: string): AgentStats {
    return {
      agent_id: 'team', agent_name: name, new_gp: 0, return_gp: 0, total_gp: 0, sales_num: 0, tp_gp: 0, tp_number: 0,
      created_leads: 0, taken_leads: 0, total_leads: 0, gp_per_lead: 0, gp_target: 0, sales_target: 0, tp_target: 0,
      tp_number_target: 0, gp_progress: 0, sales_progress: 0, tp_progress: 0, tp_number_progress: 0,
      week1: 0, week2: 0, week3: 0, week4: 0
    };
  }

  async getPersonalTasks(userId: string): Promise<PersonalTask[]> {
    try {
      const { data, error } = await supabase
        .from('personal_tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('completed', false)
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === '42P01') {
          console.warn("Table 'personal_tasks' does not exist yet.");
          return [];
        }
        throw error;
      }
      return data || [];
    } catch (err) {
      console.error("Error in getPersonalTasks:", err);
      return [];
    }
  }

  async addPersonalTask(userId: string, text: string): Promise<PersonalTask | null> {
    const { data, error } = await supabase
      .from('personal_tasks')
      .insert({ user_id: userId, text, completed: false })
      .select()
      .maybeSingle(); // Use maybeSingle to avoid errors if RLS blocks the selection

    if (error) {
      console.error("Supabase error in addPersonalTask:", error);
      throw error;
    }
    return data;
  }

  async completePersonalTask(taskId: string): Promise<void> {
    const { error } = await supabase.from('personal_tasks').update({ completed: true }).eq('id', taskId);
    if (error) throw error;
  }

  async getUsefulLinks(userId: string): Promise<UsefulLink[]> {
    const { data, error } = await supabase
      .from('useful_links')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return data || [];
  }

  async addUsefulLink(userId: string, name: string, url: string): Promise<UsefulLink> {
    const { data, error } = await supabase
      .from('useful_links')
      .insert({ user_id: userId, name, url })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteUsefulLink(id: string): Promise<void> {
    const { error } = await supabase.from('useful_links').delete().eq('id', id);
    if (error) throw error;
  }

  async bulkReassignLeads(leadIds: string[], newAgentId: string, newAgentName: string, adminId: string, oldAgentName: string): Promise<void> {
    const { error } = await supabase
      .from('leads')
      .update({ assigned_agent_id: newAgentId, assigned_agent_name: newAgentName, updated_at: new Date().toISOString() })
      .in('id', leadIds);
    if (error) throw error;

    const logEntries = leadIds.map(leadId => ({
      lead_id: leadId,
      agent_id: adminId,
      action: 'reassigned',
      details: `Reassigned from ${oldAgentName} to ${newAgentName} by admin`
    }));
    await supabase.from('activity_logs').insert(logEntries);
  }

  async logAdminWarning(agentId: string, warningText: string, adminId: string): Promise<void> {
    await supabase.from('activity_logs').insert({
      lead_id: agentId,
      agent_id: adminId,
      action: 'admin_warning',
      details: warningText
    });
  }

  async getAgentWarnings(agentId: string): Promise<number> {
    const { count, error } = await supabase
      .from('activity_logs')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', agentId)
      .eq('action', 'admin_warning');
    if (error) return 0;
    return count || 0;
  }

  async getFullActivityLogs(): Promise<ActivityLog[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    return data || [];
  }
}

export const db = new DBService();
