import { describe, it, expect } from 'vitest';
import { buildPreamble, preambleRingLabel, freeSymbolsIn } from '../src/hooks/useWorkbench';
import type { WorkbenchObject } from '../src/types';

function mkMatrix(name: string, rows: number, cols: number, vals: Record<string, string>): WorkbenchObject {
  return { id: 0, kind: 'matrix', name, rows, cols, orient: null, values: vals };
}

describe('buildPreamble', () => {
  it('uses QQ when all entries are numeric', () => {
    const objs = [mkMatrix('A', 2, 2, { '0,0': '1', '0,1': '2', '1,0': '3', '1,1': '4' })];
    expect(buildPreamble(objs)).toBe('A = matrix(QQ, 2, 2, [1, 2, 3, 4])');
    expect(preambleRingLabel(objs)).toBe('QQ');
  });

  it('declares symbolic vars and drops QQ when a free symbol appears', () => {
    const objs = [mkMatrix('A', 2, 2, { '0,0': '1', '0,1': '2', '1,0': '1+x', '1,1': '4' })];
    const out = buildPreamble(objs);
    expect(out).toBe("var('x')\nA = matrix(2, 2, [1, 2, 1+x, 4])");
    expect(preambleRingLabel(objs)).toBe('SR');
  });

  it('declares multiple symbols sorted, space-separated', () => {
    const objs = [mkMatrix('A', 1, 3, { '0,0': 'y+1', '0,1': 'x', '0,2': 'z*y' })];
    expect(buildPreamble(objs)).toBe("var('x y z')\nA = matrix(1, 3, [y+1, x, z*y])");
  });

  it('does not declare object names as symbols', () => {
    const objs: WorkbenchObject[] = [
      mkMatrix('A', 1, 1, { '0,0': '1' }),
      { id: 1, kind: 'scalar', name: 'k', rows: 1, cols: 1, orient: null, values: { '0,0': 'A + 1' } },
    ];
    // 'A' is an object name so should not be in var(); no other symbols → keep QQ form
    expect(buildPreamble(objs)).toBe('A = matrix(QQ, 1, 1, [1])\nk = A + 1');
    expect(preambleRingLabel(objs)).toBe('QQ');
  });

  it('skips Sage reserved names like pi, sin, sqrt, I', () => {
    const objs = [mkMatrix('A', 1, 2, { '0,0': 'sin(pi/4)', '0,1': 'sqrt(2) + I' })];
    expect(buildPreamble(objs)).toBe('A = matrix(QQ, 1, 2, [sin(pi/4), sqrt(2) + I])');
  });

  it('extracts only free identifiers via freeSymbolsIn', () => {
    expect(freeSymbolsIn(['1+x', 'sin(t)+a'], new Set())).toEqual(['a', 't', 'x']);
    expect(freeSymbolsIn(['A + 1'], new Set(['A']))).toEqual([]);
  });

  it('vector with symbols drops QQ; without symbols keeps QQ', () => {
    const vNum: WorkbenchObject = { id: 0, kind: 'vector', name: 'v', rows: 3, cols: 1, orient: 'col', values: { '0,0': '1', '1,0': '2', '2,0': '3' } };
    expect(buildPreamble([vNum])).toBe('v = vector(QQ, [1, 2, 3])');
    const vSym: WorkbenchObject = { ...vNum, values: { '0,0': '1', '1,0': 't', '2,0': '3' } };
    expect(buildPreamble([vSym])).toBe("var('t')\nv = vector([1, t, 3])");
  });
});
