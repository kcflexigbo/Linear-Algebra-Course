# Optional Auth, History, and Local Persistence — Design

**Date:** 2026-05-19
**App:** linalg-workbench (Butterbase app_02vcbf6ev0vp)

## Goal

Make the Linear Workbench usable anonymously *and* better for returning users:

1. **Anonymous users** can perform calculations exactly as today — no friction added.
2. **All users** get refresh-protection: the last workbench state (objects, code, outputs) is persisted to `localStorage` and restored on reload.
3. **Logged-in users** get a history of every evaluation, browsable, loadable, renamable, deletable.
4. **Login is optional and frictionless** — magic-link only.

## Non-goals

- Multi-user sharing or collaboration.
- Workspaces / projects / folders for history.
- Server-side persistence for anonymous users.
- Cross-device sync of the unsaved workbench state (localStorage is per-browser by design).
- Pinning / favoriting history entries.

## Decision Summary

| Topic | Decision |
|---|---|
| Auth | Optional, magic-link only via Butterbase |
| Anonymous use | Full compute via existing `evaluate`; no history |
| History entry | Full snapshot: `objects` + `code` + `outputs`; auto-saved on every successful Evaluate |
| Title | AI-generated asynchronously by cheap model; sees code + objects + outputs; fallback to code preview; user-renamable |
| History UI | Modal opened from header (logged-in only) |
| Size limit | None; per-entry delete + "Clear all" |
| localStorage | `{ objects, code, outputs }`; debounced on edits, written on Evaluate success |
| Login mid-session | No retroactive save; first history entry comes from next Evaluate |
| Load from history | Replace current workbench; confirm if there are un-Evaluated edits |
| Backend split | `evaluate` (auth: none, unchanged) + new `save_history` (auth: required) + new `rename_calculation` |
| History list / delete | Direct Butterbase client calls with RLS |
| Title-fill in modal | Butterbase realtime subscription on `calculations` filtered to current user |

## Data Model

### `calculations` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key |
| `user_id` | uuid | fk → auth.users, indexed |
| `created_at` | timestamptz | default `now()`, indexed desc |
| `title` | text, nullable | AI-generated; `null` = still generating or failed |
| `title_source` | text | `'pending'` \| `'ai'` \| `'user'`, default `'pending'` |
| `code` | text, not null | Sage code as entered |
| `objects` | jsonb, not null | array of `ObjectDef` from `frontend/src/types.ts` |
| `outputs` | jsonb, not null | `SageOutput[]` from `frontend/src/types.ts` |
| `preview` | text | First non-comment, non-blank line of `code`, truncated to ~80 chars — fallback display when `title` is null |

**Indexes:** `(user_id, created_at desc)` — the only read pattern is "my history, newest first".

### Row-Level Security

- `SELECT`, `UPDATE`, `DELETE`: `user_id = auth.uid()`
- `INSERT`: `user_id = auth.uid()` (in practice writes go through `save_history`, which sets `user_id` from the authenticated request)

No modifications to Butterbase's `auth.users` table — we just reference `auth.uid()`.

## Backend Functions

### `evaluate` — existing, unchanged

`auth: "none"`. Sage proxy only. Both anonymous and authenticated users call this directly. After a successful response, the frontend (only if authenticated) fires a separate `save_history` call.

### `save_history` — new

- **Trigger:** HTTP POST `/save_history`, `auth: "required"`
- **Body:** `{ code: string, objects: ObjectDef[], outputs: SageOutput[] }`
- **Validation:** reject payloads exceeding caps (outputs ≤ 500 KB, objects ≤ 50 KB, code ≤ 50 KB). Return 413 with a clear error.
- **Logic:**
  1. Compute `preview` = first non-comment, non-blank line of `code`, truncated to 80 chars.
  2. Insert row with `user_id = ctx.user.id`, `title = null`, `title_source = 'pending'`.
  3. Schedule AI title generation via `ctx.waitUntil` (do not await).
  4. Return `{ id, created_at, preview }` to the caller immediately.
- **Background AI title job (same function, via `waitUntil`):**
  - Build prompt: full `code`, a summary of `objects` (name, kind, dimensions), and a truncated text rendering of `outputs`.
  - Call `manage_ai` with a cheap model (Haiku-class), `max_tokens ≈ 30`, low temperature.
  - On success: `UPDATE calculations SET title = ?, title_source = 'ai' WHERE id = ?`
  - On failure (any reason): leave `title = null`. No retries.

### `rename_calculation` — new

- **Trigger:** HTTP POST `/rename_calculation`, `auth: "required"`
- **Body:** `{ id: string, title: string }` (title trimmed; reject empty or > 200 chars)
- **Logic:** `UPDATE calculations SET title = ?, title_source = 'user' WHERE id = ?` — RLS enforces ownership.

### Direct DB access for reads/deletes

History list, per-entry delete, and "Clear all" use the Butterbase client from the frontend, gated by RLS. No additional functions needed.

## Frontend Architecture

### New modules

```
frontend/src/
├── auth/
│   ├── AuthContext.tsx       — provides { user, signIn, signOut, status }
│   └── LoginModal.tsx        — magic-link form + "check your email" state
├── history/
│   ├── HistoryModal.tsx      — list, load, rename, delete, clear all
│   ├── HistoryEntry.tsx      — one row in the list
│   └── useHistory.ts         — fetch + realtime subscription + mutations
├── persistence/
│   └── useLocalWorkbench.ts  — debounced save/restore of { objects, code, outputs }
```

### Modified files

- `App.tsx` — wrap in `<AuthProvider>`; add account chip + History button to header; integrate `useLocalWorkbench`; track `lastEvaluatedState` for dirty check; fire-and-forget `saveHistory` after each successful Evaluate when logged in; mount `LoginModal` and `HistoryModal`.
- `api.ts` — add `saveHistory()`, `renameCalculation()`; attach auth token to authenticated requests.
- `hooks/useWorkbench.ts` — add `replaceAll(objects: ObjectDef[])` so loading a history entry can swap objects atomically.
- `types.ts` — add `Calculation` matching the DB row.

### Local persistence (`useLocalWorkbench`)

- **Storage key:** `linalg-workbench:v1`
- **Shape:** `{ objects, code, outputs, savedAt }` (outputs may be `null`)
- **Write triggers:** debounced 500ms on changes to `objects` or `code`; immediate on Evaluate success (writes `outputs` too).
- **Restore:** on mount, before `wb.initExample()` runs. If localStorage is empty, parse fails, or quota error occurred, fall back to `initExample()`.
- **Quota fallback:** on write failure, retry without `outputs`; if still failing, skip the save silently. Wrapped in try/catch.
- **Lifecycle vs. auth:** never cleared on sign-in or sign-out — workbench state is independent of auth.

### Save-to-history flow (logged-in only)

1. `runCode()` succeeds (Sage returns outputs).
2. Update `lastEvaluatedState = { objects, code }`.
3. If `user` is present, fire `saveHistory({ code, objects, outputs })` — do not await; errors logged with a non-blocking toast ("Couldn't save to history"); workbench unaffected.

### Load-from-history flow

1. User clicks an entry in `HistoryModal`.
2. Compute `isDirty = currentState ≠ lastEvaluatedState`.
3. If dirty, show inline confirm: "Discard current edits?" — cancel returns to list; proceed continues.
4. On proceed: `wb.replaceAll(entry.objects)`, `setCode(entry.code)`, `setOutputs(entry.outputs)`, update `lastEvaluatedState`, close modal.

### Title-fill in the modal

`useHistory` opens a Butterbase realtime subscription on `calculations` filtered by `user_id = me` while the modal is mounted. When a row's `title` updates (the AI job), the list updates live. If realtime is unavailable, titles remain as `preview` until the modal is reopened (acceptable degradation).

## Auth Flow

### Magic link

1. User clicks "Sign in" in header → `LoginModal` opens.
2. User submits email → `butterbase.auth.signInWithMagicLink({ email, redirectTo: window.location.origin })`.
3. UI shows "Check your email — we sent a link to …".
4. User clicks the link → returns to app with a session token in the URL.
5. `AuthContext` detects token on mount, establishes session, clears URL params.
6. Modal closes; header swaps "Sign in" for the account chip (email + Sign out).

### Session persistence

Butterbase SDK persists session in its own localStorage entry. On app load, `AuthContext.getSession()` runs before any auth-dependent UI renders.

## Edge Cases

- **Sign-out** clears the auth session only — workbench `localStorage` is preserved.
- **Magic-link opened in a new tab** — second tab is authenticated; original tab remains anonymous until reload. No cross-tab sync.
- **`save_history` failure** — non-blocking toast; workbench result unaffected; no retry.
- **AI title failure or timeout** — row stays with `title = null`; `preview` is displayed instead; user can manually rename.
- **Rapid successive Evaluates** — each produces its own history row. Expected.
- **localStorage corruption / quota** — read failures fall back to example; write failures drop `outputs` and retry, then skip silently.
- **Account isolation** — RLS + `user_id` filter; no cross-account leak.

## Testing Strategy

- **Function unit tests** (`save_history`, `rename_calculation`): payload validation, RLS enforcement, AI failure path leaving `title = null`.
- **Frontend hook tests** (`useLocalWorkbench`): write debouncing, restore-before-example, quota fallback.
- **Integration test**: end-to-end Evaluate → row exists → title appears after AI job.
- **Manual smoke**: anonymous flow unchanged; sign-in → evaluate → modal shows entry; load entry replaces workbench; dirty check prompts; delete + clear-all behave; sign-out preserves workbench.

## Open Items (revisit if encountered)

- **Realtime reliability for title-fill** — if Butterbase realtime proves flaky for this table, swap to a 5s poll while the modal is open.
- **AI prompt tuning** — initial prompt is a starting point; refine after seeing real generated titles.
