import { useState } from 'react';
import { useHistory } from './useHistory';
import { HistoryEntry } from './HistoryEntry';
import type { Calculation } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (entry: Calculation) => void;
}

export function HistoryModal({ open, onClose, onLoad }: Props) {
  const history = useHistory(open);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!open) return null;

  async function handleClear() {
    try {
      await history.clearAll();
      setConfirmClear(false);
    } catch (e) {
      console.warn('clearAll failed', e);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>History</h2>
          <div className="modal-header-actions">
            {history.entries.length > 0 && !confirmClear && (
              <button onClick={() => setConfirmClear(true)}>Clear all</button>
            )}
            {confirmClear && (
              <>
                <span>Delete all entries?</span>
                <button onClick={handleClear}>Yes</button>
                <button onClick={() => setConfirmClear(false)}>No</button>
              </>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        {history.loading && <p>Loading…</p>}
        {history.error && <p className="error">{history.error}</p>}
        {!history.loading && history.entries.length === 0 && (
          <p>No history yet. Run an evaluation to populate this list.</p>
        )}
        <ul className="history-list">
          {history.entries.map((e) => (
            <HistoryEntry
              key={e.id}
              entry={e}
              onLoad={onLoad}
              onDelete={history.deleteEntry}
              onRename={history.rename}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
