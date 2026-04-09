/**
 * React hook that loads (or generates) today's morning briefing for a
 * given agent. The edge function handles both cases — it returns a
 * cached row if one exists for today, or generates a new one via
 * Claude Haiku on demand. This hook is fire-and-forget: if anything
 * fails, the UI simply doesn't render the briefing card.
 *
 * Lifecycle:
 *   1. On mount, read the cached row directly from the table for an
 *      instant paint (no edge function round-trip if we already have one).
 *   2. If nothing cached, invoke the edge function to generate.
 *   3. Expose `dismiss()` so the user can mark the briefing read.
 *      Dismissed briefings stay in the table (so admin can audit) but
 *      are hidden from the UI for the rest of the day.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dismissBriefing,
  generateBriefing,
  getTodayBriefing,
  type BriefingRow,
} from '../services/pulseApi';

interface UsePulseBriefingResult {
  briefing: BriefingRow | null;
  loading: boolean;
  /** True while the initial edge function call is in flight. */
  generating: boolean;
  /** Mark today's briefing as read and hide it. */
  dismiss: () => Promise<void>;
}

export function usePulseBriefing(
  agentId: string | null | undefined,
  agentName: string | undefined,
): UsePulseBriefingResult {
  const [briefing, setBriefing] = useState<BriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!agentId) {
      setBriefing(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Step 1 — optimistic cache read from the table.
      const cached = await getTodayBriefing(agentId);
      if (cancelled.current) return;
      if (cached) {
        setBriefing(cached);
        setLoading(false);
        return;
      }

      // Step 2 — generate on demand via edge function.
      setGenerating(true);
      const resp = await generateBriefing({ agent_id: agentId, agent_name: agentName });
      if (cancelled.current) return;
      setBriefing(resp.briefing);
    } catch (err) {
      console.warn('usePulseBriefing load failed:', err);
    } finally {
      if (!cancelled.current) {
        setLoading(false);
        setGenerating(false);
      }
    }
  }, [agentId, agentName]);

  useEffect(() => {
    cancelled.current = false;
    load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  const dismiss = useCallback(async () => {
    if (!briefing) return;
    setBriefing({ ...briefing, read_at: new Date().toISOString() });
    await dismissBriefing(briefing.id);
  }, [briefing]);

  return { briefing, loading, generating, dismiss };
}
