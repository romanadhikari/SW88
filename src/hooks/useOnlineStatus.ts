import { useCallback, useEffect, useRef, useState } from 'react';

async function probeConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [justReconnected, setJustReconnected] = useState<boolean>(false);

  const wasOfflineRef = useRef<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const reconnectTimerRef = useRef<number | null>(null);

  const markRestored = useCallback(() => {
    setIsOnline(true);
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setJustReconnected(true);
      window.dispatchEvent(new CustomEvent('sw88:reconnected'));
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        setJustReconnected(false);
      }, 1800);
    }
  }, []);

  const retryNow = useCallback(async () => {
    setIsChecking(true);
    try {
      const reachable = await probeConnectivity();
      if (reachable) {
        markRestored();
      } else {
        wasOfflineRef.current = true;
        setIsOnline(false);
      }
      return reachable;
    } finally {
      setIsChecking(false);
    }
  }, [markRestored]);

  useEffect(() => {
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setJustReconnected(false);
      setIsOnline(false);
    };

    const handleOnline = async () => {
      setIsChecking(true);
      try {
        const reachable = await probeConnectivity();
        if (reachable || navigator.onLine) {
          markRestored();
        }
      } finally {
        setIsChecking(false);
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [markRestored]);

  // Automatic background reconnection scanner while offline
  useEffect(() => {
    if (isOnline) return;
    const interval = window.setInterval(() => {
      retryNow();
    }, 2800);
    return () => window.clearInterval(interval);
  }, [isOnline, retryNow]);

  return {
    isOnline,
    isChecking,
    justReconnected,
    retryNow,
  };
}
