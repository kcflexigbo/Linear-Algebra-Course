import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bb } from '../lib/butterbaseClient';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromSession(session: { user?: { id: string; email: string } } | null): AuthUser | null {
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const session = bb.sessionManager.restoreSession();
    const u = userFromSession(session as never);
    if (u) {
      setUser(u);
      setStatus('authenticated');
    } else {
      setStatus('anonymous');
    }

    const sub = bb.onAuthStateChange((_event, sess) => {
      const next = userFromSession(sess as never);
      if (next) {
        setUser(next);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    });
    return () => {
      sub.unsubscribe();
    };
  }, []);

  async function sendCode(email: string): Promise<void> {
    const { error } = await bb.auth.sendMagicLink(email);
    if (error) throw new Error(error.message ?? 'Failed to send code');
  }

  async function verifyCode(email: string, code: string): Promise<void> {
    const { error } = await bb.auth.verifyMagicLink(email, code);
    if (error) throw new Error(error.message ?? 'Invalid code');
  }

  async function signOut(): Promise<void> {
    await bb.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ status, user, sendCode, verifyCode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
