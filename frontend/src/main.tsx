import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { SharedView } from './share/SharedView'

function getShareSlug(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('c');
  if (fromQuery && /^[A-Za-z0-9]+$/.test(fromQuery)) return fromQuery;
  const pathMatch = window.location.pathname.match(/^\/c\/([A-Za-z0-9]+)\/?$/);
  return pathMatch ? pathMatch[1] : null;
}

function Root() {
  const slug = getShareSlug();
  if (slug) {
    return <SharedView slug={slug} />;
  }
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
