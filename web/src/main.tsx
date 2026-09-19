import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { App } from './app'
import { Toaster } from './components/ui/sonner'
import './index.css'
import { ChannelPage } from './pages/channel'
import { History } from './pages/history'
import { Login } from './pages/login'
import { ScopePage } from './pages/scope'
import { Scopes } from './pages/scopes'
import { Settings } from './pages/settings'
import { Tokens } from './pages/tokens'

// Theme follows the OS.
const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
applyTheme()
dark.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<><Login /><Toaster /></>} />
        <Route element={<App />}>
          <Route path="/" element={<Scopes />} />
          <Route path="/s/:scope" element={<ScopePage />} />
          <Route path="/s/:scope/:channel" element={<ChannelPage />} />
          <Route path="/history" element={<History />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
