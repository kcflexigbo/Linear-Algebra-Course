import { describe, it, expect } from 'vitest';
import { applyToolCalls } from '../src/ai/applyToolCalls';
import type { ToolCall } from '../src/ai/types';
import type { WorkbenchObject } from '../src/types';

const empty = { prevObjects: [] as WorkbenchObject[], prevCode: '' };

describe('applyToolCalls', () => {
  it('adds a matrix with a fresh name when none requested', () => {
    const calls: ToolCall[] = [
      { tool: 'add_matrix', args: { rows: 2, cols: 2, entries: [['1', '2'], ['3', '4']] } },
    ];
    const out = applyToolCalls({ ...empty, calls });
    expect(out.rejected).toEqual([]);
    expect(out.nextObjects).toHaveLength(1);
    expect(out.nextObjects[0]).toMatchObject({
      kind: 'matrix',
      name: 'A',
      rows: 2,
      cols: 2,
      values: { '0,0': '1', '0,1': '2', '1,0': '3', '1,1': '4' },
    });
  });

  it('picks the next free letter when default A is taken', () => {
    const prev: WorkbenchObject[] = [
      { id: 0, kind: 'matrix', name: 'A', rows: 1, cols: 1, orient: null, values: { '0,0': '1' } },
    ];
    const out = applyToolCalls({
      prevObjects: prev,
      prevCode: '',
      calls: [{ tool: 'add_matrix', args: { rows: 1, cols: 1, entries: [['9']] } }],
    });
    expect(out.nextObjects[1].name).toBe('B');
  });

  it('honors a requested name when valid and free', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_matrix', args: { name: 'M', rows: 1, cols: 1, entries: [['1']] } }],
    });
    expect(out.nextObjects[0].name).toBe('M');
  });

  it('rejects requested name that collides', () => {
    const prev: WorkbenchObject[] = [
      { id: 0, kind: 'matrix', name: 'A', rows: 1, cols: 1, orient: null, values: {} },
    ];
    const out = applyToolCalls({
      prevObjects: prev,
      prevCode: '',
      calls: [{ tool: 'add_matrix', args: { name: 'A', rows: 1, cols: 1, entries: [['1']] } }],
    });
    expect(out.applied).toEqual([]);
    expect(out.rejected[0].reason).toMatch(/already in use/);
  });

  it('rejects bad shape', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_matrix', args: { rows: 2, cols: 2, entries: [['1', '2']] } }],
    });
    expect(out.rejected[0].reason).toMatch(/2 rows/);
  });

  it('rejects out-of-range dims', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_matrix', args: { rows: 9, cols: 1, entries: [] } }],
    });
    expect(out.rejected[0].reason).toMatch(/\[1,8\]/);
  });

  it('adds a column vector', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_vector', args: { orient: 'col', entries: ['1', '2', '3'] } }],
    });
    expect(out.nextObjects[0]).toMatchObject({
      kind: 'vector',
      name: 'v',
      rows: 3,
      cols: 1,
      orient: 'col',
      values: { '0,0': '1', '1,0': '2', '2,0': '3' },
    });
  });

  it('adds a row vector', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_vector', args: { orient: 'row', entries: ['x', 'y'] } }],
    });
    expect(out.nextObjects[0]).toMatchObject({
      rows: 1,
      cols: 2,
      orient: 'row',
      values: { '0,0': 'x', '0,1': 'y' },
    });
  });

  it('adds a scalar', () => {
    const out = applyToolCalls({
      ...empty,
      calls: [{ tool: 'add_scalar', args: { value: '1/3' } }],
    });
    expect(out.nextObjects[0]).toMatchObject({ kind: 'scalar', name: 'c', values: { '0,0': '1/3' } });
  });

  it('set_code replaces editor', () => {
    const out = applyToolCalls({
      prevObjects: [],
      prevCode: 'old',
      calls: [{ tool: 'set_code', args: { code: 'show(A.det())' } }],
    });
    expect(out.nextCode).toBe('show(A.det())');
  });

  it('append_code adds on a new line', () => {
    const out = applyToolCalls({
      prevObjects: [],
      prevCode: 'show(A)',
      calls: [{ tool: 'append_code', args: { code: 'show(B)' } }],
    });
    expect(out.nextCode).toBe('show(A)\nshow(B)');
  });

  it('clear_workbench drops all objects when confirmed', () => {
    const prev: WorkbenchObject[] = [
      { id: 0, kind: 'matrix', name: 'A', rows: 1, cols: 1, orient: null, values: {} },
    ];
    const out = applyToolCalls({
      prevObjects: prev,
      prevCode: 'x',
      calls: [{ tool: 'clear_workbench', args: { confirm: true } }],
    });
    expect(out.nextObjects).toEqual([]);
    expect(out.nextCode).toBe('x');
  });

  it('clear_workbench without confirm is rejected', () => {
    const out = applyToolCalls({
      ...empty,
      // @ts-expect-error testing bad input
      calls: [{ tool: 'clear_workbench', args: { confirm: false } }],
    });
    expect(out.rejected).toHaveLength(1);
  });

  it('end-to-end: image-of-matrix + solve scenario', () => {
    const calls: ToolCall[] = [
      { tool: 'add_matrix', args: { rows: 2, cols: 2, entries: [['1', '2'], ['1+x', '4']] } },
      { tool: 'set_code', args: { code: 'show(A.det())' } },
    ];
    const out = applyToolCalls({ ...empty, calls });
    expect(out.rejected).toEqual([]);
    expect(out.nextObjects[0].name).toBe('A');
    expect(out.nextObjects[0].values['1,0']).toBe('1+x');
    expect(out.nextCode).toBe('show(A.det())');
  });

  it('continues applying remaining calls after one is rejected', () => {
    const calls: ToolCall[] = [
      { tool: 'add_matrix', args: { rows: 99, cols: 1, entries: [] } },
      { tool: 'add_matrix', args: { rows: 1, cols: 1, entries: [['7']] } },
    ];
    const out = applyToolCalls({ ...empty, calls });
    expect(out.applied).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.nextObjects).toHaveLength(1);
  });
});
