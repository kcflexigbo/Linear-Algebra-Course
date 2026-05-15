/**
 * Butterbase serverless function: evaluate
 *
 * Deployed to: https://api.butterbase.ai/v1/app_02vcbf6ev0vp/fn/evaluate
 * Trigger: POST /evaluate (auth: none)
 * Timeout: 45 000 ms
 *
 * Accepts  { code: string }
 * Returns  { ok: true,  outputs: SageOutput[] }
 *       or { ok: false, error: string }
 *
 * Protocol:
 *   1. POST sagecell.sagemath.org/kernel → get kernel id + ws_url
 *   2. Open WebSocket to {ws_url}/kernel/{id}/channels
 *   3. Send execute_request message (Jupyter wire protocol)
 *   4. Collect iopub outputs until execute_reply + status:idle arrive
 *   5. Return collected outputs as JSON
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type SageOutput =
  | { type: 'stream'; name: string; text: string }
  | { type: 'display'; data: Record<string, string> }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] };

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const code = body?.code;
  if (!code || typeof code !== 'string') {
    return jsonResp({ ok: false, error: 'code must be a non-empty string' }, 400);
  }

  try {
    const outputs = await runSage(code);
    return jsonResp({ ok: true, outputs });
  } catch (err) {
    console.error('runSage error:', err);
    return jsonResp({ ok: false, error: (err as Error)?.message ?? String(err) }, 500);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── SageMathCell kernel request ──────────────────────────────────────────────

async function requestKernel(): Promise<{ id: string; ws_url: string }> {
  const resp = await fetch('https://sagecell.sagemath.org/kernel', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (linalg-workbench/2.0)',
    },
    body: 'accepted_tos=true',
  });
  if (!resp.ok) throw new Error(`SageCell kernel request failed: ${resp.status}`);
  return resp.json() as Promise<{ id: string; ws_url: string }>;
}

// ─── Jupyter WebSocket execution ──────────────────────────────────────────────

async function runSage(code: string): Promise<SageOutput[]> {
  const kernel = await requestKernel();
  const kid = kernel.id;
  let base = kernel.ws_url ?? 'wss://sagecell.sagemath.org';
  if (!base.endsWith('/')) base += '/';
  const wsUrl = `${base}kernel/${kid}/channels`;

  console.log('Connecting to:', wsUrl);

  return new Promise<SageOutput[]>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return reject(new Error(`WebSocket construction failed: ${(e as Error)?.message}`));
    }

    const outputs: SageOutput[] = [];
    let gotReply = false;
    let gotIdle = false;
    const session = uuid();

    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('Sage evaluation timed out (40 s)'));
    }, 40_000);

    function done(err?: Error): void {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(outputs);
    }

    ws.addEventListener('open', () => {
      const msg = {
        channel: 'shell',
        header: {
          msg_type: 'execute_request',
          msg_id: uuid(),
          username: '',
          session,
        },
        parent_header: {},
        metadata: {},
        content: {
          code,
          silent: false,
          user_expressions: { _sagecell_files: 'sys._sage_.new_files()' },
          allow_stdin: false,
        },
      };
      ws.send(JSON.stringify(msg));
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: {
        channel?: string;
        header?: { msg_type?: string };
        content?: Record<string, unknown>;
      };
      try { msg = JSON.parse(ev.data as string); } catch { return; }

      const ch = msg.channel;
      const type = msg.header?.msg_type;
      const content = (msg.content ?? {}) as Record<string, unknown>;

      if (ch === 'shell' && type === 'execute_reply') {
        gotReply = true;
      } else if (ch === 'iopub') {
        if (type === 'stream') {
          outputs.push({
            type: 'stream',
            name: (content.name as string) ?? 'stdout',
            text: (content.text as string) ?? '',
          });
        } else if (type === 'display_data' || type === 'execute_result') {
          outputs.push({
            type: 'display',
            data: (content.data as Record<string, string>) ?? {},
          });
        } else if (type === 'error') {
          outputs.push({
            type: 'error',
            ename: (content.ename as string) ?? '',
            evalue: (content.evalue as string) ?? '',
            traceback: (content.traceback as string[]) ?? [],
          });
        } else if (type === 'status' && content.execution_state === 'idle') {
          gotIdle = true;
        }
      }

      if (gotReply && gotIdle) {
        try { ws.close(); } catch { /* ignore */ }
        done();
      }
    });

    ws.addEventListener('error', (ev: Event) => {
      done(new Error(`WebSocket error: ${(ev as ErrorEvent).message ?? 'connection failed'}`));
    });

    ws.addEventListener('close', (ev: CloseEvent) => {
      if (!gotReply || !gotIdle) {
        done(new Error(`WebSocket closed early (code ${ev.code}): ${ev.reason || 'no reason'}`));
      }
    });
  });
}
