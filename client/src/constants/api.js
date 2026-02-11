const isBrowser = typeof window !== 'undefined';
const isLocalDevHost = isBrowser
  ? /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  : true;

// Force same-origin API in production so hosting rewrites control backend routing.
const rawBase = isLocalDevHost ? (import.meta.env.VITE_API_URL || '') : '';
const trimmedBase = rawBase.replace(/\/+$/, '');

const API_URL = trimmedBase
  ? (trimmedBase.endsWith('/api') ? trimmedBase : `${trimmedBase}/api`)
  : '/api';

export { API_URL };
