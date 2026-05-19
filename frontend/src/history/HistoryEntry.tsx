import { useState } from 'react';
import type { Calculation } from '../types';

interface Props {
  entry: Calculation;
  onLoad: (entry: Calculation) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function HistoryEntry({ entry, onLoad, onDelete, onRename }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const displayTitle =
    entry.title && entry.title.length > 0 ? entry.title : entry.preview || '(empty)';
  const isPlaceholder = !entry.title;

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    try {
      await onRename(entry.id, t);
      setRenaming(false);
    } catch (err) {
      console.warn('rename failed', err);
    }
  }

  return (
    <li className="history-entry">
      {renaming ? (
        <form onSubmit={submitRename} className="history-rename-form">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            maxLength={200}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <button
            className="history-entry-load"
            onClick={() => onLoad(entry)}
            title="Load this calculation"
          >
            <span className={isPlaceholder ? 'history-title-placeholder' : 'history-title'}>
              {displayTitle}
            </span>
            <span className="history-meta">
              {entry.objects.map((o) => o.name).join(', ') || '(no objects)'} ·{' '}
              {relativeTime(entry.created_at)}
            </span>
          </button>
          <span className="history-actions">
            <button
              onClick={() => {
                setDraft(entry.title ?? entry.preview ?? '');
                setRenaming(true);
              }}
              title="Rename"
            >
              ✎
            </button>
            <button onClick={() => onDelete(entry.id)} title="Delete">×</button>
          </span>
        </>
      )}
    </li>
  );
}
