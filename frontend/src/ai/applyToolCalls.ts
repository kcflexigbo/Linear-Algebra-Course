import type { WorkbenchObject, ObjKind } from '../types';
import type { ToolCall } from './types';

const NAME_POOLS: Record<ObjKind, string[]> = {
  matrix: ['A', 'B', 'C', 'D', 'M', 'N', 'P', 'Q'],
  vector: ['v', 'u', 'w', 'b', 'x', 'y', 'z'],
  scalar: ['c', 'k', 't', 's', 'r', 'a'],
};

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function freshName(kind: ObjKind, used: Set<string>): string {
  for (const n of NAME_POOLS[kind]) if (!used.has(n)) return n;
  let i = 1;
  while (used.has(NAME_POOLS[kind][0] + i)) i++;
  return NAME_POOLS[kind][0] + i;
}

function clampDim(n: unknown, max: number): number | null {
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  if (n < 1 || n > max) return null;
  return n;
}

export interface ApplyOptions {
  prevObjects: WorkbenchObject[];
  prevCode: string;
  calls: ToolCall[];
  /** Next id seed; defaults to max(prev.id)+1 */
  nextId?: number;
}

export interface ApplyOutput {
  nextObjects: WorkbenchObject[];
  nextCode: string;
  applied: ToolCall[];
  rejected: { call: ToolCall; reason: string }[];
}

export function applyToolCalls(opts: ApplyOptions): ApplyOutput {
  const objects = [...opts.prevObjects];
  let code = opts.prevCode;
  let idSeed = opts.nextId ?? objects.reduce((m, o) => Math.max(m, o.id + 1), 0);
  const used = new Set(objects.map((o) => o.name));
  const applied: ToolCall[] = [];
  const rejected: { call: ToolCall; reason: string }[] = [];

  const reject = (call: ToolCall, reason: string) => rejected.push({ call, reason });

  for (const call of opts.calls) {
    switch (call.tool) {
      case 'add_matrix': {
        const { name, rows, cols, entries } = call.args;
        const r = clampDim(rows, 8);
        const c = clampDim(cols, 8);
        if (r === null || c === null) {
          reject(call, 'rows/cols must be integers in [1,8]');
          break;
        }
        if (!Array.isArray(entries) || entries.length !== r) {
          reject(call, `entries must have ${r} rows`);
          break;
        }
        if (!entries.every((row) => Array.isArray(row) && row.length === c)) {
          reject(call, `each row must have ${c} columns`);
          break;
        }
        const chosenName = pickName('matrix', name, used, reject, call);
        if (!chosenName) break;
        const values: Record<string, string> = {};
        for (let i = 0; i < r; i++)
          for (let j = 0; j < c; j++)
            values[`${i},${j}`] = String(entries[i][j] ?? '');
        objects.push({
          id: idSeed++,
          kind: 'matrix',
          name: chosenName,
          rows: r,
          cols: c,
          orient: null,
          values,
        });
        used.add(chosenName);
        applied.push(call);
        break;
      }

      case 'add_vector': {
        const { name, orient, entries } = call.args;
        if (orient !== 'col' && orient !== 'row') {
          reject(call, 'orient must be "col" or "row"');
          break;
        }
        if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10) {
          reject(call, 'entries length must be in [1,10]');
          break;
        }
        const chosenName = pickName('vector', name, used, reject, call);
        if (!chosenName) break;
        const len = entries.length;
        const rows = orient === 'col' ? len : 1;
        const cols = orient === 'col' ? 1 : len;
        const values: Record<string, string> = {};
        for (let i = 0; i < len; i++) {
          const key = orient === 'col' ? `${i},0` : `0,${i}`;
          values[key] = String(entries[i] ?? '');
        }
        objects.push({
          id: idSeed++,
          kind: 'vector',
          name: chosenName,
          rows,
          cols,
          orient,
          values,
        });
        used.add(chosenName);
        applied.push(call);
        break;
      }

      case 'add_scalar': {
        const { name, value } = call.args;
        if (typeof value !== 'string') {
          reject(call, 'value must be a string');
          break;
        }
        const chosenName = pickName('scalar', name, used, reject, call);
        if (!chosenName) break;
        objects.push({
          id: idSeed++,
          kind: 'scalar',
          name: chosenName,
          rows: 1,
          cols: 1,
          orient: null,
          values: { '0,0': value },
        });
        used.add(chosenName);
        applied.push(call);
        break;
      }

      case 'set_code': {
        if (typeof call.args.code !== 'string') {
          reject(call, 'code must be a string');
          break;
        }
        code = call.args.code;
        applied.push(call);
        break;
      }

      case 'append_code': {
        if (typeof call.args.code !== 'string') {
          reject(call, 'code must be a string');
          break;
        }
        code = code.length > 0 ? code.replace(/\s+$/, '') + '\n' + call.args.code : call.args.code;
        applied.push(call);
        break;
      }

      case 'clear_workbench': {
        if (call.args?.confirm !== true) {
          reject(call, 'confirm must be true');
          break;
        }
        objects.length = 0;
        used.clear();
        applied.push(call);
        break;
      }

      default: {
        reject(call as ToolCall, 'unknown tool');
        break;
      }
    }
  }

  return { nextObjects: objects, nextCode: code, applied, rejected };
}

function pickName(
  kind: ObjKind,
  requested: string | undefined,
  used: Set<string>,
  reject: (c: ToolCall, r: string) => void,
  call: ToolCall
): string | null {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !NAME_RE.test(requested)) {
      reject(call, `invalid name: ${JSON.stringify(requested)}`);
      return null;
    }
    if (used.has(requested)) {
      reject(call, `name "${requested}" already in use`);
      return null;
    }
    return requested;
  }
  return freshName(kind, used);
}
