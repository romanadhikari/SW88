import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Gamepad2,
  Loader2,
  Lock,
  MoreVertical,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { GameInfo } from '../types';

export function MobileGameRestrictionModal({
  game,
  asPage = false,
  onClose,
}: {
  game: GameInfo;
  asPage?: boolean;
  onClose: () => void;
}) {
  const {
    isAppInstalledOnDevice,
    justInstalled,
    isIos,
    isPrompting,
    canDirectInstall,
    appHandoffState,
    promptInstall,
    markManualInstalled,
    openInInstalledApp,
    resetHandoffState,
  } = usePWAInstall();

  const [showSteps, setShowSteps] = useState(false);

  const handleAction = async () => {
    if (isAppInstalledOnDevice || justInstalled) {
      openInInstalledApp(game.id);
      return;
    }
    const res = await promptInstall();
    if (res === 'ios' || res === 'manual' || res === 'dismissed') {
      setShowSteps(true);
    }
  };

  const containerClass = asPage
    ? 'min-h-dvh bg-[#0B0D11] text-[#F5F7FA] flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'
    : 'fixed inset-0 z-[75] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]';

  return (
    <div className={containerClass} role="dialog" aria-modal="true" aria-labelledby="sw88-mobile-game-gate-title">
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-3xl bg-gradient-to-b from-[#171B26] to-[#10131B] border border-[#E6B84F]/40 shadow-2xl p-5 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-[#E6B84F]/15 border border-[#E6B84F]/40 flex items-center justify-center shrink-0">
              <Smartphone className="w-6 h-6 text-[#E6B84F]" />
            </div>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/12 border border-amber-400/30 rounded-md px-2 py-0.5 mb-1">
                <Lock className="w-3 h-3" />
                <span>Mobile App Required</span>
              </div>
              <h2 id="sw88-mobile-game-gate-title" className="font-display font-extrabold text-lg text-[#F5F7FA] leading-tight">
                Play {game.name} in the SW88 App
              </h2>
            </div>
          </div>

          {!asPage && (
            <button
              type="button"
              onClick={() => {
                resetHandoffState();
                onClose();
              }}
              className="p-2 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Game Card Preview */}
        <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-3.5 flex items-center gap-3.5">
          <img
            src="/pwa-192x192.png"
            alt={game.name}
            className="w-14 h-14 rounded-xl border border-[#E6B84F]/35 object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-bold text-[#F5F7FA]">
              <Gamepad2 className="w-4 h-4 text-[#E6B84F] shrink-0" />
              <span className="truncate">{game.name}</span>
            </div>
            <p className="text-xs text-[#9CA3AF] mt-1 leading-relaxed">
              On mobile devices, live gameplay is restricted to the installed SW88 standalone app for full-screen security and real-time stability.
            </p>
          </div>
        </div>

        {/* Feedback Notices */}
        {(isAppInstalledOnDevice || justInstalled) && appHandoffState === 'opened' && (
          <div className="rounded-xl bg-emerald-500/12 border border-emerald-500/35 px-4 py-3 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Switched to SW88 App! You can close this browser tab.</span>
          </div>
        )}

        {(isAppInstalledOnDevice || justInstalled) && appHandoffState === 'manual_switch' && (
          <div className="rounded-xl bg-[#E6B84F]/12 border border-[#E6B84F]/40 px-4 py-3 text-xs text-[#F3D27A] leading-relaxed">
            Tap the <strong className="text-white">SW88</strong> icon on your mobile Home Screen or App Drawer to open and play{' '}
            <strong className="text-white">{game.name}</strong> directly inside the app.
          </div>
        )}

        {/* Primary CTA */}
        <div className="space-y-2.5">
          {isAppInstalledOnDevice || justInstalled ? (
            <button
              type="button"
              onClick={handleAction}
              disabled={appHandoffState === 'redirecting'}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#07110B] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer px-4"
            >
              {appHandoffState === 'redirecting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>OPENING SW88 APP...</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>OPEN IN SW88 APP TO PLAY</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAction}
              disabled={isPrompting}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer px-4"
            >
              {isPrompting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>INSTALLING SW88 APP...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{canDirectInstall ? 'INSTALL SW88 APP TO PLAY' : 'DOWNLOAD SW88 APP TO PLAY'}</span>
                </>
              )}
            </button>
          )}

          {showSteps && !(isAppInstalledOnDevice || justInstalled) && (
            <div className="rounded-2xl bg-[#0B0D11] border border-[#E6B84F]/40 p-4 space-y-2.5 text-xs text-[#E5E7EB]">
              <div className="font-bold text-[#E6B84F]">Install SW88 in 3 Steps:</div>
              {isIos ? (
                <ol className="space-y-2">
                  <li>
                    1. Tap <Share className="inline w-3.5 h-3.5 text-[#E6B84F]" /> Share in Safari.
                  </li>
                  <li>2. Tap &ldquo;Add to Home Screen&rdquo;.</li>
                  <li>3. Confirm &amp; open SW88 from your Home Screen to play.</li>
                </ol>
              ) : (
                <ol className="space-y-2">
                  <li>
                    1. Open your mobile browser menu (<MoreVertical className="inline w-3.5 h-3.5 text-[#E6B84F]" /> three dots or install icon).
                  </li>
                  <li>2. Tap &ldquo;Install App&rdquo; or &ldquo;Add to Home Screen&rdquo;.</li>
                  <li>3. Confirm &amp; launch SW88 as a standalone mobile app.</li>
                </ol>
              )}
              <button
                type="button"
                onClick={markManualInstalled}
                className="w-full min-h-[40px] rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-xs cursor-pointer"
              >
                I Have Installed — Open in SW88 App
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              resetHandoffState();
              onClose();
            }}
            className="w-full min-h-[44px] rounded-xl bg-white/5 border border-white/10 text-[#D1D5DB] font-semibold text-xs hover:bg-white/10 transition cursor-pointer px-4"
          >
            Back to Website Portal (Wallet &amp; Account)
          </button>
        </div>
      </div>
    </div>
  );
}
