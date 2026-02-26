
import React from 'react';

const shimmer = 'animate-pulse bg-white/[0.05] rounded';

export const SkeletonRow: React.FC = () => (
  <tr className="border-none">
    <td className="px-2 py-2.5"><div className={`${shimmer} h-3 w-28`} /></td>
    <td className="px-2 py-2.5"><div className={`${shimmer} h-5 w-12 rounded-md`} /></td>
    <td className="px-2 py-2.5"><div className={`${shimmer} h-3 w-16`} /></td>
    <td className="px-2 py-2.5"><div className={`${shimmer} h-3 w-14`} /></td>
    <td className="px-2 py-2.5"><div className={`${shimmer} h-3 w-20`} /></td>
    <td className="px-2 py-2.5"><div className={`${shimmer} h-3 w-32`} /></td>
  </tr>
);

export const SkeletonCard: React.FC = () => (
  <div className="dashboard-card p-6 flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <div className={`${shimmer} w-9 h-9 rounded-lg`} />
      <div className={`${shimmer} h-3 w-24`} />
    </div>
    <div className="space-y-2">
      <div className={`${shimmer} h-8 w-16`} />
      <div className={`${shimmer} h-2.5 w-40`} />
    </div>
  </div>
);
