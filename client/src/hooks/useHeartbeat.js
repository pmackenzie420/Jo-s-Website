import { useEffect } from 'react';
import { API_URL } from '../constants/api';

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

export default function useHeartbeat(intervalMs = DEFAULT_INTERVAL_MS) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (import.meta.env.DEV) {
      return;
    }

    const ping = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      fetch(`${API_URL}/heartbeat`, { credentials: 'include' }).catch(() => {});
    };

    ping();
    const interval = window.setInterval(ping, intervalMs);

    return () => window.clearInterval(interval);
  }, [intervalMs]);
}
