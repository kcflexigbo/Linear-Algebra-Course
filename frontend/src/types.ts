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

export type TitleSource = 'pending' | 'ai' | 'user';

export interface Calculation {
  id: string;
  user_id: string;
  created_at: string;
  title: string | null;
  title_source: TitleSource;
  code: string;
  objects: WorkbenchObject[];
  outputs: SageOutput[];
  preview: string;
  public: boolean;
  slug: string | null;
}
