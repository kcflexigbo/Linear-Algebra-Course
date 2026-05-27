/**
 * Butterbase serverless function: ai_workbench
 * Trigger: POST /ai_workbench (auth: none)
 */

type Json = unknown;

interface ReqBody {
  image?: string;
  instruction?: string;
  context?: { objects?: Json; code?: string };
}

interface WorkbenchObjectLite {
  name: string;
  kind: 'matrix' | 'vector' | 'scalar';
  rows: number;
  cols: number;
  orient: 'col' | 'row' | null;
  values: Record<string, string>;
}

type ToolCall =
  | { tool: 'add_matrix'; args: { name?: string; rows: number; cols: number; entries: string[][] } }
  | { tool: 'add_vector'; args: { name?: string; orient: 'col' | 'row'; entries: string[] } }
  | { tool: 'add_scalar'; args: { name?: string; value: string } }
  | { tool: 'set_code'; args: { code: string } }
  | { tool: 'append_code'; args: { code: string } }
  | { tool: 'clear_workbench'; args: { confirm: true } };

const MODEL = 'anthropic/claude-sonnet-4.6';
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const SYSTEM_PROMPT = `You are an assistant for a linear-algebra workbench.

The workbench has named MATRICES, VECTORS, and SCALARS, plus a Sage code editor.
Entries are STRINGS — fractions like "1/3" and symbolic expressions like "1+x", "sqrt(2)", "sin(t)" are allowed. Blank entries become "0".

You respond ONLY with JSON of this shape:
  { "tool_calls": ToolCall[] }

ToolCall is one of:
  { "tool": "add_matrix",      "args": { "name"?: string, "rows": int, "cols": int, "entries": string[][] } }
  { "tool": "add_vector",      "args": { "name"?: string, "orient": "col"|"row", "entries": string[] } }
  { "tool": "add_scalar",      "args": { "name"?: string, "value": string } }
  { "tool": "set_code",        "args": { "code": string } }
  { "tool": "append_code",     "args": { "code": string } }
  { "tool": "clear_workbench", "args": { "confirm": true } }

Rules:
- The current workbench state will be shown. Names already in use must NOT be reused for new objects. Pick a different letter or simply OMIT "name" — the workbench will assign the next free letter automatically. Omitting "name" is the safest choice.
- entries arrays for add_matrix MUST be shape [rows][cols], row-major.
- rows and cols must be in [1,8]; vector entries length in [1,10].
- If the instruction asks to solve / compute / show something, emit add_* calls FIRST, then a final set_code that calls show(...) using those names. Example: show(A.det()), show(A.solve_right(b)), show(A.rref()).
- Never wrap names in quotes inside code strings. Use Sage syntax directly.
- Do NOT emit clear_workbench unless the user explicitly asks to start over.
- SANITY-CHECK the request against the actual shapes of the existing objects before writing code. If the request is mathematically invalid for the given objects, do NOT emit broken Sage. Instead emit a single set_code call whose body is a Sage print(...) explaining why, and suggesting the closest valid operation. Examples of invalid requests: eigenvalues / determinant / inverse / trace / charpoly on a non-square matrix; A * B when A.cols != B.rows; A.solve_right(b) when A.rows != len(b); inverting a singular matrix is allowed (Sage handles it) but inverting a non-square one is not.
- Output JSON only. No prose, no markdown fence.`;

export async function handler(request: Request, ctx: { env: Record<string, string> }): Promise<Response> {
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
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body: ReqBody;
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const instruction = (body.instruction ?? '').trim();
  if (!instruction && !body.image) {
    return jsonResp({ ok: false, error: 'instruction or image required' }, 400);
  }

  const { BUTTERBASE_APP_ID, BUTTERBASE_API_URL, BUTTERBASE_API_KEY } = ctx.env;
  if (!BUTTERBASE_API_KEY) {
    return jsonResp({ ok: false, error: 'server missing BUTTERBASE_API_KEY' }, 500);
  }

  const objects = sanitizeObjects(body.context?.objects);
  const takenNames = new Set(objects.map((o) => o.name));
  const contextSummary = summarizeContext(objects, body.context?.code, takenNames);

  // First-turn messages
  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserContent(contextSummary, instruction, body.image),
    },
  ];

  let calls: unknown[];
  let attempt = 0;

  while (true) {
    attempt++;
    let assistantText: string;
    try {
      assistantText = await callModel(
        BUTTERBASE_API_URL,
        BUTTERBASE_APP_ID,
        BUTTERBASE_API_KEY,
        messages
      );
    } catch (err) {
      console.error('AI call failed:', err);
      return jsonResp({ ok: false, error: (err as Error).message }, 502);
    }

    const parsed = parseToolCalls(assistantText);
    if (!parsed.ok) {
      console.error('Parse failed on attempt', attempt, 'content:', assistantText);
      if (attempt >= 2) return jsonResp({ ok: false, error: parsed.error, raw: assistantText }, 502);
      messages.push({ role: 'assistant', content: assistantText });
      messages.push({
        role: 'user',
        content: `Your previous response did not parse as JSON: ${parsed.error}. Respond again with ONLY a single JSON object of the form {"tool_calls":[...]}.`,
      });
      continue;
    }

    const issues = validateCalls(parsed.calls as ToolCall[], takenNames);
    if (issues.length === 0 || attempt >= 2) {
      calls = parsed.calls;
      break;
    }

    // Provide feedback and retry once.
    console.log('Retrying with validation feedback:', issues);
    messages.push({ role: 'assistant', content: assistantText });
    messages.push({
      role: 'user',
      content:
        `Some of your tool calls had problems and must be fixed. Issues:\n` +
        issues.map((i) => `- ${i}`).join('\n') +
        `\n\nThe workbench currently has these names already in use: ${[...takenNames].join(', ') || '(none)'}.\n` +
        `Re-emit the FULL corrected JSON. Prefer omitting "name" so the workbench picks the next free letter automatically.`,
    });
  }

  return jsonResp({ ok: true, tool_calls: calls });
}

function buildUserContent(contextSummary: string, instruction: string, image: string | undefined): Json {
  const parts: Json[] = [
    {
      type: 'text',
      text:
        `Current workbench:\n${contextSummary}\n\n` +
        `Instruction: ${instruction || '(no text instruction — extract from the image)'}`,
    },
  ];
  if (image) parts.push({ type: 'image_url', image_url: { url: image } });
  return parts;
}

async function callModel(
  apiUrl: string,
  appId: string,
  apiKey: string,
  messages: Array<{ role: string; content: unknown }>
): Promise<string> {
  const resp = await fetch(`${apiUrl}/v1/${appId}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 2000,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${text}`);
  }
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json?.choices?.[0]?.message?.content ?? '';
}

function sanitizeObjects(raw: unknown): WorkbenchObjectLite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => ({
      name: String(o.name ?? ''),
      kind: (o.kind as WorkbenchObjectLite['kind']) ?? 'matrix',
      rows: Number(o.rows) || 1,
      cols: Number(o.cols) || 1,
      orient: (o.orient as WorkbenchObjectLite['orient']) ?? null,
      values: (o.values as Record<string, string>) ?? {},
    }))
    .filter((o) => o.name.length > 0);
}

function summarizeContext(
  objects: WorkbenchObjectLite[],
  code: string | undefined,
  takenNames: Set<string>
): string {
  const lines: string[] = [];
  lines.push(
    `Names already in use (DO NOT REUSE for new objects): ${
      takenNames.size > 0 ? [...takenNames].join(', ') : '(none)'
    }`
  );
  if (objects.length > 0) {
    lines.push('Objects:');
    for (const o of objects) {
      const entries: string[] = [];
      for (let r = 0; r < o.rows; r++) {
        const row: string[] = [];
        for (let c = 0; c < o.cols; c++) row.push(o.values[`${r},${c}`] ?? '0');
        entries.push(`[${row.join(', ')}]`);
      }
      const body =
        o.kind === 'scalar'
          ? o.values['0,0'] ?? '0'
          : o.kind === 'vector'
            ? `(${o.orient}) [${entries.flatMap((r) => r.replace(/[[\]]/g, '').split(', ')).join(', ')}]`
            : entries.join(', ');
      lines.push(`  - ${o.name} (${o.kind} ${o.rows}x${o.cols}) = ${body}`);
    }
  } else {
    lines.push('Objects: (none)');
  }
  if (code) lines.push(`Editor:\n${code}`);
  return lines.join('\n');
}

function validateCalls(calls: ToolCall[], existingTaken: Set<string>): string[] {
  const issues: string[] = [];
  const taken = new Set(existingTaken);
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const at = `tool_calls[${i}] (${c?.tool})`;
    if (!c || typeof c !== 'object' || typeof c.tool !== 'string') {
      issues.push(`${at}: malformed`);
      continue;
    }
    if (c.tool === 'add_matrix' || c.tool === 'add_vector' || c.tool === 'add_scalar') {
      const name = (c.args as { name?: string }).name;
      if (name !== undefined) {
        if (typeof name !== 'string' || !NAME_RE.test(name)) {
          issues.push(`${at}: invalid name "${name}"`);
        } else if (taken.has(name)) {
          issues.push(`${at}: name "${name}" is already in use — pick a fresh letter or omit "name"`);
        } else {
          taken.add(name);
        }
      }
    }
    if (c.tool === 'add_matrix') {
      const { rows, cols, entries } = c.args;
      if (!Number.isInteger(rows) || rows < 1 || rows > 8)
        issues.push(`${at}: rows must be integer in [1,8]`);
      if (!Number.isInteger(cols) || cols < 1 || cols > 8)
        issues.push(`${at}: cols must be integer in [1,8]`);
      if (!Array.isArray(entries) || entries.length !== rows)
        issues.push(`${at}: entries must have ${rows} rows`);
      else if (!entries.every((r) => Array.isArray(r) && r.length === cols))
        issues.push(`${at}: each row must have ${cols} columns`);
    }
    if (c.tool === 'add_vector') {
      const { orient, entries } = c.args;
      if (orient !== 'col' && orient !== 'row') issues.push(`${at}: orient must be col/row`);
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10)
        issues.push(`${at}: entries length must be in [1,10]`);
    }
  }
  return issues;
}

function parseToolCalls(content: string): { ok: true; calls: unknown[] } | { ok: false; error: string } {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `model did not return JSON: ${(e as Error).message}` };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'model JSON not an object' };
  const calls = (obj as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return { ok: false, error: 'tool_calls missing or not an array' };
  return { ok: true, calls };
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
