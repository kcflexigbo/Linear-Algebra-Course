import { useState, useCallback, useRef } from 'react';
import type { WorkbenchObject, ObjKind } from '../types';

const NAME_POOLS: Record<ObjKind, string[]> = {
  matrix: ['A', 'B', 'C', 'D', 'M', 'N', 'P', 'Q'],
  vector: ['v', 'u', 'w', 'b', 'x', 'y', 'z'],
  scalar: ['c', 'k', 't', 's', 'r', 'a'],
};

function freshName(kind: ObjKind, used: Set<string>): string {
  const pool = NAME_POOLS[kind];
  for (const n of pool) if (!used.has(n)) return n;
  let i = 1;
  while (used.has(pool[0] + i)) i++;
  return pool[0] + i;
}

export function sanitizeEntry(v: string | undefined): string {
  if (v === undefined || v === null) return '0';
  const s = String(v).trim();
  if (s === '') return '0';
  return s.replace(/[−–—]/g, '-');
}

const SAGE_RESERVED = new Set([
  'pi', 'e', 'I', 'oo', 'infinity', 'NaN',
  'True', 'False', 'None',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'log', 'ln', 'sqrt', 'abs', 'factorial', 'gamma',
  'real', 'imag', 'conjugate', 'floor', 'ceil', 'round',
  'min', 'max', 'sum', 'prod',
  'QQ', 'ZZ', 'RR', 'CC', 'SR', 'RDF', 'CDF', 'GF', 'AA', 'QQbar',
  'PolynomialRing', 'var', 'matrix', 'vector',
  'identity_matrix', 'zero_matrix', 'diagonal_matrix',
  'show', 'print', 'latex',
]);

export function freeSymbolsIn(entries: string[], objectNames: Set<string>): string[] {
  const found = new Set<string>();
  const idRe = /[A-Za-z_]\w*/g;
  for (const entry of entries) {
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(entry)) !== null) {
      const tok = m[0];
      if (objectNames.has(tok)) continue;
      if (SAGE_RESERVED.has(tok)) continue;
      // Skip if immediately preceded by '.' (method/attribute access)
      if (m.index > 0 && entry[m.index - 1] === '.') continue;
      // Skip if it looks like a numeric literal suffix (unlikely given regex, but guard)
      found.add(tok);
    }
  }
  return Array.from(found).sort();
}

export function buildPreamble(objects: WorkbenchObject[]): string {
  const objectNames = new Set(objects.map((o) => o.name));
  const allEntries: string[] = [];
  for (const obj of objects) {
    if (obj.kind === 'scalar') {
      allEntries.push(sanitizeEntry(obj.values['0,0']));
    } else {
      for (let r = 0; r < obj.rows; r++)
        for (let c = 0; c < obj.cols; c++)
          allEntries.push(sanitizeEntry(obj.values[`${r},${c}`]));
    }
  }
  const symbols = freeSymbolsIn(allEntries, objectNames);
  const hasSymbols = symbols.length > 0;

  const lines: string[] = [];
  if (hasSymbols) lines.push(`var('${symbols.join(' ')}')`);

  for (const obj of objects) {
    if (obj.kind === 'scalar') {
      lines.push(`${obj.name} = ${sanitizeEntry(obj.values['0,0'])}`);
      continue;
    }
    const entries: string[] = [];
    for (let r = 0; r < obj.rows; r++)
      for (let c = 0; c < obj.cols; c++)
        entries.push(sanitizeEntry(obj.values[`${r},${c}`]));
    const entryStr = entries.join(', ');
    if (obj.kind === 'vector') {
      lines.push(
        hasSymbols
          ? `${obj.name} = vector([${entryStr}])`
          : `${obj.name} = vector(QQ, [${entryStr}])`
      );
    } else {
      lines.push(
        hasSymbols
          ? `${obj.name} = matrix(${obj.rows}, ${obj.cols}, [${entryStr}])`
          : `${obj.name} = matrix(QQ, ${obj.rows}, ${obj.cols}, [${entryStr}])`
      );
    }
  }
  return lines.join('\n');
}

export function preambleRingLabel(objects: WorkbenchObject[]): 'QQ' | 'SR' {
  const objectNames = new Set(objects.map((o) => o.name));
  const allEntries: string[] = [];
  for (const obj of objects) {
    if (obj.kind === 'scalar') {
      allEntries.push(sanitizeEntry(obj.values['0,0']));
    } else {
      for (let r = 0; r < obj.rows; r++)
        for (let c = 0; c < obj.cols; c++)
          allEntries.push(sanitizeEntry(obj.values[`${r},${c}`]));
    }
  }
  return freeSymbolsIn(allEntries, objectNames).length > 0 ? 'SR' : 'QQ';
}

export function useWorkbench() {
  const [objects, setObjects] = useState<WorkbenchObject[]>([]);
  const nextId = useRef(0);
  const usedNames = useRef(new Set<string>());

  const addObject = useCallback((kind: ObjKind) => {
    const id = nextId.current++;
    const name = freshName(kind, usedNames.current);
    usedNames.current.add(name);
    setObjects((prev) => [
      ...prev,
      {
        id,
        kind,
        name,
        rows: kind === 'matrix' ? 3 : kind === 'vector' ? 3 : 1,
        cols: kind === 'matrix' ? 3 : 1,
        orient: kind === 'vector' ? 'col' : null,
        values: {},
      },
    ]);
  }, []);

  const removeObject = useCallback((id: number) => {
    setObjects((prev) => {
      const obj = prev.find((o) => o.id === id);
      if (obj) usedNames.current.delete(obj.name);
      return prev.filter((o) => o.id !== id);
    });
  }, []);

  const duplicateObject = useCallback((id: number) => {
    setObjects((prev) => {
      const src = prev.find((o) => o.id === id);
      if (!src) return prev;
      const newName = freshName(src.kind, usedNames.current);
      usedNames.current.add(newName);
      return [
        ...prev,
        { ...src, id: nextId.current++, name: newName, values: { ...src.values } },
      ];
    });
  }, []);

  const updateName = useCallback((id: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return false;
    setObjects((prev) => {
      const obj = prev.find((o) => o.id === id);
      if (!obj) return prev;
      if (trimmed !== obj.name && usedNames.current.has(trimmed)) return prev;
      usedNames.current.delete(obj.name);
      usedNames.current.add(trimmed);
      return prev.map((o) => (o.id === id ? { ...o, name: trimmed } : o));
    });
    return true;
  }, []);

  const updateDim = useCallback((id: number, which: 'rows' | 'cols', val: number) => {
    const clamped = Math.max(1, Math.min(8, val || 1));
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, [which]: clamped } : o))
    );
  }, []);

  const updateVectorLen = useCallback((id: number, val: number) => {
    const len = Math.max(1, Math.min(10, val || 1));
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        return o.orient === 'col'
          ? { ...o, rows: len, cols: 1 }
          : { ...o, rows: 1, cols: len };
      })
    );
  }, []);

  const updateVectorOrient = useCallback((id: number, orient: 'col' | 'row') => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const len = Math.max(o.rows, o.cols);
        return orient === 'col'
          ? { ...o, orient, rows: len, cols: 1 }
          : { ...o, orient, rows: 1, cols: len };
      })
    );
  }, []);

  const updateCell = useCallback((id: number, r: number, c: number, val: string) => {
    setObjects((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, values: { ...o.values, [`${r},${c}`]: val } } : o
      )
    );
  }, []);

  const updateScalar = useCallback((id: number, val: string) => {
    setObjects((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, values: { ...o.values, '0,0': val } } : o
      )
    );
  }, []);

  const replaceAll = useCallback((next: WorkbenchObject[]) => {
    usedNames.current = new Set(next.map((o) => o.name));
    nextId.current = next.reduce((m, o) => Math.max(m, o.id + 1), 0);
    setObjects(next);
  }, []);

  const initExample = useCallback(() => {
    const id = nextId.current++;
    usedNames.current.add('A');
    setObjects([
      {
        id,
        kind: 'matrix',
        name: 'A',
        rows: 4,
        cols: 5,
        orient: null,
        values: {
          '0,0': '1', '0,1': '1', '0,2': '0', '0,3': '0', '0,4': '3',
          '1,0': '0', '1,1': '1', '1,2': '1', '1,3': '0', '1,4': '2',
          '2,0': '0', '2,1': '0', '2,2': '1', '2,3': '1', '2,4': '4',
          '3,0': '1', '3,1': '0', '3,2': '0', '3,3': '1', '3,4': '5',
        },
      },
    ]);
  }, []);

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
}
