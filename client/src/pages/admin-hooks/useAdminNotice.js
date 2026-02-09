import { useCallback, useEffect, useRef, useState } from 'react';

export default function useAdminNotice() {
  const [notice, setNotice] = useState(null);
  const timeoutRef = useRef(null);

  const clearNoticeTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearNoticeTimeout(), [clearNoticeTimeout]);

  const showToast = useCallback(
    (payload) => {
      setNotice(payload);
      clearNoticeTimeout();
      const duration =
        payload && Number.isFinite(payload.duration) ? payload.duration : 3000;
      if (duration === 0) return;
      timeoutRef.current = setTimeout(() => {
        setNotice((current) => (current === payload ? null : current));
        timeoutRef.current = null;
      }, duration);
    },
    [clearNoticeTimeout]
  );

  const handleNoticeAction = useCallback(() => {
    setNotice((current) => {
      if (!current?.action) return current;
      current.action();
      return null;
    });
  }, []);

  return {
    notice,
    setNotice,
    showToast,
    handleNoticeAction
  };
}
