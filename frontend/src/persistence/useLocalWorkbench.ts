import { useRef } from 'react';
import type { WorkbenchObject, SageOutput } from '../types';

export const LOCAL_KEY = 'linalg-workbench:v1';
const DEBOUNCE_MS = 500;

export interface WorkbenchSnapshot {
  objects: WorkbenchObject[];
  code: string;
  outputs: SageOutput[] | null;
  savedAt?: string;
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'QuotaExceededError' || /quota/i.test(err.message))
  );
}

function writeSnapshot(snap: WorkbenchSnapshot): void {
  const payload = { ...snap, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
  } catch (err) {
    if (!isQuotaError(err)) return;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...payload, outputs: null }));
    } catch {
      // give up silently
    }
  }
}

export function useLocalWorkbench() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<WorkbenchSnapshot | null>(null);

  function save(snap: WorkbenchSnapshot): void {
    pending.current = snap;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pending.current) writeSnapshot(pending.current);
      pending.current = null;
      timer.current = null;
    }, DEBOUNCE_MS);
  }

  function saveImmediate(snap: WorkbenchSnapshot): void {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    writeSnapshot(snap);
  }

  function restore(): WorkbenchSnapshot | null {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.objects) || typeof parsed.code !== 'string') {
        return null;
      }
      return parsed as WorkbenchSnapshot;
    } catch {
      return null;
    }
  }

  return { save, saveImmediate, restore };
}
