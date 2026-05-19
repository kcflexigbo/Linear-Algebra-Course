import { useEffect, useRef, useState } from 'react';
import { useWorkbench, buildPreamble } from './hooks/useWorkbench';
import { useLocalWorkbench } from './persistence/useLocalWorkbench';
import { ObjectCard } from './components/ObjectCard';
import { SnippetBar } from './components/SnippetBar';
import { OutputPanel } from './components/OutputPanel';
import { CodeEditor, type CodeEditorHandle } from './components/CodeEditor';
import { runOnSage } from './api';
import { useAuth } from './auth/AuthContext';
import { LoginModal } from './auth/LoginModal';
import type { ObjKind, SageOutput } from './types';
import 'katex/dist/katex.min.css';

export default function App() {
  const wb = useWorkbench();
  const persist = useLocalWorkbench();
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [code, setCode] = useState('show(A.rref())');
  const [showPreamble, setShowPreamble] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outputs, setOutputs] = useState<SageOutput[] | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);

  useEffect(() => {
    const snap = persist.restore();
    if (snap) {
      wb.replaceAll(snap.objects);
      setCode(snap.code);
      setOutputs(snap.outputs ?? null);
    } else {
      wb.initExample();
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced persistence of edits.
  useEffect(() => {
    if (!restored) return;
    persist.save({ objects: wb.objects, code, outputs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb.objects, code, restored]);

  const preamble = buildPreamble(wb.objects);

  async function runCode() {
    if (!code.trim()) {
      setOutputs([]);
      setEvalError(null);
      return;
    }
    const full = (preamble ? preamble + '\n\n' : '') + code;
    setLoading(true);
    setEvalError(null);
    setOutputs(null);
    try {
      const outs = await runOnSage(full);
      setOutputs(outs);
      persist.saveImmediate({ objects: wb.objects, code, outputs: outs });
    } catch (err) {
      setEvalError((err as Error).message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  function insertSnippet(snip: string) {
    editorRef.current?.insert(snip);
  }

  return (
    <>
      <div className="wrap">
        <header>
          <div className="masthead-left">
            <h1>The <em>Linear</em> Workbench</h1>
            <span className="subtitle">— a Sage-powered reading desk for matrices, vectors &amp; the operations between them</span>
          </div>
          <span className="vol">Vol. I · No. 1</span>
          <span className="account">
            {auth.status === 'authenticated' && auth.user ? (
              <>
                <span className="account-email">{auth.user.email}</span>
                <button className="account-btn" onClick={() => auth.signOut()}>Sign out</button>
              </>
            ) : auth.status === 'anonymous' ? (
              <button className="account-btn" onClick={() => setLoginOpen(true)}>Sign in</button>
            ) : null}
          </span>
        </header>
        <div className="double-rule" />

        <div className="grid">
          {/* LEFT: object panel */}
          <aside>
            <div className="section-h">
              <span>Defined Objects</span>
              <span className="count">{wb.objects.length} item{wb.objects.length === 1 ? '' : 's'}</span>
            </div>

            <div className="obj-list">
              {wb.objects.length === 0 && (
                <div className="empty-objs">No objects yet. Start by adding a matrix or vector below.</div>
              )}
              {wb.objects.map((obj) => (
                <ObjectCard
                  key={obj.id}
                  obj={obj}
                  onRemove={wb.removeObject}
                  onDuplicate={wb.duplicateObject}
                  onNameChange={wb.updateName}
                  onDimChange={wb.updateDim}
                  onVectorLen={wb.updateVectorLen}
                  onVectorOrient={wb.updateVectorOrient}
                  onCell={wb.updateCell}
                  onScalar={wb.updateScalar}
                />
              ))}
            </div>

            <div className="add-row">
              {(['matrix', 'vector', 'scalar'] as ObjKind[]).map((kind) => (
                <button key={kind} className="add-btn" onClick={() => wb.addObject(kind)}>
                  <span className="plus">+</span>{kind}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 32 }}>
              <div className="section-h"><span>Notes</span></div>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', margin: '8px 0' }}>
                Names you give objects above (like <em>A</em>, <em>B</em>, <em>v</em>) become Sage variables.
                Reference them in the code panel — for instance <code>A.rref()</code> or <code>A * v</code>.
              </p>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', margin: '8px 0' }}>
                Entries accept fractions (<code>1/3</code>), negatives, and symbolic expressions. Blanks become <code>0</code>.
              </p>
            </div>
          </aside>

          {/* RIGHT: editor + output */}
          <section>
            <div className="section-h">
              <span>Computation</span>
              <span className="count">Sage · QQ ring</span>
            </div>

            <div className="editor-wrap">
              <SnippetBar onInsert={insertSnippet} />

              <CodeEditor
                ref={editorRef}
                value={code}
                onChange={setCode}
                onRun={runCode}
                objects={wb.objects}
                placeholder={`# Write Sage code here using the names you defined to the left.\n# Examples:\n#   show(A.rref())\n#   show(A * B)\n#   show(A.eigenvalues())`}
              />

              <div className="editor-foot">
                <button className="preamble-toggle" onClick={() => setShowPreamble((v) => !v)}>
                  {showPreamble ? 'hide' : 'view'} generated preamble
                </button>
                <button className="run-btn" disabled={loading} onClick={runCode}>
                  {loading ? (
                    <><span className="spinner" /><span>Evaluating</span></>
                  ) : (
                    <><span>Evaluate</span><span className="arrow">→</span></>
                  )}
                </button>
              </div>

              {showPreamble && (
                <pre className="preamble-view show">
                  {preamble || '# (no objects defined)'}
                </pre>
              )}
            </div>

            <div className="output-wrap">
              <OutputPanel outputs={outputs} loading={loading} error={evalError} />
            </div>
          </section>
        </div>

        <footer>
          <span>
            Computed via{' '}
            <a href="https://sagecell.sagemath.org" target="_blank" rel="noreferrer">SageMathCell</a>
            {' '}(Butterbase serverless proxy). 40-second timeout per evaluation.
          </span>
          <span>Set in EB Garamond &amp; JetBrains Mono.</span>
        </footer>
      </div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
