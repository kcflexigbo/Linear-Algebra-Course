import { useState, useRef } from 'react';
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

const MAX_BYTES = 6 * 1024 * 1024;

export function AIUploadModal(props: Props) {
  const { open, onClose, prevObjects, prevCode, onApply } = props;
  const [image, setImage] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [solve, setSolve] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    calls: ToolCall[];
    rejected: { call: ToolCall; reason: string }[];
    nextObjects: WorkbenchObject[];
    nextCode: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function reset() {
    setImage(null);
    setInstruction('');
    setSolve(true);
    setBusy(false);
    setErr(null);
    setPreview(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) {
      setErr(`Image too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`);
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setImage(dataUrl);
    setErr(null);
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) handleFile(file);
    }
  }

  async function runAI() {
    if (!image && !instruction.trim()) {
      setErr('Upload an image or enter an instruction.');
      return;
    }
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const fullInstruction =
        (instruction.trim() || 'Extract the matrices and vectors shown.') +
        (solve ? '\nThen write Sage code that solves or computes whatever the problem asks; if unclear, show the determinant for square matrices or rref otherwise.' : '');
      const raw = await aiWorkbench({
        image: image ?? undefined,
        instruction: fullInstruction,
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

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-ai" onClick={(e) => e.stopPropagation()} onPaste={onPaste}>
        <h2>From image / prompt</h2>
        <p>
          Upload (or paste) an image of a matrix, vector, or full linear-algebra problem.
          Optionally add an instruction. The AI extracts the objects and writes the Sage code.
        </p>

        <div className="ai-dropzone" onClick={() => fileRef.current?.click()}>
          {image ? (
            <img src={image} alt="preview" />
          ) : (
            <span>Click to choose an image, drop it here, or paste from clipboard</span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {image && (
          <button className="ai-clear-img" onClick={() => setImage(null)}>
            remove image
          </button>
        )}

        <textarea
          className="ai-instruction"
          placeholder="Optional instruction (e.g. 'find the eigenvalues', 'just extract')"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
        />

        <label className="ai-solve">
          <input type="checkbox" checked={solve} onChange={(e) => setSolve(e.target.checked)} />
          Also write code to solve / show the result
        </label>

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
              <button onClick={runAI} disabled={busy}>
                {busy ? 'Thinking…' : 'Regenerate'}
              </button>
              <button type="submit" onClick={apply} disabled={preview.calls.length === 0}>
                Apply
              </button>
            </>
          ) : (
            <button type="submit" onClick={runAI} disabled={busy}>
              {busy ? 'Thinking…' : 'Generate'}
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
      return `set code: ${truncate(c.args.code, 80)}`;
    case 'append_code':
      return `append code: ${truncate(c.args.code, 80)}`;
    case 'clear_workbench':
      return 'clear workbench';
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
