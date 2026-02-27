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
  const STALE_BUNDLE_RELOAD_KEY = 'jowebsite:stale-bundle-reload-attempted';
  const STALE_BUNDLE_MESSAGE_PATTERNS = [
    'failed to fetch dynamically imported module',
    'importing a module script failed',
    'unable to preload css for /assets/',
    'loading chunk',
    'chunkloaderror',
    'load failed'
  ];
  const ASSET_PATH_REGEX = /\/assets\/.+\.(js|css)\b/i;
  const HASHED_ASSET_REGEX = /\/assets\/[a-z0-9._-]+-[a-z0-9_-]{6,}\.(js|css)\b/i;

  const hasLazyDefaultMismatchText = (text) => (
    text.includes("cannot read properties of undefined (reading 'default')")
    || text.includes('cannot read properties of undefined (reading "default")')
    || /_+result\.default/.test(text)
    || text.includes("undefined is not an object (evaluating 'b._result.default')")
    || text.includes("undefined is not an object (evaluating 'b.__result.default')")
  );

  const isLikelyStaleBundleRuntimeError = (event) => {
    const message = String(event?.error?.message || event?.message || '').toLowerCase();
    const stack = String(event?.error?.stack || '').toLowerCase();
    const hasAssetPathInMessage = ASSET_PATH_REGEX.test(message) || message.includes('for /assets/');
    const hasAssetPathInStack = ASSET_PATH_REGEX.test(stack);
    const hasHashedAssetPath = HASHED_ASSET_REGEX.test(`${message}\n${stack}`);
    const hasKnownStaleMessage = STALE_BUNDLE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
    const hasLikelyLazyDefaultMismatch = hasLazyDefaultMismatchText(message)
      && (hasAssetPathInMessage || hasAssetPathInStack || hasHashedAssetPath || stack.includes('/assets/index-'));

    return (hasKnownStaleMessage && (hasAssetPathInMessage || hasAssetPathInStack || hasHashedAssetPath))
      || hasLikelyLazyDefaultMismatch;
  };

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
    reloadOnce(STALE_BUNDLE_RELOAD_KEY);
  });

  window.addEventListener('error', (event) => {
    if (!isLikelyStaleBundleRuntimeError(event)) return;
    reloadOnce(STALE_BUNDLE_RELOAD_KEY);
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
