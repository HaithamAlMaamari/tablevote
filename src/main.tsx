import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { Toaster } from 'sonner'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <MotionConfig reducedMotion="user">
        <App />
        <Toaster position="bottom-center" toastOptions={{ style: { background: "#2B2420", color: "#FFFDF8", borderRadius: 12, border: "none", marginBottom: 90 } }} />
      </MotionConfig>
    </HashRouter>
  </StrictMode>,
)
