
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Mail, Lock, Loader2, LogIn, ShieldCheck, Target, TrendingUp, Zap, ArrowRight, PlayCircle, Layers, Database, ShieldAlert, CheckCircle, Copy, Check } from 'lucide-react';

export const Auth: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setSuccess('Password reset email sent! Check your inbox.');
        setIsForgotPassword(false);
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({ 
            email, 
            password,
            options: { data: { name: email.split('@')[0] } }
        });
        if (error) throw error;
        alert('Check your email for confirmation!');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setError('Invalid email or password. If you previously had an account, try "Forgot Password".');
      } else if (err.message?.includes('User already registered')) {
        setError('This email is already registered. Please log in instead, or use "Forgot Password" to reset your password.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (showForm) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-orange-500/10 blur-[120px] rounded-full pointer-events-none opacity-40"></div>
        
        <div className="max-w-md w-full animate-scale-in glass p-10 rounded-[2.5rem] relative z-10 border border-white/10 shadow-2xl">
          <button 
            onClick={() => setShowForm(false)} 
            className="mb-8 text-[10px] font-bold uppercase tracking-[0.2em] text-muted hover:text-white transition-colors flex items-center gap-2"
          >
            <ArrowRight className="rotate-180" size={14} /> Back to Home
          </button>
          
          <div className="text-center mb-10">
            <div className="w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
               <Zap size={24} fill="currentColor" />
            </div>
            <h1 className="text-3xl font-medium text-white tracking-tight mb-2">
              {isForgotPassword ? 'Reset Password' : 'Portal Access'}
            </h1>
            <p className="text-xs text-muted uppercase tracking-widest">
              {isForgotPassword ? 'Enter your email to reset' : isSignUp ? 'Create your agent account' : 'Welcome back, agent'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input 
                required
                type="email" 
                placeholder="Agent Email" 
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {!isForgotPassword && (
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input 
                  required
                  type="password" 
                  placeholder="Password" 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-white text-black py-4 rounded-2xl font-semibold text-sm hover:bg-neutral-200 transition-all flex items-center justify-center gap-3 shadow-xl disabled:opacity-50 mt-6"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : (
                  isForgotPassword ? 'Send Reset Email' : isSignUp ? 'Create Account' : 'Access Dashboard'
              )}
            </button>
          </form>

          {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
                  <p className="text-[10px] text-red-400 text-center font-bold uppercase tracking-widest">{error}</p>
              </div>
          )}

          {success && (
              <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
                  <p className="text-[10px] text-green-400 text-center font-bold uppercase tracking-widest">{success}</p>
              </div>
          )}

          <div className="mt-8 pt-8 border-t border-white/10 text-center space-y-3">
            {!isForgotPassword && !isSignUp && (
              <button 
                onClick={() => { setIsForgotPassword(true); setError(null); setSuccess(null); }} 
                className="text-xs text-muted hover:text-white transition-colors"
              >
                Forgot your password?
              </button>
            )}
            <p className="text-xs text-muted">
              {isForgotPassword ? 'Remember your password?' : isSignUp ? 'Already a member?' : "New recruit?"}
              <button 
                onClick={() => { 
                  if (isForgotPassword) {
                    setIsForgotPassword(false);
                  } else {
                    setIsSignUp(!isSignUp);
                  }
                  setError(null); 
                  setSuccess(null); 
                }} 
                className="ml-2 text-white font-bold hover:underline"
              >
                {isForgotPassword ? 'Log In' : isSignUp ? 'Log In' : 'Join Team'}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-primary selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-border glass">
        <div className="flex h-16 max-w-7xl mx-auto px-6 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-black">
              <Zap size={20} fill="currentColor" />
            </div>
            <span className="font-medium tracking-tight text-white text-lg">Follow-Up</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => { setIsSignUp(false); setShowForm(true); }} className="text-xs text-muted hover:text-white transition-colors">Log in</button>
            <button onClick={() => { setIsSignUp(true); setShowForm(true); }} className="px-5 py-2 bg-white text-black text-xs font-medium rounded-full hover:bg-neutral-200 transition-colors">Sign up</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      {/* Corrected 'class' to 'className' for section and divs */}
      <section className="overflow-hidden pt-40 pb-20 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand-500/20 blur-[120px] rounded-full pointer-events-none opacity-40"></div>
        <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-orange-500/10 blur-[100px] rounded-full pointer-events-none opacity-20"></div>

        <div className="z-10 flex flex-col text-center max-w-7xl mx-auto px-6 relative items-center">
            <h1 className="md:text-7xl leading-[1.1] text-5xl font-medium text-transparent tracking-tight bg-clip-text bg-gradient-to-b from-white via-white to-white/50 max-w-4xl mb-6 pb-2">
              Never miss a lead! <br /> Close more deals today.
            </h1>
            
            <p className="md:text-xl text-muted leading-relaxed text-lg font-light max-w-2xl mb-10">
              The high-performance lead management system for elite sales squads. Track follow-ups, resolve identities, and ensure zero data loss.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-24 items-center">
                <button onClick={() => setShowForm(true)} className="h-12 px-8 rounded-full bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.15)]">
                    Access Portal <ArrowRight className="w-4 h-4" />
                </button>
                <button className="h-12 px-8 rounded-full border border-border bg-white/5 text-sm font-medium hover:bg-white/10 transition-all text-muted hover:text-white flex items-center gap-2">
                    <PlayCircle className="w-4 h-4" /> View Demo
                </button>
            </div>

            {/* Dashboard Preview */}
            <div className="w-full max-w-5xl rounded-2xl border border-border bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden relative group transform hover:scale-[1.01] transition-all duration-700">
                <div className="h-10 border-b border-border flex items-center px-4 gap-2 bg-white/5 justify-between">
                    <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                        <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                    </div>
                </div>
                <div className="grid grid-cols-12 divide-x divide-border h-[400px] grid-bg">
                    <div className="col-span-3 p-6 text-left hidden md:block">
                        <div className="space-y-4">
                            <div className="h-4 w-24 bg-white/10 rounded"></div>
                            <div className="space-y-2">
                                <div className="h-8 w-full bg-white/5 border border-white/5 rounded-lg flex items-center px-3 gap-2">
                                  <Layers size={14} className="text-white"/>
                                  <div className="h-2 w-16 bg-white/20 rounded"></div>
                                </div>
                                <div className="h-8 w-full bg-white/5 rounded-lg"></div>
                                <div className="h-8 w-full bg-white/5 rounded-lg"></div>
                            </div>
                        </div>
                    </div>
                    <div className="col-span-12 md:col-span-9 p-8 text-left">
                        <div className="flex justify-between items-start mb-10">
                            <div className="space-y-2">
                                <div className="h-6 w-48 bg-white/20 rounded"></div>
                                <div className="h-3 w-32 bg-white/10 rounded"></div>
                            </div>
                            <div className="h-10 w-24 bg-brand-500/20 border border-brand-500/30 rounded-full flex items-center justify-center">
                                <div className="h-2 w-12 bg-brand-500 rounded"></div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6 mb-8">
                             <div className="h-24 bg-white/[0.02] border border-border rounded-xl p-4">
                                 <div className="h-2 w-12 bg-white/10 rounded mb-4"></div>
                                 <div className="h-6 w-24 bg-white/20 rounded"></div>
                             </div>
                             <div className="h-24 bg-brand-500/5 border border-brand-500/20 rounded-xl p-4">
                                 <div className="h-2 w-12 bg-brand-500/20 rounded mb-4"></div>
                                 <div className="h-6 w-24 bg-white/20 rounded"></div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section className="py-32 border-t border-border relative">
        <div className="max-w-7xl mx-auto px-6">
            <div className="mb-20 max-w-2xl">
                <h2 className="text-3xl md:text-5xl font-medium tracking-tight mb-6 text-white">Advanced Attribution.<br/>Zero Compromise.</h2>
                <p className="text-muted font-light text-lg">Every feature is designed to maximize lead recovery while ensuring high-performance speed.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 auto-rows-[minmax(180px,auto)]">
                <div className="col-span-1 md:col-span-2 row-span-2 p-8 rounded-3xl bg-white/[0.02] border border-border hover:border-white/10 transition-all group relative overflow-hidden flex flex-col justify-between">
                    <div className="relative z-10 mb-8 p-6 rounded-2xl border border-white/5 bg-black/40 backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                             <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-brand-500 to-accent-orange flex items-center justify-center text-[10px] text-white font-bold">JD</div>
                                <span className="text-xs text-white font-medium">Resolved Identity #8291</span>
                             </div>
                             <span className="text-[10px] text-accent-emerald bg-accent-emerald/10 px-2 py-0.5 rounded-full">Active</span>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted">Lead Source</span>
                                <span className="text-white font-medium">Meta CAPI</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted">Conversion Score</span>
                                <span className="text-accent-orange font-medium">9.8/10</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xl font-medium text-white mb-2">Smart Identity Resolution</h3>
                        <p className="text-sm text-muted font-light leading-relaxed">Stitch together browser cookies, IP addresses, and CRM data to create persistent user profiles across devices.</p>
                    </div>
                </div>

                <div className="col-span-1 md:col-span-2 p-8 rounded-3xl bg-white/[0.02] border border-border flex flex-col justify-center">
                    <div className="w-10 h-10 rounded-xl bg-accent-emerald/10 flex items-center justify-center mb-6">
                        <CheckCircle className="text-accent-emerald" size={20} />
                    </div>
                    <h3 className="text-lg font-medium text-white mb-2">Automated Deduplication</h3>
                    <p className="text-sm text-muted font-light">Eliminate double-counted conversions with advanced Event_ID matching across all destinations.</p>
                </div>

                <div className="col-span-1 p-8 rounded-3xl bg-white/[0.02] border border-border">
                    <h3 className="text-lg font-medium text-white mb-2">Bot Filter</h3>
                    <p className="text-sm text-muted font-light">Crawl pings are filtered before reaching your ad manager.</p>
                </div>
                <div className="col-span-1 p-8 rounded-3xl bg-white/[0.02] border border-border">
                    <h3 className="text-lg font-medium text-white mb-2">GDPR Safe</h3>
                    <p className="text-sm text-muted font-light">SHA-256 hashing for all PII data.</p>
                </div>
            </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-16 bg-black">
        <div className="max-w-7xl mx-auto px-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-6">
                <div className="w-6 h-6 bg-white rounded flex items-center justify-center text-black">
                    <Zap size={14} fill="currentColor" />
                </div>
                <span className="font-medium tracking-tight text-white">Follow-Up CRM</span>
            </div>
            <p className="text-muted text-xs">© 2024 Follow-Up CRM. Built for elite sales operations.</p>
        </div>
      </footer>
    </div>
  );
};
