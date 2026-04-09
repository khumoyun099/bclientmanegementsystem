
import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Mail, Lock, User as UserIcon, Loader2, Zap, ArrowRight, PlayCircle, Layers, CheckCircle } from 'lucide-react';

type AuthMode = 'login' | 'signup' | 'forgot-password' | 'reset-password';

interface AuthProps {
  /**
   * When set to 'reset-password', the Auth component renders the
   * new-password form directly (no landing page). Used by App.tsx after
   * detecting a PASSWORD_RECOVERY auth event.
   */
  initialMode?: AuthMode;
}

export const Auth: React.FC<AuthProps> = ({ initialMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>(initialMode ?? 'login');
  const [showForm, setShowForm] = useState<boolean>(initialMode === 'reset-password');

  // Keep the mode in sync with parent-driven state so that when App.tsx
  // detects PASSWORD_RECOVERY and (re)renders Auth with the new initialMode,
  // the UI immediately switches to the new-password form.
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
      setShowForm(true);
    }
  }, [initialMode]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === 'forgot-password') {
        // Build a redirect URL that includes #type=recovery so the app can
        // route the user to the reset-password form after they click the
        // email link. Supabase attaches the session tokens to the hash.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/#auth-recovery`,
        });
        if (error) throw error;
        setSuccess('Password reset email sent. Check your inbox and click the link to set a new password.');
        setMode('login');
      } else if (mode === 'reset-password') {
        // The user arrived via a recovery link — Supabase has already put
        // them in an authenticated session with a recovery flag. Calling
        // updateUser sets the new password against that session.
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccess('Password updated. You can sign in with your new password.');
        setPassword('');
        setConfirmPassword('');
        // Sign the user out so they re-login fresh with the new password.
        await supabase.auth.signOut();
        setMode('login');
      } else if (mode === 'signup') {
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          setLoading(false);
          return;
        }
        const fullName = name.trim() || email.split('@')[0] || 'User';
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: fullName } },
        });
        if (error) throw error;
        setSuccess('Account created. Check your email for a confirmation link, then log in.');
        setMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setError('Invalid email or password. If you had an account before, try "Forgot Password".');
      } else if (err.message?.includes('User already registered')) {
        setError('This email is already registered. Log in instead, or reset your password.');
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const headerTitle = {
    login: 'Portal Access',
    signup: 'Create Your Account',
    'forgot-password': 'Reset Password',
    'reset-password': 'Set a New Password',
  }[mode];

  const headerSubtitle = {
    login: 'Welcome back, agent',
    signup: 'Join your team',
    'forgot-password': 'Enter your email to get a reset link',
    'reset-password': 'Choose a new password for your account',
  }[mode];

  const submitLabel = {
    login: 'Access Dashboard',
    signup: 'Create Account',
    'forgot-password': 'Send Reset Email',
    'reset-password': 'Update Password',
  }[mode];

  if (showForm) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-orange-500/10 blur-[120px] rounded-full pointer-events-none opacity-40"></div>

        <div className="max-w-md w-full animate-scale-in glass p-10 rounded-[2.5rem] relative z-10 border border-white/10 shadow-2xl">
          {mode !== 'reset-password' && (
            <button
              onClick={() => setShowForm(false)}
              className="mb-8 text-[10px] font-bold uppercase tracking-[0.2em] text-muted hover:text-white transition-colors flex items-center gap-2"
            >
              <ArrowRight className="rotate-180" size={14} /> Back to Home
            </button>
          )}

          <div className="text-center mb-10">
            <div className="w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
              <Zap size={24} fill="currentColor" />
            </div>
            <h1 className="text-3xl font-medium text-white tracking-tight mb-2">
              {headerTitle}
            </h1>
            <p className="text-xs text-muted uppercase tracking-widest">
              {headerSubtitle}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {/* Name field — signup only */}
            {mode === 'signup' && (
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  required
                  type="text"
                  placeholder="Your full name"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            {/* Email — login, signup, forgot-password */}
            {mode !== 'reset-password' && (
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  required
                  type="email"
                  placeholder="Email"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {/* Password — login, signup, reset-password */}
            {mode !== 'forgot-password' && (
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  required
                  type="password"
                  placeholder={mode === 'reset-password' ? 'New password' : 'Password'}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {/* Confirm password — reset-password only */}
            {mode === 'reset-password' && (
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  required
                  type="password"
                  placeholder="Confirm new password"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black py-4 rounded-2xl font-semibold text-sm hover:bg-neutral-200 transition-all flex items-center justify-center gap-3 shadow-xl disabled:opacity-50 mt-6"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : submitLabel}
            </button>
          </form>

          {error && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <p className="text-[11px] text-red-400 text-center font-medium">{error}</p>
            </div>
          )}

          {success && (
            <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-start gap-3">
              <CheckCircle size={14} className="text-green-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-green-400 font-medium">{success}</p>
            </div>
          )}

          {mode !== 'reset-password' && (
            <div className="mt-8 pt-8 border-t border-white/10 text-center space-y-3">
              {mode === 'login' && (
                <button
                  onClick={() => { setMode('forgot-password'); setError(null); setSuccess(null); }}
                  className="text-xs text-muted hover:text-white transition-colors"
                >
                  Forgot your password?
                </button>
              )}
              <p className="text-xs text-muted">
                {mode === 'forgot-password'
                  ? 'Remember your password?'
                  : mode === 'signup'
                  ? 'Already a member?'
                  : 'New here?'}
                <button
                  onClick={() => {
                    if (mode === 'forgot-password') setMode('login');
                    else setMode(mode === 'signup' ? 'login' : 'signup');
                    setError(null);
                    setSuccess(null);
                  }}
                  className="ml-2 text-white font-bold hover:underline"
                >
                  {mode === 'forgot-password'
                    ? 'Log In'
                    : mode === 'signup'
                    ? 'Log In'
                    : 'Sign Up'}
                </button>
              </p>
            </div>
          )}
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
            <button onClick={() => { setMode('login'); setShowForm(true); }} className="text-xs text-muted hover:text-white transition-colors">Log in</button>
            <button onClick={() => { setMode('signup'); setShowForm(true); }} className="px-5 py-2 bg-white text-black text-xs font-medium rounded-full hover:bg-neutral-200 transition-colors">Sign up</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
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
            <button onClick={() => { setMode('login'); setShowForm(true); }} className="h-12 px-8 rounded-full bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.15)]">
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
                      <Layers size={14} className="text-white" />
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

      {/* Footer */}
      <footer className="border-t border-border py-16 bg-black">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-6 h-6 bg-white rounded flex items-center justify-center text-black">
              <Zap size={14} fill="currentColor" />
            </div>
            <span className="font-medium tracking-tight text-white">Follow-Up CRM</span>
          </div>
          <p className="text-muted text-xs">© 2026 Follow-Up CRM. Built for elite sales operations.</p>
        </div>
      </footer>
    </div>
  );
};
