import { useEffect, useState } from 'react';
import { fetchSharedCalculation } from '../api';
import { OutputPanel } from '../components/OutputPanel';
import type { Calculation, WorkbenchObject } from '../types';

interface Props {
  slug: string;
}

function ReadOnlyObject({ obj }: { obj: WorkbenchObject }) {
  if (obj.kind === 'scalar') {
    return (
      <div className="shared-obj">
        <div className="shared-obj-name">
          {obj.name} <span className="shared-obj-kind">(scalar)</span>
        </div>
        <div className="shared-scalar">{obj.values['0,0'] ?? '0'}</div>
      </div>
    );
  }
  const rows = obj.rows;
  const cols = obj.cols;
  return (
    <div className="shared-obj">
      <div className="shared-obj-name">
        {obj.name}{' '}
        <span className="shared-obj-kind">
          ({obj.kind} {rows}×{cols})
        </span>
      </div>
      <table className="shared-matrix">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>{obj.values[`${r},${c}`] ?? '0'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SharedView({ slug }: Props) {
  const [calc, setCalc] = useState<Calculation | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchSharedCalculation(slug);
        if (cancelled) return;
        if (!c) {
          setStatus('not-found');
        } else {
          setCalc(c);
          setStatus('ready');
        }
      } catch (e) {
        if (cancelled) return;
        setErrMsg((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const title = calc?.title ?? calc?.preview ?? '(untitled calculation)';

  return (
    <div className="wrap">
      <header>
        <div className="masthead-left">
          <h1>
            The <em>Linear</em> Workbench
          </h1>
          <span className="subtitle">— shared calculation</span>
        </div>
        <a href="/" className="account-btn">Open workbench →</a>
      </header>
      <div className="double-rule" />

      {status === 'loading' && <p style={{ fontStyle: 'italic' }}>Loading…</p>}
      {status === 'not-found' && (
        <p>This calculation isn't available. It may have been unshared or never existed.</p>
      )}
      {status === 'error' && <p className="error">Couldn't load: {errMsg}</p>}

      {status === 'ready' && calc && (
        <div className="shared-body">
          <h2 className="shared-title">{title}</h2>
          <p className="shared-meta">
            Shared {new Date(calc.created_at).toLocaleDateString()}
          </p>

          {calc.objects.length > 0 && (
            <section className="shared-section">
              <div className="section-h"><span>Defined Objects</span></div>
              <div className="shared-obj-grid">
                {calc.objects.map((o) => (
                  <ReadOnlyObject key={o.id} obj={o} />
                ))}
              </div>
            </section>
          )}

          <section className="shared-section">
            <div className="section-h"><span>Code</span></div>
            <pre className="shared-code">{calc.code}</pre>
          </section>

          <section className="shared-section">
            <div className="section-h"><span>Output</span></div>
            <div className="output-wrap">
              <OutputPanel outputs={calc.outputs} loading={false} error={null} />
            </div>
          </section>
        </div>
      )}

      <footer>
        <span>
          Computed via{' '}
          <a href="https://sagecell.sagemath.org" target="_blank" rel="noreferrer">
            SageMathCell
          </a>{' '}
          (Butterbase serverless proxy).
        </span>
        <span>Read-only shared view.</span>
      </footer>
    </div>
  );
}
