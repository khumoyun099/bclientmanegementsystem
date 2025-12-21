
import React, { useState, useEffect, KeyboardEvent } from 'react';
import { User, StrategyItem, StrategyItemType } from '../types';
import { supabase } from '../services/supabase';
import { X, Loader2, Sparkles, GripVertical, Copy, Check, AlertCircle, Info } from 'lucide-react';

// Robust ID Generator Fallback
const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// GLOBAL SESSION CACHE to prevent redundant checks
let globalIsColumnMissing = false;
let globalHasCheckedColumn = false;

interface SlashCommand {
  type: StrategyItemType;
  label: string;
  description: string;
  icon: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { type: StrategyItemType.H1, label: 'Heading 1', description: 'Large section heading', icon: '📋' },
  { type: StrategyItemType.H2, label: 'Heading 2', description: 'Medium section heading', icon: '📄' },
  { type: StrategyItemType.BULLET, label: 'Bullet List', description: 'Simple bulleted list', icon: '•' },
  { type: StrategyItemType.NUMBER, label: 'Number List', description: 'Numbered list', icon: '1.' },
  { type: StrategyItemType.TODO, label: 'To-do List', description: 'Track tasks with checkboxes', icon: '☐' },
  { type: StrategyItemType.QUOTE, label: 'Quote', description: 'Capture a quote or insight', icon: '"' },
  { type: StrategyItemType.DIVIDER, label: 'Divider', description: 'Visual separator', icon: '─' },
  { type: StrategyItemType.STICKER, label: 'Sticker', description: 'Colored tag or note', icon: '🎨' },
];

const STICKER_COLORS = [
  { name: 'red', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  { name: 'yellow', bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  { name: 'green', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  { name: 'blue', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  { name: 'purple', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  { name: 'pink', bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
];

const SQL_FIX = `ALTER TABLE public.agent_strategies ADD COLUMN IF NOT EXISTS "order" integer DEFAULT 0;`;

export const StrategyModal: React.FC<{ agent: User; onClose: () => void }> = ({ agent, onClose }) => {
  const [blocks, setBlocks] = useState<StrategyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isColumnMissing, setIsColumnMissing] = useState(globalIsColumnMissing);
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuFilter, setSlashMenuFilter] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);

  useEffect(() => {
    loadBlocks();
  }, [agent.id]);

  async function loadBlocks() {
    setLoading(true);
    let columnMissing = globalIsColumnMissing;
    
    try {
      if (!globalHasCheckedColumn) {
          let { data, error: fetchError } = await supabase
            .from('agent_strategies')
            .select('*')
            .eq('agent_id', agent.id)
            .order('order');

          if (fetchError && (fetchError.message.includes('order') || fetchError.code === '42703')) {
              columnMissing = true;
              globalIsColumnMissing = true;
          }
          globalHasCheckedColumn = true;
          setIsColumnMissing(columnMissing);
      }

      let data;
      if (columnMissing) {
          setError("REORDERING RESTRICTED: Missing 'order' column.");
          const fallback = await supabase
            .from('agent_strategies')
            .select('*')
            .eq('agent_id', agent.id)
            .order('created_at', { ascending: true });
          data = fallback.data;
      } else {
          const result = await supabase
            .from('agent_strategies')
            .select('*')
            .eq('agent_id', agent.id)
            .order('order');
          data = result.data;
      }

      if (data && data.length > 0) {
        setBlocks(data);
      } else {
        const firstBlockId = generateId();
        const firstBlock: any = {
          id: firstBlockId,
          agent_id: agent.id,
          type: StrategyItemType.H1,
          content: '',
          order: 0,
        };
        await saveBlockRaw(firstBlock, columnMissing);
        setBlocks([firstBlock]);
        setFocusedBlockId(firstBlockId);
      }
    } catch (err: any) {
      console.error("Roadmap load error:", err);
      setError("DATABASE CONNECTION ERROR: Please ensure 'agent_strategies' table exists.");
    } finally {
      setLoading(false);
    }
  }

  async function saveBlockRaw(block: StrategyItem, missingColumn: boolean) {
    const payload: any = {
      id: block.id,
      agent_id: block.agent_id,
      type: block.type,
      content: block.content,
      checked: block.checked,
      color: block.color
    };
    
    if (!missingColumn) {
        payload.order = block.order;
    }

    const { error: upsertError } = await supabase
      .from('agent_strategies')
      .upsert(payload, { onConflict: 'id' });

    if (upsertError) console.error('Save error:', upsertError);
  }

  async function saveBlock(block: StrategyItem) {
    await saveBlockRaw(block, isColumnMissing);
  }

  async function deleteBlock(blockId: string) {
    await supabase
      .from('agent_strategies')
      .delete()
      .eq('id', blockId);
  }

  function updateBlock(blockId: string, updates: Partial<StrategyItem>) {
    setBlocks(prev => {
      const updated = prev.map(b => 
        b.id === blockId ? { ...b, ...updates } : b
      );
      const block = updated.find(b => b.id === blockId);
      if (block) saveBlock(block);
      return updated;
    });
  }

  function createNewBlock(afterBlockId: string, type: StrategyItemType = StrategyItemType.BULLET) {
    const afterIndex = blocks.findIndex(b => b.id === afterBlockId);
    const newOrder = blocks[afterIndex] ? (blocks[afterIndex].order || 0) + 0.5 : 0;

    const newBlockId = generateId();
    const newBlock: any = {
      id: newBlockId,
      agent_id: agent.id,
      type,
      content: '',
      order: newOrder,
    };

    setBlocks(prev => {
      const updated = [...prev, newBlock].sort((a, b) => (a.order || 0) - (b.order || 0));
      const reordered = updated.map((b, i) => ({ ...b, order: i }));
      reordered.forEach(saveBlock);
      return reordered;
    });

    setTimeout(() => {
      setFocusedBlockId(newBlockId);
      document.getElementById(`block-${newBlockId}`)?.focus();
    }, 50);
  }

  function removeBlock(blockId: string) {
    const index = blocks.findIndex(b => b.id === blockId);
    if (blocks.length === 1) return;

    deleteBlock(blockId);
    setBlocks(prev => prev.filter(b => b.id !== blockId));

    if (index > 0) {
      const prevBlock = blocks[index - 1];
      setTimeout(() => {
        document.getElementById(`block-${prevBlock.id}`)?.focus();
      }, 50);
    }
  }

  function handleKeyDown(e: KeyboardEvent, block: StrategyItem, index: number) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const content = target.value;

    if (e.key === '/' && content === '') {
      e.preventDefault();
      setShowSlashMenu(true);
      setSlashMenuFilter('');
      setSelectedCommandIndex(0);
      setFocusedBlockId(block.id);
      return;
    }

    if (showSlashMenu) {
      const filteredCommands = SLASH_COMMANDS.filter(cmd =>
        cmd.label.toLowerCase().includes(slashMenuFilter.toLowerCase())
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev => 
          Math.min(prev + 1, filteredCommands.length - 1)
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedCommandIndex]) {
          applySlashCommand(filteredCommands[selectedCommandIndex].type, block.id);
        }
      } else if (e.key === 'Escape') {
        setShowSlashMenu(false);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      createNewBlock(block.id, block.type === StrategyItemType.DIVIDER ? StrategyItemType.BULLET : block.type);
    }

    if (e.key === 'Backspace' && content === '' && blocks.length > 1) {
      e.preventDefault();
      removeBlock(block.id);
    }

    if (e.key === 'ArrowUp' && index > 0) {
      const cursorPos = target.selectionStart || 0;
      if (cursorPos === 0) {
        e.preventDefault();
        document.getElementById(`block-${blocks[index - 1].id}`)?.focus();
      }
    }

    if (e.key === 'ArrowDown' && index < blocks.length - 1) {
      const cursorPos = (target as any).selectionStart || 0;
      if (cursorPos === content.length) {
        e.preventDefault();
        document.getElementById(`block-${blocks[index + 1].id}`)?.focus();
      }
    }
  }

  function applySlashCommand(type: StrategyItemType, blockId: string) {
    updateBlock(blockId, { type, content: '' });
    setShowSlashMenu(false);
    setTimeout(() => {
      document.getElementById(`block-${blockId}`)?.focus();
    }, 50);
  }

  function handleDragStart(blockId: string) {
    if (isColumnMissing) return;
    setDraggedBlockId(blockId);
  }

  function handleDragOver(e: React.DragEvent, targetBlockId: string) {
    e.preventDefault();
    if (!draggedBlockId || draggedBlockId === targetBlockId) return;

    const draggedIndex = blocks.findIndex(b => b.id === draggedBlockId);
    const targetIndex = blocks.findIndex(b => b.id === targetBlockId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const reordered = [...blocks];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    const updated = reordered.map((b, i) => ({ ...b, order: i }));
    setBlocks(updated);
  }

  function handleDragEnd() {
    if (draggedBlockId) {
      blocks.forEach(saveBlock);
      setDraggedBlockId(null);
    }
  }

  function renderBlock(block: StrategyItem, index: number) {
    const baseClasses = "w-full bg-transparent border-none outline-none resize-none px-0 transition-all";
    const placeholders = {
      [StrategyItemType.H1]: "Heading 1",
      [StrategyItemType.H2]: "Heading 2", 
      [StrategyItemType.BULLET]: "List item",
      [StrategyItemType.NUMBER]: "List item",
      [StrategyItemType.TODO]: "To-do",
      [StrategyItemType.QUOTE]: "Quote",
      [StrategyItemType.DIVIDER]: "",
      [StrategyItemType.STICKER]: "Type a note...",
    };

    switch (block.type) {
      case StrategyItemType.H1:
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={(e) => updateBlock(block.id, { content: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, block, index)}
            placeholder={placeholders[StrategyItemType.H1]}
            className={`${baseClasses} text-4xl font-black text-white tracking-tighter uppercase italic`}
            autoFocus={focusedBlockId === block.id}
            onFocus={() => setFocusedBlockId(block.id)}
          />
        );

      case StrategyItemType.H2:
        return (
          <input
            id={`block-${block.id}`}
            type="text"
            value={block.content}
            onChange={(e) => updateBlock(block.id, { content: e.target.value })}
            onKeyDown={(e) => handleKeyDown(e, block, index)}
            placeholder={placeholders[StrategyItemType.H2]}
            className={`${baseClasses} text-xl font-bold text-gray-300 tracking-tight`}
            autoFocus={focusedBlockId === block.id}
            onFocus={() => setFocusedBlockId(block.id)}
          />
        );

      case StrategyItemType.BULLET:
        return (
          <div className="flex items-start gap-4">
            <span className="text-brand-500 font-bold mt-1.5">•</span>
            <textarea
              id={`block-${block.id}`}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, block, index)}
              placeholder={placeholders[StrategyItemType.BULLET]}
              rows={1}
              className={`${baseClasses} text-gray-300 leading-relaxed py-1`}
              autoFocus={focusedBlockId === block.id}
              onFocus={() => setFocusedBlockId(block.id)}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = target.scrollHeight + 'px';
              }}
            />
          </div>
        );

      case StrategyItemType.NUMBER:
        return (
          <div className="flex items-start gap-4">
            <span className="text-gray-600 font-black text-xs mt-2 w-5 text-right">{index + 1}.</span>
            <textarea
              id={`block-${block.id}`}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, block, index)}
              placeholder={placeholders[StrategyItemType.NUMBER]}
              rows={1}
              className={`${baseClasses} text-gray-300 leading-relaxed py-1`}
              autoFocus={focusedBlockId === block.id}
              onFocus={() => setFocusedBlockId(block.id)}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = target.scrollHeight + 'px';
              }}
            />
          </div>
        );

      case StrategyItemType.TODO:
        return (
          <div className="flex items-start gap-4">
            <div className="mt-2 shrink-0">
               <input 
                 type="checkbox" 
                 checked={block.checked || false} 
                 onChange={(e) => updateBlock(block.id, { checked: e.target.checked })}
                 className="w-5 h-5 rounded-md border-[#333] bg-[#1a1a1a] text-brand-500 focus:ring-brand-500"
               />
            </div>
            <textarea
              id={`block-${block.id}`}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, block, index)}
              placeholder={placeholders[StrategyItemType.TODO]}
              rows={1}
              className={`${baseClasses} text-gray-300 leading-relaxed py-1 ${block.checked ? 'line-through opacity-40' : ''}`}
              autoFocus={focusedBlockId === block.id}
              onFocus={() => setFocusedBlockId(block.id)}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = target.scrollHeight + 'px';
              }}
            />
          </div>
        );

      case StrategyItemType.QUOTE:
        return (
          <div className="border-l-4 border-brand-500/40 pl-6 py-2 bg-brand-500/5 rounded-r-xl">
            <textarea
              id={`block-${block.id}`}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, block, index)}
              placeholder={placeholders[StrategyItemType.QUOTE]}
              rows={1}
              className={`${baseClasses} text-gray-400 italic font-medium leading-relaxed`}
              autoFocus={focusedBlockId === block.id}
              onFocus={() => setFocusedBlockId(block.id)}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = target.scrollHeight + 'px';
              }}
            />
          </div>
        );

      case StrategyItemType.DIVIDER:
        return (
          <div className="py-8" id={`block-${block.id}`}>
            <div className="h-px bg-[#222] w-full" />
          </div>
        );

      case StrategyItemType.STICKER:
        const stickerColor = STICKER_COLORS.find(c => c.name === block.color) || STICKER_COLORS[3];
        return (
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
                <input
                  id={`block-${block.id}`}
                  type="text"
                  value={block.content}
                  onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                  onKeyDown={(e) => handleKeyDown(e, block, index)}
                  placeholder={placeholders[StrategyItemType.STICKER]}
                  className={`${baseClasses} px-6 py-4 rounded-[1.5rem] border ${stickerColor.bg} ${stickerColor.text} ${stickerColor.border} font-black text-sm uppercase tracking-widest italic`}
                  autoFocus={focusedBlockId === block.id}
                  onFocus={() => setFocusedBlockId(block.id)}
                />
            </div>
            <div className="flex gap-1.5 p-1.5 bg-[#1a1a1a] rounded-2xl border border-[#2f2f2f]">
               {STICKER_COLORS.map(c => (
                  <button 
                    key={c.name}
                    onClick={() => updateBlock(block.id, { color: c.name })}
                    className={`w-4 h-4 rounded-full border border-white/10 ${c.bg} ${block.color === c.name ? 'ring-2 ring-white scale-110' : ''}`}
                    title={c.name}
                  />
               ))}
            </div>
          </div>
        );
      default: return null;
    }
  }

  if (loading && blocks.length === 0) return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-xl">
       <div className="text-center">
          <Loader2 className="animate-spin text-brand-500 mx-auto mb-4" size={48} />
          <p className="text-gray-500 font-black uppercase tracking-widest text-xs">Syncing Roadmap...</p>
       </div>
    </div>
  );

  const filteredCommands = SLASH_COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(slashMenuFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-2xl p-4 sm:p-12">
      <div className="bg-[#111] rounded-[2.5rem] shadow-[0_0_120px_rgba(0,0,0,0.8)] w-full max-w-7xl h-[92vh] border border-[#222] overflow-hidden flex flex-col animate-scale-in">
        
        <div className="px-12 py-8 border-b border-[#1f1f1f] flex justify-between items-center bg-[#141414]">
          <div className="flex items-center gap-5">
             <div className="w-14 h-14 bg-brand-500/10 rounded-2xl flex items-center justify-center text-brand-500 border border-brand-500/20">
               <Sparkles size={28} />
             </div>
             <div>
                <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">Agent Growth Roadmap</h2>
                <div className="flex items-center gap-3 mt-1.5">
                   <span className="text-gray-600 font-bold text-sm tracking-widest uppercase">/ {agent.name}</span>
                </div>
             </div>
          </div>
          <button onClick={onClose} className="p-3 bg-[#1a1a1a] hover:bg-brand-600 text-gray-500 hover:text-white rounded-2xl transition-all border border-[#2f2f2f]">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-12 py-12 custom-scrollbar space-y-2 relative bg-[#111]">
          {error && (
              <div className="max-w-4xl mx-auto mb-8 animate-slide-up">
                  <div className={`border p-6 rounded-3xl flex flex-col gap-4 ${isColumnMissing ? 'bg-amber-500/5 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                      <div className="flex items-center gap-4">
                        {isColumnMissing ? <Info className="text-amber-500 shrink-0" size={24} /> : <AlertCircle className="text-red-500 shrink-0" size={24} />}
                        <div className="flex-1">
                            <p className={`text-sm font-black uppercase tracking-widest ${isColumnMissing ? 'text-amber-400' : 'text-red-400'}`}>
                                {isColumnMissing ? 'REORDERING RESTRICTED' : 'DATABASE ERROR'}
                            </p>
                            <p className={`text-xs mt-1 ${isColumnMissing ? 'text-amber-500/70' : 'text-red-500/70'}`}>
                                {isColumnMissing 
                                    ? "Reordering is disabled because the 'order' column is missing from Supabase." 
                                    : error
                                }
                            </p>
                        </div>
                        <button onClick={() => setShowSql(!showSql)} className={`px-4 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${isColumnMissing ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
                            {showSql ? 'Hide Script' : 'Get Fix'}
                        </button>
                      </div>
                      {showSql && (
                          <div className={`mt-2 bg-[#080808] border rounded-2xl p-4 relative group ${isColumnMissing ? 'border-amber-900/30' : 'border-red-900/30'}`}>
                              <pre className="text-[10px] text-brand-400/80 font-mono overflow-x-auto whitespace-pre-wrap">{SQL_FIX}</pre>
                              <button onClick={() => { navigator.clipboard.writeText(SQL_FIX); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="absolute top-4 right-4 p-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-gray-400 hover:text-white">
                                  {copied ? <Check size={14} className="text-green-500"/> : <Copy size={14} />}
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          )}

          <div className="max-w-4xl mx-auto space-y-1 pb-40">
            {blocks.map((block, index) => (
              <div
                key={block.id}
                draggable={!isColumnMissing}
                onDragStart={() => handleDragStart(block.id)}
                onDragOver={(e) => handleDragOver(e, block.id)}
                onDragEnd={handleDragEnd}
                className={`group relative py-1 px-4 -mx-4 rounded-xl transition-all hover:bg-white/[0.02] ${draggedBlockId === block.id ? 'opacity-30' : ''}`}
              >
                {!isColumnMissing && (
                    <div className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-gray-800 hover:text-gray-500 transition-all">
                       <GripVertical size={20} />
                    </div>
                )}

                <div className="relative">
                  {renderBlock(block, index)}

                  {showSlashMenu && focusedBlockId === block.id && (
                    <div className="absolute left-0 top-full mt-2 w-72 bg-[#1a1a1a] border border-[#2f2f2f] rounded-2xl shadow-2xl overflow-hidden z-[70] animate-slide-up backdrop-blur-xl">
                       <div className="max-h-96 overflow-y-auto py-3 px-2 space-y-1">
                          {filteredCommands.map((cmd, i) => (
                             <button 
                                key={cmd.type} 
                                onClick={() => applySlashCommand(cmd.type, block.id)} 
                                className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl transition-all group text-left ${i === selectedCommandIndex ? 'bg-brand-600' : 'hover:bg-white/5'}`}
                             >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${i === selectedCommandIndex ? 'bg-brand-500 text-white' : 'bg-[#252525] text-gray-400 group-hover:text-white'}`}>
                                   <span className="text-lg">{cmd.icon}</span>
                                </div>
                                <div>
                                   <p className={`text-xs font-black ${i === selectedCommandIndex ? 'text-white' : 'text-gray-200'}`}>{cmd.label}</p>
                                   <p className={`text-[10px] mt-0.5 ${i === selectedCommandIndex ? 'text-brand-100' : 'text-gray-600'}`}>{cmd.description}</p>
                                </div>
                             </button>
                          ))}
                       </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            <div 
              onClick={() => createNewBlock(blocks[blocks.length - 1]?.id || '', StrategyItemType.BULLET)}
              className="py-10 text-gray-800 hover:text-gray-600 cursor-text transition-colors italic text-xs uppercase tracking-widest font-black"
            >
              Click or press Enter to add content...
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#1f1f1f] flex items-center justify-between text-[10px] font-black text-gray-600 uppercase tracking-widest bg-[#141414]">
          <div className="flex items-center gap-6">
            <span>{blocks.length} Blocks</span>
            <span>•</span>
            <span>Type "/" for commands</span>
          </div>
          <span className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
             Auto-saving Cloud
          </span>
        </div>
      </div>
    </div>
  );
};
