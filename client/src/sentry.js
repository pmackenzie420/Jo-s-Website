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
    integrations: [Sentry.browserTracingIntegration()]
  })

  initialized = true
}

export { initSentry }
