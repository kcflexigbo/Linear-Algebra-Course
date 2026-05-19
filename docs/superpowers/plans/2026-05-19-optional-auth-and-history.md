# Optional Auth, History & Local Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional magic-link auth, per-user history with AI-generated titles, and refresh-protection localStorage to the Linear Workbench — without changing the anonymous-use experience.

**Architecture:** Public `evaluate` function stays unchanged. Authenticated users hit a new `save_history` function after each successful Evaluate, which inserts a row and kicks off an async AI title generation via `ctx.waitUntil`. Frontend lists/deletes history rows directly via the Butterbase client (gated by RLS) and subscribes to realtime updates for title-fill. A `useLocalWorkbench` hook persists `{objects, code, outputs}` to `localStorage` debounced.

**Tech Stack:** React 19, TypeScript, Vite, Butterbase (Postgres + Auth + Realtime + AI + Serverless Functions), Vitest (new — for unit tests).

**Spec:** `docs/superpowers/specs/2026-05-19-optional-auth-and-history-design.md`

---

## Conventions

- All paths are relative to repo root `/Users/kenneth/Documents/Misc/matrix/`.
- `frontend/` is the Vite app. Run frontend commands from there.
- Butterbase server-side operations (schema, RLS, function deploy, AI) are performed via the `mcp__butterbase__*` MCP tools. The Butterbase app id is `app_02vcbf6ev0vp` ("linalg-workbench"). When in doubt about a specific MCP tool's parameter shape, call `mcp__butterbase__butterbase_docs` or `mcp__butterbase__rag_query` first.
- Commit after every task with a Conventional Commits message.
- Use `WorkbenchObject` (the existing type in `frontend/src/types.ts`) wherever the spec refers to `ObjectDef`.

---

## File Structure

**New files:**

```
functions/
├── save_history.ts                — auth-required; inserts row + waitUntil AI title
└── rename_calculation.ts          — auth-required; updates title + title_source

frontend/src/
├── auth/
│   ├── AuthContext.tsx            — { user, status, signIn, signOut }
│   └── LoginModal.tsx             — magic-link form
├── history/
│   ├── HistoryModal.tsx           — list, rename, delete, clear all, load
│   ├── HistoryEntry.tsx           — single row component
│   └── useHistory.ts              — list + realtime subscription + mutations
├── persistence/
│   └── useLocalWorkbench.ts       — debounced save/restore of workbench state
└── lib/
    └── butterbaseClient.ts        — single shared Butterbase JS client instance

frontend/test/
├── useLocalWorkbench.test.ts
└── setup.ts                        — Vitest setup (jsdom, localStorage mock)

docs/superpowers/plans/
└── 2026-05-19-optional-auth-and-history.md (this file)
```

**Modified files:**

```
frontend/package.json               — add vitest, jsdom, @testing-library/react, butterbase client
frontend/vite.config.ts             — add vitest config
frontend/src/types.ts               — add Calculation, TitleSource
frontend/src/api.ts                 — add saveHistory(), renameCalculation()
frontend/src/hooks/useWorkbench.ts  — add replaceAll(objects)
frontend/src/App.tsx                — providers, header chip, modals, dirty tracking
butterbase.json                     — register save_history, rename_calculation
```

---

## Phase 0: Schema, RLS, and Server-Side Setup

### Task 0.1: Inspect Butterbase auth & AI capabilities

**Files:** none (research only)

- [ ] **Step 1:** Verify the magic-link auth flow and config

Call `mcp__butterbase__butterbase_docs` with a query about "magic link auth setup" and inspect current auth config:

```
mcp__butterbase__manage_auth_config({ app_id: "app_02vcbf6ev0vp", action: "get" })
```

Confirm: magic-link provider is enabled, redirect URL allowlist includes `http://localhost:5173` and `https://linalg-workbench.butterbase.dev`. If not, enable magic link and add both URLs.

- [ ] **Step 2:** Confirm `manage_ai` model availability

```
mcp__butterbase__manage_ai({ app_id: "app_02vcbf6ev0vp", action: "list_models" })
```

Pick the cheapest available chat model (Haiku-class). Note the exact `model_id` — it will be used by `save_history`.

- [ ] **Step 3:** No commit (research only).

---

### Task 0.2: Create the `calculations` table

**Files:** Server-side schema only (no repo file unless `butterbase.json` mirrors schema; if so, also update it).

- [ ] **Step 1:** Create the migration via MCP

```
mcp__butterbase__manage_migrations({
  app_id: "app_02vcbf6ev0vp",
  action: "create",
  name: "create_calculations",
  sql: `
    CREATE TABLE calculations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      title        TEXT,
      title_source TEXT NOT NULL DEFAULT 'pending'
                   CHECK (title_source IN ('pending','ai','user')),
      code         TEXT NOT NULL,
      objects      JSONB NOT NULL,
      outputs      JSONB NOT NULL,
      preview      TEXT NOT NULL
    );
    CREATE INDEX calculations_user_created_idx
      ON calculations (user_id, created_at DESC);
  `
})
```

- [ ] **Step 2:** Apply

```
mcp__butterbase__manage_migrations({ app_id: "app_02vcbf6ev0vp", action: "apply" })
```

- [ ] **Step 3:** Verify the table exists

```
mcp__butterbase__manage_schema({ app_id: "app_02vcbf6ev0vp", action: "describe", table: "calculations" })
```

Expected: shows all 8 columns and the composite index.

- [ ] **Step 4:** Commit any local mirror

If `butterbase.json` or a schema doc is updated locally by the MCP tool, commit:

```bash
git add butterbase.json
git commit -m "feat(schema): add calculations table"
```

If nothing changed locally, skip the commit and note in chat that schema was applied server-side only.

---

### Task 0.3: Add RLS policies on `calculations`

**Files:** Server-side only (or `butterbase.json` mirror).

- [ ] **Step 1:** Enable RLS and add per-user policies

```
mcp__butterbase__manage_rls({
  app_id: "app_02vcbf6ev0vp",
  action: "set",
  table: "calculations",
  enable_rls: true,
  policies: [
    { name: "own_select", command: "SELECT", using: "user_id = auth.uid()" },
    { name: "own_update", command: "UPDATE", using: "user_id = auth.uid()", check: "user_id = auth.uid()" },
    { name: "own_delete", command: "DELETE", using: "user_id = auth.uid()" },
    { name: "own_insert", command: "INSERT", check: "user_id = auth.uid()" }
  ]
})
```

- [ ] **Step 2:** Verify

```
mcp__butterbase__manage_rls({ app_id: "app_02vcbf6ev0vp", action: "get", table: "calculations" })
```

Expected: `enabled: true`, 4 policies listed.

- [ ] **Step 3:** Smoke-test RLS isolation by inserting a row as user A and selecting as user B

Use `mcp__butterbase__manage_auth_users` to create two test users if needed. Insert a row with user A's `auth.uid()`, then `select_rows` as user B and confirm 0 rows returned. Then `select_rows` as user A and confirm 1 row. Delete the test row at the end.

- [ ] **Step 4:** Commit if local mirror updated:

```bash
git add butterbase.json
git commit -m "feat(schema): add RLS policies for calculations"
```

---

## Phase 1: Backend Functions

### Task 1.1: Scaffold `save_history` function

**Files:**
- Create: `functions/save_history.ts`
- Modify: `butterbase.json` (register the function)

- [ ] **Step 1:** Create `functions/save_history.ts` with validation + insert, AI generation stubbed

```typescript
/**
 * Butterbase serverless function: save_history
 *
 * Auth: required (Butterbase injects ctx.user)
 * Body: { code: string, objects: WorkbenchObject[], outputs: SageOutput[] }
 * Returns: { ok: true, id: string, created_at: string, preview: string }
 *       or { ok: false, error: string }
 */

const MAX_CODE = 50_000;
const MAX_OBJECTS_JSON = 50_000;
const MAX_OUTPUTS_JSON = 500_000;

interface SaveHistoryBody {
  code?: unknown;
  objects?: unknown;
  outputs?: unknown;
}

function computePreview(code: string): string {
  const firstMeaningful = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return (firstMeaningful ?? '').slice(0, 80);
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handler(request: Request, ctx: any): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!ctx?.user?.id) {
    return jsonResp({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: SaveHistoryBody;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (typeof body.code !== 'string' || !Array.isArray(body.objects) || !Array.isArray(body.outputs)) {
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

  const inserted = await ctx.db.insert('calculations', {
    user_id: ctx.user.id,
    code: body.code,
    objects: body.objects,
    outputs: body.outputs,
    preview,
    title: null,
    title_source: 'pending',
  });

  // Schedule async title generation. Don't await.
  if (ctx.waitUntil) {
    ctx.waitUntil(generateTitle(ctx, inserted.id, body.code, body.objects, body.outputs));
  }

  return jsonResp({ ok: true, id: inserted.id, created_at: inserted.created_at, preview });
}

async function generateTitle(
  ctx: any,
  id: string,
  code: string,
  objects: any[],
  outputs: any[]
): Promise<void> {
  try {
    const objSummary = objects
      .map((o: any) => `${o.name}: ${o.kind} ${o.kind === 'scalar' ? '' : `${o.rows}x${o.cols}`}`.trim())
      .join('; ');
    const outputText = outputs
      .map((o: any) => {
        if (o.type === 'stream') return o.text;
        if (o.type === 'error') return `${o.ename}: ${o.evalue}`;
        if (o.type === 'display') return o.data?.['text/plain'] ?? '[display]';
        return '';
      })
      .join('\n')
      .slice(0, 1000);

    const prompt = [
      'Generate a short descriptive title (max 8 words, no quotes, no trailing period) for this linear algebra workbench evaluation.',
      `Objects: ${objSummary || 'none'}`,
      `Code:\n${code}`,
      `Output preview:\n${outputText}`,
      'Title:',
    ].join('\n\n');

    const result = await ctx.ai.complete({
      model: '<CHEAP_MODEL_ID_FROM_TASK_0.1>',
      prompt,
      max_tokens: 30,
      temperature: 0.3,
    });

    const title = (result.text ?? '').trim().replace(/^["']|["']$/g, '').slice(0, 200);
    if (!title) return;

    await ctx.db.update('calculations', { id }, { title, title_source: 'ai' });
  } catch (err) {
    console.error('title generation failed', err);
    // Leave title null; frontend falls back to preview.
  }
}
```

> **Note:** Replace `<CHEAP_MODEL_ID_FROM_TASK_0.1>` with the actual model id noted in Task 0.1, Step 2. The exact shape of `ctx.db.insert / update`, `ctx.ai.complete`, and `ctx.waitUntil` may differ — verify against `mcp__butterbase__butterbase_docs` for "function context API" and "ai complete" before deploying. If the actual API uses raw SQL, replace the calls with `ctx.db.query("INSERT INTO calculations ... RETURNING id, created_at", [...])`.

- [ ] **Step 2:** Register in `butterbase.json`

Add to the `functions` array:

```json
{
  "name": "save_history",
  "source": "functions/save_history.ts",
  "url": "https://api.butterbase.ai/v1/app_02vcbf6ev0vp/fn/save_history",
  "trigger": {
    "type": "http",
    "method": "POST",
    "path": "/save_history",
    "auth": "required"
  },
  "timeoutMs": 10000
}
```

- [ ] **Step 3:** Deploy

```
mcp__butterbase__deploy_function({
  app_id: "app_02vcbf6ev0vp",
  name: "save_history",
  source_path: "functions/save_history.ts"
})
```

Expected: success message with the deployed URL.

- [ ] **Step 4:** Commit

```bash
git add functions/save_history.ts butterbase.json
git commit -m "feat(functions): add save_history with async AI title"
```

---

### Task 1.2: Test `save_history` end-to-end

**Files:** none (test via MCP invoke)

- [ ] **Step 1:** Get an auth token for a test user

```
mcp__butterbase__manage_auth_users({ app_id: "app_02vcbf6ev0vp", action: "create_session", email: "test@example.com" })
```

Note the returned access token.

- [ ] **Step 2:** Invoke with a valid payload

```
mcp__butterbase__invoke_function({
  app_id: "app_02vcbf6ev0vp",
  name: "save_history",
  method: "POST",
  headers: { "Authorization": "Bearer <TOKEN>" },
  body: {
    code: "show(A.rref())",
    objects: [{ id: 0, kind: "matrix", name: "A", rows: 2, cols: 2, orient: null, values: { "0,0": "1", "0,1": "2", "1,0": "3", "1,1": "4" } }],
    outputs: [{ type: "stream", name: "stdout", text: "[1 0]\n[0 1]" }]
  }
})
```

Expected: `{ ok: true, id: "...", created_at: "...", preview: "show(A.rref())" }`.

- [ ] **Step 3:** After ~3 seconds, verify the title was filled in

```
mcp__butterbase__select_rows({
  app_id: "app_02vcbf6ev0vp",
  table: "calculations",
  filter: { id: "<ID_FROM_STEP_2>" }
})
```

Expected: `title` is a non-null short string, `title_source` is `'ai'`.

- [ ] **Step 4:** Invoke unauthorized (no token)

Same call without `Authorization` header. Expected: `401 Unauthorized`.

- [ ] **Step 5:** Invoke with oversized payload (1 MB of outputs)

Expected: `413` with `error: 'outputs too large'`.

- [ ] **Step 6:** Delete the test row

```
mcp__butterbase__select_rows({ ... })  # or a delete call
```

- [ ] **Step 7:** No commit (testing only).

---

### Task 1.3: Add `rename_calculation` function

**Files:**
- Create: `functions/rename_calculation.ts`
- Modify: `butterbase.json`

- [ ] **Step 1:** Create `functions/rename_calculation.ts`

```typescript
/**
 * Butterbase serverless function: rename_calculation
 * Auth: required
 * Body: { id: string, title: string }
 * Returns: { ok: true } or { ok: false, error: string }
 */

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handler(request: Request, ctx: any): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!ctx?.user?.id) {
    return jsonResp({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: { id?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (typeof body.id !== 'string' || typeof body.title !== 'string') {
    return jsonResp({ ok: false, error: 'Invalid payload' }, 400);
  }
  const title = body.title.trim();
  if (!title || title.length > 200) {
    return jsonResp({ ok: false, error: 'Title must be 1-200 chars' }, 400);
  }

  // RLS enforces ownership.
  const updated = await ctx.db.update(
    'calculations',
    { id: body.id, user_id: ctx.user.id },
    { title, title_source: 'user' }
  );

  if (!updated || updated.length === 0) {
    return jsonResp({ ok: false, error: 'Not found' }, 404);
  }

  return jsonResp({ ok: true });
}
```

- [ ] **Step 2:** Register in `butterbase.json`

```json
{
  "name": "rename_calculation",
  "source": "functions/rename_calculation.ts",
  "url": "https://api.butterbase.ai/v1/app_02vcbf6ev0vp/fn/rename_calculation",
  "trigger": {
    "type": "http",
    "method": "POST",
    "path": "/rename_calculation",
    "auth": "required"
  },
  "timeoutMs": 5000
}
```

- [ ] **Step 3:** Deploy

```
mcp__butterbase__deploy_function({
  app_id: "app_02vcbf6ev0vp",
  name: "rename_calculation",
  source_path: "functions/rename_calculation.ts"
})
```

- [ ] **Step 4:** Test rename + cross-user denial

Using the row created in Task 1.2 (recreate if deleted), call `rename_calculation` as the owning user — expect `200 ok`. Call as a different test user with the same id — expect `404 Not found` (RLS hides the row). Verify `title_source` is `'user'` after success.

- [ ] **Step 5:** Commit

```bash
git add functions/rename_calculation.ts butterbase.json
git commit -m "feat(functions): add rename_calculation"
```

---

## Phase 2: Frontend Tooling Setup

### Task 2.1: Add Vitest + Testing Library

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/test/setup.ts`
- Create: `frontend/test/sanity.test.ts`

- [ ] **Step 1:** Install dev deps

```bash
cd frontend && npm install --save-dev vitest@^2 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2:** Update `frontend/vite.config.ts` to include vitest config

Replace the file content with the existing config plus a `test` block. If the file currently looks like:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
```

Change to:

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3:** Create `frontend/test/setup.ts`

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4:** Add a `test` script to `frontend/package.json`

In the `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5:** Sanity test

Create `frontend/test/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6:** Run

```bash
cd frontend && npm test
```

Expected: 1 test passes.

- [ ] **Step 7:** Commit

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/test/setup.ts frontend/test/sanity.test.ts
git commit -m "chore(frontend): add vitest + testing-library"
```

---

### Task 2.2: Add Butterbase JS client

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/butterbaseClient.ts`

- [ ] **Step 1:** Install client

```bash
cd frontend && npm install @butterbase/client
```

(If the exact package name differs, look it up via `mcp__butterbase__butterbase_docs` query "frontend client install". Adjust the import accordingly in step 2.)

- [ ] **Step 2:** Create `frontend/src/lib/butterbaseClient.ts`

```typescript
import { createClient } from '@butterbase/client';

const API_URL =
  import.meta.env.VITE_BUTTERBASE_API_URL ??
  'https://api.butterbase.ai/v1/app_02vcbf6ev0vp';

const ANON_KEY = import.meta.env.VITE_BUTTERBASE_ANON_KEY ?? '';

export const bb = createClient({
  url: API_URL,
  anonKey: ANON_KEY,
});
```

- [ ] **Step 3:** Set the env vars

Create `frontend/.env.local` (gitignored — verify with `cat frontend/.gitignore | grep env`; if not gitignored, add `.env.local` to it):

```
VITE_BUTTERBASE_API_URL=https://api.butterbase.ai/v1/app_02vcbf6ev0vp
VITE_BUTTERBASE_ANON_KEY=<get_from_mcp__butterbase__manage_api_keys>
```

Use `mcp__butterbase__manage_api_keys({ app_id: "app_02vcbf6ev0vp", action: "list" })` and copy the anon key.

- [ ] **Step 4:** Commit (env file excluded)

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/butterbaseClient.ts
git commit -m "chore(frontend): add butterbase client"
```

---

## Phase 3: Local Persistence (TDD)

### Task 3.1: `useLocalWorkbench` hook — write the tests

**Files:**
- Create: `frontend/test/useLocalWorkbench.test.ts`

- [ ] **Step 1:** Write the failing test

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalWorkbench, LOCAL_KEY } from '../src/persistence/useLocalWorkbench';
import type { WorkbenchObject, SageOutput } from '../src/types';

const sampleObjects: WorkbenchObject[] = [
  { id: 0, kind: 'matrix', name: 'A', rows: 2, cols: 2, orient: null, values: { '0,0': '1' } },
];
const sampleOutputs: SageOutput[] = [{ type: 'stream', name: 'stdout', text: 'hi' }];

describe('useLocalWorkbench', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on first load when storage is empty', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    expect(result.current.restore()).toBeNull();
  });

  it('persists state debounced and restores it', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    act(() => {
      result.current.save({ objects: sampleObjects, code: 'A.rref()', outputs: null });
    });
    // Before debounce window
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.objects).toEqual(sampleObjects);
    expect(stored.code).toBe('A.rref()');
    expect(stored.outputs).toBeNull();

    const { result: r2 } = renderHook(() => useLocalWorkbench());
    expect(r2.current.restore()).toMatchObject({
      objects: sampleObjects,
      code: 'A.rref()',
      outputs: null,
    });
  });

  it('saveImmediate bypasses the debounce', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    act(() => {
      result.current.saveImmediate({ objects: sampleObjects, code: 'x', outputs: sampleOutputs });
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.outputs).toEqual(sampleOutputs);
  });

  it('drops outputs and retries on quota exceeded', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    const big: SageOutput[] = [{ type: 'stream', name: 'stdout', text: 'x'.repeat(10) }];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let call = 0;
    setItem.mockImplementation((k, v) => {
      call += 1;
      if (call === 1) {
        const e = new Error('quota');
        (e as any).name = 'QuotaExceededError';
        throw e;
      }
      // Real second call: write to the underlying store.
      Object.getPrototypeOf(localStorage).setItem.call(localStorage, k, v);
    });
    act(() => {
      result.current.saveImmediate({ objects: sampleObjects, code: 'x', outputs: big });
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.outputs).toBeNull();
    setItem.mockRestore();
  });

  it('returns null and recovers on corrupted JSON', () => {
    localStorage.setItem(LOCAL_KEY, 'not json {{');
    const { result } = renderHook(() => useLocalWorkbench());
    expect(result.current.restore()).toBeNull();
  });
});
```

- [ ] **Step 2:** Run the test, confirm it fails

```bash
cd frontend && npm test -- useLocalWorkbench
```

Expected: failure — module not found.

- [ ] **Step 3:** Commit the failing test

```bash
git add frontend/test/useLocalWorkbench.test.ts
git commit -m "test(persistence): failing tests for useLocalWorkbench"
```

---

### Task 3.2: Implement `useLocalWorkbench`

**Files:**
- Create: `frontend/src/persistence/useLocalWorkbench.ts`

- [ ] **Step 1:** Implement the hook

```typescript
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
  return err instanceof Error && (err.name === 'QuotaExceededError' || /quota/i.test(err.message));
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
      if (!parsed || !Array.isArray(parsed.objects) || typeof parsed.code !== 'string') return null;
      return parsed as WorkbenchSnapshot;
    } catch {
      return null;
    }
  }

  return { save, saveImmediate, restore };
}
```

- [ ] **Step 2:** Run the tests

```bash
cd frontend && npm test -- useLocalWorkbench
```

Expected: all 5 tests pass.

- [ ] **Step 3:** Commit

```bash
git add frontend/src/persistence/useLocalWorkbench.ts
git commit -m "feat(persistence): implement useLocalWorkbench hook"
```

---

### Task 3.3: Wire `useLocalWorkbench` into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useWorkbench.ts` (add `replaceAll`)

- [ ] **Step 1:** Add `replaceAll` to `useWorkbench`

In `frontend/src/hooks/useWorkbench.ts`, just before the `initExample` definition, add:

```typescript
const replaceAll = useCallback((next: WorkbenchObject[]) => {
  usedNames.current = new Set(next.map((o) => o.name));
  nextId.current = next.reduce((m, o) => Math.max(m, o.id + 1), 0);
  setObjects(next);
}, []);
```

And add `replaceAll` to the returned object:

```typescript
return {
  objects,
  addObject,
  removeObject,
  duplicateObject,
  updateName,
  updateDim,
  updateVectorLen,
  updateVectorOrient,
  updateCell,
  updateScalar,
  initExample,
  replaceAll,
};
```

- [ ] **Step 2:** Integrate persistence in `App.tsx`

Change the imports at the top of `frontend/src/App.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { useWorkbench, buildPreamble } from './hooks/useWorkbench';
import { useLocalWorkbench } from './persistence/useLocalWorkbench';
import { ObjectCard } from './components/ObjectCard';
import { SnippetBar } from './components/SnippetBar';
import { OutputPanel } from './components/OutputPanel';
import { runOnSage } from './api';
import type { ObjKind, SageOutput } from './types';
import 'katex/dist/katex.min.css';
```

Replace the body of the `useEffect` mount block and the state declarations:

```typescript
const wb = useWorkbench();
const persist = useLocalWorkbench();
const [code, setCode] = useState('show(A.rref())');
const [showPreamble, setShowPreamble] = useState(false);
const [loading, setLoading] = useState(false);
const [outputs, setOutputs] = useState<SageOutput[] | null>(null);
const [evalError, setEvalError] = useState<string | null>(null);
const codeRef = useRef<HTMLTextAreaElement>(null);

useEffect(() => {
  const snap = persist.restore();
  if (snap) {
    wb.replaceAll(snap.objects);
    setCode(snap.code);
    setOutputs(snap.outputs ?? null);
  } else {
    wb.initExample();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Debounced write on edits.
useEffect(() => {
  persist.save({ objects: wb.objects, code, outputs });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [wb.objects, code]);
```

In the `runCode` function, after `setOutputs(outs);` add an immediate write:

```typescript
const outs = await runOnSage(full);
setOutputs(outs);
persist.saveImmediate({ objects: wb.objects, code, outputs: outs });
```

- [ ] **Step 3:** Manual smoke

```bash
cd frontend && npm run dev
```

In a browser, open the app, add a matrix, type some code, click Evaluate. Reload the page — same state should be restored (objects + code + output). Open DevTools → Application → Local Storage and confirm key `linalg-workbench:v1` exists.

Document the result in the commit message (pass/fail).

- [ ] **Step 4:** Commit

```bash
git add frontend/src/hooks/useWorkbench.ts frontend/src/App.tsx
git commit -m "feat(persistence): restore workbench from localStorage on load"
```

---

## Phase 4: Auth

### Task 4.1: `AuthContext`

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`

- [ ] **Step 1:** Implement

```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { bb } from '../lib/butterbaseClient';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let mounted = true;
    bb.auth.getSession().then((session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email });
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
      }
    });
    const sub = bb.auth.onAuthStateChange((session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email });
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    });
    return () => {
      mounted = false;
      sub?.unsubscribe?.();
    };
  }, []);

  async function signIn(email: string) {
    await bb.auth.signInWithMagicLink({
      email,
      redirectTo: window.location.origin,
    });
  }

  async function signOut() {
    await bb.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

> **Note:** If the actual Butterbase client API differs (e.g. `bb.auth.signIn({ email, type: 'magic_link' })` instead of `signInWithMagicLink`), adapt. Verify with `mcp__butterbase__butterbase_docs` query "client auth magic link" before deploying.

- [ ] **Step 2:** Commit

```bash
git add frontend/src/auth/AuthContext.tsx
git commit -m "feat(auth): add AuthContext with magic-link sign-in"
```

---

### Task 4.2: `LoginModal`

**Files:**
- Create: `frontend/src/auth/LoginModal.tsx`

- [ ] **Step 1:** Implement

```typescript
import { useState } from 'react';
import { useAuth } from './AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: Props) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<'enter' | 'sent' | 'error'>('enter');
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await signIn(email.trim());
      setStage('sent');
    } catch (e) {
      setErr((e as Error).message);
      setStage('error');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sign in</h2>
        {stage === 'sent' ? (
          <p>Check your email — we sent a sign-in link to <strong>{email}</strong>.</p>
        ) : (
          <form onSubmit={submit}>
            <p>Enter your email — we'll send you a one-tap sign-in link.</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit">Send link</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Add minimal CSS for `.modal-overlay`, `.modal`, `.modal-actions`, `.error` to `frontend/src/index.css`

Append:

```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--paper, #fff);
  padding: 24px;
  border-radius: 4px;
  max-width: 480px;
  width: 90%;
  max-height: 80vh;
  overflow: auto;
  font-family: inherit;
}
.modal h2 { margin-top: 0; }
.modal input[type="email"], .modal input[type="text"] {
  width: 100%; padding: 8px; font-size: 16px; box-sizing: border-box;
}
.modal-actions {
  display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;
}
.modal .error { color: #b00; }
```

- [ ] **Step 3:** Commit

```bash
git add frontend/src/auth/LoginModal.tsx frontend/src/index.css
git commit -m "feat(auth): add LoginModal"
```

---

### Task 4.3: Wire Auth into `App.tsx` header

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1:** Wrap app in `AuthProvider`

Edit `frontend/src/main.tsx`. Wrap `<App />` in `<AuthProvider>`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
```

(Adapt the existing imports if `main.tsx` differs — read it first.)

- [ ] **Step 2:** Add header chip + Sign-in button to `App.tsx`

Import:

```typescript
import { useAuth } from './auth/AuthContext';
import { LoginModal } from './auth/LoginModal';
```

Add state inside `App()`:

```typescript
const auth = useAuth();
const [loginOpen, setLoginOpen] = useState(false);
```

In the `<header>` block, after the existing `<span className="vol">` line, add an account chip:

```tsx
<span className="vol">Vol. I · No. 1</span>
<span className="account">
  {auth.status === 'authenticated' && auth.user ? (
    <>
      <span className="account-email">{auth.user.email}</span>
      <button className="account-btn" onClick={() => auth.signOut()}>Sign out</button>
    </>
  ) : (
    <button className="account-btn" onClick={() => setLoginOpen(true)}>Sign in</button>
  )}
</span>
```

At the end of the `<div className="wrap">` block (after `</footer>`), mount the modal:

```tsx
<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
```

Add CSS to `index.css`:

```css
.account { display: inline-flex; gap: 8px; align-items: center; margin-left: 16px; font-size: 14px; }
.account-btn { font-family: inherit; cursor: pointer; }
.account-email { color: var(--ink-soft); }
```

- [ ] **Step 3:** Manual smoke

Run `npm run dev`. Click "Sign in". Enter a test email. Confirm "Check your email" state appears. (Don't need to actually click the link in this task — that's tested in Task 6.)

- [ ] **Step 4:** Commit

```bash
git add frontend/src/main.tsx frontend/src/App.tsx frontend/src/index.css
git commit -m "feat(auth): add header sign-in/out chip + LoginModal mount"
```

---

## Phase 5: History

### Task 5.1: Add `saveHistory` + `renameCalculation` to `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1:** Extend `types.ts`

Append:

```typescript
export type TitleSource = 'pending' | 'ai' | 'user';

export interface Calculation {
  id: string;
  user_id: string;
  created_at: string;
  title: string | null;
  title_source: TitleSource;
  code: string;
  objects: WorkbenchObject[];
  outputs: SageOutput[];
  preview: string;
}
```

- [ ] **Step 2:** Extend `api.ts`

Add at the bottom (and update imports):

```typescript
import { bb } from './lib/butterbaseClient';
import type { SageOutput, WorkbenchObject } from './types';

const API_BASE =
  import.meta.env.VITE_BUTTERBASE_API_URL ??
  'https://api.butterbase.ai/v1/app_02vcbf6ev0vp';

async function authFetch(path: string, body: unknown): Promise<unknown> {
  const session = await bb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');
  const resp = await fetch(`${API_BASE}/fn${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (data as any).ok === false) {
    throw new Error((data as any).error ?? `request failed: ${resp.status}`);
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
```

- [ ] **Step 3:** Commit

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(api): add saveHistory + renameCalculation client calls"
```

---

### Task 5.2: Fire `saveHistory` on Evaluate (logged-in only)

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1:** Update `runCode` to fire save and track `lastEvaluatedState`

Add a new state in `App()`:

```typescript
const [lastEvaluatedState, setLastEvaluatedState] = useState<{
  objects: WorkbenchObject[];
  code: string;
} | null>(null);
```

Update `runCode` after `setOutputs(outs);`:

```typescript
setOutputs(outs);
persist.saveImmediate({ objects: wb.objects, code, outputs: outs });
setLastEvaluatedState({ objects: wb.objects, code });

if (auth.status === 'authenticated') {
  saveHistory({ code, objects: wb.objects, outputs: outs }).catch((err) => {
    console.warn('saveHistory failed', err);
    // Non-blocking; surface as console warn only for now.
  });
}
```

Import:

```typescript
import { saveHistory } from './api';
import type { WorkbenchObject } from './types';
```

- [ ] **Step 2:** Manual smoke

Sign in (use the actual magic link in your email — open in same tab to keep session). Evaluate something. Verify via MCP:

```
mcp__butterbase__select_rows({ app_id: "app_02vcbf6ev0vp", table: "calculations", filter: { user_id: "<YOUR_USER_ID>" }, order_by: "created_at desc", limit: 1 })
```

Expected: row exists with your code; `title` may still be null at first, then non-null after ~3s.

- [ ] **Step 3:** Commit

```bash
git add frontend/src/App.tsx
git commit -m "feat(history): save to history on Evaluate when authenticated"
```

---

### Task 5.3: `useHistory` hook

**Files:**
- Create: `frontend/src/history/useHistory.ts`

- [ ] **Step 1:** Implement

```typescript
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
    try {
      const { data, error } = await bb
        .from('calculations')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setEntries((data as Calculation[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      return;
    }
    fetchAll();
    const channel = bb
      .channel('calculations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calculations' },
        (payload: any) => {
          setEntries((prev) => {
            if (payload.eventType === 'INSERT') {
              return [payload.new as Calculation, ...prev];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((e) =>
                e.id === payload.new.id ? (payload.new as Calculation) : e
              );
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter((e) => e.id !== payload.old.id);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => {
      bb.removeChannel(channel);
    };
  }, [enabled, fetchAll]);

  async function deleteEntry(id: string) {
    const { error } = await bb.from('calculations').delete().eq('id', id);
    if (error) throw new Error(error.message);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function clearAll() {
    const session = await bb.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error('Not authenticated');
    const { error } = await bb.from('calculations').delete().eq('user_id', uid);
    if (error) throw new Error(error.message);
    setEntries([]);
  }

  async function rename(id: string, title: string) {
    await renameCalculation(id, title);
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, title, title_source: 'user' } : e))
    );
  }

  return { entries, loading, error, deleteEntry, clearAll, rename, refetch: fetchAll };
}
```

> **Note:** The exact realtime channel/subscribe syntax depends on the Butterbase client version. If `bb.channel(...).on('postgres_changes', ...)` differs, query `mcp__butterbase__butterbase_docs` for "realtime postgres_changes client" and adapt. Behavior must equal: on INSERT/UPDATE/DELETE of any `calculations` row visible to the current user (RLS-filtered), update local state.

- [ ] **Step 2:** Commit

```bash
git add frontend/src/history/useHistory.ts
git commit -m "feat(history): add useHistory hook with realtime subscription"
```

---

### Task 5.4: `HistoryEntry` component

**Files:**
- Create: `frontend/src/history/HistoryEntry.tsx`

- [ ] **Step 1:** Implement

```typescript
import { useState } from 'react';
import type { Calculation } from '../types';

interface Props {
  entry: Calculation;
  onLoad: (entry: Calculation) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function HistoryEntry({ entry, onLoad, onDelete, onRename }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const displayTitle =
    entry.title && entry.title.length > 0 ? entry.title : entry.preview || '(empty)';
  const isPlaceholder = !entry.title;

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    await onRename(entry.id, t);
    setRenaming(false);
  }

  return (
    <li className="history-entry">
      {renaming ? (
        <form onSubmit={submitRename} className="history-rename-form">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            maxLength={200}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <button
            className="history-entry-load"
            onClick={() => onLoad(entry)}
            title="Load this calculation"
          >
            <span className={isPlaceholder ? 'history-title-placeholder' : 'history-title'}>
              {displayTitle}
            </span>
            <span className="history-meta">
              {entry.objects.map((o) => o.name).join(', ') || '(no objects)'} ·{' '}
              {relativeTime(entry.created_at)}
            </span>
          </button>
          <span className="history-actions">
            <button
              onClick={() => {
                setDraft(entry.title ?? entry.preview ?? '');
                setRenaming(true);
              }}
              title="Rename"
            >
              ✎
            </button>
            <button onClick={() => onDelete(entry.id)} title="Delete">×</button>
          </span>
        </>
      )}
    </li>
  );
}
```

- [ ] **Step 2:** Add CSS to `frontend/src/index.css`

```css
.history-list { list-style: none; padding: 0; margin: 0; }
.history-entry {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 4px; border-bottom: 1px solid var(--rule, #ddd);
}
.history-entry-load {
  flex: 1; text-align: left; background: none; border: none;
  cursor: pointer; padding: 4px 0; font-family: inherit;
  display: flex; flex-direction: column; gap: 2px;
}
.history-title { font-weight: 500; }
.history-title-placeholder { font-weight: 500; color: var(--ink-soft, #777); font-style: italic; }
.history-meta { font-size: 12px; color: var(--ink-soft, #777); }
.history-actions { display: inline-flex; gap: 4px; }
.history-actions button { background: none; border: 1px solid transparent; cursor: pointer; padding: 2px 6px; }
.history-actions button:hover { border-color: var(--rule, #ddd); }
.history-rename-form { flex: 1; display: flex; gap: 4px; }
.history-rename-form input { flex: 1; padding: 4px; }
```

- [ ] **Step 3:** Commit

```bash
git add frontend/src/history/HistoryEntry.tsx frontend/src/index.css
git commit -m "feat(history): add HistoryEntry component"
```

---

### Task 5.5: `HistoryModal`

**Files:**
- Create: `frontend/src/history/HistoryModal.tsx`

- [ ] **Step 1:** Implement

```typescript
import { useState } from 'react';
import { useHistory } from './useHistory';
import { HistoryEntry } from './HistoryEntry';
import type { Calculation } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (entry: Calculation) => void;
}

export function HistoryModal({ open, onClose, onLoad }: Props) {
  const history = useHistory(open);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!open) return null;

  async function handleClear() {
    try {
      await history.clearAll();
      setConfirmClear(false);
    } catch (e) {
      console.warn('clearAll failed', e);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>History</h2>
          <div>
            {history.entries.length > 0 && !confirmClear && (
              <button onClick={() => setConfirmClear(true)}>Clear all</button>
            )}
            {confirmClear && (
              <>
                <span>Delete all entries?</span>
                <button onClick={handleClear}>Yes</button>
                <button onClick={() => setConfirmClear(false)}>No</button>
              </>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        {history.loading && <p>Loading…</p>}
        {history.error && <p className="error">{history.error}</p>}
        {!history.loading && history.entries.length === 0 && (
          <p>No history yet. Run an evaluation to populate this list.</p>
        )}
        <ul className="history-list">
          {history.entries.map((e) => (
            <HistoryEntry
              key={e.id}
              entry={e}
              onLoad={onLoad}
              onDelete={history.deleteEntry}
              onRename={history.rename}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Add CSS

Append to `frontend/src/index.css`:

```css
.modal-history { max-width: 640px; width: 90%; }
.modal-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; gap: 8px; }
.modal-header > div { display: flex; gap: 6px; align-items: center; font-size: 14px; }
```

- [ ] **Step 3:** Commit

```bash
git add frontend/src/history/HistoryModal.tsx frontend/src/index.css
git commit -m "feat(history): add HistoryModal with list/clear-all"
```

---

### Task 5.6: Mount `HistoryModal` and wire load-from-history with dirty check

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1:** Add a History button in the header (visible when authenticated)

In the header, after `<span className="account">…</span>`, add a History button (or inside the account span — your call). Add state:

```typescript
const [historyOpen, setHistoryOpen] = useState(false);
```

And in the header (right next to the account chip), only for authenticated users:

```tsx
{auth.status === 'authenticated' && (
  <button className="account-btn" onClick={() => setHistoryOpen(true)}>History</button>
)}
```

- [ ] **Step 2:** Define `loadEntry` with dirty-check

Inside `App()`:

```typescript
function isDirtySinceEvaluated(): boolean {
  if (!lastEvaluatedState) {
    // No Evaluate yet this session; consider current state un-saved-but-not-dirty
    // only if it matches initExample / restored snap. Easier rule: if any code or
    // objects are present and there's no lastEvaluatedState, treat as dirty.
    return code.trim().length > 0 || wb.objects.length > 0;
  }
  return (
    JSON.stringify(lastEvaluatedState.objects) !== JSON.stringify(wb.objects) ||
    lastEvaluatedState.code !== code
  );
}

function loadEntry(entry: Calculation) {
  if (isDirtySinceEvaluated()) {
    const ok = window.confirm('Discard current edits and load this entry?');
    if (!ok) return;
  }
  wb.replaceAll(entry.objects);
  setCode(entry.code);
  setOutputs(entry.outputs);
  setLastEvaluatedState({ objects: entry.objects, code: entry.code });
  persist.saveImmediate({ objects: entry.objects, code: entry.code, outputs: entry.outputs });
  setHistoryOpen(false);
}
```

Import `Calculation`:

```typescript
import type { ObjKind, SageOutput, WorkbenchObject, Calculation } from './types';
```

- [ ] **Step 3:** Mount the modal

After `<LoginModal ... />` add:

```tsx
<HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} onLoad={loadEntry} />
```

Import:

```typescript
import { HistoryModal } from './history/HistoryModal';
```

- [ ] **Step 4:** Manual smoke (logged in)

- Evaluate twice with different code → two entries appear in modal.
- Click an entry → workbench replaces, output shows.
- Edit code, click another entry → confirm prompt appears.
- Rename an entry → title updates immediately.
- Delete an entry → removed from list.
- Clear all → list emptied.
- Watch a freshly Evaluated entry: title initially shows as preview (italic), then within a few seconds updates to the AI title without a refresh (realtime).

- [ ] **Step 5:** Commit

```bash
git add frontend/src/App.tsx
git commit -m "feat(history): mount HistoryModal and load-from-history with dirty check"
```

---

## Phase 6: End-to-End Smoke

### Task 6.1: Full manual QA pass

**Files:** none (testing only)

- [ ] **Step 1:** Anonymous flow regression

Sign out (or use an incognito window). Add a matrix, type some code, Evaluate. Confirm output appears. Reload. Confirm exact same state restored (objects + code + output) from `localStorage`. Confirm no History button is visible. Confirm no requests to `/save_history` in DevTools Network panel.

- [ ] **Step 2:** Sign-in flow

Click Sign in → enter email → submit → "Check your email" shows → click magic link in email → returns to app → header shows email + Sign out + History.

- [ ] **Step 3:** History creation + AI title

Evaluate. Open History modal. Newest entry exists with `preview` shown italicized. Wait ≤ 5 seconds. Title updates live to an AI-generated phrase.

- [ ] **Step 4:** Rename

Click ✎ on an entry → input appears with current title → change → Save → title persists; reopen modal → still there.

- [ ] **Step 5:** Load + dirty check

Make uncommitted edits. Click a different history entry. Confirm prompt appears. Cancel → workbench unchanged. Click again, proceed → workbench replaced.

- [ ] **Step 6:** Delete + clear all

Delete one entry → disappears. "Clear all" → confirm prompt → Yes → list empties.

- [ ] **Step 7:** Sign-out preserves workbench

Sign out. Confirm header reverts to "Sign in". Confirm current workbench state (objects, code, output) is unchanged. Reload. Same state.

- [ ] **Step 8:** Cross-account isolation

Sign in as user A, Evaluate. Sign out. Sign in as user B (different email). Open History → empty. Evaluate as B. History shows only B's entry.

- [ ] **Step 9:** AI failure graceful path

Temporarily break the model id in `save_history.ts` (change to bogus value, redeploy). Evaluate. Confirm row inserts and entry appears in modal with the preview as the title (italic). Restore the model id and redeploy.

- [ ] **Step 10:** Commit a one-line QA log

Create `docs/superpowers/plans/2026-05-19-qa-log.md` summarizing pass/fail per step.

```bash
git add docs/superpowers/plans/2026-05-19-qa-log.md
git commit -m "docs: QA log for optional-auth-and-history"
```

---

## Self-Review Notes

- **Spec coverage:** every decision in the Decision Summary table maps to a task above (auth → 4.x, history entry → 1.1, AI title → 1.1, modal → 5.5, no cap → 5.5 clear-all, localStorage → 3.x, login mid-session → 5.2 (we only fire save on Evaluate so no retroactive saves), load with dirty check → 5.6, backend split → 1.x).
- **Type consistency:** `WorkbenchObject` used everywhere (not `ObjectDef`). `Calculation`, `TitleSource` defined in 5.1 and consumed thereafter. `replaceAll(objects)` defined in 3.3 and called in 5.6.
- **Known unknowns flagged for engineer:** exact shape of `ctx.db / ctx.ai / ctx.waitUntil` (Task 1.1 note), exact Butterbase client import path (2.2 step 1), exact `auth.signInWithMagicLink` API (4.1 note), exact realtime channel API (5.3 note). All have a fallback instruction: query `mcp__butterbase__butterbase_docs` and adapt while preserving behavior.

