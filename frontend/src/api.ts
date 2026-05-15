import type { SageOutput } from './types';

const EVALUATE_URL =
  import.meta.env.VITE_EVALUATE_URL ??
  'https://api.butterbase.ai/v1/app_02vcbf6ev0vp/fn/evaluate';

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
