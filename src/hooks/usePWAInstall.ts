import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface AppDownloadInfo {
  mode: 'pwa' | 'uploaded' | 'external';
  hasApk: boolean;
  apkDownloadUrl: string | null;
  apkFilename: string | null;
  apkSizeBytes: number;
  externalUrl: string;
  version: string;
  updatedAt: string | null;
}

export type AutoSetupPhase =
  | 'idle'
  | 'preparing'
  | 'prompting'
  | 'ready_tap'
  | 'downloading'
  | 'installed'
  | 'dismissed'
  | 'iframe_redirect'
  | 'ios_sheet'
  | 'webview_escape'
  | 'unsupported';

declare global {
  interface Window {
    __sw88DeferredPrompt?: BeforeInstallPromptEvent | null;
    __sw88Installed?: boolean;
  }
}

function detectEnvironment() {
  if (typeof window === 'undefined') {
    return {
      isIos: false,
      isAndroid: false,
      isEmbeddedIframe: false,
      isInAppBrowser: false,
      isStandalone: false,
    };
  }
  const ua = window.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/i.test(ua);
  const isInAppBrowser = /(FBAN|FBAV|Instagram|Line|MicroMessenger|WhatsApp|Telegram|Snapchat|wv\))/i.test(ua);
  let isEmbeddedIframe = false;
  try {
    isEmbeddedIframe = window.self !== window.top;
  } catch {
    isEmbeddedIframe = true;
  }
  const isStandalone = Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      window.__sw88Installed
  );
  return { isIos, isAndroid, isEmbeddedIframe, isInAppBrowser, isStandalone };
}

export function getSpecialDownloadUrl(): string {
  if (typeof window === 'undefined') return '/download';
  return `${window.location.origin}/download`;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__sw88DeferredPrompt || null : null
  );
  const [env] = useState(() => detectEnvironment());
  const [isInstalled, setIsInstalled] = useState(() => env.isStandalone);
  const [swReady, setSwReady] = useState(false);
  const [appInfo, setAppInfo] = useState<AppDownloadInfo | null>(null);
  const [setupPhase, setSetupPhase] = useState<AutoSetupPhase>(() =>
    env.isStandalone ? 'installed' : 'idle'
  );

  const refreshAppInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/app/download-info', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as AppDownloadInfo;
        setAppInfo(data);
      }
    } catch {
      // keep existing or offline fallback
    }
  }, []);

  useEffect(() => {
    refreshAppInfo();

    const syncPrompt = () => {
      if (window.__sw88DeferredPrompt) {
        setDeferredPrompt(window.__sw88DeferredPrompt);
      }
    };
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      window.__sw88DeferredPrompt = ev;
      setDeferredPrompt(ev);
    };
    const onInstalled = () => {
      window.__sw88Installed = true;
      window.__sw88DeferredPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
      setSetupPhase('installed');
    };

    window.addEventListener('sw88:install-prompt-ready', syncPrompt);
    window.addEventListener('sw88:app-installed', onInstalled);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => setSwReady(true))
        .catch(() => {
          // ignore
        });
    }

    return () => {
      window.removeEventListener('sw88:install-prompt-ready', syncPrompt);
      window.removeEventListener('sw88:app-installed', onInstalled);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [refreshAppInfo]);

  const openTopLevelDownload = useCallback(() => {
    const targetUrl = `${window.location.origin}/download?auto=1`;
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const triggerApkDownload = useCallback((url: string) => {
    setSetupPhase('downloading');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SW88-App.apk';
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => {
      setSetupPhase((prev) => (prev === 'downloading' ? 'idle' : prev));
    }, 3500);
  }, []);

  const invokePromptNow = useCallback(async (promptEv: BeforeInstallPromptEvent): Promise<'accepted' | 'dismissed' | 'gesture_expired'> => {
    setSetupPhase('prompting');
    try {
      await promptEv.prompt();
      const choice = await promptEv.userChoice;
      if (choice.outcome === 'accepted') {
        window.__sw88DeferredPrompt = null;
        window.__sw88Installed = true;
        setDeferredPrompt(null);
        setIsInstalled(true);
        setSetupPhase('installed');
        return 'accepted';
      }
      setSetupPhase('dismissed');
      return 'dismissed';
    } catch {
      setSetupPhase('ready_tap');
      return 'gesture_expired';
    }
  }, []);

  const triggerAutoSetup = useCallback(async (): Promise<AutoSetupPhase> => {
    if (isInstalled) {
      setSetupPhase('installed');
      return 'installed';
    }

    // 1. If Admin uploaded/linked a native Android .apk package, download it directly
    if (appInfo?.hasApk && appInfo?.apkDownloadUrl) {
      triggerApkDownload(appInfo.apkDownloadUrl);
      return 'downloading';
    }

    // 2. Synchronous OS installer trigger when pre-boot prompt is captured
    const immediatePrompt = window.__sw88DeferredPrompt || deferredPrompt;
    if (immediatePrompt) {
      const outcome = await invokePromptNow(immediatePrompt);
      if (outcome === 'accepted') return 'installed';
      if (outcome === 'dismissed') return 'dismissed';
      return 'ready_tap';
    }

    // 3. Embedded preview / iframe: escape into top-level browser tab where OS install is permitted
    if (env.isEmbeddedIframe) {
      openTopLevelDownload();
      setSetupPhase('iframe_redirect');
      return 'iframe_redirect';
    }

    // 4. Restricted social/chat WebView (WhatsApp, Telegram, Facebook, Instagram)
    if (env.isInAppBrowser) {
      setSetupPhase('webview_escape');
      return 'webview_escape';
    }

    // 5. iOS Safari requires Safari Share -> Add to Home Screen by Apple OS policy
    if (env.isIos) {
      setSetupPhase('ios_sheet');
      return 'ios_sheet';
    }

    // 6. Wait briefly for Service Worker & beforeinstallprompt to finish initializing on first visit
    setSetupPhase('preparing');
    if ('serviceWorker' in navigator) {
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
        setSwReady(true);
      } catch {
        // ignore
      }
    }

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      const latePrompt = window.__sw88DeferredPrompt;
      if (latePrompt) {
        setDeferredPrompt(latePrompt);
        const outcome = await invokePromptNow(latePrompt);
        if (outcome === 'accepted') return 'installed';
        if (outcome === 'dismissed') return 'dismissed';
        return 'ready_tap';
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    setSetupPhase('unsupported');
    return 'unsupported';
  }, [
    appInfo,
    deferredPrompt,
    env.isEmbeddedIframe,
    env.isInAppBrowser,
    env.isIos,
    invokePromptNow,
    isInstalled,
    openTopLevelDownload,
    triggerApkDownload,
  ]);

  const resetSetupPhase = useCallback(() => {
    setSetupPhase(isInstalled ? 'installed' : 'idle');
  }, [isInstalled]);

  return {
    isInstalled,
    isIos: env.isIos,
    isAndroid: env.isAndroid,
    isEmbeddedIframe: env.isEmbeddedIframe,
    isInAppBrowser: env.isInAppBrowser,
    swReady,
    canDirectInstall: Boolean(deferredPrompt || (typeof window !== 'undefined' && window.__sw88DeferredPrompt)),
    appInfo,
    setupPhase,
    specialDownloadUrl: getSpecialDownloadUrl(),
    refreshAppInfo,
    triggerAutoSetup,
    openTopLevelDownload,
    resetSetupPhase,
  };
}
