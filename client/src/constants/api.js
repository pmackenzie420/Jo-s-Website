const rawBase = import.meta.env.VITE_API_URL || '';
const trimmedBase = rawBase.replace(/\/+$/, '');

const API_URL = trimmedBase
  ? (trimmedBase.endsWith('/api') ? trimmedBase : `${trimmedBase}/api`)
  : '/api';

export { API_URL };
