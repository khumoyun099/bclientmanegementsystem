
import React, { useState, useMemo } from 'react';
import { Lead } from '../types';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { getTodayString } from '../services/db';

interface FollowUpCalendarProps {
  leads: Lead[];
  onLeadClick?: (lead: Lead) => void;
  onLeadMove?: (leadId: string, newDate: string) => void;
}

export const FollowUpCalendar: React.FC<FollowUpCalendarProps> = ({ leads, onLeadClick, onLeadMove }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Group leads by date
  const leadsByDate = useMemo(() => {
    const groups: Record<string, Lead[]> = {};
    leads.forEach(lead => {
        const date = lead.follow_up_date; // YYYY-MM-DD
        if (!groups[date]) groups[date] = [];
        groups[date].push(lead);
    });
    return groups;
  }, [leads]);

  const todayStr = getTodayString();

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('leadId', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDragOverDate(date);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const leadId = e.dataTransfer.getData('leadId');
    if (leadId && onLeadMove) {
      onLeadMove(leadId, date);
    }
  };

  const renderDays = () => {
    const days = [];
    
    // Previous month padding
    for (let i = 0; i < firstDayOfMonth; i++) {
        days.push(<div key={`empty-${i}`} className="bg-[#1a1a1a] border border-[#2f2f2f] min-h-[120px] opacity-50"></div>);
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayLeads = leadsByDate[dateString] || [];
        const isToday = todayStr === dateString;
        const isDragOver = dragOverDate === dateString;

        days.push(
            <div 
              key={day} 
              onDragOver={(e) => handleDragOver(e, dateString)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, dateString)}
              className={`bg-[#202020] border border-[#2f2f2f] min-h-[120px] p-2 flex flex-col gap-1 relative group hover:bg-[#252525] transition-colors ${isDragOver ? 'ring-2 ring-brand-500 bg-brand-500/10 z-10' : ''}`}
            >
                <div className="flex justify-end mb-1">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-red-500 text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                        {day}
                    </span>
                </div>
                <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto custom-scrollbar max-h-[100px]">
                    {dayLeads.map(lead => (
                        <div 
                            key={lead.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, lead.id)}
                            onClick={() => onLeadClick?.(lead)}
                            className="bg-[#333] hover:bg-[#404040] px-2 py-1.5 rounded text-[11px] font-medium text-gray-200 truncate cursor-pointer border border-[#3f3f3f] shadow-sm flex items-center gap-2 group/lead active:scale-95 transition-transform" 
                            title={lead.name}
                        >
                             <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                lead.status === 'hot' ? 'bg-red-400' : 
                                lead.status === 'warm' ? 'bg-orange-400' :
                                lead.status === 'cold' ? 'bg-blue-400' : 'bg-gray-400'
                             }`}></span>
                            <span className="group-hover/lead:text-brand-400 transition-colors pointer-events-none">{lead.name}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    
    return days;
  };

  return (
    <div className="space-y-4 animate-fade-in mt-12 pb-12">
        <div className="flex items-center justify-between bg-[#202020] p-4 rounded-lg border border-[#2f2f2f]">
            <div className="flex items-center gap-3">
                 <div className="p-2 bg-[#2f2f2f] rounded-lg text-gray-400">
                    <CalendarDays size={20} />
                 </div>
                 <h2 className="text-lg font-bold text-gray-100">FollowUp Calendar</h2>
            </div>
            <div className="flex items-center gap-4">
                 <button onClick={handleToday} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[#2f2f2f] hover:bg-[#3f3f3f] text-gray-300 rounded transition-colors border border-[#3f3f3f]">
                    Today
                 </button>
                 <div className="flex items-center bg-[#2f2f2f] rounded-md border border-[#3f3f3f] p-0.5">
                    <button onClick={handlePrevMonth} className="p-1.5 hover:bg-[#3f3f3f] rounded text-gray-400 hover:text-white transition-colors"><ChevronLeft size={16} /></button>
                    <span className="px-4 text-sm font-bold min-w-[140px] text-center text-gray-200">{monthNames[month]} {year}</span>
                    <button onClick={handleNextMonth} className="p-1.5 hover:bg-[#3f3f3f] rounded text-gray-400 hover:text-white transition-colors"><ChevronRight size={16} /></button>
                 </div>
            </div>
        </div>
        
        <div className="rounded-lg overflow-hidden border border-[#2f2f2f] shadow-2xl bg-[#191919]">
            <div className="grid grid-cols-7 bg-[#252525] border-b border-[#2f2f2f]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="py-3 text-center text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {d}
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7 bg-[#191919]">
                {renderDays()}
            </div>
        </div>
    </div>
  );
}
