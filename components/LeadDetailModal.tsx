
import React, { useState, useEffect } from 'react';
import { Lead, Role, TodoStatus, LeadStatus, EveryFreq, User } from '../types';
// Added Loader2 to the imports from lucide-react
import { X, ExternalLink, Trash2, Save, Loader2 } from 'lucide-react';
import { db, getTodayString } from '../services/db';

interface LeadDetailModalProps {
  lead: Lead;
  currentUser: User;
  onClose: () => void;
  onUpdate: () => void;
  onPatch?: (id: string, updates: Partial<Lead>) => void;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({ lead, currentUser, onClose, onUpdate, onPatch }) => {
  const [newNote, setNewNote] = useState('');
  const [editTodo, setEditTodo] = useState<TodoStatus>(lead.todo);
  const [editStatus, setEditStatus] = useState<LeadStatus>(lead.status);
  const [editEvery, setEditEvery] = useState<EveryFreq | undefined>(lead.every || undefined);
  const [editDate, setEditDate] = useState<string>(lead.follow_up_date);
  const [editReason, setEditReason] = useState<string>(lead.close_reason || '');
  const [editColdStatus, setEditColdStatus] = useState<string>(lead.cold_status || '');
  
  const [editName, setEditName] = useState(lead.name);
  const [editLink, setEditLink] = useState(lead.link || '');
  const [saving, setSaving] = useState(false);

  const isAdmin = currentUser && currentUser.role === Role.ADMIN;
  
  // Sync internal state if the lead prop changes from parent
  useEffect(() => {
    setEditTodo(lead.todo);
    setEditStatus(lead.status);
    setEditEvery(lead.every || undefined);
    setEditDate(lead.follow_up_date);
    setEditName(lead.name);
    setEditLink(lead.link || '');
    setEditReason(lead.close_reason || '');
    setEditColdStatus(lead.cold_status || '');
  }, [lead.id, lead.follow_up_date, lead.status, lead.todo]);

  const handleEditStatusChange = (newS: LeadStatus) => {
    setEditStatus(newS);
    if (newS === LeadStatus.WARM) {
      setEditTodo(TodoStatus.FOLLOWUP);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);

    const updates: Partial<Lead> = {};
    let hasChanges = false;
    let actionLog = '';

    if (editTodo !== lead.todo) {
      updates.todo = editTodo;
      hasChanges = true;
      actionLog = 'status_changed';
    }
    if (editStatus !== lead.status) {
      updates.status = editStatus;
      hasChanges = true;
      actionLog = 'status_changed';
    }
    if (editEvery !== lead.every) {
      updates.every = editEvery || null;
      hasChanges = true;
    }
    if (editDate !== lead.follow_up_date) {
      updates.follow_up_date = editDate;
      hasChanges = true;
      actionLog = actionLog || 'date_changed';
    }
    if (editReason !== lead.close_reason) {
      updates.close_reason = editReason;
      hasChanges = true;
    }
    if (editColdStatus !== lead.cold_status) {
      updates.cold_status = editColdStatus as any;
      hasChanges = true;
    }

    if (isAdmin) {
      if (editName !== lead.name) { updates.name = editName; hasChanges = true; }
      if (editLink !== lead.link) { updates.link = editLink; hasChanges = true; }
    }

    try {
        // Step 1: Optimistic Local Patch (Update UI immediately)
        if (onPatch && (hasChanges || newNote.trim())) {
            onPatch(lead.id, updates);
        }

        // Step 2: Persistent DB Updates (Sequential to ensure stability)
        if (newNote.trim()) {
          await db.addNote(lead.id, newNote.trim(), currentUser);
        }

        if (hasChanges) {
            await db.updateLead(lead.id, updates, currentUser);
            if (actionLog) {
                await db.logActivity(lead.id, currentUser.id, actionLog as any, `Updated lead details via modal`);
            }
        }

        // Step 3: Success handling
        // We close the modal immediately to feel fast
        onClose();
        
        // Step 4: Background Refresh (with small delay to allow DB consistency)
        setTimeout(() => {
            onUpdate();
        }, 600);

    } catch (err) {
        console.error("Save failed:", err);
        alert("Changes could not be saved. Reverting...");
        onUpdate(); // Refresh to original state on failure
    } finally {
        setSaving(false);
    }
  };

  const handleRequestDeletion = () => {
    if (confirm('Are you sure you want to request deletion for this lead?')) {
      db.requestDeletion(lead.id, currentUser);
      onUpdate();
    }
  };

  const handleDeleteDirectly = () => {
      if (confirm('ADMIN: Are you sure you want to permanently delete this lead?')) {
          db.handleDeletionRequest(lead.id, true);
          onUpdate();
          onClose();
      }
  }

  const formatDisplayDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 'N/A' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };

  const showEveryField = [LeadStatus.WARM, LeadStatus.COLD, LeadStatus.PROGRESSIVE].includes(editStatus);
  const inputClass = "block w-full text-sm bg-[#2f2f2f] border border-[#3f3f3f] rounded-md shadow-sm p-2 text-gray-200 focus:ring-brand-500 focus:border-brand-500 placeholder-gray-500 disabled:opacity-50";
  const labelClass = "text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#202020] rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-[#333] animate-scale-in">
        
        <div className="px-6 py-4 border-b border-[#2f2f2f] flex justify-between items-center bg-[#252525]">
          <div className="flex-1">
             <div className="flex items-center gap-3">
               {isAdmin ? (
                 <input 
                   disabled={saving}
                   type="text" 
                   value={editName}
                   onChange={(e) => setEditName(e.target.value)}
                   className="bg-[#2f2f2f] border border-[#3f3f3f] text-gray-100 px-2 py-1 rounded text-lg font-bold w-full focus:ring-brand-500 focus:border-brand-500"
                 />
               ) : (
                 <h2 className="text-xl font-bold text-gray-100">{lead.name}</h2>
               )}
               {lead.link && (
                    <a href={lead.link} target="_blank" rel="noreferrer" className="text-brand-400 hover:text-brand-300 transition-colors">
                        <ExternalLink size={16} />
                    </a>
                )}
             </div>
             <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                ID: {lead.id} <span className="text-gray-600">•</span> Assigned: {lead.assigned_agent_name}
                {lead.deletionRequest && (
                    <span className="bg-red-500/10 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border border-red-500/20">
                        DELETION {lead.deletionRequest.status.toUpperCase()}
                    </span>
                )}
             </div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-gray-500 hover:text-gray-300 transition-colors ml-4">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            <div className="sm:col-span-4">
                {isAdmin ? (
                   <div className="mb-4">
                     <label className={labelClass}>Link URL</label>
                     <input 
                        disabled={saving}
                        type="text" 
                        value={editLink}
                        onChange={(e) => setEditLink(e.target.value)}
                        className={inputClass}
                      />
                   </div>
                ) : (
                   <div className="mb-4">
                     <label className={labelClass}>Link</label>
                     <p className="text-sm text-slate-500 italic">Locked for agents. Contact supervisor to change.</p>
                   </div>
                )}
            </div>

            <div className="sm:col-span-1">
               <label className={labelClass}>Priority</label>
               <select 
                 disabled={saving}
                 value={editStatus} 
                 onChange={(e) => handleEditStatusChange(e.target.value as LeadStatus)}
                 className={inputClass}
               >
                 {Object.values(LeadStatus).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
               </select>
            </div>

            <div className="sm:col-span-1">
               <label className={labelClass}>To-do</label>
               <select 
                 disabled={saving || editStatus === LeadStatus.COLD}
                 value={editTodo} 
                 onChange={(e) => setEditTodo(e.target.value as TodoStatus)}
                 className={inputClass}
               >
                 {Object.values(TodoStatus).map(t => {
                   if (editStatus === LeadStatus.WARM && t !== TodoStatus.FOLLOWUP) return null;
                   return <option key={t} value={t}>{t.toUpperCase()}</option>;
                 })}
               </select>
            </div>

            <div className="sm:col-span-1">
               <label className={labelClass}>Follow-Up</label>
               <input 
                 disabled={saving}
                 type="date"
                 value={editDate}
                 onChange={(e) => setEditDate(e.target.value)}
                 className={`${inputClass} ${editDate < getTodayString() ? 'border-red-900 bg-red-900/10 text-red-400' : ''}`}
               />
               {editDate < getTodayString() && editStatus !== LeadStatus.SOLD && editStatus !== LeadStatus.CLOSED && <p className="text-[10px] text-red-400 mt-1 font-bold">OVERDUE</p>}
            </div>

             <div className="sm:col-span-1">
                <label className={labelClass}>Frequency</label>
                {showEveryField && editStatus !== LeadStatus.COLD ? (
                    <select 
                        disabled={saving}
                        value={editEvery || ''} 
                        onChange={(e) => setEditEvery(e.target.value as EveryFreq || undefined)}
                        className={inputClass}
                    >
                        <option value="">-- Manual --</option>
                        {Object.values(EveryFreq).map(f => <option key={f} value={f}>{f.replace('days', ' Days')}</option>)}
                    </select>
                ) : (
                    <div className="text-sm text-gray-600 italic py-2">Not applicable</div>
                )}
            </div>

            {editStatus === LeadStatus.COLD && (
                <div className="sm:col-span-4">
                    <label className={labelClass}>Cold Status</label>
                    <select 
                        disabled={saving}
                        value={editColdStatus}
                        onChange={(e) => setEditColdStatus(e.target.value)}
                        className={inputClass}
                    >
                        <option value="">Select status...</option>
                        <option value="Unreached">Unreached</option>
                        <option value="Unresponsive">Unresponsive</option>
                    </select>
                </div>
            )}

            {editStatus === LeadStatus.CLOSED && (
                <div className="sm:col-span-4">
                    <label className={labelClass}>Reason for Closing</label>
                    <select 
                        disabled={saving}
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        className={inputClass}
                    >
                        <option value="">Select a reason...</option>
                        <option value="Booked elsewhere">Booked elsewhere</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="Asked not to be contacted">Asked not to be contacted</option>
                    </select>
                </div>
            )}
          </div>

          <div className="border-t border-[#2f2f2f] my-6"></div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="space-y-2">
                 <label className={labelClass}>Add New Note</label>
                 <textarea 
                    disabled={saving}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Type details about your call or action..."
                    className="w-full h-32 bg-[#2f2f2f] border border-[#3f3f3f] rounded-md p-3 text-sm text-gray-200 focus:ring-brand-500 focus:border-brand-500 resize-none placeholder-gray-500 custom-scrollbar"
                />
             </div>

             <div className="space-y-2 flex flex-col h-full">
                 <label className={labelClass}>
                     History <span className="text-gray-500 font-normal ml-1">({lead.notes ? lead.notes.length : 0})</span>
                 </label>
                 <div className="bg-[#1a1a1a] rounded-lg p-3 overflow-y-auto h-32 flex-1 border border-[#2f2f2f] space-y-3 custom-scrollbar">
                   {!lead.notes || lead.notes.length === 0 ? (
                     <p className="text-xs text-gray-600 text-center py-4 italic">No history yet.</p>
                   ) : (
                     lead.notes.slice().sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(note => (
                       <div key={note.id} className="border-b border-[#2f2f2f] last:border-0 pb-2 last:pb-0">
                         <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs font-bold text-gray-400">{note.author_name}</span>
                            <span className="text-[10px] text-gray-600">{formatDisplayDate(note.created_at)}</span>
                         </div>
                         <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{note.text}</p>
                       </div>
                     ))
                   )}
                 </div>
             </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-[#252525] border-t border-[#2f2f2f] flex justify-between items-center">
            <div>
               {isAdmin ? (
                   <button 
                   disabled={saving}
                   onClick={handleDeleteDirectly}
                   className="text-red-400 hover:bg-red-900/20 px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2"
                   >
                       <Trash2 size={16} /> Delete Lead
                   </button>
               ) : (
                  !lead.deletionRequest && (
                    <button 
                        disabled={saving}
                        onClick={handleRequestDeletion}
                        className="text-gray-500 hover:text-red-400 hover:bg-red-900/10 px-3 py-2 rounded text-xs font-medium transition-colors"
                    >
                        Request Deletion
                    </button>
                  )
               )}
            </div>
            
            <div className="flex gap-3">
                <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#333] rounded transition-colors">
                    Cancel
                </button>
                <button 
                    disabled={saving}
                    onClick={handleSave}
                    className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded shadow-sm transition-all flex items-center gap-2 min-w-[140px] justify-center"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
