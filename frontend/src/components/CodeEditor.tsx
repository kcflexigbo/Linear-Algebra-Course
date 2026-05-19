import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import type { ObjKind, WorkbenchObject } from '../types';

export interface CodeEditorHandle {
  insert: (snippet: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  objects: WorkbenchObject[];
  placeholder?: string;
}

const MATRIX_METHODS: Array<[string, string]> = [
  ['rref', 'reduced row echelon form'],
  ['echelon_form', 'row echelon form'],
  ['inverse', 'matrix inverse'],
  ['transpose', 'transpose'],
  ['determinant', 'determinant'],
  ['det', 'determinant (alias)'],
  ['rank', 'rank'],
  ['nullity', 'dimension of null space'],
  ['trace', 'trace'],
  ['eigenvalues', 'list of eigenvalues'],
  ['eigenvectors_right', 'right eigenvectors'],
  ['eigenvectors_left', 'left eigenvectors'],
  ['characteristic_polynomial', 'characteristic polynomial'],
  ['minimal_polynomial', 'minimal polynomial'],
  ['kernel', 'kernel / null space'],
  ['image', 'column space'],
  ['right_kernel', 'right kernel'],
  ['left_kernel', 'left kernel'],
  ['column_space', 'column space'],
  ['row_space', 'row space'],
  ['nrows', 'number of rows'],
  ['ncols', 'number of columns'],
  ['solve_right', 'solve A·x = b'],
  ['solve_left', 'solve x·A = b'],
  ['LU', 'LU decomposition'],
  ['QR', 'QR decomposition'],
  ['jordan_form', 'Jordan normal form'],
  ['smith_form', 'Smith normal form'],
  ['gram_schmidt', 'Gram-Schmidt orthogonalization'],
  ['is_invertible', 'invertibility test'],
  ['is_symmetric', 'symmetry test'],
  ['is_diagonalizable', 'diagonalizability test'],
];

const VECTOR_METHODS: Array<[string, string]> = [
  ['norm', 'Euclidean norm'],
  ['dot_product', 'dot product'],
  ['inner_product', 'inner product'],
  ['cross_product', 'cross product'],
  ['outer_product', 'outer product'],
  ['normalized', 'unit vector'],
  ['column', 'as column matrix'],
  ['row', 'as row matrix'],
  ['length', 'number of entries'],
];

const SCALAR_METHODS: Array<[string, string]> = [
  ['numerator', 'numerator'],
  ['denominator', 'denominator'],
  ['sqrt', 'square root'],
  ['n', 'numerical approximation'],
];

const SAGE_GLOBALS: Array<[string, string]> = [
  ['show', 'pretty-print (LaTeX)'],
  ['print', 'plain print'],
  ['matrix', 'construct a matrix'],
  ['vector', 'construct a vector'],
  ['identity_matrix', 'identity matrix'],
  ['zero_matrix', 'zero matrix'],
  ['diagonal_matrix', 'diagonal matrix'],
  ['random_matrix', 'random matrix'],
  ['QQ', 'rationals'],
  ['RR', 'real field'],
  ['CC', 'complex field'],
  ['ZZ', 'integers'],
  ['SR', 'symbolic ring'],
  ['var', 'declare symbolic variable'],
  ['solve', 'solve equations'],
  ['plot', 'plot function'],
  ['range', 'integer range'],
  ['len', 'length'],
  ['sum', 'sum'],
];

function methodsFor(kind: ObjKind): Array<[string, string]> {
  if (kind === 'matrix') return MATRIX_METHODS;
  if (kind === 'vector') return VECTOR_METHODS;
  return SCALAR_METHODS;
}

function toCompletion(label: string, detail: string, type: Completion['type']): Completion {
  return { label, detail, type };
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, onRun, objects, placeholder },
  ref,
) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useImperativeHandle(ref, () => ({
    insert: (snippet: string) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: snippet },
        selection: { anchor: from + snippet.length },
      });
      view.focus();
    },
    focus: () => cmRef.current?.view?.focus(),
  }), []);

  const extensions = useMemo(() => {
    const completionSource = (context: CompletionContext): CompletionResult | null => {
      const objs = objectsRef.current;

      // Member access: name.<prefix>
      const dotMatch = context.matchBefore(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]*)$/);
      if (dotMatch) {
        const [, base, member] = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]*)$/.exec(dotMatch.text)!;
        const obj = objs.find((o) => o.name === base);
        if (obj) {
          const methods = methodsFor(obj.kind);
          const start = dotMatch.from + base.length + 1; // after the dot
          return {
            from: start,
            to: dotMatch.to,
            options: methods.map(([name, detail]) =>
              toCompletion(name + '()', `${obj.kind} · ${detail}`, 'method'),
            ),
            validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
            filter: member.length === 0 ? false : undefined,
          };
        }
      }

      // Identifier prefix
      const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const options: Completion[] = [
        ...objs.map((o) =>
          toCompletion(o.name, `your ${o.kind} (${o.rows}×${o.cols})`, 'variable'),
        ),
        ...SAGE_GLOBALS.map(([name, detail]) =>
          toCompletion(name, detail, name === name.toUpperCase() ? 'constant' : 'function'),
        ),
      ];

      return {
        from: word.from,
        to: word.to,
        options,
        validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
      };
    };

    return [
      python(),
      autocompletion({
        override: [completionSource],
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ]),
      EditorView.theme({
        '&': { fontSize: '14px', backgroundColor: 'transparent' },
        '.cm-content': {
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          padding: '18px 20px',
          minHeight: '220px',
          caretColor: 'var(--ink)',
        },
        '.cm-gutters': { display: 'none' },
        '.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
          backgroundColor: 'rgba(139, 26, 26, 0.18)',
        },
        '.cm-line': { padding: '0' },
        '.cm-tooltip.cm-tooltip-autocomplete': {
          border: '1px solid var(--rule)',
          backgroundColor: 'var(--paper)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
          boxShadow: '2px 3px 0 rgba(26, 22, 18, 0.08)',
        },
        '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
          padding: '4px 10px',
          color: 'var(--ink)',
        },
        '.cm-tooltip-autocomplete ul li[aria-selected]': {
          backgroundColor: 'var(--paper-deep)',
          color: 'var(--ink)',
        },
        '.cm-completionDetail': {
          fontStyle: 'italic',
          color: 'var(--ink-faint)',
          fontFamily: "'EB Garamond', serif",
          fontSize: '13px',
          marginLeft: '12px',
        },
        '.cm-completionIcon': { paddingRight: '6px', opacity: 0.6 },
      }),
      EditorView.lineWrapping,
    ];
  }, []);

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
      theme="light"
      className="cm-workbench"
    />
  );
});
