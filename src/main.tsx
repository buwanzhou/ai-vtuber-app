import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import GeminiVoicePage from './GeminiVoicePage.tsx'

const isVoicePage = window.location.pathname === '/voice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isVoicePage ? <GeminiVoicePage /> : <App />}
  </StrictMode>,
)
