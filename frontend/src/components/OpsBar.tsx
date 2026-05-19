import { useEffect, useState } from 'react';
import type { WorkbenchObject } from '../types';

interface Op {
  label: string;
  kinds: Array<WorkbenchObject['kind']>;
  /** Build the Sage expression. {n} is replaced with the object name. */
  build: (name: string) => string;
}

const OPS: Op[] = [
  { label: 'RREF',           kinds: ['matrix'], build: (n) => `show(${n}.rref())` },
  { label: 'det',            kinds: ['matrix'], build: (n) => `show(${n}.det())` },
  { label: 'inverse',        kinds: ['matrix'], build: (n) => `show(${n}.inverse())` },
  { label: 'rank',           kinds: ['matrix'], build: (n) => `show(${n}.rank())` },
  { label: 'trace',          kinds: ['matrix'], build: (n) => `show(${n}.trace())` },
  { label: 'transpose',      kinds: ['matrix', 'vector'], build: (n) => `show(${n}.transpose())` },
  { label: 'eigenvalues',    kinds: ['matrix'], build: (n) => `show(${n}.eigenvalues())` },
  { label: 'eigenvectors',   kinds: ['matrix'], build: (n) => `show(${n}.eigenvectors_right())` },
  { label: 'char. poly',     kinds: ['matrix'], build: (n) => `show(${n}.charpoly())` },
  { label: 'null space',     kinds: ['matrix'], build: (n) => `show(${n}.right_kernel())` },
  { label: 'column space',   kinds: ['matrix'], build: (n) => `show(${n}.column_space())` },
  { label: 'norm',           kinds: ['vector'], build: (n) => `show(${n}.norm())` },
];

interface Props {
  objects: WorkbenchObject[];
  onInsert: (snip: string) => void;
}

export function OpsBar({ objects, onInsert }: Props) {
  const candidates = objects.filter((o) => o.kind === 'matrix' || o.kind === 'vector');
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (!selected && candidates.length > 0) {
      setSelected(candidates[0].name);
    } else if (selected && !candidates.some((o) => o.name === selected)) {
      setSelected(candidates[0]?.name ?? '');
    }
  }, [candidates, selected]);

  if (candidates.length === 0) return null;

  const active = candidates.find((o) => o.name === selected);
  const availableOps = active ? OPS.filter((op) => op.kinds.includes(active.kind)) : [];

  return (
    <div className="opsbar">
      <span className="opsbar-label">One-click ops on</span>
      <select
        className="opsbar-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {candidates.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name} ({o.kind})
          </option>
        ))}
      </select>
      <span className="opsbar-divider">·</span>
      {availableOps.map((op) => (
        <button
          key={op.label}
          className="opsbar-btn"
          onClick={() => active && onInsert(op.build(active.name) + '\n')}
        >
          {op.label}
        </button>
      ))}
    </div>
  );
}
