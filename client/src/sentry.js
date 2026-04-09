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

const APPLE_VENDOR = 'Apple Computer, Inc.'
const ALTERNATIVE_APPLE_WEBKIT_BROWSER_PATTERN = /CriOS|FxiOS|EdgiOS|EdgA|Edg|OPiOS|OPR|Chrome|Chromium|Firefox|DuckDuckGo/i
const APPLE_MAIL_NOISE_PATTERN = /\bbird_[a-z0-9_]+\b/i

const isAppleWebKit = () => {
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''
  const vendor = navigator.vendor || ''
  const platform = navigator.platform || ''
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0)

  const isApplePlatform = /iPad|iPhone|iPod|Macintosh/.test(ua)
    || /iPad|iPhone|iPod|Mac/.test(platform)
    || vendor === APPLE_VENDOR
    || (platform === 'MacIntel' && maxTouchPoints > 1)

  if (!isApplePlatform) return false

  const isWebKit = /AppleWebKit/i.test(ua)
  const isAlternativeBrowser = ALTERNATIVE_APPLE_WEBKIT_BROWSER_PATTERN.test(ua)

  return isWebKit && !isAlternativeBrowser
}

const shouldEnableBrowserTracing = () => {
  const browserTracingEnabled = parseBoolean(
    import.meta.env.VITE_SENTRY_ENABLE_BROWSER_TRACING,
    true
  )

  if (!browserTracingEnabled) return false

  // Browser tracing boots web-vitals observers. Apple WebKit browsers and
  // embedded webviews have produced startup/runtime crashes in production,
  // including iOS WKWebView and macOS Apple Mail. Keep error reporting on but
  // skip tracing on that browser family.
  return !isAppleWebKit()
}

let initialized = false

const STALE_BUNDLE_MESSAGE_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'unable to preload css for /assets/',
  'loading chunk',
  'chunkloaderror'
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

const readStringProperty = (value, key) => {
  try {
    const candidate = value?.[key]
    return typeof candidate === 'string' ? candidate : ''
  } catch {
    return ''
  }
}

const toSafeText = (value) => {
  try {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value).trim()
    }
  } catch {
    return ''
  }

  if (!value || typeof value !== 'object') return ''

  const name = readStringProperty(value, 'name').trim()
  const message = readStringProperty(value, 'message').trim()
  if (name && message) return `${name}: ${message}`
  return name || message
}

const getErrorText = (event, hint) => {
  const parts = []
  const push = (value) => {
    const text = toSafeText(value)
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

const getEventStringValue = (event, path, tagKey) => {
  try {
    const contextValue = path.reduce((value, key) => value?.[key], event)
    if (typeof contextValue === 'string' && contextValue.trim()) {
      return contextValue.trim()
    }
  } catch {
    // Ignore context lookup issues and fall back to tags.
  }

  try {
    const tagValue = event?.tags?.[tagKey]
    return typeof tagValue === 'string' ? tagValue.trim() : ''
  } catch {
    return ''
  }
}

const isAppleMailRuntimeNoise = (event, hint) => {
  const browserName = getEventStringValue(event, ['contexts', 'browser', 'name'], 'browser.name').toLowerCase()
  const deviceFamily = getEventStringValue(event, ['contexts', 'device', 'family'], 'device.family').toLowerCase()

  if (browserName !== 'apple mail' || deviceFamily !== 'mac') {
    return false
  }

  return APPLE_MAIL_NOISE_PATTERN.test(getErrorText(event, hint))
}

const isLikelyStaleBundleError = (event, hint) => {
  const text = getErrorText(event, hint)
  const stackFiles = getStackFilenames(event)

  const hasAssetPathInStack = stackFiles.some((file) => /\/assets\/.+\.(js|css)\b/i.test(file))
  const hasAssetPathInMessage = /\/assets\/.+\.(js|css)\b/i.test(text)
    || text.includes('for /assets/')
  const hasHashedAssetFile = stackFiles.some((file) =>
    /\/assets\/[a-z0-9._-]+-[a-z0-9_-]{6,}\.(js|css)\b/i.test(file)
  )
  const hasKnownMessage = STALE_BUNDLE_MESSAGE_PATTERNS.some((pattern) =>
    text.includes(pattern)
  )
  const hasLikelyStaleLoadFailed = text.includes('load failed')
    && hasAssetPathInMessage
    && (
      text.includes('module')
      || text.includes('chunk')
      || text.includes('import')
      || text.includes('preload')
    )
  const hasCannotReadDefaultMismatch = (
    text.includes("cannot read properties of undefined (reading 'default')")
    || text.includes('cannot read properties of undefined (reading "default")')
  ) && (
    hasAssetPathInMessage
    || hasAssetPathInStack
    || hasHashedAssetFile
    || stackFiles.some((file) => file.includes('/assets/index-'))
  )
  const hasReactLazyResultMismatch = (
    /_+result\.default/.test(text)
    || text.includes("undefined is not an object (evaluating 'b._result.default')")
    || text.includes("undefined is not an object (evaluating 'b.__result.default')")
  )
    && (hasHashedAssetFile || stackFiles.some((file) => file.includes('/assets/index-')))

  return (
    (hasKnownMessage && (hasAssetPathInMessage || hasHashedAssetFile))
    || (hasLikelyStaleLoadFailed && (hasAssetPathInStack || hasHashedAssetFile))
    || hasCannotReadDefaultMismatch
    || hasReactLazyResultMismatch
  )
}

const buildSentryOptions = (integrations) => ({
  dsn: import.meta.env.VITE_SENTRY_DSN || '',
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',
  release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
  sendDefaultPii: parseBoolean(import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII, false),
  tracesSampleRate: parseSampleRate(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
    import.meta.env.PROD ? 0.05 : 1
  ),
  integrations,
  beforeSend(event, hint) {
    // Fail open: never let filter logic crash error reporting.
    try {
      if (isLikelyStaleBundleError(event, hint)) return null
      if (isAppleMailRuntimeNoise(event, hint)) return null
    } catch {
      return event
    }
    return event
  }
})

const initSentry = () => {
  if (initialized) return
  const dsn = (import.meta.env.VITE_SENTRY_DSN || '').trim()
  if (!dsn) return
  const enabled = parseBoolean(import.meta.env.VITE_SENTRY_ENABLED, true)
  if (!enabled) return

  if (shouldEnableBrowserTracing()) {
    try {
      Sentry.init(buildSentryOptions([Sentry.browserTracingIntegration()]))
      initialized = true
      return
    } catch {
      // If tracing bootstrap crashes in a browser-specific runtime, keep
      // Sentry error reporting enabled rather than taking down the app.
    }
  }

  Sentry.init(buildSentryOptions([]))

  initialized = true
}

export { initSentry }
