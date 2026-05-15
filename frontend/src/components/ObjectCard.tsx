import { useRef } from 'react';
import type { WorkbenchObject } from '../types';
import { MatrixGrid } from './MatrixGrid';

interface Props {
  obj: WorkbenchObject;
  onRemove: (id: number) => void;
  onDuplicate: (id: number) => void;
  onNameChange: (id: number, name: string) => void;
  onDimChange: (id: number, which: 'rows' | 'cols', val: number) => void;
  onVectorLen: (id: number, val: number) => void;
  onVectorOrient: (id: number, orient: 'col' | 'row') => void;
  onCell: (id: number, r: number, c: number, val: string) => void;
  onScalar: (id: number, val: string) => void;
}

export function ObjectCard({
  obj,
  onRemove,
  onDuplicate,
  onNameChange,
  onDimChange,
  onVectorLen,
  onVectorOrient,
  onCell,
  onScalar,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);

  function handleNameBlur() {
    if (nameRef.current) onNameChange(obj.id, nameRef.current.value);
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') nameRef.current?.blur();
    if (e.key === 'Escape') {
      if (nameRef.current) nameRef.current.value = obj.name;
      nameRef.current?.blur();
    }
  }

  return (
    <div className={`obj ${obj.kind}`}>
      <div className="obj-head">
        <div>
          <input
            ref={nameRef}
            className="obj-name"
            defaultValue={obj.name}
            maxLength={6}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
          />
        </div>
        <div className="obj-meta">
          {obj.kind === 'matrix' && (
            <span className="dims">
              <input
                type="number"
                min={1}
                max={8}
                defaultValue={obj.rows}
                onChange={(e) => onDimChange(obj.id, 'rows', parseInt(e.target.value))}
              />
              {' × '}
              <input
                type="number"
                min={1}
                max={8}
                defaultValue={obj.cols}
                onChange={(e) => onDimChange(obj.id, 'cols', parseInt(e.target.value))}
              />
            </span>
          )}
          {obj.kind === 'vector' && (
            <>
              <select
                value={obj.orient ?? 'col'}
                onChange={(e) => onVectorOrient(obj.id, e.target.value as 'col' | 'row')}
              >
                <option value="col">column</option>
                <option value="row">row</option>
              </select>
              {' · '}
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={Math.max(obj.rows, obj.cols)}
                onChange={(e) => onVectorLen(obj.id, parseInt(e.target.value))}
              />
              {' entries'}
            </>
          )}
          {obj.kind === 'scalar' && <span>scalar</span>}
        </div>
      </div>

      {obj.kind === 'scalar' ? (
        <input
          className="scalar-input"
          type="text"
          placeholder="0"
          defaultValue={obj.values['0,0'] ?? ''}
          onChange={(e) => onScalar(obj.id, e.target.value)}
        />
      ) : (
        <MatrixGrid obj={obj} onCell={(r, c, val) => onCell(obj.id, r, c, val)} />
      )}

      <div className="obj-actions">
        <button className="icon-btn" title="duplicate" onClick={() => onDuplicate(obj.id)}>⧉</button>
        <button className="icon-btn" title="delete" onClick={() => onRemove(obj.id)}>×</button>
      </div>
    </div>
  );
}
