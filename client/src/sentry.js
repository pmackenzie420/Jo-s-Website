import * as Sentry from '@sentry/react'

const parseSampleRate = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0 || parsed > 1) return fallback
  return parsed
}

const parseBoolean = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes'].includes(normalized)) return true
  if (['0', 'false', 'no'].includes(normalized)) return false
  return fallback
}

let initialized = false

const STALE_BUNDLE_MESSAGE_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'unable to preload css for /assets/',
  'loading chunk',
  'chunkloaderror',
  'load failed'
]

const getStackFilenames = (event) => {
  const values = Array.isArray(event?.exception?.values) ? event.exception.values : []
  const names = []
  for (const value of values) {
    const frames = Array.isArray(value?.stacktrace?.frames) ? value.stacktrace.frames : []
    for (const frame of frames) {
      const file = String(frame?.filename || '').trim()
      if (file) names.push(file)
    }
  }
  return names
}

const getErrorText = (event, hint) => {
  const parts = []
  const push = (value) => {
    const text = String(value || '').trim()
    if (text) parts.push(text)
  }
  push(event?.message)
  const values = Array.isArray(event?.exception?.values) ? event.exception.values : []
  for (const value of values) {
    push(value?.type)
    push(value?.value)
  }
  push(hint?.originalException?.message)
  push(hint?.originalException)
  return parts.join('\n').toLowerCase()
}

const isLikelyStaleBundleError = (event, hint) => {
  const text = getErrorText(event, hint)
  const stackFiles = getStackFilenames(event)

  const hasAssetPath = text.includes('/assets/')
    || stackFiles.some((file) => /\/assets\/.+\.(js|css)\b/i.test(file))
  const hasHashedAssetFile = stackFiles.some((file) =>
    /\/assets\/[a-z0-9._-]+-[a-z0-9_-]{6,}\.(js|css)\b/i.test(file)
  )
  const hasKnownMessage = STALE_BUNDLE_MESSAGE_PATTERNS.some((pattern) =>
    text.includes(pattern)
  )
  const hasReactLazyResultMismatch = text.includes('__result.default')
    && (hasHashedAssetFile || stackFiles.some((file) => file.includes('/assets/index-')))

  return (hasKnownMessage && hasAssetPath) || hasReactLazyResultMismatch
}

const initSentry = () => {
  if (initialized) return
  const dsn = (import.meta.env.VITE_SENTRY_DSN || '').trim()
  if (!dsn) return
  const enabled = parseBoolean(import.meta.env.VITE_SENTRY_ENABLED, true)
  if (!enabled) return

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: parseBoolean(import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII, false),
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      import.meta.env.PROD ? 0.05 : 1
    ),
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event, hint) {
      if (isLikelyStaleBundleError(event, hint)) {
        return null
      }
      return event
    }
  })

  initialized = true
}

export { initSentry }
