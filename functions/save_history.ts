/**
 * Butterbase serverless function: save_history
 *
 * Trigger: POST /save_history (auth: required)
 * Inserts a calculation snapshot for the authenticated user, then asynchronously
 * generates an AI title via the Butterbase AI gateway.
 *
 * Body:    { code: string, objects: WorkbenchObject[], outputs: SageOutput[] }
 * Returns: { ok: true, id, created_at, preview } | { ok: false, error }
 */

const MAX_CODE = 50_000;
const MAX_OBJECTS_JSON = 50_000;
const MAX_OUTPUTS_JSON = 500_000;
const AI_MODEL = 'anthropic/claude-3-haiku';

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function computePreview(code: string): string {
  const firstMeaningful = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return (firstMeaningful ?? '').slice(0, 80);
}

function summarizeObjects(objects: any[]): string {
  return objects
    .map((o) => {
      const name = o?.name ?? '?';
      const kind = o?.kind ?? '?';
      if (kind === 'scalar') return `${name}: scalar`;
      return `${name}: ${kind} ${o?.rows ?? '?'}x${o?.cols ?? '?'}`;
    })
    .join('; ');
}

function summarizeOutputs(outputs: any[]): string {
  return outputs
    .map((o) => {
      if (!o || typeof o !== 'object') return '';
      if (o.type === 'stream') return String(o.text ?? '');
      if (o.type === 'error') return `${o.ename ?? 'Error'}: ${o.evalue ?? ''}`;
      if (o.type === 'display') return String(o.data?.['text/plain'] ?? '[display]');
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);
}

async function generateTitle(
  ctx: any,
  id: string,
  code: string,
  objects: any[],
  outputs: any[],
): Promise<void> {
  try {
    const { BUTTERBASE_API_URL, BUTTERBASE_APP_ID, BUTTERBASE_API_KEY } = ctx.env;
    if (!BUTTERBASE_API_KEY) {
      console.warn('BUTTERBASE_API_KEY not configured; skipping title generation');
      return;
    }

    const prompt = [
      'Generate a short descriptive title (max 8 words, no quotes, no trailing period) for this linear algebra workbench evaluation.',
      `Objects: ${summarizeObjects(objects) || 'none'}`,
      `Code:\n${code}`,
      `Output preview:\n${summarizeOutputs(outputs) || '(no output)'}`,
      'Title:',
    ].join('\n\n');

    const resp = await fetch(`${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BUTTERBASE_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 30,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      console.error('AI gateway error', resp.status, await resp.text().catch(() => ''));
      return;
    }

    const data: any = await resp.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return;

    const title = raw.trim().replace(/^["']|["']$/g, '').slice(0, 200);
    if (!title) return;

    await ctx.db.query(
      `UPDATE calculations SET title = $1, title_source = 'ai' WHERE id = $2`,
      [title, id],
    );
  } catch (err) {
    console.error('title generation failed', err);
  }
}

export async function handler(request: Request, ctx: any): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflight();
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!ctx?.user?.id) {
    return jsonResp({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (typeof body?.code !== 'string' || !Array.isArray(body?.objects) || !Array.isArray(body?.outputs)) {
    return jsonResp({ ok: false, error: 'Invalid payload shape' }, 400);
  }
  if (body.code.length > MAX_CODE) {
    return jsonResp({ ok: false, error: 'code too large' }, 413);
  }

  const objectsJson = JSON.stringify(body.objects);
  const outputsJson = JSON.stringify(body.outputs);
  if (objectsJson.length > MAX_OBJECTS_JSON) {
    return jsonResp({ ok: false, error: 'objects too large' }, 413);
  }
  if (outputsJson.length > MAX_OUTPUTS_JSON) {
    return jsonResp({ ok: false, error: 'outputs too large' }, 413);
  }

  const preview = computePreview(body.code);

  // user_id is auto-populated by the BEFORE INSERT trigger from create_user_isolation.
  const result = await ctx.db.query(
    `INSERT INTO calculations (code, objects, outputs, preview)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)
     RETURNING id, created_at`,
    [body.code, objectsJson, outputsJson, preview],
  );

  const row = result.rows?.[0];
  if (!row) {
    return jsonResp({ ok: false, error: 'Insert failed' }, 500);
  }

  if (typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(generateTitle(ctx, row.id, body.code, body.objects, body.outputs));
  } else {
    generateTitle(ctx, row.id, body.code, body.objects, body.outputs).catch(() => {});
  }

  return jsonResp({ ok: true, id: row.id, created_at: row.created_at, preview });
}
