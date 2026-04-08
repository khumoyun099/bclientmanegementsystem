/**
 * React hook that loads and polls the Pulse feed for a given agent.
 *
 * - Polls every 60 seconds so new signals (after the 15-min cron) surface
 *   without a manual refresh. The cost is one RPC call per minute — the
 *   RPC is indexed and local — negligible.
 * - Exposes a `refresh()` function for the manual refresh button.
 * - Never throws; on error returns the last-known data and an `error` flag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPulseFeed } from '../services/pulseApi';
import type { PulseFeedItem } from '../types/pulse.types';

interface UsePulseFeedResult {
  data: PulseFeedItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastRefreshedAt: Date | null;
}

const POLL_MS = 60_000;

export function usePulseFeed(agentId: string | null | undefined): UsePulseFeedResult {
  const [data, setData] = useState<PulseFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = await getPulseFeed(agentId ?? null);
      if (cancelled.current) return;
      setData(rows);
      setError(null);
      setLastRefreshedAt(new Date());
    } catch (err) {
      if (cancelled.current) return;
      console.error('usePulseFeed load failed:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [agentId]);

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

  return { data, loading, error, refresh: load, lastRefreshedAt };
}
