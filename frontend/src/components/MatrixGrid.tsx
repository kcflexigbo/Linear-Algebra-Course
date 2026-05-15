import { useRef } from 'react';
import type { WorkbenchObject } from '../types';

interface Props {
  obj: WorkbenchObject;
  onCell: (r: number, c: number, val: string) => void;
}

export function MatrixGrid({ obj, onCell }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const map: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      Tab: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      Enter: [r + 1, c],
      ArrowUp: [r - 1, c],
    };
    const next = map[e.key];
    if (!next) return;
    if (e.key === 'Tab' && e.shiftKey) return;
    let [nr, nc] = next;
    if (nc >= obj.cols) { nc = 0; nr++; }
    if (nc < 0) { nc = obj.cols - 1; nr--; }
    if (nr < 0 || nr >= obj.rows) return;
    e.preventDefault();
    const target = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-r="${nr}"][data-c="${nc}"]`
    );
    if (target) { target.focus(); target.select(); }
  }

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < obj.rows; r++) {
    for (let c = 0; c < obj.cols; c++) {
      const key = `${r},${c}`;
      cells.push(
        <input
          key={key}
          className="cell"
          type="text"
          placeholder="0"
          defaultValue={obj.values[key] ?? ''}
          data-r={r}
          data-c={c}
          onChange={(e) => onCell(r, c, e.target.value)}
          onKeyDown={(e) => handleKey(e, r, c)}
        />
      );
    }
  }

  return (
    <div
      ref={gridRef}
      className="matrix-input"
      style={{ gridTemplateColumns: `repeat(${obj.cols}, minmax(36px, 1fr))` }}
    >
      {cells}
    </div>
  );
}
