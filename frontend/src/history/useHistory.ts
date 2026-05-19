import { useEffect, useState, useCallback } from 'react';
import { bb } from '../lib/butterbaseClient';
import { renameCalculation } from '../api';
import type { Calculation } from '../types';

export function useHistory(enabled: boolean) {
  const [entries, setEntries] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await bb
      .from<Calculation>('calculations')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message ?? 'Failed to load history');
    } else {
      setEntries((data ?? []) as Calculation[]);
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      return;
    }
    fetchAll();
    bb.realtime.connect();
    const sub = bb.realtime.on('calculations', (change) => {
      setEntries((prev) => {
        if (change.op === 'INSERT' && change.record) {
          const row = change.record as unknown as Calculation;
          if (prev.some((e) => e.id === row.id)) return prev;
          return [row, ...prev];
        }
        if (change.op === 'UPDATE' && change.record) {
          const row = change.record as unknown as Calculation;
          return prev.map((e) => (e.id === row.id ? row : e));
        }
        if (change.op === 'DELETE' && change.old_record) {
          const id = (change.old_record as { id?: string }).id;
          if (!id) return prev;
          return prev.filter((e) => e.id !== id);
        }
        return prev;
      });
    });
    return () => {
      sub.unsubscribe();
    };
  }, [enabled, fetchAll]);

  async function deleteEntry(id: string): Promise<void> {
    const { error: err } = await bb.from('calculations').delete().eq('id', id);
    if (err) throw new Error(err.message ?? 'Delete failed');
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function clearAll(): Promise<void> {
    const session = bb.sessionManager.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error('Not authenticated');
    const { error: err } = await bb.from('calculations').delete().eq('user_id', uid);
    if (err) throw new Error(err.message ?? 'Clear failed');
    setEntries([]);
  }

  async function rename(id: string, title: string): Promise<void> {
    await renameCalculation(id, title);
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, title, title_source: 'user' as const } : e)),
    );
  }

  return { entries, loading, error, deleteEntry, clearAll, rename, refetch: fetchAll };
}
