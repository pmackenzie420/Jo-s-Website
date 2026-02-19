import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import { initSentry } from './sentry.js'
import './styles/global.css'

initSentry()

if (import.meta.env.PROD) {
  // Auto-recover from chunk/preload failures right after a deploy.
  window.addEventListener('vite:preloadError', (event) => {
    event?.preventDefault?.();
    const key = 'jowebsite:preload-reload-attempted';
    try {
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    } catch { /* storage blocked (e.g. Facebook in-app browser) */ }
  });

  window.addEventListener('error', (event) => {
    const message = String(event?.error?.message || event?.message || '');
    if (!message.includes('Unable to preload CSS for /assets/')) return;
    const key = 'jowebsite:preload-reload-attempted';
    try {
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    } catch { /* storage blocked */ }
  });

  inject()
  injectSpeedInsights()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
