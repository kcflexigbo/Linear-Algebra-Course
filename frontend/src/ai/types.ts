/**
 * Tool-call schema for the AI workbench assistant.
 *
 * The model emits a list of these; the client applies them to the workbench.
 * Entries are always strings so symbolic expressions ("1+x", "sqrt(2)") and
 * fractions ("1/3") pass through the existing preamble logic unchanged.
 */

export type ToolCall =
  | { tool: 'add_matrix'; args: AddMatrixArgs }
  | { tool: 'add_vector'; args: AddVectorArgs }
  | { tool: 'add_scalar'; args: AddScalarArgs }
  | { tool: 'set_code'; args: { code: string } }
  | { tool: 'append_code'; args: { code: string } }
  | { tool: 'clear_workbench'; args: { confirm: true } };

export interface AddMatrixArgs {
  name?: string;
  rows: number;
  cols: number;
  /** Row-major: entries[r][c] */
  entries: string[][];
}

export interface AddVectorArgs {
  name?: string;
  orient: 'col' | 'row';
  entries: string[];
}

export interface AddScalarArgs {
  name?: string;
  value: string;
}

export interface ApplyResult {
  applied: ToolCall[];
  rejected: { call: ToolCall; reason: string }[];
}

/**
 * JSON-schema-like descriptors sent to the model so it knows what tools exist.
 * Kept in sync with the union above.
 */
export const TOOL_SCHEMAS = [
  {
    name: 'add_matrix',
    description:
      'Add a matrix to the workbench. Entries are strings; symbolic expressions like "1+x" and fractions like "1/3" are allowed. Blank entries become "0".',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Optional single-letter name (e.g. "A", "B"). Omit to let the workbench pick the next free name.',
        },
        rows: { type: 'integer', minimum: 1, maximum: 8 },
        cols: { type: 'integer', minimum: 1, maximum: 8 },
        entries: {
          type: 'array',
          description: 'Row-major 2D array of string entries with shape [rows][cols].',
          items: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['rows', 'cols', 'entries'],
    },
  },
  {
    name: 'add_vector',
    description: 'Add a vector to the workbench.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        orient: { type: 'string', enum: ['col', 'row'] },
        entries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
      },
      required: ['orient', 'entries'],
    },
  },
  {
    name: 'add_scalar',
    description: 'Add a scalar value to the workbench.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'set_code',
    description:
      'Replace the editor contents with Sage code that uses the workbench object names.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
  },
  {
    name: 'append_code',
    description: 'Append Sage code to the editor on a new line.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
  },
  {
    name: 'clear_workbench',
    description:
      'Remove all objects from the workbench. Use only when the user explicitly asks to start over.',
    parameters: {
      type: 'object',
      properties: { confirm: { type: 'boolean', enum: [true] } },
      required: ['confirm'],
    },
  },
] as const;
