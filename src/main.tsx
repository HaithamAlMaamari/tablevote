import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { Toaster } from 'sonner';
import { MotionConfig } from 'framer-motion';
import './index.css';
import App from './App.tsx';

void import('./lib/fonts').then(({ loadLocalFonts }) => loadLocalFonts());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <MotionConfig reducedMotion="user">
        <App />
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: '#241329',
              color: '#FCFDF8',
              borderRadius: 2,
              border: '2px solid #FCFDF8',
              boxShadow: '4px 4px 0 #2457FF',
              marginBottom: 90,
              fontFamily: '"Source Sans 3 Variable", sans-serif',
            },
          }}
        />
      </MotionConfig>
    </HashRouter>
  </StrictMode>,
);
