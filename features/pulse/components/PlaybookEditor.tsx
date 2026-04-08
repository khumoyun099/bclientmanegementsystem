/**
 * Admin-only Playbook editor. The Playbook is the sales doctrine the
 * AI (Pulse-2+) injects into every prompt, so editing it is the
 * admin's lever to teach Pulse their specific industry + team.
 *
 * Even though no AI reads it in Pulse-1, we ship the editor now so
 * admins can refine the doctrine ahead of the narration rollout. The
 * default row seeded by the migration is generic travel-industry.
 */

import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Save,
  History as HistoryIcon,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { User } from '../../../types';
import { usePlaybook } from '../hooks/usePlaybook';

const MAX_LENGTH = 4000;

interface PlaybookEditorProps {
  currentUser: User;
}

export const PlaybookEditor: React.FC<PlaybookEditorProps> = ({ currentUser }) => {
  const { active, versions, loading, saving, error, save, rollback } = usePlaybook();
  const [draft, setDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Seed the editor with the current active playbook whenever it loads
  useEffect(() => {
    if (active) setDraft(active.content_md);
  }, [active?.id]);

  const dirty = active ? draft !== active.content_md : draft.length > 0;
  const remaining = MAX_LENGTH - draft.length;

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error('Playbook cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      toast.error(`Playbook is too long (${trimmed.length} / ${MAX_LENGTH} chars).`);
      return;
    }
    try {
      await save({
        content_md: trimmed,
        notes: noteDraft.trim() || undefined,
        created_by: currentUser.id,
      });
      setNoteDraft('');
      toast.success('Playbook updated.');
    } catch (err) {
      console.error('Playbook save failed:', err);
      toast.error('Failed to save playbook.');
    }
  };

  const handleRollback = async (id: string, version: number) => {
    if (!confirm(`Roll back to version ${version}? Your current draft will be discarded.`)) {
      return;
    }
    try {
      await rollback(id);
      toast.success(`Rolled back to v${version}.`);
    } catch (err) {
      console.error('Playbook rollback failed:', err);
      toast.error('Rollback failed.');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20">
            <BookOpen size={16} className="text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Sales Playbook</h2>
            <p className="text-xs text-muted mt-0.5 max-w-xl">
              Teach Pulse your team's sales doctrine. Every AI insight and
              morning briefing (Pulse-2+) is generated with this doctrine as
              system context. Keep it tight — the AI reads every word.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-muted hover:text-white hover:bg-white/10 transition-all"
        >
          <HistoryIcon size={12} />
          {showHistory ? 'Hide history' : `History (${versions.length})`}
        </button>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="dashboard-card p-6 flex items-center justify-center text-muted text-xs">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading playbook…
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-300 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Could not load playbook: {error.message}</span>
        </div>
      )}

      {/* Editor */}
      {!loading && active && (
        <div className="dashboard-card p-5 space-y-4">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
            <span className="text-brand-400">
              Active: v{active.version}{' '}
              <span className="text-muted font-normal">
                ({new Date(active.created_at).toLocaleDateString()})
              </span>
            </span>
            <span className={remaining < 0 ? 'text-red-400' : 'text-muted'}>
              {draft.length} / {MAX_LENGTH}
            </span>
          </div>

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-xs text-gray-200 font-mono leading-relaxed resize-y outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all custom-scrollbar"
            placeholder="# Sales Doctrine&#10;&#10;Describe how your team sells…"
          />

          <input
            type="text"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Change note (optional) — why are you editing?"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white placeholder-muted outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all"
          />

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted">
              {dirty
                ? 'Saving creates a new version. Old versions are kept for rollback.'
                : 'No unsaved changes.'}
            </span>
            <button
              onClick={handleSave}
              disabled={!dirty || saving || remaining < 0}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-brand-500/20 transition-all"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save as new version'}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && versions.length > 0 && (
        <div className="dashboard-card p-5 space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">
            Version history
          </h3>
          <div className="divide-y divide-white/5">
            {versions.map(v => (
              <div
                key={v.id}
                className="flex items-start justify-between py-3 gap-4 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">v{v.version}</span>
                    {v.active && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-brand-500/10 border border-brand-500/20 text-brand-400">
                        Active
                      </span>
                    )}
                    <span className="text-[10px] text-muted">
                      {new Date(v.created_at).toLocaleString()}
                    </span>
                  </div>
                  {v.notes && (
                    <p className="text-[11px] text-muted italic mt-1 line-clamp-2">
                      {v.notes}
                    </p>
                  )}
                </div>
                {!v.active && (
                  <button
                    onClick={() => handleRollback(v.id, v.version)}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-muted hover:text-white hover:bg-white/10 transition-all disabled:opacity-40"
                  >
                    <RotateCcw size={10} />
                    Activate
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
