
import React, { useState, useEffect } from 'react';
import { Copy, Check, Database, ShieldAlert, ShieldCheck, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { db } from '../services/db';
import { User } from '../types';

export const DatabaseSetup: React.FC<{ currentUser?: User }> = ({ currentUser }) => {
  const [copied, setCopied] = React.useState(false);
  const [promoting, setPromoting] = useState(false);
  const [health, setHealth] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);

  const tables = ['profiles', 'leads', 'notes', 'activity_logs', 'points_history', 'payout_requests', 'agent_targets', 'agent_strategies', 'personal_tasks'];

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    setChecking(true);
    const results: Record<string, boolean> = {};
    for (const table of tables) {
      results[table] = await db.checkTableExists(table);
    }
    setHealth(results);
    setChecking(false);
  };

  const sqlSchema = `-- ==========================================
-- 1. CORE SYSTEM TABLES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text,
  name text,
  role text DEFAULT 'agent',
  points integer DEFAULT 0,
  theme_preference text DEFAULT 'dark',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.personal_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  text text NOT NULL,
  completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  link text,
  status text NOT NULL,
  todo text NOT NULL,
  every text,
  follow_up_date text NOT NULL,
  assigned_agent_id uuid REFERENCES auth.users ON DELETE SET NULL,
  assigned_agent_name text,
  "deletionRequest" jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  close_reason text,
  cold_status text,
  cold_start_date text,
  cold_check_history text[] DEFAULT ARRAY[]::text[]
);

CREATE TABLE IF NOT EXISTS public.notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES public.leads ON DELETE CASCADE NOT NULL,
  text text NOT NULL,
  author_id uuid REFERENCES auth.users ON DELETE SET NULL,
  author_name text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES public.leads ON DELETE CASCADE,
  agent_id uuid REFERENCES auth.users ON DELETE SET NULL,
  action text NOT NULL,
  details text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.points_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  agent_name text,
  amount integer NOT NULL,
  reason text NOT NULL,
  lead_id uuid REFERENCES leads ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payout_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  agent_name text NOT NULL,
  points_requested integer NOT NULL,
  dollar_value numeric(10,2) NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  admin_note text,
  requested_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  processed_at timestamp with time zone,
  processed_by uuid REFERENCES auth.users ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.agent_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  agent_name text NOT NULL,
  month date NOT NULL,
  gp_target numeric DEFAULT 0,
  sales_target integer DEFAULT 0,
  manual_new_gp numeric DEFAULT 0,
  manual_return_gp numeric DEFAULT 0,
  manual_sales_num integer DEFAULT 0,
  manual_tp_gp numeric DEFAULT 0,
  manual_tp_num integer DEFAULT 0,
  manual_created_leads integer DEFAULT 0,
  manual_taken_leads integer DEFAULT 0,
  manual_total_leads integer DEFAULT 0,
  manual_week1 numeric DEFAULT 0,
  manual_week2 numeric DEFAULT 0,
  manual_week3 numeric DEFAULT 0,
  manual_week4 numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(agent_id, month)
);

CREATE TABLE IF NOT EXISTS public.agent_strategies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  type text NOT NULL,
  content text NOT NULL,
  color text,
  checked boolean DEFAULT false,
  "order" integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS & Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_strategies ENABLE ROW LEVEL SECURITY;

-- Grant Permissions
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.personal_tasks TO authenticated;
GRANT ALL ON public.leads TO authenticated;
GRANT ALL ON public.notes TO authenticated;
GRANT ALL ON public.activity_logs TO authenticated;
GRANT ALL ON public.points_history TO authenticated;
GRANT ALL ON public.payout_requests TO authenticated;
GRANT ALL ON public.agent_targets TO authenticated;
GRANT ALL ON public.agent_strategies TO authenticated;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Auth all" ON public.personal_tasks;
    DROP POLICY IF EXISTS "Auth all" ON public.leads;
    DROP POLICY IF EXISTS "Auth all" ON public.notes;
    DROP POLICY IF EXISTS "Auth all" ON public.activity_logs;
    DROP POLICY IF EXISTS "Auth all" ON public.points_history;
    DROP POLICY IF EXISTS "Auth all" ON public.payout_requests;
    DROP POLICY IF EXISTS "Auth all" ON public.agent_targets;
    DROP POLICY IF EXISTS "Auth all" ON public.agent_strategies;
    DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
    DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;
END $$;

CREATE POLICY "Auth all" ON public.personal_tasks FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.leads FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.notes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.activity_logs FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.points_history FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.payout_requests FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.agent_targets FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth all" ON public.agent_strategies FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Profiles are viewable by authenticated users" ON public.profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sqlSchema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePromoteSelf = async () => {
    if (!currentUser) return;
    setPromoting(true);
    try {
        await db.promoteToAdmin(currentUser.id);
        alert("Success! Your role has been updated. Refreshing...");
        window.location.reload();
    } catch (err) {
        alert("Sync failed. Ensure 'profiles' table exists.");
    } finally {
        setPromoting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto my-12 space-y-10 animate-fade-in">
      <div className="bg-[#202020] rounded-[3rem] border border-amber-500/20 p-12 shadow-2xl relative overflow-hidden">
        
        <div className="flex flex-col md:flex-row items-start justify-between mb-12 gap-8 relative z-10">
            <div className="flex items-center gap-8">
                <div className="p-6 bg-amber-500/10 rounded-[2rem] border border-amber-500/20 shadow-xl">
                    <Database className="text-amber-500" size={48} />
                </div>
                <div>
                    <h2 className="text-5xl font-black text-white tracking-tighter uppercase italic leading-none">System Engine</h2>
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-[0.4em] mt-4 flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></span>
                       Infrastructure Management
                    </p>
                </div>
            </div>
            
            <div className="flex flex-col items-end gap-4">
                <button 
                  onClick={handlePromoteSelf}
                  disabled={promoting}
                  className="px-10 py-5 bg-brand-600 hover:bg-brand-500 text-white font-black rounded-3xl transition-all shadow-2xl shadow-brand-500/30 flex items-center gap-4 uppercase tracking-widest text-xs group"
                >
                  <ShieldCheck size={24} className="group-hover:scale-110 transition-transform" />
                  {promoting ? 'Syncing...' : 'Promote Me to Supervisor'}
                </button>
            </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {tables.map(table => (
                <div key={table} className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${checking ? 'opacity-50' : health[table] ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest truncate mr-2">{table.replace('_', ' ')}</span>
                    {checking ? (
                        <RefreshCw size={14} className="animate-spin text-gray-600" />
                    ) : health[table] ? (
                        <CheckCircle2 size={16} className="text-green-500" />
                    ) : (
                        <AlertCircle size={16} className="text-red-500" />
                    )}
                </div>
            ))}
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 p-8 rounded-[2.5rem] mb-12 flex items-start gap-6 animate-slide-up shadow-2xl shadow-amber-500/5">
            <div className="p-4 bg-amber-500/20 rounded-2xl text-amber-500">
                <ShieldAlert size={32} />
            </div>
            <div className="space-y-2">
                <p className="text-xl text-amber-400 font-black uppercase tracking-tighter italic">Migration Required</p>
                <p className="text-sm text-gray-400 leading-relaxed font-medium">
                    Run the SQL script below to update your schema. This will create all required tables including <span className="text-white">personal_tasks</span>.
                </p>
            </div>
        </div>

        <div className="relative group mb-12">
            <div className="absolute -top-3 left-10 px-4 bg-[#202020] text-[10px] font-black text-amber-500 uppercase tracking-[0.4em] z-10">SQL Setup Script</div>
            <div className="bg-[#0a0a0a] p-10 rounded-[2.5rem] border border-[#2f2f2f] relative group-hover:border-amber-500/40 transition-all shadow-inner">
                <pre className="text-[11px] text-brand-400/80 overflow-x-auto max-h-[500px] custom-scrollbar leading-relaxed font-mono">
                    {sqlSchema}
                </pre>
                <button 
                    onClick={copyToClipboard}
                    className="absolute top-8 right-8 px-8 py-3 bg-[#1a1a1a] hover:bg-brand-600 text-gray-400 hover:text-white rounded-2xl transition-all border border-[#2f2f2f] flex items-center gap-3 text-[10px] font-black uppercase tracking-widest shadow-2xl"
                >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy Script'}
                </button>
            </div>
        </div>

        <div className="bg-[#1a1a1a] p-8 rounded-[2.5rem] border border-[#2f2f2f] flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-6">
                <div className="p-4 bg-brand-500/10 rounded-2xl text-brand-400 border border-brand-500/20">
                    <RefreshCw size={32} className="animate-spin-slow" />
                </div>
                <div>
                    <p className="text-lg font-black text-white uppercase italic tracking-tighter">Sync Application</p>
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">Updates identity & table links</p>
                </div>
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto">
                <button 
                    onClick={checkHealth}
                    className="flex-1 md:flex-none px-8 py-4 bg-[#222] hover:bg-[#333] text-gray-400 font-black rounded-2xl transition-all border border-[#333] uppercase tracking-widest text-[10px]"
                >
                    Re-Check Health
                </button>
                <button 
                    onClick={() => window.location.reload()}
                    className="flex-1 md:flex-none px-10 py-4 bg-brand-600 hover:bg-brand-500 text-white font-black rounded-2xl transition-all shadow-2xl uppercase tracking-widest text-[10px] flex items-center justify-center gap-3"
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
