/**
 * React hook that loads and polls the Pulse feed for a given agent,
 * then asks the AI edge function to narrate every flagged lead. AI
 * narratives are merged back into each feed item under ai_title /
 * ai_body so PulseItem can render them directly.
 *
 * - Polls every 60 seconds so new signals (after the 15-min cron) surface
 *   without a manual refresh.
 * - Exposes a `refresh()` function for the manual refresh button.
 * - Never throws; on error returns last-known data and an `error` flag.
 * - AI generation is fire-and-forget: if the edge function is unreachable
 *   or returns nothing, the feed still renders with the deterministic
 *   fallback narrative from Pulse-1. The AI path never blocks the UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generateInsightsBatch,
  getCachedInsights,
  getPulseFeed,
} from '../services/pulseApi';
import type { PulseFeedItem } from '../types/pulse.types';

interface UsePulseFeedResult {
  data: PulseFeedItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastRefreshedAt: Date | null;
  /** True while the background AI narration fetch is in flight. */
  narrating: boolean;
  aiEnabled: boolean;
}

const POLL_MS = 60_000;
const MAX_AI_BATCH = 12;

export function usePulseFeed(agentId: string | null | undefined): UsePulseFeedResult {
  const [data, setData] = useState<PulseFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const cancelled = useRef(false);

  /**
   * Merge AI insights (keyed by lead_id) into the current feed items in
   * place. Items without a matching AI row are left with null ai_title /
   * ai_body so PulseItem falls back to the deterministic narrative.
   */
  const mergeInsights = useCallback(
    (feed: PulseFeedItem[], insights: Array<{ lead_id: string; title: string; body: string }>) => {
      if (insights.length === 0) return feed;
      const byId = new Map(insights.map(i => [i.lead_id, i]));
      return feed.map(item => {
        const ai = byId.get(item.lead_id);
        if (!ai) return item;
        return { ...item, ai_title: ai.title, ai_body: ai.body };
      });
    },
    [],
  );

  /**
   * Fire the AI edge function for the current feed. Uses any existing
   * cache rows up front so users see narrated items instantly on
   * subsequent renders, even before the edge function round-trips.
   */
  const narrate = useCallback(
    async (feed: PulseFeedItem[], targetAgentId: string | null) => {
      if (!targetAgentId || feed.length === 0) return;
      try {
        setNarrating(true);

        // Optimistic paint: show any cached rows we already have.
        const cached = await getCachedInsights(targetAgentId);
        if (cancelled.current) return;
        if (cached.length > 0) {
          setData(prev => mergeInsights(prev, cached));
        }

        // Then ask the edge function to fill in missing / expired narratives.
        const leads = feed.slice(0, MAX_AI_BATCH).map(item => ({
          lead_id: item.lead_id,
          name: item.lead_name,
          status: item.status,
          category: item.category ?? 'overdue',
          silence_score: item.silence_score,
          days_overdue: item.days_overdue,
          days_since_last_touch: item.days_since_last_touch,
          reschedule_streak: item.reschedule_streak,
          every_days: item.every_days,
          last_note_text: item.last_note_text,
        }));

        const resp = await generateInsightsBatch({
          agent_id: targetAgentId,
          leads,
        });

        if (cancelled.current) return;
        setAiEnabled(Boolean(resp.ai_enabled));
        if (resp.insights.length > 0) {
          setData(prev => mergeInsights(prev, resp.insights));
        }
      } catch (err) {
        console.warn('narrate failed:', err);
      } finally {
        if (!cancelled.current) setNarrating(false);
      }
    },
    [mergeInsights],
  );

  const load = useCallback(async () => {
    try {
      const rows = await getPulseFeed(agentId ?? null);
      if (cancelled.current) return;
      setData(rows);
      setError(null);
      setLastRefreshedAt(new Date());

      // Kick off AI narration AFTER the feed is painted. Uses the caller's
      // agentId when set, otherwise falls back to doing nothing (admin
      // whole-team view — we only narrate when filtered to one agent so the
      // edge function cost stays bounded).
      if (agentId) {
        void narrate(rows, agentId);
      }
    } catch (err) {
      if (cancelled.current) return;
      console.error('usePulseFeed load failed:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [agentId, narrate]);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(id);
    };
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh: load,
    lastRefreshedAt,
    narrating,
    aiEnabled,
  };
}
