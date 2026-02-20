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
  const RELOAD_QUERY_PARAM = 'joreload';
  const reloadOnce = (storageKey) => {
    try {
      if (!window.sessionStorage.getItem(storageKey)) {
        window.sessionStorage.setItem(storageKey, '1');
        window.location.reload();
      }
      return;
    } catch {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get(RELOAD_QUERY_PARAM) !== '1') {
          url.searchParams.set(RELOAD_QUERY_PARAM, '1');
          window.location.replace(url.toString());
        }
      } catch {
        window.location.reload();
      }
    }
  };

  // Clean one-time reload query guard once app boots successfully.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(RELOAD_QUERY_PARAM) === '1') {
      url.searchParams.delete(RELOAD_QUERY_PARAM);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Ignore URL parsing issues.
  }

  // Auto-recover from chunk/preload failures right after a deploy.
  window.addEventListener('vite:preloadError', (event) => {
    event?.preventDefault?.();
    reloadOnce('jowebsite:preload-reload-attempted');
  });

  window.addEventListener('error', (event) => {
    const message = String(event?.error?.message || event?.message || '');
    if (!message.includes('Unable to preload CSS for /assets/')) return;
    reloadOnce('jowebsite:preload-reload-attempted');
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
