import type { SageOutput, WorkbenchObject } from './types';
import { bb } from './lib/butterbaseClient';

const API_BASE = bb.apiUrl + '/v1/' + bb.appId;

const EVALUATE_URL =
  import.meta.env.VITE_EVALUATE_URL ?? `${API_BASE}/fn/evaluate`;

export async function runOnSage(code: string): Promise<SageOutput[]> {
  const resp = await fetch(EVALUATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  let data: { ok: boolean; outputs?: SageOutput[]; error?: string };
  try {
    data = await resp.json();
  } catch {
    throw new Error(`evaluate failed: ${resp.status} (server returned non-JSON)`);
  }

  if (!resp.ok || !data.ok) {
    throw new Error(data.error ?? `evaluate failed: ${resp.status}`);
  }

  return data.outputs ?? [];
}

async function authFetch(path: string, body: unknown): Promise<unknown> {
  const authHeader = bb.getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');
  const resp = await fetch(`${API_BASE}/fn${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });
  let data: { ok?: boolean; error?: string; [k: string]: unknown };
  try {
    data = await resp.json();
  } catch {
    throw new Error(`request failed: ${resp.status}`);
  }
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error ?? `request failed: ${resp.status}`);
  }
  return data;
}

export async function saveHistory(payload: {
  code: string;
  objects: WorkbenchObject[];
  outputs: SageOutput[];
}): Promise<{ id: string; created_at: string; preview: string }> {
  const data = (await authFetch('/save_history', payload)) as {
    id: string;
    created_at: string;
    preview: string;
  };
  return data;
}

export async function renameCalculation(id: string, title: string): Promise<void> {
  await authFetch('/rename_calculation', { id, title });
}
