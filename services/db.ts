
import { Lead, User, Role, LeadStatus, TodoStatus, ActivityLog, Note, DeletionStatus, PointsHistory, AgentTarget, AgentStats, PersonalTask, PayoutRequest } from '../types';
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

      if (fetchError) throw fetchError;

      if (!profile) {
        const { data: newProfile, error: upsertError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            role: userEmail.includes('admin') ? Role.ADMIN : Role.AGENT,
            points: 0,
            theme_preference: 'dark'
          })
          .select()
          .single();

        if (upsertError) throw upsertError;
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

  async getLeads(user: User): Promise<Lead[]> {
    const exists = await this.checkTableExists('leads');
    if (!exists) return [];

    let query = supabase.from('leads').select('*, notes(*)');
    if (user.role === Role.AGENT) {
      query = query.eq('assigned_agent_id', user.id);
    }
    const { data, error } = await query.order('follow_up_date', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async addLead(leadData: Partial<Lead>, user: User): Promise<Lead> {
    const { data, error } = await supabase.from('leads').insert({
      ...leadData,
      assigned_agent_id: user.id,
      assigned_agent_name: user.name,
      follow_up_date: leadData.follow_up_date || getTodayString(),
    }).select().single();
    if (error) throw error;
    return data;
  }

  async updateLead(leadId: string, updates: Partial<Lead>, user: User): Promise<void> {
    const { error } = await supabase.from('leads').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', leadId);
    if (error) {
      console.error("Supabase update error:", error);
      throw error;
    }
  }

  async deleteLead(leadId: string): Promise<void> {
    const { error } = await supabase.from('leads').delete().eq('id', leadId);
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

  async handleDeletionRequest(leadId: string, approve: boolean): Promise<void> {
    if (approve) {
      await supabase.from('leads').delete().eq('id', leadId);
    } else {
      await supabase.from('leads').update({ deletionRequest: null }).eq('id', leadId);
    }
  }

  async awardPoints(agentId: string, agentName: string, amount: number, reason: string, lead_id?: string): Promise<void> {
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

  async calculateTeamStats(month: string): Promise<AgentStats> {
    return this.emptyStats('Team Total');
  }

  async calculateAgentStats(agentId: string, month: string): Promise<AgentStats> {
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
}

export const db = new DBService();
