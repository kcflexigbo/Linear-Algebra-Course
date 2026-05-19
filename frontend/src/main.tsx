import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { SharedView } from './share/SharedView'

function Root() {
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/c\/([A-Za-z0-9]+)\/?$/);
  if (shareMatch) {
    return <SharedView slug={shareMatch[1]} />;
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
