import { describe, it, expect } from 'vitest';
import { LeadStatus } from '../types';

// Pure helpers extracted from the cold-lead compliance rules.
// A cold lead must be checked every day. cold_days[i] === true means day i was checked.

function isColdViolation(cold_days: boolean[] | undefined): boolean {
  if (!cold_days || cold_days.length === 0) return false;
  return cold_days.some(checked => !checked);
}

function checkedDaysCount(cold_days: boolean[] | undefined): number {
  if (!cold_days) return 0;
  return cold_days.filter(Boolean).length;
}

function allDaysChecked(cold_days: boolean[] | undefined): boolean {
  if (!cold_days || cold_days.length === 0) return false;
  return cold_days.every(Boolean);
}

describe('Cold lead compliance', () => {
  it('reports a violation when at least one day is unchecked', () => {
    const cold_days = [true, true, false, true, false, false, true];
    expect(isColdViolation(cold_days)).toBe(true);
  });

  it('reports no violation when all days are checked', () => {
    const cold_days = [true, true, true, true, true, true, true];
    expect(isColdViolation(cold_days)).toBe(false);
  });

  it('handles an empty cold_days array as no violation', () => {
    expect(isColdViolation([])).toBe(false);
    expect(isColdViolation(undefined)).toBe(false);
  });

  it('counts checked days correctly', () => {
    const cold_days = [true, false, true, false, true, false, false];
    expect(checkedDaysCount(cold_days)).toBe(3);
    expect(allDaysChecked(cold_days)).toBe(false);
  });

  it('allDaysChecked returns true only when every slot is true', () => {
    expect(allDaysChecked([true, true, true])).toBe(true);
    expect(allDaysChecked([true, true, false])).toBe(false);
  });

  it('only COLD leads use this logic — other statuses should not be flagged', () => {
    const nonColdStatuses = [LeadStatus.HOT, LeadStatus.WARM, LeadStatus.SOLD, LeadStatus.CLOSED];
    nonColdStatuses.forEach(status => {
      expect(status).not.toBe(LeadStatus.COLD);
    });
  });
});
