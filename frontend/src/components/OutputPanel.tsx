import { useEffect, useRef } from 'react';
import katex from 'katex';
import type { SageOutput } from '../types';

function stripDollars(s: string) {
  return s.replace(/^\$+|\$+$/g, '');
}

/**
 * Sage's show() wraps output as <html>\(...\)</html> or <html>\[...\]</html>.
 * Extract the inner LaTeX string so KaTeX can render it.
 */
function extractLatexFromHtml(html: string | undefined): string | null {
  if (!html) return null;
  // Strip outer <html>...</html> tags
  const inner = html.replace(/^<html>\s*/i, '').replace(/\s*<\/html>$/i, '').trim();
  // Match \(...\) or \[...\]
  const inline = inner.match(/^\\\((.+)\\\)$/s);
  if (inline) return inline[1].trim();
  const display = inner.match(/^\\\[(.+)\\\]$/s);
  if (display) return display[1].trim();
  return null;
}

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function sageTextMatrixToLatex(text: string): string | null {
  const lines = text
    .trim()
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^\[.*\]$/.test(l));
  if (lines.length === 0) return null;
  const rows = lines.map((l) =>
    l.replace(/^\[/, '').replace(/\]$/, '').trim().split(/\s+/)
  );
  const cols = rows[0].length;
  if (!rows.every((r) => r.length === cols)) return null;
  const body = rows
    .map((r) =>
      r
        .map((cell) => {
          const m = cell.match(/^(-?)(\d+)\/(\d+)$/);
          if (m) return `${m[1]}\\frac{${m[2]}}{${m[3]}}`;
          return cell;
        })
        .join(' & ')
    )
    .join(' \\\\ ');
  return `\\begin{bmatrix}${body}\\end{bmatrix}`;
}

function detectLatex(text: string): string | null {
  const t = text.trim();
  if (/^\\(begin|left|frac|mathrm)/.test(t)) return t;
  return sageTextMatrixToLatex(t);
}

interface KatexBlockProps {
  latex: string;
}

function KatexBlock({ latex }: KatexBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      try {
        katex.render(latex, ref.current, { throwOnError: false, displayMode: true });
      } catch {
        if (ref.current) ref.current.textContent = latex;
      }
    }
  }, [latex]);
  return <div ref={ref} className="out-block latex" />;
}

interface Props {
  outputs: SageOutput[] | null;
  loading: boolean;
  error: string | null;
}

export function OutputPanel({ outputs, loading, error }: Props) {
  if (loading) {
    return (
      <div className="output">
        <span className="output-label">Result</span>
        <div className="status-line">
          <span className="spinner" style={{ borderColor: 'var(--ink)', borderTopColor: 'transparent', verticalAlign: 'middle', marginRight: 8 }} />
          evaluating…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="output error">
        <span className="output-label">Result</span>
        <div className="out-block stderr">Error: {error}</div>
      </div>
    );
  }

  if (outputs === null) {
    return (
      <div className="output empty">
        <span className="output-label">Result</span>
        <em>Output will appear here after evaluation.</em>
      </div>
    );
  }

  if (outputs.length === 0) {
    return (
      <div className="output empty">
        <span className="output-label">Result</span>
        <em>(no output)</em>
      </div>
    );
  }

  let hadError = false;
  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if (o.type === 'stream' && o.name === 'stdout') {
      const latex = detectLatex(o.text);
      if (latex) {
        blocks.push(<KatexBlock key={i} latex={latex} />);
      } else {
        blocks.push(<div key={i} className="out-block text">{o.text}</div>);
      }
    } else if (o.type === 'stream' && o.name === 'stderr') {
      blocks.push(<div key={i} className="out-block stderr">{o.text}</div>);
    } else if (o.type === 'display') {
      const data = o.data;
      // Prefer text/latex; fall back to LaTeX embedded in text/html (Sage show() output)
      const latexSrc = data['text/latex'] ?? extractLatexFromHtml(data['text/html']);
      if (latexSrc) {
        blocks.push(<KatexBlock key={i} latex={stripDollars(latexSrc)} />);
      } else if (data['image/png']) {
        blocks.push(
          <div key={i} className="out-block">
            <img src={`data:image/png;base64,${data['image/png']}`} style={{ maxWidth: '100%' }} alt="output" />
          </div>
        );
      } else if (data['text/plain']) {
        blocks.push(<div key={i} className="out-block text">{data['text/plain']}</div>);
      } else {
        blocks.push(<div key={i} className="out-block text">{JSON.stringify(data)}</div>);
      }
    } else if (o.type === 'error') {
      hadError = true;
      const tb = (o.traceback ?? []).map(stripAnsi).join('\n');
      blocks.push(
        <div key={i} className="out-block stderr">
          {o.ename}: {o.evalue}
          {tb ? `\n\n${tb}` : ''}
        </div>
      );
    }
  }

  return (
    <div className={`output${hadError ? ' error' : ''}`}>
      <span className="output-label">Result</span>
      {blocks}
    </div>
  );
}
