
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { PersonalTask, User } from '../types';
import { Plus, Check, Loader2, AlertCircle } from 'lucide-react';

export const MyTasks: React.FC<{ user: User }> = ({ user }) => {
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTasks();
  }, [user.id]);

  const loadTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await db.getPersonalTasks(user.id);
      setTasks(data);
    } catch (err: any) {
      console.error("Error loading tasks:", err);
      if (err.code === 'PGRST205' || err.message?.includes('personal_tasks')) {
        setError("Table Missing");
      }
    } finally {
      setLoading(false);
    }
  };

  const addTask = async () => {
    const text = newTaskText.trim();
    if (!text || adding) return;

    setAdding(true);
    setError(null);
    try {
      const task = await db.addPersonalTask(user.id, text);
      if (task) {
        setTasks(prev => [task, ...prev]);
        setNewTaskText('');
        inputRef.current?.focus();
      }
    } catch (err: any) {
      console.error("Failed to add task:", err);
      if (err.code === 'PGRST205' || err.message?.includes('personal_tasks')) {
        setError("Table Missing");
      }
    } finally {
      setAdding(false);
    }
  };

  const completeTask = async (taskId: string) => {
    try {
      setTasks(prev => prev.filter(t => t.id !== taskId));
      await db.completePersonalTask(taskId);
    } catch (err) {
      console.error("Error completing task:", err);
      loadTasks();
    }
  };

  return (
    <div className="dashboard-card h-full flex flex-col overflow-hidden bg-[#1a1a1a] border-white/10 shadow-xl">
      <div className="p-4 border-b border-white/5 bg-white/[0.03]">
        <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-3 font-sans">My Tasks</h3>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder={error === "Table Missing" ? "DATABASE OFFLINE..." : "Add task..."}
            disabled={adding || error === "Table Missing"}
            className="w-full bg-[#252525] border border-white/20 rounded-lg py-3 pl-4 pr-10 text-sm text-white font-medium outline-none focus:border-brand-500 focus:bg-[#2a2a2a] transition-all placeholder-gray-400 disabled:opacity-50"
          />
          <button
            onClick={addTask}
            disabled={adding || !newTaskText.trim() || error === "Table Missing"}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-white hover:text-brand-500 disabled:opacity-50 bg-white/10 rounded-md hover:bg-white/20 transition-all"
          >
            {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={16} className="animate-spin text-brand-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16 bg-white/[0.02] rounded-lg border border-dashed border-white/10">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">No pending tasks</p>
            <p className="text-[10px] text-gray-600 mt-1">Add a task above to get started</p>
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className="flex items-start gap-3 group p-3 bg-[#252525] hover:bg-[#2a2a2a] rounded-lg border border-white/10 hover:border-white/20 transition-all">
              <button
                onClick={() => completeTask(task.id)}
                className="mt-0.5 w-5 h-5 rounded-md border-2 border-white/30 flex items-center justify-center hover:border-emerald-500 hover:bg-emerald-500/20 transition-all text-transparent hover:text-emerald-500 bg-white/5 flex-shrink-0"
              >
                <Check size={12} strokeWidth={3} />
              </button>
              <span className="flex-1 text-sm text-gray-200 group-hover:text-white transition-colors leading-relaxed font-medium">{task.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
