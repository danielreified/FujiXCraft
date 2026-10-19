import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { LightboxProvider } from './Lightbox.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <LightboxProvider>
    <App />
  </LightboxProvider>,
)
