
import React, { useState } from 'react';
import { TodoStatus, LeadStatus, EveryFreq, User } from '../types';
import { db, getTodayString } from '../services/db';
import { X, Loader2, AlertCircle } from 'lucide-react';

interface AddLeadModalProps {
  currentUser: User;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({ currentUser, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [status, setStatus] = useState<LeadStatus>(LeadStatus.HOT);
  const [todo, setTodo] = useState<TodoStatus>(TodoStatus.NEW);
  const [every, setEvery] = useState<EveryFreq | undefined>(undefined);
  const [date, setDate] = useState<string>(getTodayString());
  const [initialNote, setInitialNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const newLead = await db.addLead({
        name,
        link,
        status,
        todo,
        every,
        follow_up_date: date,
      }, currentUser);

      if (initialNote.trim() && newLead?.id) {
        await db.addNote(newLead.id, initialNote, currentUser);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Lead creation failed:", err);
      setError(err.message || 'Failed to create lead. Please check your database connection.');
    } finally {
      setLoading(false);
    }
  };

  const showEveryField = [LeadStatus.WARM, LeadStatus.COLD, LeadStatus.PROGRESSIVE].includes(status);

  const inputClass = "mt-1 block w-full bg-[#2f2f2f] border border-[#3f3f3f] rounded-md shadow-sm p-2 text-gray-200 focus:ring-brand-500 focus:border-brand-500 text-sm placeholder-gray-500 disabled:opacity-50";
  const labelClass = "block text-xs font-medium text-gray-400 uppercase mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#202020] rounded-lg shadow-xl w-full max-w-lg overflow-hidden border border-[#333] animate-fade-in">
        <div className="flex justify-between items-center px-6 py-4 border-b border-[#2f2f2f] bg-[#252525]">
            <h3 className="text-lg font-bold text-gray-100">Add New Lead</h3>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 disabled:opacity-50" disabled={loading}><X size={20}/></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 flex items-start gap-3">
                    <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
                    <p className="text-xs text-red-400">{error}</p>
                </div>
            )}

            <div>
                <label className={labelClass}>Lead Name *</label>
                <input 
                  required 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className={inputClass} 
                  placeholder="e.g. John Doe / Acme Corp"
                  disabled={loading}
                />
            </div>
            
            <div>
                <label className={labelClass}>Link (Optional)</label>
                <input 
                  type="url" 
                  value={link} 
                  onChange={e => setLink(e.target.value)} 
                  className={inputClass} 
                  placeholder="https://..." 
                  disabled={loading}
                />
            </div>

            <div className="grid grid-cols-2 gap-5">
                <div>
                    <label className={labelClass}>Priority</label>
                    <select 
                      value={status} 
                      onChange={e => setStatus(e.target.value as LeadStatus)} 
                      className={inputClass}
                      disabled={loading}
                    >
                        {Object.values(LeadStatus).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                    </select>
                </div>
                <div>
                    <label className={labelClass}>To-do</label>
                    <select 
                      value={todo} 
                      onChange={e => setTodo(e.target.value as TodoStatus)} 
                      className={inputClass}
                      disabled={loading}
                    >
                        {Object.values(TodoStatus).map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
                 <div>
                    <label className={labelClass}>Follow-Up Date</label>
                    <input 
                      type="date" 
                      required 
                      value={date} 
                      onChange={e => setDate(e.target.value)} 
                      className={inputClass} 
                      disabled={loading}
                    />
                </div>
                {showEveryField && (
                     <div>
                        <label className={labelClass}>Frequency</label>
                        <select 
                          value={every || ''} 
                          onChange={e => setEvery(e.target.value as EveryFreq)} 
                          className={inputClass}
                          disabled={loading}
                        >
                            <option value="">None</option>
                            {Object.values(EveryFreq).map(f => <option key={f} value={f}>{f.replace('days', ' Days')}</option>)}
                        </select>
                    </div>
                )}
            </div>

            <div>
                 <label className={labelClass}>Initial Note</label>
                 <textarea 
                   value={initialNote} 
                   onChange={e => setInitialNote(e.target.value)} 
                   rows={3} 
                   className={inputClass} 
                   placeholder="Details about the initial call..."
                   disabled={loading}
                 ></textarea>
            </div>

            <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={onClose} 
                  disabled={loading}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-30"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading || !name.trim()}
                  className="bg-brand-600 text-white py-2 px-6 rounded hover:bg-brand-500 transition-all font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating...
                    </>
                  ) : 'Create Lead'}
                </button>
            </div>
        </form>
      </div>
    </div>
  );
};
