import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import './index.css'
import App from './App.tsx'
import { loadSettings } from './lib/settings'

// The webview can't open new windows; send external links to the system browser.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="http"]')
  if (!link) return
  e.preventDefault()
  void openUrl(link.href)
})

// Settings come from the backend (OS config dir), so read them before the first render.
void loadSettings().then((settings) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialSettings={settings} />
    </StrictMode>,
  )
})
