
import React, { useState, useRef, useEffect } from 'react';
import { User, Role } from '../types';
import { LogOut, LayoutDashboard, ShieldCheck, Coins, Users, Settings, UserPlus, Zap, Bell, Search, Sun, Moon, Monitor, ChevronDown } from 'lucide-react';
import { db } from '../services/db';

interface LayoutProps {
  // Use React.ReactNode instead of React.Node
  children: React.ReactNode;
  user: User | null;
  activePage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, user, activePage, onNavigate, onLogout, theme, onThemeChange }) => {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return <>{children}</>;

  return (
    <div className="min-h-screen mesh-bg flex flex-col font-sans">
      <header className="fixed top-0 w-full z-50 border-b border-white/10 glass">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8 h-full">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate('dashboard')}>
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-black shadow-lg">
                <Zap size={18} fill="currentColor" />
              </div>
              <h1 className="text-lg font-medium text-white tracking-tight">Follow-Up</h1>
            </div>

            <nav className="hidden md:flex items-center h-full gap-1">
               <button 
                  onClick={() => onNavigate('dashboard')}
                  className={`px-4 h-full flex items-center gap-2 text-xs font-medium uppercase tracking-wider transition-all border-b-2 ${activePage === 'dashboard' ? 'text-white border-white' : 'text-muted border-transparent hover:text-white'}`}
               >
                  <LayoutDashboard size={14} />
                  Dashboard
               </button>
               <button 
                  onClick={() => onNavigate('crm')}
                  className={`px-4 h-full flex items-center gap-2 text-xs font-medium uppercase tracking-wider transition-all border-b-2 ${activePage === 'crm' ? 'text-white border-white' : 'text-muted border-transparent hover:text-white'}`}
               >
                  <Users size={14} />
                  Portal
               </button>
               {user.role === Role.ADMIN && (
                 <button 
                    onClick={() => onNavigate('supervisor')}
                    className={`px-4 h-full flex items-center gap-2 text-xs font-medium uppercase tracking-wider transition-all border-b-2 ${activePage === 'supervisor' ? 'text-white border-white' : 'text-muted border-transparent hover:text-white'}`}
                 >
                    <ShieldCheck size={14} />
                    Supervisor
                 </button>
               )}
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-brand-500 font-bold text-xs">
                <Coins size={14} />
                <span>{user.points?.toLocaleString() || 0}</span>
            </div>
            
            <div className="flex items-center pl-4 border-l border-white/10 relative" ref={settingsRef}>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-all"
              >
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{user.role}</p>
                  <p className="text-xs font-medium text-white">{user.name}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold uppercase">
                  {user.name.charAt(0)}
                </div>
                <ChevronDown size={14} className={`text-muted transition-transform ${showSettings ? 'rotate-180' : ''}`} />
              </button>

              {showSettings && (
                <div className="absolute top-full right-0 mt-2 w-56 glass border border-white/10 rounded-2xl shadow-2xl p-2 z-[60] animate-scale-in">
                  <p className="px-3 py-2 text-[10px] font-bold uppercase text-muted tracking-widest">Interface Settings</p>
                  <button onClick={() => onThemeChange('light')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${theme === 'light' ? 'bg-white text-black' : 'hover:bg-white/5 text-muted hover:text-white'}`}>
                    <Sun size={14} /> Light Mode
                  </button>
                  <button onClick={() => onThemeChange('dark')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${theme === 'dark' ? 'bg-white text-black' : 'hover:bg-white/5 text-muted hover:text-white'}`}>
                    <Moon size={14} /> Dark Mode
                  </button>
                  <div className="my-1 border-t border-white/5" />
                  <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-red-400 hover:bg-red-400/10 transition-all">
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 pt-32 pb-20">
        {children}
      </main>
      <footer className="py-8 border-t border-white/5 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Follow-Up CRM • Server-Side Lead Intelligence</p>
      </footer>
    </div>
  );
};
