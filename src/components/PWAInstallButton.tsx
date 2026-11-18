import { useState } from 'react';
import { CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';
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
  const { isInstalled, isIos, canDirectInstall, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const handleClick = async () => {
    if (isInstalled) return;
    const result = await promptInstall();
    if (result === 'ios' || result === 'manual') {
      setShowGuide(true);
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
                {isInstalled
                  ? 'You are running the installed standalone SW88 app.'
                  : 'Download & install SW88 on your Android or iPhone home screen for full-screen mobile gameplay.'}
              </p>
            </div>
          </div>

          {isInstalled ? (
            <div className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold text-xs sm:text-sm px-4">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>SW88 APP INSTALLED</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 active:scale-[0.98] transition cursor-pointer px-4"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{canDirectInstall ? 'Install SW88 App Now' : 'Download SW88 Mobile App'}</span>
            </button>
          )}
        </div>

        {showGuide && (
          <InstallGuideModal isIos={isIos} onClose={() => setShowGuide(false)} />
        )}
      </>
    );
  }

  if (isInstalled) {
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

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-bold tracking-tight hover:brightness-105 active:scale-[0.98] transition cursor-pointer whitespace-nowrap ${
          compact ? 'min-h-[40px] sm:min-h-[44px] px-3 sm:px-3.5 py-2 text-xs' : 'min-h-[46px] px-4 py-2.5 text-sm'
        } ${fullWidth ? 'w-full' : ''}`}
      >
        <Download className="w-4 h-4 shrink-0" />
        {compact ? (
          <>
            <span className="sm:hidden">Install App</span>
            <span className="hidden sm:inline">DOWNLOAD SW88 APP</span>
          </>
        ) : (
          <span>DOWNLOAD SW88 APP</span>
        )}
      </button>

      {showGuide && (
        <InstallGuideModal isIos={isIos} onClose={() => setShowGuide(false)} />
      )}
    </>
  );
}

function InstallGuideModal({ isIos, onClose }: { isIos: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-[#F5F7FA]">Install SW88 Mobile App</h3>
            <p className="text-sm text-[#9CA3AF] mt-1">
              Add SW88 directly to your phone home screen for instant full-screen access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close install instructions"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
              <span>Tap &ldquo;Add&rdquo; in the upper-right corner to install SW88.</span>
            </li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm text-[#D1D5DB] bg-[#0B0D11] rounded-xl p-4 border border-white/10">
            <li className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
                1
              </span>
              <span>Open your mobile browser menu (⋮ three dots or address bar install icon).</span>
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

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-sm hover:brightness-105 cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
