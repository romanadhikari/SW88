import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  MoreVertical,
  RotateCcw,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({
  compact = false,
  fullWidth = false,
  variant = 'button',
}: {
  compact?: boolean;
  fullWidth?: boolean;
  variant?: 'button' | 'card';
}) {
  const {
    isStandalone,
    isAppInstalledOnDevice,
    justInstalled,
    isIos,
    isPrompting,
    canDirectInstall,
    promptInstall,
    markManualInstalled,
    clearInstalledMarker,
  } = usePWAInstall();

  const [showModal, setShowModal] = useState(false);

  const handleClick = async () => {
    if (isStandalone) return;
    if (isAppInstalledOnDevice) {
      setShowModal(true);
      return;
    }
    const result = await promptInstall();
    if (result === 'accepted' || result === 'ios' || result === 'manual' || result === 'dismissed') {
      setShowModal(true);
    }
  };

  if (variant === 'card') {
    return (
      <>
        <div className="rounded-2xl bg-gradient-to-br from-[#191D28] via-[#14171F] to-[#11131A] border border-[#E6B84F]/30 p-4 sm:p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E6B84F]/15 border border-[#E6B84F]/35 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-[#E6B84F]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-base text-[#F5F7FA]">
                SW88 Mobile App
              </div>
              <p className="text-xs text-[#9CA3AF] mt-0.5 leading-relaxed">
                {isStandalone
                  ? 'You are running the installed standalone SW88 app.'
                  : isAppInstalledOnDevice
                    ? 'SW88 is installed on your device. Launch from your Home Screen app icon for full-screen play.'
                    : 'Download & install SW88 on your Android or iPhone home screen for full-screen mobile gameplay.'}
              </p>
            </div>
          </div>

          {isStandalone ? (
            <div className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold text-xs sm:text-sm px-4">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>SW88 APP INSTALLED</span>
            </div>
          ) : isAppInstalledOnDevice ? (
            <button
              type="button"
              onClick={handleClick}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#07110B] font-extrabold text-sm hover:brightness-105 active:scale-[0.98] transition cursor-pointer px-4"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span>OPEN FROM SW88 APP</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              disabled={isPrompting}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-70 transition cursor-pointer px-4"
            >
              {isPrompting ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Download className="w-4 h-4 shrink-0" />
              )}
              <span>
                {isPrompting
                  ? 'Installing SW88 App...'
                  : canDirectInstall
                    ? 'Install SW88 App Now'
                    : 'Download SW88 Mobile App'}
              </span>
            </button>
          )}
        </div>

        {showModal && (
          <InstallGuideModal
            isIos={isIos}
            isInstalled={isAppInstalledOnDevice || justInstalled}
            justInstalled={justInstalled}
            onMarkInstalled={markManualInstalled}
            onResetInstall={clearInstalledMarker}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  if (isStandalone) {
    return (
      <div
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold ${
          compact ? 'px-2.5 sm:px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
        } ${fullWidth ? 'w-full' : ''}`}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span className={compact ? 'hidden sm:inline' : ''}>APP INSTALLED</span>
        {compact && <span className="sm:hidden">INSTALLED</span>}
      </div>
    );
  }

  if (isAppInstalledOnDevice) {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#07110B] font-extrabold tracking-tight hover:brightness-105 active:scale-[0.98] transition cursor-pointer whitespace-nowrap ${
            compact ? 'min-h-[40px] sm:min-h-[44px] px-3 sm:px-3.5 py-2 text-xs' : 'min-h-[46px] px-4 py-2.5 text-sm'
          } ${fullWidth ? 'w-full' : ''}`}
        >
          <ExternalLink className="w-4 h-4 shrink-0" />
          {compact ? (
            <>
              <span className="sm:hidden">Open App</span>
              <span className="hidden sm:inline">OPEN FROM SW88 APP</span>
            </>
          ) : (
            <span>OPEN FROM SW88 APP</span>
          )}
        </button>

        {showModal && (
          <InstallGuideModal
            isIos={isIos}
            isInstalled={true}
            justInstalled={justInstalled}
            onMarkInstalled={markManualInstalled}
            onResetInstall={clearInstalledMarker}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPrompting}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-bold tracking-tight hover:brightness-105 active:scale-[0.98] disabled:opacity-70 transition cursor-pointer whitespace-nowrap ${
          compact ? 'min-h-[40px] sm:min-h-[44px] px-3 sm:px-3.5 py-2 text-xs' : 'min-h-[46px] px-4 py-2.5 text-sm'
        } ${fullWidth ? 'w-full' : ''}`}
      >
        {isPrompting ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        {compact ? (
          <>
            <span className="sm:hidden">{isPrompting ? 'Installing...' : 'Install App'}</span>
            <span className="hidden sm:inline">
              {isPrompting ? 'INSTALLING...' : 'DOWNLOAD SW88 APP'}
            </span>
          </>
        ) : (
          <span>{isPrompting ? 'INSTALLING SW88 APP...' : 'DOWNLOAD SW88 APP'}</span>
        )}
      </button>

      {showModal && (
        <InstallGuideModal
          isIos={isIos}
          isInstalled={isAppInstalledOnDevice || justInstalled}
          justInstalled={justInstalled}
          onMarkInstalled={markManualInstalled}
          onResetInstall={clearInstalledMarker}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function InstallGuideModal({
  isIos,
  isInstalled,
  justInstalled,
  onMarkInstalled,
  onResetInstall,
  onClose,
}: {
  isIos: boolean;
  isInstalled: boolean;
  justInstalled: boolean;
  onMarkInstalled: () => void;
  onResetInstall: () => void;
  onClose: () => void;
}) {
  const { openInInstalledApp, appHandoffState } = usePWAInstall();
  const [launchedNotice, setLaunchedNotice] = useState(false);

  const handleOpenApp = () => {
    setLaunchedNotice(true);
    openInInstalledApp();
  };

  return (
    <div className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="SW88"
              className="w-11 h-11 rounded-xl border border-[#E6B84F]/40 shrink-0"
            />
            <div>
              <h3 className="text-lg font-bold text-[#F5F7FA]">
                {isInstalled ? 'SW88 Mobile App Ready' : 'Install SW88 Mobile App'}
              </h3>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                {isInstalled
                  ? 'Open SW88 directly from your phone Home Screen icon.'
                  : 'Add SW88 directly to your phone home screen for instant full-screen access.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close install dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isInstalled ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/35 p-4 space-y-2 text-xs sm:text-sm text-emerald-200">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {appHandoffState === 'opened'
                    ? 'Switched to SW88 App! You can close this browser tab.'
                    : justInstalled
                      ? 'SW88 installed successfully!'
                      : 'SW88 is detected as installed on this device.'}
                </span>
              </div>
              <p className="text-emerald-100/80 leading-relaxed">
                Tap the <strong className="text-white">SW88</strong> icon on your mobile Home Screen or App Drawer to open as a standalone mobile app.
              </p>
            </div>

            {(launchedNotice || appHandoffState === 'manual_switch') && (
              <div className="rounded-xl bg-[#E6B84F]/10 border border-[#E6B84F]/35 px-3.5 py-2.5 text-xs text-[#F3D27A] leading-relaxed">
                Switch to your phone&apos;s Home Screen and tap the <strong className="text-white">SW88</strong> icon to open the standalone mobile app.
              </div>
            )}

            <button
              type="button"
              onClick={handleOpenApp}
              disabled={appHandoffState === 'redirecting'}
              className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#07110B] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-75 cursor-pointer"
            >
              {appHandoffState === 'redirecting' ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <ExternalLink className="w-4 h-4 shrink-0" />
              )}
              <span>{appHandoffState === 'redirecting' ? 'OPENING SW88 APP...' : 'OPEN IN SW88 APP'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLaunchedNotice(false);
                onResetInstall();
              }}
              className="w-full py-2 text-xs text-[#9CA3AF] hover:text-[#E6B84F] inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Show 3-step install instructions again</span>
            </button>
          </div>
        ) : (
          <>
            {isIos ? (
              <ol className="space-y-3 text-sm text-[#D1D5DB] bg-[#0B0D11] rounded-xl p-4 border border-white/10">
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    1
                  </span>
                  <span>
                    Tap the <Share className="inline w-4 h-4 mx-0.5 text-[#E6B84F]" /> Share icon in Safari’s bottom or top bar.
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    2
                  </span>
                  <span>Scroll down and select &ldquo;Add to Home Screen&rdquo;.</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    3
                  </span>
                  <span>Confirm to install and launch SW88 as a standalone mobile app.</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm text-[#D1D5DB] bg-[#0B0D11] rounded-xl p-4 border border-white/10">
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    1
                  </span>
                  <span>
                    Open your mobile browser menu (<MoreVertical className="inline w-3.5 h-3.5 text-[#E6B84F]" /> three dots or address bar install icon).
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    2
                  </span>
                  <span>Tap &ldquo;Install App&rdquo; or &ldquo;Add to Home Screen&rdquo;.</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                    3
                  </span>
                  <span>Confirm to install and launch SW88 as a standalone mobile app.</span>
                </li>
              </ol>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={onMarkInstalled}
                className="w-full min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 cursor-pointer"
              >
                I Have Installed — Open from SW88 App
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[40px] rounded-xl bg-white/5 border border-white/10 text-[#D1D5DB] font-semibold text-xs hover:bg-white/10 cursor-pointer"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
