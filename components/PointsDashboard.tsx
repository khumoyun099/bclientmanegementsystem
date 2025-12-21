
import React, { useState, useEffect } from 'react';
import { User, PointsHistory } from '../types';
import { db } from '../services/db';
import { Coins, History, DollarSign, Wallet, TrendingUp, Sparkles } from 'lucide-react';

export const PointsDashboard: React.FC<{ currentUser: User, onUpdate: () => void }> = ({ currentUser, onUpdate }) => {
  const [history, setHistory] = useState<PointsHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [currentUser.id]);

  const loadData = async () => {
    try {
      const historyData = await db.getPointsHistory(currentUser.id);
      setHistory(historyData);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  if (loading) return (
      <div className="flex items-center justify-center py-20">
          <div className="animate-spin text-brand-500"><History size={32}/></div>
      </div>
  );

  const estimatedValue = (currentUser.points || 0) / 10;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in mb-12">
      {/* Wallet Summary */}
      <div className="lg:col-span-2 dashboard-card p-8 flex flex-col justify-between relative overflow-hidden group">
         <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 blur-[100px] -mr-32 -mt-32 pointer-events-none group-hover:bg-brand-500/20 transition-all duration-700" />
         
         <div className="flex justify-between items-start relative z-10">
            <div>
               <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Total Points Balance</p>
               <div className="flex items-baseline gap-3">
                  <h2 className="text-5xl font-black text-white tracking-tighter">
                     {(currentUser.points || 0).toLocaleString()}
                  </h2>
                  <span className="text-xs font-bold text-brand-400 uppercase">BC Points</span>
               </div>
            </div>
            <div className="w-12 h-12 bg-brand-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-500/20">
               <Coins size={24} fill="currentColor" />
            </div>
         </div>

         <div className="mt-12 grid grid-cols-2 gap-8 relative z-10">
            <div className="p-4 bg-midnight-800/50 rounded-2xl border border-card-border">
               <div className="flex items-center gap-2 mb-2">
                  <DollarSign size={14} className="text-emerald-500" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Estimated Value</p>
               </div>
               <p className="text-2xl font-bold text-white">${estimatedValue.toFixed(2)} <span className="text-xs text-slate-500">USD</span></p>
            </div>
            <div className="p-4 bg-midnight-800/50 rounded-2xl border border-card-border">
               <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-brand-400" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Performance Tier</p>
               </div>
               <p className="text-2xl font-bold text-white">{currentUser.points! > 1000 ? 'Pro' : 'Rookie'}</p>
            </div>
         </div>
      </div>

      {/* Transaction Feed */}
      <div className="dashboard-card flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-card-border flex justify-between items-center bg-midnight-800/30">
           <h3 className="text-xs font-bold text-white uppercase flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              Recent Activity
           </h3>
           <button onClick={loadData} className="text-slate-500 hover:text-white transition-colors">
              <Sparkles size={14} />
           </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[250px]">
           {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-10 opacity-30">
                 <History size={24} className="mb-2" />
                 <p className="text-[10px] font-bold uppercase">No Transactions</p>
              </div>
           ) : (
              <div className="divide-y divide-card-border/30">
                 {history.map(item => (
                    <div key={item.id} className="px-6 py-4 flex items-center justify-between hover:bg-card-hover transition-standard">
                       <div>
                          <p className="text-xs font-bold text-white">{item.reason}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{new Date(item.created_at).toLocaleDateString()}</p>
                       </div>
                       <span className="text-sm font-bold text-brand-400">+{item.amount}</span>
                    </div>
                 ))}
              </div>
           )}
        </div>
      </div>
    </div>
  );
};
