const RELOAD_QUERY_PARAM = 'joreload'
const STALE_BUNDLE_RELOAD_KEY = 'jowebsite:stale-bundle-reload-attempted'
const STALE_BUNDLE_GUARD_RESET_DELAY_MS = 15000

const STALE_BUNDLE_MESSAGE_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'unable to preload css for /assets/',
  'loading chunk',
  'chunkloaderror',
  'load failed'
]

const ASSET_PATH_REGEX = /\/assets\/.+\.(js|css)\b/i
const HASHED_ASSET_REGEX = /\/assets\/[a-z0-9._-]+-[a-z0-9_-]{6,}\.(js|css)\b/i

const normalizeText = (value) => String(value || '').trim().toLowerCase()

const hasLazyDefaultMismatchText = (text) => (
  text.includes("cannot read properties of undefined (reading 'default')")
  || text.includes('cannot read properties of undefined (reading "default")')
  || /_+result\.default/.test(text)
  || text.includes("undefined is not an object (evaluating 'b._result.default')")
  || text.includes("undefined is not an object (evaluating 'b.__result.default')")
)

const getMessageAndStack = (value) => {
  if (typeof value === 'string') {
    return { message: normalizeText(value), stack: '' }
  }

  if (!value || typeof value !== 'object') {
    return { message: '', stack: '' }
  }

  const message = normalizeText(value.message)
  const stack = normalizeText(value.stack)
  return { message, stack }
}

const isLikelyStaleBundleMessage = (messageValue, stackValue = '') => {
  const message = normalizeText(messageValue)
  const stack = normalizeText(stackValue)
  const combined = `${message}\n${stack}`

  const hasAssetPathInMessage = ASSET_PATH_REGEX.test(message) || message.includes('for /assets/')
  const hasAssetPathInStack = ASSET_PATH_REGEX.test(stack)
  const hasHashedAssetPath = HASHED_ASSET_REGEX.test(combined)
  const hasIndexAssetPath = combined.includes('/assets/index-')
  const hasKnownMessage = STALE_BUNDLE_MESSAGE_PATTERNS.some((pattern) => combined.includes(pattern))
  const hasAssetPath = hasAssetPathInMessage || hasAssetPathInStack || hasHashedAssetPath || hasIndexAssetPath
  const hasLazyDefaultMismatch = hasLazyDefaultMismatchText(combined) && hasAssetPath

  return (hasKnownMessage && hasAssetPath) || hasLazyDefaultMismatch
}

const isLikelyStaleBundleErrorLike = (value) => {
  const { message, stack } = getMessageAndStack(value)
  return isLikelyStaleBundleMessage(message, stack)
}

const reloadOnceForStaleBundle = () => {
  if (typeof window === 'undefined') return false

  let hasReloadQueryParam = false
  try {
    const currentUrl = new URL(window.location.href)
    hasReloadQueryParam = currentUrl.searchParams.get(RELOAD_QUERY_PARAM) === '1'
  } catch {
    hasReloadQueryParam = false
  }

  try {
    if (window.sessionStorage.getItem(STALE_BUNDLE_RELOAD_KEY) || hasReloadQueryParam) {
      return false
    }
    window.sessionStorage.setItem(STALE_BUNDLE_RELOAD_KEY, '1')
  } catch {
    if (hasReloadQueryParam) {
      return false
    }
  }

  try {
    const url = new URL(window.location.href)
    url.searchParams.set(RELOAD_QUERY_PARAM, '1')
    window.location.replace(url.toString())
    return true
  } catch {
    window.location.reload()
    return true
  }
}

const cleanupStaleBundleReloadState = () => {
  if (typeof window === 'undefined') return

  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get(RELOAD_QUERY_PARAM) !== '1') {
      // Keep going so the one-shot guard can still expire after a stable boot.
    } else {
      url.searchParams.delete(RELOAD_QUERY_PARAM)
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  } catch {
    // Ignore URL parsing issues.
  }

  window.setTimeout(() => {
    try {
      window.sessionStorage.removeItem(STALE_BUNDLE_RELOAD_KEY)
    } catch {
      // Ignore storage cleanup issues.
    }
  }, STALE_BUNDLE_GUARD_RESET_DELAY_MS)
}

export {
  cleanupStaleBundleReloadState,
  isLikelyStaleBundleErrorLike,
  isLikelyStaleBundleMessage,
  reloadOnceForStaleBundle
}
