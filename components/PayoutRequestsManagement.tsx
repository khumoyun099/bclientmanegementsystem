import React, { useState, useEffect } from 'react';
import { User, PayoutRequest } from '../types';
import { db } from '../services/db';
import { CheckCircle2, XCircle, Clock, DollarSign, Users, ShieldCheck, ArrowRight } from 'lucide-react';

export const PayoutRequestsManagement: React.FC<{ currentUser: User, onUpdate: () => void }> = ({ currentUser, onUpdate }) => {
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const data = await db.getPayoutRequests(true);
      setRequests(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async (requestId: string, action: 'approved' | 'denied') => {
    const note = prompt(action === 'denied' ? 'Reason for denial (optional):' : 'Approval message (optional):');
    try {
      await db.processPayoutRequest(requestId, action, currentUser.id, note || undefined);
      loadRequests();
      onUpdate();
    } catch (err) {
      alert("Processing failed. Please try again.");
    }
  };

  if (loading) return (
      <div className="flex items-center justify-center py-20">
          <div className="animate-spin text-brand-500"><Clock size={32}/></div>
      </div>
  );

  const pending = requests.filter(r => r.status === 'pending');
  const processed = requests.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 text-green-400 rounded-lg">
                  <DollarSign size={20} />
              </div>
              <h2 className="text-lg font-black uppercase tracking-widest text-gray-200">Payout Review Board</h2>
          </div>
          <div className="px-4 py-1.5 bg-[#202020] rounded-full border border-[#2f2f2f] text-[10px] font-black text-gray-500 uppercase tracking-widest">
             {pending.length} Pending
          </div>
      </div>

      {pending.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {pending.map(req => (
                 <div key={req.id} className="bg-[#202020] rounded-[2rem] border border-[#2f2f2f] p-8 shadow-xl flex flex-col justify-between group hover:border-brand-500/50 transition-all">
                    <div className="flex justify-between items-start mb-6">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Requested By</p>
                            <h3 className="text-xl font-black text-white">{req.agent_name}</h3>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black text-brand-400 uppercase tracking-widest">Requested At</p>
                            <p className="text-xs text-gray-500 mt-1">{new Date(req.requested_at).toLocaleDateString()}</p>
                        </div>
                    </div>

                    <div className="bg-[#1a1a1a] rounded-2xl p-6 flex items-center justify-between mb-8 border border-[#2a2a2a]">
                        <div>
                           <p className="text-[10px] font-bold text-gray-500 uppercase">Value</p>
                           <p className="text-2xl font-black text-green-400">${req.dollar_value.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                           <p className="text-[10px] font-bold text-gray-500 uppercase">Points</p>
                           <p className="text-xl font-black text-gray-200">{req.points_requested.toLocaleString()}</p>
                        </div>
                    </div>

                    <div className="flex gap-3">
                       <button 
                         onClick={() => handleProcess(req.id, 'denied')}
                         className="flex-1 py-4 bg-[#2a2a2a] hover:bg-red-900/20 text-gray-400 hover:text-red-400 font-black rounded-2xl transition-all uppercase tracking-widest text-[10px] border border-[#333]"
                       >
                          Deny
                       </button>
                       <button 
                         onClick={() => handleProcess(req.id, 'approved')}
                         className="flex-[2] py-4 bg-green-600 hover:bg-green-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-green-500/20 uppercase tracking-widest text-[10px] flex items-center justify-center gap-2"
                       >
                          <CheckCircle2 size={16} />
                          Approve & Deduct Points
                       </button>
                    </div>
                 </div>
             ))}
          </div>
      ) : (
          <div className="py-20 text-center bg-[#202020] rounded-[2rem] border border-dashed border-[#2f2f2f]">
             <div className="w-16 h-16 bg-[#1a1a1a] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#2f2f2f]">
                <Clock size={24} className="text-gray-700" />
             </div>
             <p className="text-sm font-bold text-gray-400">No pending payout requests</p>
             <p className="text-xs text-gray-600 mt-1">Agents will appear here when they request a cashout.</p>
          </div>
      )}

      {processed.length > 0 && (
          <div className="space-y-6 pt-10">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Audit Trail (Processed)</h3>
              <div className="bg-[#202020] rounded-[2rem] border border-[#2f2f2f] overflow-hidden shadow-xl">
                 <table className="w-full">
                    <thead className="bg-[#252525] border-b border-[#2f2f2f]">
                       <tr>
                          <th className="px-8 py-4 text-left text-[10px] font-black text-gray-500 uppercase">Agent</th>
                          <th className="px-8 py-4 text-left text-[10px] font-black text-gray-500 uppercase">Amount</th>
                          <th className="px-8 py-4 text-left text-[10px] font-black text-gray-500 uppercase">Status</th>
                          <th className="px-8 py-4 text-left text-[10px] font-black text-gray-500 uppercase">Processed</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2a2a2a]">
                       {processed.map(req => (
                          <tr key={req.id} className="hover:bg-white/[0.01]">
                             <td className="px-8 py-4">
                                <p className="text-xs font-black text-gray-200">{req.agent_name}</p>
                                <p className="text-[10px] text-gray-600">ID: {req.id.slice(0,8)}</p>
                             </td>
                             <td className="px-8 py-4">
                                <p className="text-xs font-black text-green-400">${req.dollar_value.toFixed(2)}</p>
                                <p className="text-[10px] text-gray-600">{req.points_requested} pts</p>
                             </td>
                             <td className="px-8 py-4">
                                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase border ${
                                   req.status === 'approved' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
                                }`}>
                                   {req.status === 'approved' ? <CheckCircle2 size={12}/> : <XCircle size={12}/>}
                                   {req.status}
                                </div>
                             </td>
                             <td className="px-8 py-4 text-xs text-gray-500 font-medium">
                                {req.processed_at ? new Date(req.processed_at).toLocaleDateString() : '-'}
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>
          </div>
      )}
    </div>
  );
};