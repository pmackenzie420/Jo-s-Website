import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import { initSentry } from './sentry.js'
import {
  cleanupStaleBundleReloadState,
  isLikelyStaleBundleErrorLike,
  reloadOnceForStaleBundle
} from './utils/staleBundle.js'
import './styles/global.css'

initSentry()

if (import.meta.env.PROD) {
  cleanupStaleBundleReloadState()

  // Auto-recover from chunk/preload failures right after a deploy.
  window.addEventListener('vite:preloadError', (event) => {
    event?.preventDefault?.()
    reloadOnceForStaleBundle()
  })

  window.addEventListener('error', (event) => {
    if (!isLikelyStaleBundleErrorLike(event?.error || event)) return
    reloadOnceForStaleBundle()
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!isLikelyStaleBundleErrorLike(event?.reason)) return
    event?.preventDefault?.()
    reloadOnceForStaleBundle()
  })

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
