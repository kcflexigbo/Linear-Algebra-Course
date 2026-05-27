import { useState, useEffect, useRef } from 'react';
import { aiWorkbench } from '../api';
import { applyToolCalls } from './applyToolCalls';
import type { ToolCall } from './types';
import type { WorkbenchObject } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  prevObjects: WorkbenchObject[];
  prevCode: string;
  onApply: (next: { objects: WorkbenchObject[]; code: string }) => void;
}

export function AIPromptModal(props: Props) {
  const { open, onClose, prevObjects, prevCode, onApply } = props;
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    calls: ToolCall[];
    rejected: { call: ToolCall; reason: string }[];
    nextObjects: WorkbenchObject[];
    nextCode: string;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  function reset() {
    setInstruction('');
    setBusy(false);
    setErr(null);
    setPreview(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function runAI() {
    if (!instruction.trim()) {
      setErr('Enter an instruction first.');
      return;
    }
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const raw = await aiWorkbench({
        instruction: instruction.trim(),
        context: { objects: prevObjects, code: prevCode },
      });
      const calls = raw as ToolCall[];
      const result = applyToolCalls({ prevObjects, prevCode, calls });
      setPreview({
        calls: result.applied,
        rejected: result.rejected,
        nextObjects: result.nextObjects,
        nextCode: result.nextCode,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!preview) return;
    onApply({ objects: preview.nextObjects, code: preview.nextCode });
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runAI();
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-ai-prompt" onClick={(e) => e.stopPropagation()}>
        <h2>Ask the assistant</h2>
        <p>
          The AI sees your current matrices, vectors, scalars, and code. Ask it to compute, transform,
          or set up a problem. <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send.
        </p>

        <textarea
          ref={inputRef}
          className="ai-instruction"
          placeholder="e.g. find the eigenvalues of A&#10;e.g. solve A·x = b for x&#10;e.g. add a 3×3 identity matrix called I"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
        />

        {err && <p className="error">{err}</p>}

        {preview && (
          <div className="ai-preview">
            <strong>AI proposes:</strong>
            <ul>
              {preview.calls.map((c, i) => (
                <li key={i}>{summarizeCall(c)}</li>
              ))}
            </ul>
            {preview.rejected.length > 0 && (
              <p className="ai-warn">
                {preview.rejected.length} call(s) rejected: {preview.rejected.map((r) => r.reason).join('; ')}
              </p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          {preview ? (
            <>
              <button onClick={runAI} disabled={busy}>{busy ? 'Thinking…' : 'Regenerate'}</button>
              <button type="submit" onClick={apply} disabled={preview.calls.length === 0}>Apply</button>
            </>
          ) : (
            <button type="submit" onClick={runAI} disabled={busy}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function summarizeCall(c: ToolCall): string {
  switch (c.tool) {
    case 'add_matrix':
      return `add matrix ${c.args.name ?? '(auto)'} (${c.args.rows}×${c.args.cols})`;
    case 'add_vector':
      return `add ${c.args.orient} vector ${c.args.name ?? '(auto)'} (length ${c.args.entries.length})`;
    case 'add_scalar':
      return `add scalar ${c.args.name ?? '(auto)'} = ${c.args.value}`;
    case 'set_code':
      return `set code: ${truncate(c.args.code, 100)}`;
    case 'append_code':
      return `append code: ${truncate(c.args.code, 100)}`;
    case 'clear_workbench':
      return 'clear workbench';
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
