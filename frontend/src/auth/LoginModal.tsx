import { useState } from 'react';
import { useAuth } from './AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: Props) {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'enter-email' | 'enter-code'>('enter-email');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function reset() {
    setEmail('');
    setCode('');
    setStage('enter-email');
    setErr(null);
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await sendCode(email.trim());
      setStage('enter-code');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), code.trim());
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sign in</h2>
        {stage === 'enter-email' && (
          <form onSubmit={submitEmail}>
            <p>Enter your email — we'll send you a 6-digit sign-in code.</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              disabled={busy}
            />
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
            </div>
          </form>
        )}
        {stage === 'enter-code' && (
          <form onSubmit={submitCode}>
            <p>Check <strong>{email}</strong> for a 6-digit code and enter it below.</p>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              disabled={busy}
            />
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => { setStage('enter-email'); setErr(null); setCode(''); }} disabled={busy}>
                Use a different email
              </button>
              <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Sign in'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
