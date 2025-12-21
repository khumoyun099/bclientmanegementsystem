
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Layout } from './components/Layout';
import { db, getTodayString } from './services/db';
import { supabase } from './services/supabase';
import { User, Lead, Role, LeadStatus, ActivityLog, TodoStatus } from './types';
import { LeadTable } from './components/LeadTable';
import { AddLeadModal } from './components/AddLeadModal';
import { AccountabilityDashboard } from './components/AccountabilityDashboard';
import { FollowUpCalendar } from './components/FollowUpCalendar';
import { LeadDetailModal } from './components/LeadDetailModal';
import { Auth } from './components/Auth';
import { DatabaseSetup } from './components/DatabaseSetup';
import { TeamStatsPage } from './components/TeamStatsPage';
import { Dashboard } from './components/Dashboard';
import { MyTasks } from './components/MyTasks';
import { Plus, Loader2, RefreshCw, Trophy, Users, LayoutDashboard, Calendar, Search, Zap } from 'lucide-react';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('dark');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      return localStorage.getItem('followup_active_tab') || LeadStatus.HOT;
    } catch {
      return LeadStatus.HOT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('followup_active_tab', activeTab);
    } catch (e) {
      console.warn('LocalStorage unavailable');
    }
  }, [activeTab]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    if (currentUser) {
      db.updateThemePreference(currentUser.id, theme);
    }
  }, [theme, currentUser]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile();
      else {
        setCurrentUser(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async () => {
    try {
      const profile = await db.getCurrentProfile();
      setCurrentUser(profile);
      if (profile?.theme_preference) {
        setTheme(profile.theme_preference);
      }
      if (profile) {
        refreshData(profile);
      }
    } catch (err: any) {
      setDbError('SCHEMA_MISSING');
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async (user: User = currentUser!) => {
    if (!user) return;
    try {
      setDbError(null);
      const [leadData, profiles, logs, updatedProfile] = await Promise.all([
        db.getLeads(user),
        user.role === Role.ADMIN ? db.getAllProfiles() : Promise.resolve([]),
        user.role === Role.ADMIN ? db.getActivityLogs() : Promise.resolve([]),
        db.getCurrentProfile()
      ]);
      setLeads(Array.isArray(leadData) ? leadData : []);
      setAllUsers(Array.isArray(profiles) ? profiles : []);
      setActivityLogs(Array.isArray(logs) ? logs : []);
      if (updatedProfile) setCurrentUser(updatedProfile);
    } catch (err: any) {
      setDbError('SCHEMA_MISSING');
    }
  };

  const patchLeadLocally = useCallback((leadId: string, updates: Partial<Lead>) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updates, updated_at: new Date().toISOString() } : l));
  }, []);

  const handleLeadMove = useCallback(async (leadId: string, newDate: string) => {
    if (!currentUser) return;

    patchLeadLocally(leadId, { follow_up_date: newDate });

    try {
      await db.updateLead(leadId, { follow_up_date: newDate }, currentUser);
      await db.logActivity(leadId, currentUser.id, 'date_changed', `Rescheduled lead to ${newDate} via calendar drag`);
      setTimeout(() => refreshData(), 600);
    } catch (err) {
      console.error("Failed to move lead:", err);
      refreshData();
    }
  }, [currentUser, patchLeadLocally, refreshData]);

  const handleDeleteLead = useCallback(async (leadId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this lead?")) return;

    try {
      await db.deleteLead(leadId);
      setLeads(prev => prev.filter(l => l.id !== leadId));
      if (selectedLeadId === leadId) setSelectedLeadId(null);
    } catch (err) {
      console.error("Failed to delete lead:", err);
      alert("Failed to delete lead. Check console for details.");
    }
  }, [selectedLeadId]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const tableLeads = useMemo(() => {
    const safeLeads = Array.isArray(leads) ? leads : [];
    let filtered = safeLeads;
    const today = getTodayString();

    if (currentUser?.role === Role.AGENT) {
      if ([LeadStatus.HOT, LeadStatus.WARM, LeadStatus.COLD, LeadStatus.PROGRESSIVE].includes(activeTab as LeadStatus)) {
        filtered = filtered.filter(l =>
          l.todo !== TodoStatus.FOLLOWUP || l.follow_up_date <= today
        );
      }
    }

    const safeTab = (activeTab || '').toLowerCase();
    const filteredByTab = filtered.filter(l => (l.status || '').toLowerCase() === safeTab);

    // Sort Progressive tab by frequency (ascending - lower days first)
    if (activeTab === LeadStatus.PROGRESSIVE) {
      return filteredByTab.sort((a, b) => {
        // Extract numeric values from frequency strings like "5days", "10days"
        const getFrequencyValue = (every: string | null) => {
          if (!every || every.toUpperCase() === 'MANUAL') return 0; // MANUAL = 0 (comes first)
          const match = every.match(/(\d+)/);
          return match ? parseInt(match[1]) : 999;
        };

        const aValue = getFrequencyValue(a.every);
        const bValue = getFrequencyValue(b.every);

        return aValue - bValue; // Ascending order
      });
    }

    return filteredByTab;
  }, [leads, activeTab, currentUser]);

  const currentSelectedLead = useMemo(() => {
    if (!Array.isArray(leads)) return null;
    return leads.find(l => l.id === selectedLeadId) || null;
  }, [leads, selectedLeadId]);

  if (loading) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <Loader2 className="animate-spin text-brand-500" size={32} />
    </div>
  );

  if (!session || !currentUser) return <Auth />;

  if (dbError === 'SCHEMA_MISSING' || activePage === 'setup') return (
    <Layout theme={theme} onThemeChange={setTheme} user={currentUser} activePage={activePage} onNavigate={setActivePage} onLogout={handleLogout}>
      <DatabaseSetup currentUser={currentUser} />
    </Layout>
  );

  return (
    <Layout theme={theme} onThemeChange={setTheme} user={currentUser} activePage={activePage} onNavigate={setActivePage} onLogout={handleLogout}>
      <div className="space-y-12 h-full">

        {activePage === 'dashboard' && (
          <Dashboard leads={leads} currentUser={currentUser} onUpdate={() => refreshData()} />
        )}

        {activePage === 'crm' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 animate-fade-in h-full">
            <div className="lg:col-span-1 h-full">
              <MyTasks user={currentUser} />
            </div>

            <div className="lg:col-span-3 space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <h2 className="text-3xl font-bold text-white tracking-tight uppercase font-sans">My Space</h2>
                  <p className="text-sm text-muted font-light">Focus on today's high-priority follow-ups</p>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-2xl shadow-brand-500/10 transition-standard flex items-center justify-center gap-2 border border-white/10"
                >
                  <Plus size={16} /> New Opportunity
                </button>
              </div>

              <div className="flex items-center gap-4">
                <nav className="flex-1 flex space-x-1 p-1 bg-white/[0.03] rounded-xl border border-white/5 overflow-x-auto custom-scrollbar">
                  {Object.values(LeadStatus).map((status) => {
                    const count = Array.isArray(leads) ? leads.filter(l => l.status === status).length : 0;
                    const isActive = activeTab === status;
                    return (
                      <button
                        key={status}
                        onClick={() => setActiveTab(status)}
                        className={`
                            whitespace-nowrap px-5 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest flex items-center gap-2 transition-standard
                            ${isActive ? 'bg-white/10 text-white border border-white/5 shadow-inner' : 'text-muted hover:text-white'}
                            `}
                      >
                        {status}
                        <span className={`px-2 py-0.5 rounded-md text-[8px] ${isActive ? 'bg-brand-500 text-white' : 'bg-white/5 text-muted'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <LeadTable
                leads={tableLeads}
                activeTab={activeTab as LeadStatus}
                currentUser={currentUser}
                onUpdate={refreshData}
                onPatch={patchLeadLocally}
                onDelete={handleDeleteLead}
                showAgentColumn={currentUser.role === Role.ADMIN}
              />

              <div className="pt-10">
                <div className="flex items-center gap-3 mb-6">
                  <Calendar className="text-brand-500" size={18} />
                  <h3 className="text-xs font-bold text-white uppercase tracking-widest">Global Schedule Map</h3>
                </div>
                <FollowUpCalendar leads={leads} onLeadClick={(lead) => setSelectedLeadId(lead.id)} onLeadMove={handleLeadMove} />
              </div>
            </div>
          </div>
        )}

        {activePage === 'supervisor' && currentUser.role === Role.ADMIN && (
          <div className="space-y-10 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="text-3xl font-bold text-white tracking-tight italic uppercase">Operations Monitor</h2>
                <p className="text-sm text-muted font-light">Real-time team oversight and data management</p>
              </div>
              <button onClick={() => refreshData()} className="p-3 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-muted hover:text-white transition-standard">
                <RefreshCw size={18} />
              </button>
            </div>

            <AccountabilityDashboard users={allUsers} leads={leads} logs={activityLogs} onSelectLead={(lead) => setSelectedLeadId(lead.id)} onRefresh={refreshData} />
            <div className="pt-10">
              <TeamStatsPage currentUser={currentUser} />
            </div>
          </div>
        )}
      </div>

      {isAddModalOpen && <AddLeadModal currentUser={currentUser} onClose={() => setIsAddModalOpen(false)} onSuccess={refreshData} />}
      {currentSelectedLead && (
        <LeadDetailModal
          lead={currentSelectedLead}
          currentUser={currentUser}
          onClose={() => setSelectedLeadId(null)}
          onUpdate={refreshData}
          onPatch={patchLeadLocally}
        />
      )}
    </Layout>
  );
};

export default App;
