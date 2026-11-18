import { useCallback, useEffect, useRef, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type AppHandoffState = 'idle' | 'redirecting' | 'opened' | 'manual_switch';

declare global {
  interface Window {
    __sw88InstallPrompt?: BeforeInstallPromptEvent | null;
    __sw88AppInstalled?: boolean;
  }
}

const INSTALLED_STORAGE_KEY = 'sw88_pwa_installed';
const OPEN_ATTEMPT_SESSION_KEY = 'sw88_open_app_attempted';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith('android-app://')
  );
}

function detectIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isClassicIos = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isIpadOs = /Macintosh/.test(ua) && (window.navigator.maxTouchPoints || 0) > 1;
  return isClassicIos || isIpadOs;
}

function detectAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android/i.test(window.navigator.userAgent || '');
}

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 1024;
  return mobileUa || coarsePointer || window.innerWidth < 768;
}

function readInstalledMarker(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeInstalledMarker(installed: boolean) {
  try {
    if (installed) {
      window.localStorage.setItem(INSTALLED_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(INSTALLED_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__sw88InstallPrompt || null : null
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandalone());
  const [justInstalled, setJustInstalled] = useState<boolean>(() =>
    typeof window !== 'undefined' ? Boolean(window.__sw88AppInstalled) : false
  );
  const [hasInstalledMarker, setHasInstalledMarker] = useState<boolean>(() =>
    typeof window !== 'undefined' ? readInstalledMarker() : false
  );
  const [detectedRelatedApp, setDetectedRelatedApp] = useState<boolean>(false);
  const [isIos, setIsIos] = useState<boolean>(() => detectIos());
  const [isAndroid, setIsAndroid] = useState<boolean>(() => detectAndroid());
  const [isMobile, setIsMobile] = useState<boolean>(() => detectMobile());
  const [isPrompting, setIsPrompting] = useState<boolean>(false);
  const [appHandoffState, setAppHandoffState] = useState<AppHandoffState>('idle');

  const handoffTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const syncEnvironment = () => {
      const standalone = detectStandalone();
      setIsStandalone(standalone);
      setIsIos(detectIos());
      setIsAndroid(detectAndroid());
      setIsMobile(detectMobile());
      if (standalone) {
        writeInstalledMarker(true);
        setHasInstalledMarker(true);
        setAppHandoffState('idle');
      }
    };

    const checkRelatedApps = () => {
      const nav = window.navigator as Navigator & {
        getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
      };
      if (typeof nav.getInstalledRelatedApps === 'function') {
        nav
          .getInstalledRelatedApps()
          .then((apps) => {
            if (Array.isArray(apps) && apps.length > 0) {
              setDetectedRelatedApp(true);
              writeInstalledMarker(true);
              setHasInstalledMarker(true);
            }
          })
          .catch(() => {
            // ignore
          });
      }
    };

    syncEnvironment();
    checkRelatedApps();

    if (window.__sw88InstallPrompt) {
      setDeferredPrompt(window.__sw88InstallPrompt);
      writeInstalledMarker(false);
      setHasInstalledMarker(false);
    }

    if (window.__sw88AppInstalled) {
      setJustInstalled(true);
      setHasInstalledMarker(true);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEv = e as BeforeInstallPromptEvent;
      window.__sw88InstallPrompt = promptEv;
      setDeferredPrompt(promptEv);
      // Browser fired install prompt -> app is not currently installed
      setDetectedRelatedApp(false);
      writeInstalledMarker(false);
      setHasInstalledMarker(false);
    };

    const onEarlyPromptReady = () => {
      if (window.__sw88InstallPrompt) {
        setDeferredPrompt(window.__sw88InstallPrompt);
        setDetectedRelatedApp(false);
        writeInstalledMarker(false);
        setHasInstalledMarker(false);
      }
    };

    const onInstalled = () => {
      window.__sw88AppInstalled = true;
      window.__sw88InstallPrompt = null;
      setDeferredPrompt(null);
      setJustInstalled(true);
      setDetectedRelatedApp(true);
      setHasInstalledMarker(true);
      writeInstalledMarker(true);
    };

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = () => syncEnvironment();
    const onFocus = () => {
      syncEnvironment();
      checkRelatedApps();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('sw88:pwa-prompt-ready', onEarlyPromptReady);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('sw88:pwa-installed', onInstalled);
    window.addEventListener('resize', syncEnvironment);
    window.addEventListener('focus', onFocus);
    mql?.addEventListener?.('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('sw88:pwa-prompt-ready', onEarlyPromptReady);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('sw88:pwa-installed', onInstalled);
      window.removeEventListener('resize', syncEnvironment);
      window.removeEventListener('focus', onFocus);
      mql?.removeEventListener?.('change', onDisplayModeChange);
      if (handoffTimerRef.current) {
        window.clearTimeout(handoffTimerRef.current);
      }
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'ios' | 'manual'> => {
    const activePrompt = deferredPrompt || window.__sw88InstallPrompt || null;
    if (activePrompt) {
      setIsPrompting(true);
      try {
        await activePrompt.prompt();
        const choice = await activePrompt.userChoice;
        if (choice.outcome === 'accepted') {
          window.__sw88InstallPrompt = null;
          window.__sw88AppInstalled = true;
          setDeferredPrompt(null);
          setJustInstalled(true);
          setDetectedRelatedApp(true);
          setHasInstalledMarker(true);
          writeInstalledMarker(true);
        }
        return choice.outcome;
      } finally {
        setIsPrompting(false);
      }
    }
    if (isIos) return 'ios';
    return 'manual';
  }, [deferredPrompt, isIos]);

  const markManualInstalled = useCallback(() => {
    window.__sw88AppInstalled = true;
    setJustInstalled(true);
    setHasInstalledMarker(true);
    writeInstalledMarker(true);
  }, []);

  const clearInstalledMarker = useCallback(() => {
    window.__sw88AppInstalled = false;
    setJustInstalled(false);
    setDetectedRelatedApp(false);
    setHasInstalledMarker(false);
    setAppHandoffState('idle');
    writeInstalledMarker(false);
  }, []);

  const openInInstalledApp = useCallback(
    (targetGameId?: string) => {
      if (isStandalone) return;
      if (handoffTimerRef.current) {
        window.clearTimeout(handoffTimerRef.current);
      }

      setAppHandoffState('redirecting');

      let leftBrowser = false;
      const cleanupListeners = () => {
        document.removeEventListener('visibilitychange', onVisibilityOrHide);
        window.removeEventListener('pagehide', onVisibilityOrHide);
        window.removeEventListener('blur', onVisibilityOrHide);
      };

      const onVisibilityOrHide = () => {
        if (document.hidden || document.visibilityState === 'hidden') {
          leftBrowser = true;
          cleanupListeners();
          if (handoffTimerRef.current) window.clearTimeout(handoffTimerRef.current);
          setAppHandoffState('opened');
          // Gracefully attempt to close the browser tab if allowed by browser
          try {
            window.close();
          } catch {
            // Browser prevented script close; UI transitions to "Opened in App" state
          }
        }
      };

      document.addEventListener('visibilitychange', onVisibilityOrHide);
      window.addEventListener('pagehide', onVisibilityOrHide);
      window.addEventListener('blur', onVisibilityOrHide);

      // Build clean canonical app URL preserving optional game deep-link without forcing full-page proxy reload
      const params = new URLSearchParams(window.location.search);
      params.set('source', 'pwa');
      params.set('open_app', '1');
      if (targetGameId) {
        params.set('game', targetGameId);
      }

      try {
        window.sessionStorage.setItem(OPEN_ATTEMPT_SESSION_KEY, '1');
        window.history.replaceState(null, '', `/?${params.toString()}`);
      } catch {
        // ignore history/storage errors
      }

      handoffTimerRef.current = window.setTimeout(() => {
        cleanupListeners();
        if (!leftBrowser) {
          setAppHandoffState('manual_switch');
        }
      }, 900);
    },
    [isStandalone]
  );

  const resetHandoffState = useCallback(() => {
    if (handoffTimerRef.current) {
      window.clearTimeout(handoffTimerRef.current);
    }
    setAppHandoffState('idle');
  }, []);

  const isAppInstalledOnDevice =
    isStandalone || justInstalled || detectedRelatedApp || hasInstalledMarker;

  return {
    isStandalone,
    isInstalled: isStandalone || justInstalled,
    isAppInstalledOnDevice,
    detectedRelatedApp,
    justInstalled,
    isIos,
    isAndroid,
    isMobile,
    isMobileBrowserRestricted: isMobile && !isStandalone,
    isPrompting,
    canDirectInstall: Boolean(deferredPrompt),
    appHandoffState,
    promptInstall,
    markManualInstalled,
    clearInstalledMarker,
    openInInstalledApp,
    resetHandoffState,
  };
}
