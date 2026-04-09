
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { Layout } from './components/Layout';
import { db, getTodayString, isSchemaMissingError } from './services/db';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { User, Lead, Role, LeadStatus, ActivityLog, TodoStatus, UsefulLink } from './types';
import { LeadTable } from './components/LeadTable';
import { AddLeadModal } from './components/AddLeadModal';
import { AccountabilityDashboard } from './components/AccountabilityDashboard';
import { FollowUpCalendar } from './components/FollowUpCalendar';
import { LeadDetailModal } from './components/LeadDetailModal';
import { Auth } from './components/Auth';
import { DatabaseSetup } from './components/DatabaseSetup';
import { TeamStatsPage } from './components/TeamStatsPage';
import { Dashboard } from './components/Dashboard';
import { PlaybookEditor, TeamManagement } from './features/pulse';
import { MyTasks } from './components/MyTasks';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Plus, Loader2, RefreshCw, Trophy, Users, LayoutDashboard, Calendar, Search, Zap, AlertTriangle, Copy, Check, Link, ChevronDown, X, ExternalLink, Trash2, CalendarClock } from 'lucide-react';

// Virtual tab shown alongside the LeadStatus tabs. Not stored on the DB —
// purely a client-side view that surfaces future-dated FOLLOWUP leads that
// are intentionally hidden from their status tab so they don't clutter
// "today's work" but were previously impossible to find.
const SCHEDULED_TAB = 'scheduled' as const;

// Configuration Required Screen
const ConfigurationRequired: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const envExample = `VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key`;

  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-amber-500/20 blur-[120px] rounded-full pointer-events-none opacity-40"></div>
      
      <div className="max-w-2xl w-full animate-scale-in glass p-10 rounded-[2.5rem] relative z-10 border border-white/10 shadow-2xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-amber-400" size={32} />
          </div>
          <h1 className="text-3xl font-medium text-white tracking-tight mb-2">Configuration Required</h1>
          <p className="text-sm text-muted">Supabase environment variables are missing</p>
        </div>

        <div className="space-y-6">
          <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-brand-500 rounded-lg flex items-center justify-center text-xs">1</span>
              Create a <code className="text-brand-400">.env</code> file in your project root
            </h3>
            <div className="relative">
              <pre className="bg-black/50 p-4 rounded-xl text-xs text-emerald-400 font-mono overflow-x-auto">
{envExample}
              </pre>
              <button
                onClick={() => copyToClipboard(envExample, 'env')}
                className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                {copied === 'env' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-muted" />}
              </button>
            </div>
          </div>

          <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-brand-500 rounded-lg flex items-center justify-center text-xs">2</span>
              Get your credentials from Supabase
            </h3>
            <ol className="text-sm text-muted space-y-2 list-decimal list-inside">
              <li>Go to <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">supabase.com</a> and create a project</li>
              <li>Navigate to Project Settings → API</li>
              <li>Copy the <strong className="text-white">Project URL</strong> and <strong className="text-white">anon public</strong> key</li>
            </ol>
          </div>

          <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-brand-500 rounded-lg flex items-center justify-center text-xs">3</span>
              Restart the development server
            </h3>
            <div className="relative">
              <pre className="bg-black/50 p-4 rounded-xl text-xs text-emerald-400 font-mono">npm run dev</pre>
              <button
                onClick={() => copyToClipboard('npm run dev', 'cmd')}
                className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                {copied === 'cmd' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-muted" />}
              </button>
            </div>
          </div>

          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-xs text-amber-400 text-center">
              <strong>For Vercel deployment:</strong> Add these environment variables in your Vercel project settings under Settings → Environment Variables
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const [leadsTotalCount, setLeadsTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set true when Supabase emits PASSWORD_RECOVERY after the user clicks
  // a reset-password link. Routes App to the Auth component in
  // reset-password mode instead of the normal authenticated UI.
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  // "Has more" is derived rather than stored so it can never drift out of
  // sync with leads.length after local mutations (delete / bulk delete).
  const leadsHasMore = leads.length < leadsTotalCount;
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState('');

  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      return localStorage.getItem('followup_active_tab') || LeadStatus.HOT;
    } catch {
      return LeadStatus.HOT;
    }
  });

  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Useful Links state
  const [usefulLinks, setUsefulLinks] = useState<UsefulLink[]>([]);
  const [showUsefulLinksDropdown, setShowUsefulLinksDropdown] = useState(false);
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  // Fetch useful links from Supabase
  useEffect(() => {
    if (!currentUser) return;
    db.getUsefulLinks(currentUser.id).then(setUsefulLinks).catch(() => {});
  }, [currentUser?.id]);

  const handleAddUsefulLink = async () => {
    if (!newLinkName.trim() || !newLinkUrl.trim() || !currentUser) return;
    const url = newLinkUrl.trim().startsWith('http') ? newLinkUrl.trim() : `https://${newLinkUrl.trim()}`;
    setNewLinkName('');
    setNewLinkUrl('');
    setShowAddLinkModal(false);
    try {
      const newLink = await db.addUsefulLink(currentUser.id, newLinkName.trim(), url);
      setUsefulLinks(prev => [...prev, newLink]);
    } catch {
      toast.error('Failed to save link.');
    }
  };

  const handleDeleteUsefulLink = async (id: string) => {
    setUsefulLinks(prev => prev.filter(link => link.id !== id));
    try {
      await db.deleteUsefulLink(id);
    } catch {
      toast.error('Failed to delete link.');
      db.getUsefulLinks(currentUser!.id).then(setUsefulLinks).catch(() => {});
    }
  };

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // When a user arrives via a password-reset email, Supabase puts them
      // in a temporarily-authenticated state and emits PASSWORD_RECOVERY.
      // We must route them to the new-password form instead of the normal
      // authenticated UI — otherwise the recovery never completes.
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordReset(true);
        setSession(session);
        setLoading(false);
        return;
      }
      // After the user sets a new password and calls updateUser, the
      // client emits a USER_UPDATED event followed by a SIGNED_OUT when
      // we explicitly sign them out. Clear the recovery flag on sign-out.
      if (event === 'SIGNED_OUT') {
        setNeedsPasswordReset(false);
      }
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
      const [leadsRes, profiles, logs, updatedProfile] = await Promise.all([
        db.getLeads(user),
        user.role === Role.ADMIN ? db.getAllProfiles() : Promise.resolve([]),
        user.role === Role.ADMIN ? db.getActivityLogs() : Promise.resolve([]),
        db.getCurrentProfile()
      ]);
      const leadData = Array.isArray(leadsRes?.data) ? leadsRes.data : [];
      setLeads(leadData);
      setLeadsTotalCount(leadsRes?.count ?? leadData.length);
      // Filter out soft-deleted (inactive) profiles everywhere in the app.
      // The Team Management page loads its own full list (including
      // inactive) via listAllTeamMembers() so removed users remain
      // visible to admins in the "Removed" section for reactivation.
      const activeProfiles = (Array.isArray(profiles) ? profiles : []).filter(
        (p: any) => p.active !== false,
      );
      setAllUsers(activeProfiles);
      setActivityLogs(Array.isArray(logs) ? logs : []);
      if (updatedProfile) setCurrentUser(updatedProfile);
    } catch (err: any) {
      // Only fall back to the "schema missing" screen when the error is
      // actually a missing-relation error. Transient network failures now
      // show a toast and keep the last-known data on screen so the user
      // never loses their place.
      if (isSchemaMissingError(err)) {
        setDbError('SCHEMA_MISSING');
      } else {
        console.error('refreshData failed:', err);
        toast.error('Could not refresh. Showing cached data.');
      }
    }
  };

  const loadMoreLeads = async () => {
    if (!currentUser || loadingMore || !leadsHasMore) return;
    setLoadingMore(true);
    try {
      // Page by current offset rather than a stored page index — after a
      // local delete, `leads.length` may have shrunk past a page boundary
      // and we should fetch whatever's next, not re-fetch a stale page.
      const PAGE_SIZE = 500;
      const nextPage = Math.floor(leads.length / PAGE_SIZE);
      const res = await db.getLeads(currentUser, { page: nextPage, pageSize: PAGE_SIZE });
      const newData = Array.isArray(res?.data) ? res.data : [];
      if (newData.length === 0) {
        // Server has nothing left — resync total so the banner hides itself
        // and the user isn't stuck clicking a dead button.
        setLeadsTotalCount(res?.count ?? leads.length);
        return;
      }
      setLeads(prev => {
        const seen = new Set(prev.map(l => l.id));
        return [...prev, ...newData.filter(l => !seen.has(l.id))];
      });
      setLeadsTotalCount(res?.count ?? leadsTotalCount);
    } catch (err) {
      console.error('Load more failed:', err);
      toast.error('Could not load more leads.');
      // Resync from source of truth so we don't leave the banner stuck.
      refreshData();
    } finally {
      setLoadingMore(false);
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
      // No setTimeout refetch here — the audit wrapper in db.updateLead
      // already logs the change, and the optimistic patch is authoritative.
    } catch (err) {
      console.error("Failed to move lead:", err);
      refreshData();
    }
  }, [currentUser, patchLeadLocally, refreshData]);

  const handleDeleteLead = useCallback(async (leadId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this lead?")) return;

    try {
      await db.deleteLead(leadId, currentUser || undefined);
      setLeads(prev => prev.filter(l => l.id !== leadId));
      if (selectedLeadId === leadId) setSelectedLeadId(null);
      toast.success('Lead deleted.');
      // Resync total from server so the load-more banner stays accurate.
      refreshData();
    } catch (err) {
      console.error("Failed to delete lead:", err);
      toast.error('Failed to delete lead.');
    }
  }, [selectedLeadId, currentUser]);

  const toggleBulkSelect = useCallback((leadId: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const clearBulkSelection = useCallback(() => setBulkSelectedIds(new Set()), []);

  const selectAllVisible = useCallback((ids: string[]) => {
    setBulkSelectedIds(new Set(ids));
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!currentUser || bulkSelectedIds.size === 0) return;
    if (bulkDeleteConfirmText !== 'DELETE') return;
    const ids: string[] = Array.from(bulkSelectedIds);
    try {
      await db.bulkDeleteLeads(ids, currentUser);
      setLeads(prev => prev.filter(l => !bulkSelectedIds.has(l.id)));
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} deleted.`);
      setBulkSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      setBulkDeleteConfirmText('');
      // Resync counts + hasMore from source of truth. Fixes the "171 of 0"
      // drift where local decrement pushed totalCount below leads.length.
      refreshData();
    } catch (err) {
      console.error('Bulk delete failed:', err);
      toast.error('Bulk delete failed.');
    }
  }, [currentUser, bulkSelectedIds, bulkDeleteConfirmText]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Filter leads by selected agent (for admin view), date range, and search.
  // NOTE: leads missing `created_at` (legacy/failed inserts) used to be
  // silently dropped the moment a date filter was applied — now they pass
  // through so nothing is ever invisible because of missing metadata.
  const agentFilteredLeads = useMemo(() => {
    let result = Array.isArray(leads) ? leads : [];
    if (currentUser?.role === Role.ADMIN && selectedAgentFilter) {
      result = result.filter(l => l.assigned_agent_id === selectedAgentFilter);
    }
    if (dateFrom) {
      result = result.filter(l => !l.created_at || l.created_at.slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      result = result.filter(l => !l.created_at || l.created_at.slice(0, 10) <= dateTo);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(l =>
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.link && l.link.toLowerCase().includes(q))
      );
    }
    return result;
  }, [leads, currentUser, selectedAgentFilter, dateFrom, dateTo, searchQuery]);

  // A lead is "scheduled" when it has a future FOLLOWUP date. These used to
  // be invisible — filtered out of their status tab by App.tsx but with
  // nowhere to find them — which is the #2 source of "we lost a lead"
  // complaints.
  const scheduledLeads = useMemo(() => {
    const today = getTodayString();
    return agentFilteredLeads.filter(l =>
      l.todo === TodoStatus.FOLLOWUP && l.follow_up_date > today
    );
  }, [agentFilteredLeads]);

  const tableLeads = useMemo(() => {
    let filtered = agentFilteredLeads;
    const today = getTodayString();

    // Virtual "scheduled" tab shows every future FOLLOWUP lead across all
    // statuses. Sorted by the date they'll surface so the most imminent
    // appear first.
    if (activeTab === SCHEDULED_TAB) {
      return agentFilteredLeads
        .filter(l => l.todo === TodoStatus.FOLLOWUP && l.follow_up_date > today)
        .sort((a, b) => (a.follow_up_date || '').localeCompare(b.follow_up_date || ''));
    }

    // Apply scheduled leads filter for both AGENT and ADMIN
    // When todo is FOLLOWUP and date is in the future, hide the lead until that date
    // (they are still reachable via the Scheduled tab above).
    if ([LeadStatus.HOT, LeadStatus.WARM, LeadStatus.COLD, LeadStatus.PROGRESSIVE].includes(activeTab as LeadStatus)) {
      filtered = filtered.filter(l =>
        l.todo !== TodoStatus.FOLLOWUP || l.follow_up_date <= today
      );
    }

    const safeTab = (activeTab || '').toLowerCase();
    const filteredByTab = filtered.filter(l => (l.status || '').toLowerCase() === safeTab);

    // Sort Progressive tab by frequency (ascending - lower days first)
    if (activeTab === LeadStatus.PROGRESSIVE) {
      return filteredByTab.sort((a, b) => {
        const getFrequencyValue = (every: string | null | undefined) => {
          if (!every || every.toUpperCase() === 'MANUAL') return 0;
          const match = every.match(/(\d+)/);
          return match ? parseInt(match[1]) : 999;
        };

        const aValue = getFrequencyValue(a.every);
        const bValue = getFrequencyValue(b.every);

        return aValue - bValue;
      });
    }

    // Sort by agent name for admin view (group leads by agent)
    if (currentUser?.role === Role.ADMIN && !selectedAgentFilter) {
      return filteredByTab.sort((a, b) => {
        const agentA = (a.assigned_agent_name || '').toLowerCase();
        const agentB = (b.assigned_agent_name || '').toLowerCase();
        return agentA.localeCompare(agentB);
      });
    }

    return filteredByTab;
  }, [agentFilteredLeads, activeTab, currentUser, selectedAgentFilter]);

  const currentSelectedLead = useMemo(() => {
    if (!Array.isArray(leads)) return null;
    return leads.find(l => l.id === selectedLeadId) || null;
  }, [leads, selectedLeadId]);

  // Show configuration screen if Supabase is not configured
  if (!isSupabaseConfigured) {
    return <ConfigurationRequired />;
  }

  if (loading) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <Loader2 className="animate-spin text-brand-500" size={32} />
    </div>
  );

  // Password-recovery session → route to Auth component in reset-password
  // mode even though we technically have a session. Once the user submits
  // the new password we sign them out and they re-login normally.
  if (needsPasswordReset) return <Auth initialMode="reset-password" />;

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
          <ErrorBoundary>
            <Dashboard
              leads={leads}
              currentUser={currentUser}
              onUpdate={() => refreshData()}
              isLoading={loading}
              allUsers={allUsers}
              activityLogs={activityLogs}
              onPatch={patchLeadLocally}
            />
          </ErrorBoundary>
        )}

        {activePage === 'crm' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-fade-in h-full">
            <div className="lg:col-span-1 h-full">
              <MyTasks user={currentUser} />
            </div>

            <div className="lg:col-span-4 space-y-6">
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

              {/* Admin Agent Filter Dropdown + Useful Links (for Admin) */}
              {currentUser.role === Role.ADMIN && (
                <div className="flex items-center gap-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl flex-wrap">
                  <Users size={14} className="text-brand-500 shrink-0" />
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">Agent:</span>
                  <select
                    value={selectedAgentFilter || ''}
                    onChange={(e) => setSelectedAgentFilter(e.target.value || null)}
                    className="w-40 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer"
                  >
                    <option value="" className="bg-[#111]">All Agents</option>
                    {allUsers
                      .filter(u => u.role === Role.AGENT)
                      .map(agent => (
                        <option key={agent.id} value={agent.id} className="bg-[#111]">
                          {agent.name} ({agent.email})
                        </option>
                      ))
                    }
                  </select>
                  {selectedAgentFilter && (
                    <button
                      onClick={() => setSelectedAgentFilter(null)}
                      className="px-2 py-1.5 text-[10px] font-bold text-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all whitespace-nowrap"
                    >
                      Clear
                    </button>
                  )}

                  <div className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

                  {/* Date Range Filter */}
                  <Calendar size={14} className="text-brand-500 shrink-0" />
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">From:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-36 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer [color-scheme:dark]"
                  />
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">To:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-36 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer [color-scheme:dark]"
                  />
                  {(dateFrom || dateTo) && (
                    <button
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                      className="px-2 py-1.5 text-[10px] font-bold text-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all whitespace-nowrap"
                    >
                      Clear
                    </button>
                  )}

                  {/* Useful Links Dropdown */}
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setShowUsefulLinksDropdown(!showUsefulLinksDropdown)}
                      className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white hover:bg-white/10 transition-all"
                    >
                      <Link size={14} className="text-brand-500" />
                      <span className="text-xs font-bold uppercase tracking-widest">Useful Links</span>
                      <ChevronDown size={14} className={`text-muted transition-transform ${showUsefulLinksDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showUsefulLinksDropdown && (
                      <div className="absolute top-full right-0 mt-2 w-64 glass border border-white/10 rounded-xl shadow-2xl p-2 z-[60] animate-scale-in">
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          {usefulLinks.length === 0 ? (
                            <p className="text-xs text-muted text-center py-4">No links added yet</p>
                          ) : (
                            usefulLinks.map(link => (
                              <div key={link.id} className="flex items-center gap-2 group">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-muted hover:text-white hover:bg-white/5 transition-all"
                                  onClick={() => setShowUsefulLinksDropdown(false)}
                                >
                                  <ExternalLink size={12} />
                                  {link.name}
                                </a>
                                <button
                                  onClick={() => handleDeleteUsefulLink(link.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="border-t border-white/5 mt-2 pt-2">
                          <button
                            onClick={() => {
                              setShowUsefulLinksDropdown(false);
                              setShowAddLinkModal(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-brand-500 hover:bg-brand-500/10 transition-all"
                          >
                            <Plus size={14} />
                            Add More Links
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Date Range Filter + Useful Links (for Agents) */}
              {currentUser.role === Role.AGENT && (
                <div className="flex items-center gap-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl flex-wrap">
                  <Calendar size={14} className="text-brand-500 shrink-0" />
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">From:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-36 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer [color-scheme:dark]"
                  />
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest whitespace-nowrap">To:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-36 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all cursor-pointer [color-scheme:dark]"
                  />
                  {(dateFrom || dateTo) && (
                    <button
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                      className="px-2 py-1.5 text-[10px] font-bold text-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all whitespace-nowrap"
                    >
                      Clear
                    </button>
                  )}
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setShowUsefulLinksDropdown(!showUsefulLinksDropdown)}
                      className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white hover:bg-white/10 transition-all"
                    >
                      <Link size={14} className="text-brand-500" />
                      <span className="text-xs font-bold uppercase tracking-widest">Useful Links</span>
                      <ChevronDown size={14} className={`text-muted transition-transform ${showUsefulLinksDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showUsefulLinksDropdown && (
                      <div className="absolute top-full right-0 mt-2 w-64 glass border border-white/10 rounded-xl shadow-2xl p-2 z-[60] animate-scale-in">
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          {usefulLinks.length === 0 ? (
                            <p className="text-xs text-muted text-center py-4">No links added yet</p>
                          ) : (
                            usefulLinks.map(link => (
                              <div key={link.id} className="flex items-center gap-2 group">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-muted hover:text-white hover:bg-white/5 transition-all"
                                  onClick={() => setShowUsefulLinksDropdown(false)}
                                >
                                  <ExternalLink size={12} />
                                  {link.name}
                                </a>
                                <button
                                  onClick={() => handleDeleteUsefulLink(link.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="border-t border-white/5 mt-2 pt-2">
                          <button
                            onClick={() => {
                              setShowUsefulLinksDropdown(false);
                              setShowAddLinkModal(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-brand-500 hover:bg-brand-500/10 transition-all"
                          >
                            <Plus size={14} />
                            Add More Links
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Search Bar */}
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by client name or CRM link..."
                  className="w-full bg-white/[0.03] border border-white/5 rounded-xl pl-11 pr-10 py-3 text-sm text-white placeholder-muted outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-white rounded-md hover:bg-white/10 transition-all"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4">
                <nav className="flex-1 flex space-x-1 p-1 bg-white/[0.03] rounded-xl border border-white/5 overflow-x-auto custom-scrollbar">
                  {Object.values(LeadStatus).map((status) => {
                    const count = agentFilteredLeads.filter(l => l.status === status).length;
                    const isActive = activeTab === status;
                    return (
                      <button
                        key={status}
                        onClick={() => { setActiveTab(status); clearBulkSelection(); }}
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
                  {/* Virtual "Scheduled" tab — surfaces future-dated FOLLOWUP leads
                      that are intentionally hidden from their status tab. */}
                  <button
                    onClick={() => { setActiveTab(SCHEDULED_TAB); clearBulkSelection(); }}
                    className={`whitespace-nowrap px-5 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest flex items-center gap-2 transition-standard
                        ${activeTab === SCHEDULED_TAB ? 'bg-white/10 text-white border border-white/5 shadow-inner' : 'text-muted hover:text-white'}`}
                    title="Future-dated follow-ups (hidden from their status tab until due)"
                  >
                    <CalendarClock size={12} />
                    Scheduled
                    <span className={`px-2 py-0.5 rounded-md text-[8px] ${activeTab === SCHEDULED_TAB ? 'bg-brand-500 text-white' : 'bg-white/5 text-muted'}`}>
                      {scheduledLeads.length}
                    </span>
                  </button>
                </nav>
              </div>

              {/* Row-cap banner — only appears when the DB holds more leads
                  than the current page has loaded. Prevents the silent
                  truncation that was losing leads at scale. */}
              {leadsHasMore && (
                <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <div className="text-xs text-amber-300">
                    <strong>Showing {leads.length} of {leadsTotalCount} leads.</strong>
                    <span className="text-amber-200/70 ml-2">Older leads aren't loaded yet.</span>
                  </div>
                  <button
                    onClick={loadMoreLeads}
                    disabled={loadingMore}
                    className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest text-amber-200 transition-all disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}

              {/* Bulk action bar — only visible in Closed tab when admin has selected rows. */}
              {currentUser.role === Role.ADMIN && activeTab === LeadStatus.CLOSED && bulkSelectedIds.size > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl animate-fade-in sticky top-0 z-40">
                  <div className="text-xs font-bold text-red-300">
                    {bulkSelectedIds.size} selected
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => selectAllVisible(tableLeads.map(l => l.id))}
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-200 hover:bg-white/5 rounded-lg transition-all"
                    >
                      Select all {tableLeads.length}
                    </button>
                    <button
                      onClick={clearBulkSelection}
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => { setBulkDeleteConfirmText(''); setShowBulkDeleteConfirm(true); }}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
                    >
                      <Trash2 size={12} />
                      Delete permanently
                    </button>
                  </div>
                </div>
              )}

              <ErrorBoundary>
                <LeadTable
                  leads={tableLeads}
                  activeTab={activeTab as LeadStatus}
                  currentUser={currentUser}
                  onUpdate={refreshData}
                  onPatch={patchLeadLocally}
                  onDelete={handleDeleteLead}
                  showAgentColumn={currentUser.role === Role.ADMIN}
                  onLeadClick={(lead) => setSelectedLeadId(lead.id)}
                  bulkSelectedIds={bulkSelectedIds}
                  onToggleBulkSelect={toggleBulkSelect}
                  bulkSelectEnabled={currentUser.role === Role.ADMIN && activeTab === LeadStatus.CLOSED}
                />
              </ErrorBoundary>

              <div className="pt-10">
                <div className="flex items-center gap-3 mb-6">
                  <Calendar className="text-brand-500" size={18} />
                  <h3 className="text-xs font-bold text-white uppercase tracking-widest">
                    {selectedAgentFilter ? `${allUsers.find(u => u.id === selectedAgentFilter)?.name}'s Schedule` : 'Global Schedule Map'}
                  </h3>
                </div>
                <ErrorBoundary>
                  <FollowUpCalendar leads={agentFilteredLeads} onLeadClick={(lead) => setSelectedLeadId(lead.id)} onLeadMove={handleLeadMove} />
                </ErrorBoundary>
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

            <ErrorBoundary>
              <AccountabilityDashboard users={allUsers} leads={leads} logs={activityLogs} onSelectLead={(lead) => setSelectedLeadId(lead.id)} onRefresh={refreshData} />
            </ErrorBoundary>

            {/* Team Management — admin invites, removes, reactivates,
                changes roles. Must come before the Playbook editor so
                the admin's primary operational task is top-of-screen. */}
            <div className="pt-10">
              <ErrorBoundary>
                <TeamManagement
                  currentUser={currentUser}
                  leads={leads}
                  onRefresh={refreshData}
                />
              </ErrorBoundary>
            </div>

            {/* Sales Playbook — admin teaches the AI the team's sales doctrine. */}
            <div className="pt-10">
              <ErrorBoundary>
                <PlaybookEditor currentUser={currentUser} />
              </ErrorBoundary>
            </div>

            <div className="pt-10">
              <ErrorBoundary>
                <TeamStatsPage currentUser={currentUser} />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>

      {isAddModalOpen && <AddLeadModal currentUser={currentUser} allUsers={allUsers} onClose={() => setIsAddModalOpen(false)} onSuccess={refreshData} />}
      {currentSelectedLead && (
        <LeadDetailModal
          lead={currentSelectedLead}
          currentUser={currentUser}
          onClose={() => setSelectedLeadId(null)}
          onUpdate={refreshData}
          onPatch={patchLeadLocally}
        />
      )}

      {/* Add Useful Link Modal */}
      {showAddLinkModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowAddLinkModal(false)}>
          <div className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-white/10 rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Link size={16} className="text-brand-500" />
                Add New Link
              </h3>
              <button onClick={() => setShowAddLinkModal(false)} className="text-muted hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-muted uppercase tracking-widest mb-2 block">Link Name</label>
                <input
                  type="text"
                  value={newLinkName}
                  onChange={(e) => setNewLinkName(e.target.value)}
                  placeholder="e.g., Customer Support Schedule"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all placeholder:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase tracking-widest mb-2 block">URL</label>
                <input
                  type="text"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all placeholder:text-muted"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => setShowAddLinkModal(false)}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddUsefulLink}
                disabled={!newLinkName.trim() || !newLinkUrl.trim()}
                className="px-5 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-lg shadow-brand-500/20 transition-all"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk delete confirmation — requires typing DELETE to prevent mis-clicks. */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowBulkDeleteConfirm(false)}>
          <div className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-red-500/20 rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3 bg-red-500/5">
              <AlertTriangle size={18} className="text-red-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Permanent delete</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted">
                You are about to permanently delete <strong className="text-white">{bulkSelectedIds.size} lead{bulkSelectedIds.size > 1 ? 's' : ''}</strong>. This cannot be undone.
              </p>
              <div>
                <label className="text-xs font-bold text-muted uppercase tracking-widest mb-2 block">
                  Type <span className="text-red-400 font-mono">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={bulkDeleteConfirmText}
                  onChange={e => setBulkDeleteConfirmText(e.target.value)}
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 transition-all font-mono"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => { setShowBulkDeleteConfirm(false); setBulkDeleteConfirmText(''); }}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleteConfirmText !== 'DELETE'}
                className="px-5 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-all"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      <Toaster position="top-right" toastOptions={{ style: { background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' } }} />
    </Layout>
  );
};

export default App;
