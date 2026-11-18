import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  MoreVertical,
  RotateCcw,
  Share,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const DISMISS_SESSION_KEY = 'sw88_mobile_gate_dismissed';

export function MobileInstallPrompt() {
  const {
    isStandalone,
    isAppInstalledOnDevice,
    justInstalled,
    isIos,
    isMobile,
    isPrompting,
    canDirectInstall,
    appHandoffState,
    promptInstall,
    markManualInstalled,
    clearInstalledMarker,
    openInInstalledApp,
    resetHandoffState,
  } = usePWAInstall();

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem(DISMISS_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [highlightSteps, setHighlightSteps] = useState(false);

  // Surface the Open in App modal immediately if installation just succeeded
  useEffect(() => {
    if (justInstalled) {
      setDismissed(false);
    }
  }, [justInstalled]);

  // Never render inside installed standalone app or on desktop
  if (isStandalone || !isMobile || dismissed) {
    return null;
  }

  const handleDismissToBrowser = () => {
    resetHandoffState();
    try {
      window.sessionStorage.setItem(DISMISS_SESSION_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const handleDownloadClick = async () => {
    const result = await promptInstall();
    if (result === 'ios' || result === 'manual' || result === 'dismissed') {
      setHighlightSteps(true);
    }
  };

  const handleManualOpenClick = () => {
    openInInstalledApp();
  };

  const showOpenAppState = justInstalled || isAppInstalledOnDevice;

  // Dedicated full-exit screen if user successfully left browser into the installed app
  if (appHandoffState === 'opened') {
    return (
      <div
        className="fixed inset-0 z-[80] bg-[#06080C] flex items-center justify-center p-5 text-center"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-sm rounded-3xl bg-[#13161F] border border-emerald-500/35 p-6 space-y-4 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl overflow-hidden border border-emerald-400/50">
            <img src="/pwa-192x192.png" alt="SW88" className="w-full h-full object-cover" />
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1">
            <CheckCircle2 className="w-4 h-4" />
            <span>SW88 App Opened</span>
          </div>
          <h2 className="font-display font-extrabold text-xl text-[#F5F7FA]">
            Continue Inside SW88 App
          </h2>
          <p className="text-xs text-[#9CA3AF] leading-relaxed">
            You have switched to the installed SW88 mobile app. You can safely close this browser tab.
          </p>
          <button
            type="button"
            onClick={handleDismissToBrowser}
            className="w-full min-h-[44px] rounded-xl bg-white/5 border border-white/15 text-xs font-semibold text-[#E5E7EB] hover:bg-white/10 cursor-pointer"
          >
            Return to Browser Website
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#06080C]/92 backdrop-blur-md flex items-end sm:items-center justify-center p-3 sm:p-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sw88-mobile-install-title"
    >
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-3xl bg-gradient-to-b from-[#171B26] via-[#13161F] to-[#0E1118] border border-[#E6B84F]/35 shadow-[0_24px_80px_rgba(0,0,0,0.85)] p-5 sm:p-6 space-y-5">
        {/* App Brand Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-[#E6B84F]/45 bg-[#0B0D11] shadow-lg shrink-0">
              <img
                src="/pwa-192x192.png"
                alt="SW88 App Icon"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#E6B84F] bg-[#E6B84F]/12 border border-[#E6B84F]/30 rounded-md px-2 py-0.5 mb-1.5">
                <Sparkles className="w-3 h-3 shrink-0" />
                <span>{showOpenAppState ? 'App Detected on Device' : 'Standalone Mobile App'}</span>
              </div>
              <h2
                id="sw88-mobile-install-title"
                className="font-display font-extrabold text-xl text-[#F5F7FA] leading-tight"
              >
                {showOpenAppState ? 'Open in SW88 App' : 'Download SW88 App'}
              </h2>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                {showOpenAppState
                  ? 'SW88 is installed — launch the app for full-screen gameplay'
                  : 'Install SW88 to play live games in full-screen mobile app mode'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismissToBrowser}
            className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer shrink-0"
            aria-label="Stay in mobile browser"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {showOpenAppState ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/35 p-4 space-y-2.5">
              <div className="flex items-center gap-2.5 text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                <span>
                  {justInstalled
                    ? 'Download & Installation Complete!'
                    : 'SW88 Mobile App Detected!'}
                </span>
              </div>
              <p className="text-xs text-emerald-100/85 leading-relaxed">
                {appHandoffState === 'redirecting'
                  ? 'Switching you to the installed SW88 mobile app...'
                  : 'Tap below to launch from your installed SW88 app, or continue to your Wallet & Account here.'}
              </p>
            </div>

            {appHandoffState === 'manual_switch' && (
              <div className="rounded-xl bg-[#E6B84F]/12 border border-[#E6B84F]/40 px-4 py-3 text-xs text-[#F3D27A] leading-relaxed space-y-1.5">
                <div className="font-bold text-[#E6B84F]">Tap SW88 on Your Home Screen</div>
                <p>
                  Your browser kept this tab open. Switch to your phone&apos;s Home Screen or App Drawer and tap the{' '}
                  <strong className="text-white">SW88</strong> icon to launch games in full-screen standalone mode.
                </p>
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleManualOpenClick}
                disabled={appHandoffState === 'redirecting'}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#07110B] font-extrabold text-sm inline-flex items-center justify-center gap-2 shadow-[0_10px_28px_rgba(16,185,129,0.28)] hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer px-4"
              >
                {appHandoffState === 'redirecting' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>OPENING SW88 APP...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    <span>OPEN IN APP</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDismissToBrowser}
                className="w-full min-h-[42px] rounded-xl bg-white/5 border border-white/10 text-[#E5E7EB] font-semibold text-xs hover:bg-white/10 transition cursor-pointer px-4"
              >
                Continue to Website (Wallet &amp; Account)
              </button>

              <button
                type="button"
                onClick={() => {
                  clearInstalledMarker();
                  setHighlightSteps(true);
                }}
                className="w-full py-2 text-[11px] text-[#9CA3AF] hover:text-[#E6B84F] inline-flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>App not installed? Install SW88 instead</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Primary Download Action Button */}
            <button
              type="button"
              onClick={handleDownloadClick}
              disabled={isPrompting}
              className="w-full min-h-[52px] rounded-2xl bg-gradient-to-r from-[#E6B84F] via-[#F2C968] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm sm:text-base inline-flex items-center justify-center gap-2.5 shadow-[0_12px_32px_rgba(230,184,79,0.3)] hover:brightness-105 active:scale-[0.98] disabled:opacity-70 transition cursor-pointer px-4"
            >
              {isPrompting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  <span>Starting Automatic Download...</span>
                </>
              ) : (
                <>
                  <Download className="w-5 h-5 shrink-0" />
                  <span>
                    {canDirectInstall
                      ? 'DOWNLOAD & INSTALL SW88 APP'
                      : 'INSTALL SW88 MOBILE APP'}
                  </span>
                </>
              )}
            </button>

            {canDirectInstall ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 text-xs text-emerald-300">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>One-tap automatic mobile install is ready on your browser.</span>
              </div>
            ) : (
              <div
                className={`rounded-2xl p-4 space-y-3 border transition ${
                  highlightSteps
                    ? 'bg-[#E6B84F]/10 border-[#E6B84F]/60 ring-2 ring-[#E6B84F]/25'
                    : 'bg-[#0B0D11]/90 border-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#E6B84F]">
                    {isIos ? 'iPhone / iPad Quick Install (3 Steps)' : '3-Step Mobile Install Guide'}
                  </span>
                  <Smartphone className="w-4 h-4 text-[#E6B84F] shrink-0" />
                </div>

                {isIos ? (
                  <ol className="space-y-2.5 text-xs sm:text-sm text-[#E5E7EB]">
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        1
                      </span>
                      <span className="leading-relaxed">
                        Tap the <Share className="inline w-4 h-4 mx-0.5 text-[#E6B84F]" /> Share icon in Safari&apos;s bottom or top bar.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        2
                      </span>
                      <span className="leading-relaxed">
                        Tap <strong className="text-white">&ldquo;Add to Home Screen&rdquo;</strong>.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        3
                      </span>
                      <span className="leading-relaxed">
                        Confirm to install and launch <strong className="text-white">SW88</strong> as a standalone mobile app.
                      </span>
                    </li>
                  </ol>
                ) : (
                  <ol className="space-y-2.5 text-xs sm:text-sm text-[#E5E7EB]">
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        1
                      </span>
                      <span className="leading-relaxed">
                        Open your mobile browser menu (<MoreVertical className="inline w-3.5 h-3.5 text-[#E6B84F]" /> three dots or address bar install icon).
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        2
                      </span>
                      <span className="leading-relaxed">
                        Tap <strong className="text-white">&ldquo;Install App&rdquo;</strong> or <strong className="text-white">&ldquo;Add to Home Screen&rdquo;</strong>.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        3
                      </span>
                      <span className="leading-relaxed">
                        Confirm to install and launch <strong className="text-white">SW88</strong> as a standalone mobile app.
                      </span>
                    </li>
                  </ol>
                )}

                {highlightSteps && (
                  <button
                    type="button"
                    onClick={markManualInstalled}
                    className="w-full min-h-[42px] mt-1 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-xs hover:bg-emerald-500/20 transition cursor-pointer px-3"
                  >
                    I Have Installed SW88 — Open in App
                  </button>
                )}
              </div>
            )}

            {canDirectInstall && highlightSteps && (
              <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3.5 space-y-2 text-xs text-[#D1D5DB]">
                <div className="font-semibold text-[#E6B84F]">Manual Browser Install Steps:</div>
                <ol className="space-y-1.5 list-decimal list-inside">
                  <li>Open your mobile browser menu (⋮ three dots or address bar install icon).</li>
                  <li>Tap &ldquo;Install App&rdquo; or &ldquo;Add to Home Screen&rdquo;.</li>
                  <li>Confirm to install and launch SW88 as a standalone mobile app.</li>
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={handleDismissToBrowser}
              className="w-full py-2 text-xs text-[#9CA3AF] hover:text-[#F5F7FA] transition cursor-pointer"
            >
              Browse wallet &amp; account in browser (games require app)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
