export type ObjKind = 'matrix' | 'vector' | 'scalar';

export interface WorkbenchObject {
  id: number;
  kind: ObjKind;
  name: string;
  rows: number;
  cols: number;
  orient: 'col' | 'row' | null;
  values: Record<string, string>;
}

export type SageOutput =
  | { type: 'stream'; name: string; text: string }
  | { type: 'display'; data: Record<string, string> }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] };
