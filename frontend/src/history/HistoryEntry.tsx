import { useState } from 'react';
import type { Calculation } from '../types';

interface Props {
  entry: Calculation;
  onLoad: (entry: Calculation) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onSetShared: (id: string, isPublic: boolean) => Promise<Calculation | null>;
}

function shareUrl(slug: string): string {
  return `${window.location.origin}/c/${slug}`;
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

export function HistoryEntry({ entry, onLoad, onDelete, onRename, onSetShared }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleShareToggle(next: boolean) {
    setShareBusy(true);
    try {
      await onSetShared(entry.id, next);
      if (next) setSharing(true);
    } catch (err) {
      console.warn('share toggle failed', err);
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareUrl() {
    if (!entry.slug) return;
    try {
      await navigator.clipboard.writeText(shareUrl(entry.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  }

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
              onClick={() => setSharing((v) => !v)}
              title={entry.public ? 'Sharing — click to manage' : 'Share'}
              className={entry.public ? 'history-action-shared' : ''}
            >
              {entry.public ? '🔗' : '↗'}
            </button>
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
      {sharing && (
        <div className="history-share">
          {entry.public && entry.slug ? (
            <>
              <div className="history-share-row">
                <input
                  type="text"
                  readOnly
                  value={shareUrl(entry.slug)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button onClick={copyShareUrl} disabled={shareBusy}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="history-share-actions">
                <span className="history-share-note">Anyone with this link can view (read-only).</span>
                <button onClick={() => handleShareToggle(false)} disabled={shareBusy}>
                  Unshare
                </button>
              </div>
            </>
          ) : (
            <div className="history-share-actions">
              <span className="history-share-note">Not shared yet.</span>
              <button onClick={() => handleShareToggle(true)} disabled={shareBusy}>
                {shareBusy ? 'Sharing…' : 'Create share link'}
              </button>
              <button onClick={() => setSharing(false)} disabled={shareBusy}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
