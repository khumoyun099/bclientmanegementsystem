/**
 * React hook for the Playbook editor: loads the active playbook + full
 * version history, and exposes save / rollback helpers.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getActivePlaybook,
  listPlaybookVersions,
  savePlaybook,
  activatePlaybookVersion,
} from '../services/pulseApi';
import type { PulsePlaybook } from '../types/pulse.types';

interface UsePlaybookResult {
  active: PulsePlaybook | null;
  versions: PulsePlaybook[];
  loading: boolean;
  saving: boolean;
  error: Error | null;
  save: (params: { content_md: string; notes?: string; created_by: string }) => Promise<void>;
  rollback: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePlaybook(): UsePlaybookResult {
  const [active, setActive] = useState<PulsePlaybook | null>(null);
  const [versions, setVersions] = useState<PulsePlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, all] = await Promise.all([getActivePlaybook(), listPlaybookVersions()]);
      setActive(a);
      setVersions(all);
      setError(null);
    } catch (err) {
      console.error('usePlaybook load failed:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (params: { content_md: string; notes?: string; created_by: string }) => {
      setSaving(true);
      try {
        await savePlaybook(params);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  const rollback = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        await activatePlaybookVersion(id);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  return { active, versions, loading, saving, error, save, rollback, refresh: load };
}
