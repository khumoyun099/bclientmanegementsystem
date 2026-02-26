import { describe, it, expect, vi } from 'vitest';
import { Lead, LeadStatus, TodoStatus } from '../types';

// Simulate the optimistic update pattern used in App.tsx / LeadTable:
// 1. Patch state locally for instant UI feedback.
// 2. Persist to DB.
// 3. On DB error, roll back to the previous state.

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    name: 'Test Client',
    notes: [],
    status: LeadStatus.HOT,
    todo: TodoStatus.NEW,
    follow_up_date: '2026-03-01',
    assigned_agent_id: 'agent-1',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    locked: false,
    ...overrides,
  };
}

async function optimisticUpdate(
  leads: Lead[],
  leadId: string,
  patch: Partial<Lead>,
  persist: () => Promise<void>,
  setLeads: (leads: Lead[]) => void
): Promise<void> {
  // Apply patch immediately
  const patched = leads.map(l =>
    l.id === leadId ? { ...l, ...patch, updated_at: new Date().toISOString() } : l
  );
  setLeads(patched);

  try {
    await persist();
  } catch {
    // Roll back on failure
    setLeads(leads);
  }
}

describe('Optimistic update pattern', () => {
  it('applies the patch immediately before DB confirms', async () => {
    const leads = [makeLead()];
    let currentLeads = leads;
    const slowPersist = () => new Promise<void>(res => setTimeout(res, 1000));

    // Start but don't await
    const promise = optimisticUpdate(
      leads,
      'lead-1',
      { status: LeadStatus.WARM },
      slowPersist,
      updated => { currentLeads = updated; }
    );

    // State is patched synchronously before await resolves
    expect(currentLeads[0].status).toBe(LeadStatus.WARM);

    await promise;
    expect(currentLeads[0].status).toBe(LeadStatus.WARM);
  });

  it('rolls back to original state when persist throws', async () => {
    const leads = [makeLead({ status: LeadStatus.HOT })];
    let currentLeads = leads;

    await optimisticUpdate(
      leads,
      'lead-1',
      { status: LeadStatus.WARM },
      async () => { throw new Error('DB error'); },
      updated => { currentLeads = updated; }
    );

    expect(currentLeads[0].status).toBe(LeadStatus.HOT);
  });
});
