
import React, { useState, memo, useCallback, useEffect, useRef, useMemo } from 'react';
import { Lead, TodoStatus, LeadStatus, EveryFreq, Role, User } from '../types';
import { TodoBadge } from './Badge';
import { getTodayString, db } from '../services/db';
import { ExternalLink, Trash2, Clock, X, ChevronDown, Check, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonRow } from './Skeleton';

const PAGE_SIZE = 50;

interface LeadTableProps {
    leads: Lead[];
    activeTab: LeadStatus | string;
    currentUser: User;
    onUpdate: () => void;
    onPatch: (id: string, updates: Partial<Lead>) => void;
    onDelete?: (id: string) => void;
    showAgentColumn?: boolean;
    onLeadClick?: (lead: Lead) => void;
    isLoading?: boolean;
    bulkSelectedIds?: Set<string>;
    onToggleBulkSelect?: (id: string) => void;
    bulkSelectEnabled?: boolean;
}

const HistoryModal: React.FC<{ lead: Lead; onClose: () => void }> = ({ lead, onClose }) => {
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#111] shadow-2xl w-full max-w-md overflow-hidden animate-scale-in border border-white/10 rounded-2xl" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                        <Clock size={16} className="text-brand-500" />
                        Interaction Logs
                    </h3>
                    <button onClick={onClose} className="text-muted hover:text-white transition-colors"><X size={20} /></button>
                </div>
                <div className="p-6 h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                    {notes.length === 0 ? (
                        <div className="text-center py-20 text-muted text-xs uppercase tracking-widest font-bold opacity-30">No interaction history.</div>
                    ) : (
                        notes.slice().reverse().map((note) => (
                            <div key={note.id} className="relative pl-6 pb-6 border-l border-white/5 last:border-0 ml-2">
                                <div className="absolute top-0 -left-[5px] w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-[#111]" />
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-black text-white uppercase">{note.author_name}</span>
                                    <span className="text-[9px] text-muted font-bold">{note.created_at ? new Date(note.created_at).toLocaleString() : 'Just now'}</span>
                                </div>
                                <p className="text-xs text-muted leading-relaxed bg-white/[0.02] p-3 rounded-lg border border-white/5">{note.text}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

const LeadRow = memo(({ lead, activeTab, currentUser, showAgentColumn, onUpdate, onPatch, onDelete, onLeadClick, colWidths, bulkSelectEnabled, bulkSelected, onToggleBulkSelect }: any) => {
    const [showHistory, setShowHistory] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [localNote, setLocalNote] = useState('');
    // Tracks whether the input is currently focused. When idle it shows
    // the latest note as context; on focus the field clears so a fresh
    // note is typed (instead of silently "editing" into a duplicate).
    const [noteFocused, setNoteFocused] = useState(false);
    const dateInputRef = useRef<HTMLInputElement>(null);
    const isSupervisor = currentUser?.role === Role.ADMIN;
    const today = getTodayString();

    // Reset the draft when switching rows.
    useEffect(() => {
        setLocalNote('');
        setNoteFocused(false);
    }, [lead.id]);

    const handleUpdate = async (updates: Partial<Lead>) => {
        // Optimistic update first. On success we TRUST the patch and do NOT
        // schedule a background refetch — the old setTimeout(onUpdate, 5000)
        // pattern caused a race where a stale full-fetch would overwrite a
        // newer in-flight edit on an adjacent row, making lead fields appear
        // to revert or jump tabs ("losing leads"). On failure we full-refresh.
        onPatch(lead.id, updates);
        try {
            await db.updateLead(lead.id, updates, currentUser);
        } catch (err) {
            console.error("Update failed:", err);
            toast.error("Update failed. Please try again.");
            onUpdate();
        }
    };

    const latestNoteText = useMemo(() => {
        const notes = Array.isArray(lead.notes) ? lead.notes : [];
        return notes.length > 0 ? notes[notes.length - 1].text : '';
    }, [lead.notes]);

    const handleNoteFocus = () => {
        // Clear the pre-filled latest-note context so the user types fresh.
        setNoteFocused(true);
        setLocalNote('');
    };

    const handleNoteBlur = async () => {
        setNoteFocused(false);
        const notes = Array.isArray(lead.notes) ? lead.notes : [];

        if (localNote.trim() !== '') {
            // Optimistically append the new note so the UI shows it instantly
            // without a full refetch (the old onUpdate() call caused the same
            // race condition Phase 1 killed for status edits).
            const tempNote = {
                id: `tmp-${Date.now()}`,
                text: localNote.trim(),
                created_at: new Date().toISOString(),
                author_id: currentUser.id,
                author_name: currentUser.name,
            } as any;
            onPatch(lead.id, { notes: [...notes, tempNote] });
            try {
                await db.addNote(lead.id, localNote.trim(), currentUser);
                toast.success("Note saved.");
            } catch (err) {
                console.error("Failed to add note:", err);
                toast.error("Failed to save note.");
                onUpdate(); // roll back on failure
            }
        }
    };

    const toggleColdCheck = async (dayIndex: number) => {
        const history = [...(lead.cold_check_history || [])];
        if (history.includes(today)) {
            toast.error("Already performed a follow-up today.");
            return;
        }
        history.push(today);
        // Update optimistically first
        onPatch(lead.id, { cold_check_history: history });
        try {
            await db.updateLead(lead.id, { cold_check_history: history }, currentUser);
            // Don't refresh - let optimistic update persist
        } catch (err) {
            console.error("Cold check update failed:", err);
            toast.error("Failed to save checkbox. Please try again.");
            onUpdate();
        }
    };

    const handleCloseWithReason = async (reason: string) => {
        // Optimistic update first
        onPatch(lead.id, { status: LeadStatus.CLOSED, close_reason: reason });
        setShowCloseModal(false);
        try {
            await db.updateLead(lead.id, { status: LeadStatus.CLOSED, close_reason: reason }, currentUser);
            // Don't refresh - let optimistic update persist
        } catch (err) {
            console.error("Close failed:", err);
            toast.error("Failed to close lead. Please try again.");
            onUpdate();
        }
    };

    const renderPrioritySelect = () => (
        <select
            value={lead.status}
            onChange={(e) => {
                const newStatus = e.target.value as LeadStatus;
                if (newStatus === LeadStatus.CLOSED) {
                    setShowCloseModal(true);
                } else {
                    handleUpdate({ status: newStatus });
                }
            }}
            className="bg-transparent text-[10px] font-black text-white uppercase tracking-widest outline-none cursor-pointer hover:bg-white/5 rounded px-1 py-1 transition-colors appearance-none w-full"
        >
            {Object.values(LeadStatus).map(s => <option key={s} value={s} className="bg-[#111]">{s.toUpperCase()}</option>)}
        </select>
    );

    const renderTodoSelect = (options: TodoStatus[]) => (
        <select
            value={lead.todo}
            onChange={(e) => handleUpdate({ todo: e.target.value as TodoStatus })}
            className="bg-transparent text-[10px] font-black text-brand-400 uppercase tracking-widest outline-none cursor-pointer hover:bg-white/5 rounded px-1 py-1 transition-colors appearance-none w-full"
        >
            {options.map(o => <option key={o} value={o} className="bg-[#111]">{o.toUpperCase()}</option>)}
        </select>
    );

    const renderFrequencySelect = () => (
        <select
            value={lead.every || ''}
            onChange={(e) => handleUpdate({ every: e.target.value as EveryFreq })}
            className="bg-transparent text-[10px] font-black text-indigo-400 uppercase tracking-widest outline-none cursor-pointer hover:bg-white/5 rounded px-1 py-1 transition-colors appearance-none w-full"
        >
            <option value="" className="bg-[#111]">MANUAL</option>
            {Object.values(EveryFreq).map(f => <option key={f} value={f} className="bg-[#111]">{f} DAYS</option>)}
        </select>
    );

    const renderColdStatusSelect = () => (
        <select
            value={lead.cold_status || 'Unreached'}
            onChange={(e) => handleUpdate({ cold_status: e.target.value as any })}
            className="bg-transparent text-[10px] font-black text-blue-400 uppercase tracking-widest outline-none cursor-pointer hover:bg-white/5 rounded px-1 py-1 transition-colors appearance-none w-full"
        >
            <option value="Unreached" className="bg-[#111]">UNREACHED</option>
            <option value="Unresponsive" className="bg-[#111]">UNRESPONSIVE</option>
        </select>
    );

    const CloseReasonModal = () => (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowCloseModal(false)}>
            <div className="bg-[#111] shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in border border-white/10 rounded-2xl" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Close Reason</h3>
                    <button onClick={() => setShowCloseModal(false)} className="text-muted hover:text-white transition-colors"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-3">
                    {['Booked elsewhere', 'Cancelled', 'Asked not to be contacted'].map((reason) => (
                        <button
                            key={reason}
                            onClick={() => handleCloseWithReason(reason)}
                            className="w-full px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white font-medium transition-all text-left"
                        >
                            {reason}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    // Compact view for the virtual "scheduled" tab — only shows the
    // information you need to identify the lead and when it will surface.
    if (activeTab === 'scheduled') {
        return (
            <tr className="hover:bg-white/[0.01] transition-colors border-none group">
                <td className="px-2 py-2 overflow-hidden">
                    <button
                        onClick={() => onLeadClick && onLeadClick(lead)}
                        className="text-sm font-bold text-white tracking-tight block truncate hover:text-brand-400 transition-colors cursor-pointer text-left w-full"
                    >
                        {lead.name}
                    </button>
                </td>
                <td className="px-2 py-2 text-[9px] font-black uppercase tracking-widest text-brand-400">
                    {(lead.status || '').toUpperCase()}
                </td>
                <td className="px-2 py-2 text-xs font-bold text-amber-300">
                    {lead.follow_up_date}
                </td>
                {showAgentColumn && (
                    <td className="px-2 py-2 text-[9px] font-bold uppercase text-muted truncate">
                        {lead.assigned_agent_name}
                    </td>
                )}
                <td className="px-2 py-2 text-center">
                    <button
                        onClick={() => setShowHistory(true)}
                        className="p-1.5 text-muted hover:text-white hover:bg-white/5 rounded transition-all"
                    >
                        <Clock size={14} />
                    </button>
                    {showHistory && <HistoryModal lead={lead} onClose={() => setShowHistory(false)} />}
                </td>
            </tr>
        );
    }

    return (
        <tr className="hover:bg-white/[0.01] transition-colors border-none group">
            {bulkSelectEnabled && (
                <td className="px-3 py-1.5 w-10">
                    <input
                        type="checkbox"
                        checked={!!bulkSelected}
                        onChange={() => onToggleBulkSelect && onToggleBulkSelect(lead.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer"
                    />
                </td>
            )}
            <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.opportunity }}>
                <button
                    onClick={() => onLeadClick && onLeadClick(lead)}
                    className="text-sm font-bold text-white tracking-tight block truncate hover:text-brand-400 transition-colors cursor-pointer text-left w-full"
                >
                    {lead.name}
                </button>
            </td>

            <td className="px-2 py-1.5 overflow-hidden text-center" style={{ width: colWidths.asset }}>
                <a
                    href={lead.link || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-md text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all"
                >
                    CRM <ExternalLink size={10} />
                </a>
            </td>

            <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.priority }}>
                <div className="flex items-center gap-0.5 group/select">
                    {renderPrioritySelect()}
                    <ChevronDown size={8} className="text-muted group-hover/select:text-white transition-colors" />
                </div>
            </td>

            {activeTab === LeadStatus.HOT && (
                <>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.todo }}>
                        {renderTodoSelect([TodoStatus.NEW, TodoStatus.FOLLOWUP, TodoStatus.CALLBACK])}
                    </td>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.followUp }}>
                        <div
                            onClick={() => dateInputRef.current?.showPicker()}
                            className="cursor-pointer"
                        >
                            <input
                                ref={dateInputRef}
                                type="date"
                                value={lead.follow_up_date}
                                onChange={(e) => handleUpdate({ follow_up_date: e.target.value })}
                                className="bg-transparent text-xs font-bold text-muted outline-none border-none cursor-pointer focus:text-white transition-colors p-0 w-full [&::-webkit-calendar-picker-indicator]:hidden"
                            />
                        </div>
                    </td>
                </>
            )}

            {(activeTab === LeadStatus.WARM || activeTab === LeadStatus.PROGRESSIVE) && (
                <>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.todo }}>
                        {renderTodoSelect([TodoStatus.NEW, TodoStatus.FOLLOWUP, TodoStatus.CALLBACK])}
                    </td>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.frequency }}>
                        {renderFrequencySelect()}
                    </td>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.followUp }}>
                        <div
                            onClick={() => dateInputRef.current?.showPicker()}
                            className="cursor-pointer"
                        >
                            <input
                                ref={dateInputRef}
                                type="date"
                                value={lead.follow_up_date}
                                onChange={(e) => handleUpdate({ follow_up_date: e.target.value })}
                                className="bg-transparent text-xs font-bold text-muted outline-none border-none cursor-pointer focus:text-white transition-colors p-0 w-full [&::-webkit-calendar-picker-indicator]:hidden"
                            />
                        </div>
                    </td>
                </>
            )}

            {activeTab === LeadStatus.COLD && (
                <>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.status }}>
                        {renderColdStatusSelect()}
                    </td>
                    <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.fourDays }}>
                        <div className="flex gap-1.5 justify-center">
                            {[0, 1, 2, 3].map(i => {
                                const isChecked = (lead.cold_check_history || []).length > i;
                                return (
                                    <button
                                        key={i}
                                        onClick={() => !isChecked && toggleColdCheck(i)}
                                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isChecked ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white/5 border-white/10 text-transparent hover:border-brand-500'}`}
                                    >
                                        <Check size={8} strokeWidth={4} />
                                    </button>
                                );
                            })}
                        </div>
                    </td>
                </>
            )}

            <td className="px-2 py-1.5">
                <input
                    type="text"
                    value={noteFocused ? localNote : (localNote || latestNoteText)}
                    onChange={(e) => setLocalNote(e.target.value)}
                    onFocus={handleNoteFocus}
                    onBlur={handleNoteBlur}
                    placeholder={latestNoteText ? '' : 'Add interaction note...'}
                    title={latestNoteText ? `Latest: ${latestNoteText}` : 'Add interaction note'}
                    className={`w-full bg-transparent border-none outline-none text-xs transition-colors focus:text-white truncate ${noteFocused ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                />
            </td>

            {showAgentColumn && (
                <td className="px-2 py-1.5 whitespace-nowrap text-[9px] font-bold text-muted uppercase overflow-hidden" style={{ width: colWidths.agent }}>
                    <span className="block truncate">{lead.assigned_agent_name}</span>
                </td>
            )}

            <td className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths.logs }}>
                <div className="flex items-center gap-1 justify-center">
                    <button
                        onClick={() => setShowHistory(true)}
                        className="p-1.5 text-muted hover:text-white hover:bg-white/5 rounded transition-all"
                    >
                        <Clock size={14} />
                    </button>
                    {isSupervisor && onDelete && (
                        <button
                            onClick={() => onDelete(lead.id)}
                            className="p-1.5 text-muted hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
                {showHistory && <HistoryModal lead={lead} onClose={() => setShowHistory(false)} />}
                {showCloseModal && <CloseReasonModal />}
            </td>
        </tr>
    );
});

export const LeadTable: React.FC<LeadTableProps> = ({ leads, activeTab, currentUser, onUpdate, onPatch, onDelete, showAgentColumn, onLeadClick, isLoading, bulkSelectedIds, onToggleBulkSelect, bulkSelectEnabled }) => {
    const [page, setPage] = useState(0);

    // Reset to page 0 whenever the leads list or active tab changes
    React.useEffect(() => { setPage(0); }, [leads, activeTab]);

    const totalCount = leads.length;
    const pageCount = Math.ceil(totalCount / PAGE_SIZE);
    const pagedLeads = leads.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
    const to = Math.min((page + 1) * PAGE_SIZE, totalCount);

    // Column widths state for Notion-style resizing
    const [colWidths, setColWidths] = useState<Record<string, number>>({
        opportunity: 140,
        asset: 70,
        priority: 110,
        todo: 100,
        frequency: 90,
        followUp: 110,
        status: 110,
        fourDays: 100,
        agent: 100,
        logs: 50,
    });

    const isResizing = useRef<string | null>(null);
    const startX = useRef<number>(0);
    const startWidth = useRef<number>(0);

    const onMouseDown = (e: React.MouseEvent, colKey: string) => {
        isResizing.current = colKey;
        startX.current = e.clientX;
        startWidth.current = colWidths[colKey];
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const onMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const diff = e.clientX - startX.current;
        const newWidth = Math.max(60, startWidth.current + diff);
        setColWidths(prev => ({ ...prev, [isResizing.current as string]: newWidth }));
    }, []);

    const onMouseUp = useCallback(() => {
        isResizing.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    }, [onMouseMove]);

    if (!isLoading && (!leads || leads.length === 0)) {
        return (
            <div className="py-24 text-center dashboard-card flex flex-col items-center justify-center">
                <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/5">
                    <Clock size={20} className="text-muted" />
                </div>
                <p className="text-muted text-xs font-bold uppercase tracking-[0.2em]">Zero activity in {activeTab}</p>
            </div>
        );
    }

    const HeaderCell = ({ label, colKey, width }: { label: string, colKey: string, width?: number }) => (
        <th className="px-2 py-3 text-left relative group/header border-r border-white/5 last:border-r-0" style={{ width }}>
            <span className="text-[9px] font-black text-muted uppercase tracking-widest block truncate">{label}</span>
            <div
                onMouseDown={(e) => onMouseDown(e, colKey)}
                className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity bg-brand-500/20 hover:bg-brand-500/50 z-20"
            />
        </th>
    );

    const allVisibleSelected = bulkSelectEnabled && leads.length > 0 && leads.every(l => bulkSelectedIds?.has(l.id));
    const toggleSelectAllVisible = () => {
        if (!onToggleBulkSelect) return;
        if (allVisibleSelected) {
            leads.forEach(l => onToggleBulkSelect(l.id));
        } else {
            leads.filter(l => !bulkSelectedIds?.has(l.id)).forEach(l => onToggleBulkSelect(l.id));
        }
    };

    const renderScheduledHeader = () => (
        <thead className="bg-white/[0.02] border-b border-white/[0.05]">
            <tr>
                <th className="px-2 py-3 text-left text-[9px] font-black text-muted uppercase tracking-widest">Name</th>
                <th className="px-2 py-3 text-left text-[9px] font-black text-muted uppercase tracking-widest">Status</th>
                <th className="px-2 py-3 text-left text-[9px] font-black text-muted uppercase tracking-widest">Surfaces on</th>
                {showAgentColumn && <th className="px-2 py-3 text-left text-[9px] font-black text-muted uppercase tracking-widest">Agent</th>}
                <th className="px-2 py-3 text-center text-[9px] font-black text-muted uppercase tracking-widest">Logs</th>
            </tr>
        </thead>
    );

    const renderHeader = () => (
        <thead className="bg-white/[0.02] border-b border-white/[0.05]">
            <tr>
                {bulkSelectEnabled && (
                    <th className="px-3 py-3 w-10">
                        <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer"
                        />
                    </th>
                )}
                <HeaderCell label="Name" colKey="opportunity" width={colWidths.opportunity} />
                <HeaderCell label="Link" colKey="asset" width={colWidths.asset} />
                <HeaderCell label="Priority" colKey="priority" width={colWidths.priority} />

                {activeTab === LeadStatus.HOT && (
                    <>
                        <HeaderCell label="To-Do" colKey="todo" width={colWidths.todo} />
                        <HeaderCell label="Date" colKey="followUp" width={colWidths.followUp} />
                    </>
                )}

                {(activeTab === LeadStatus.WARM || activeTab === LeadStatus.PROGRESSIVE) && (
                    <>
                        <HeaderCell label="To-Do" colKey="todo" width={colWidths.todo} />
                        <HeaderCell label="Frequency" colKey="frequency" width={colWidths.frequency} />
                        <HeaderCell label="Date" colKey="followUp" width={colWidths.followUp} />
                    </>
                )}

                {activeTab === LeadStatus.COLD && (
                    <>
                        <HeaderCell label="Status" colKey="status" width={colWidths.status} />
                        <HeaderCell label="4 Days" colKey="fourDays" width={colWidths.fourDays} />
                    </>
                )}

                <th className="px-2 py-3 text-left text-[9px] font-black text-muted uppercase tracking-widest">Notes</th>

                {showAgentColumn && <HeaderCell label="Agent" colKey="agent" width={colWidths.agent} />}

                <HeaderCell label="Logs" colKey="logs" width={colWidths.logs} />
            </tr>
        </thead>
    );

    return (
        <div className="dashboard-card overflow-hidden shadow-2xl animate-scale-in">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="min-w-full border-collapse table-fixed">
                    {activeTab === 'scheduled' ? renderScheduledHeader() : renderHeader()}
                    <tbody className="divide-y divide-white/[0.03]">
                        {isLoading
                            ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
                            : pagedLeads.map(lead => (
                                <LeadRow
                                    key={lead.id}
                                    lead={lead}
                                    activeTab={activeTab}
                                    currentUser={currentUser}
                                    showAgentColumn={showAgentColumn}
                                    onUpdate={onUpdate}
                                    onPatch={onPatch}
                                    onDelete={onDelete}
                                    onLeadClick={onLeadClick}
                                    colWidths={colWidths}
                                    bulkSelectEnabled={bulkSelectEnabled}
                                    bulkSelected={bulkSelectedIds?.has(lead.id) || false}
                                    onToggleBulkSelect={onToggleBulkSelect}
                                />
                            ))
                        }
                    </tbody>
                </table>
            </div>

            {/* Pagination controls — only shown when there's more than one page */}
            {!isLoading && pageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-white/[0.01]">
                    <span className="text-[10px] font-bold text-muted uppercase tracking-widest">
                        Showing {from}–{to} of {totalCount} leads
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-muted hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <span className="text-[10px] font-bold text-white tabular-nums">
                            {page + 1} / {pageCount}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                            disabled={page >= pageCount - 1}
                            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-muted hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
