import { CheckCircle2, Gamepad2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { GameInfo } from '../types';

export function OfflineIndicator({ activeGame }: { activeGame?: GameInfo | null }) {
  const { isOnline, isChecking, justReconnected, retryNow } = useOnlineStatus();

  if (isOnline && justReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-[calc(env(safe-area-inset-top)+14px)] left-1/2 -translate-x-1/2 z-[95] max-w-[calc(100vw-24px)] rounded-2xl bg-[#0D2118]/95 border border-emerald-400/50 px-4 py-2.5 shadow-[0_12px_36px_rgba(16,185,129,0.28)] flex items-center gap-2.5 text-xs sm:text-sm font-bold text-emerald-200 backdrop-blur-md"
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>
          Connection Restored! Resuming {activeGame ? activeGame.name : 'SW88'}...
        </span>
      </div>
    );
  }

  if (isOnline) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sw88-offline-title"
      className="fixed inset-0 z-[95] bg-[#07090E]/96 backdrop-blur-xl flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="w-full max-w-md rounded-3xl bg-gradient-to-b from-[#161B26] via-[#12161F] to-[#0C0E14] border border-[#E6B84F]/35 shadow-[0_30px_90px_rgba(0,0,0,0.9)] p-6 sm:p-8 text-center space-y-6">
        {/* Game & Platform Branding */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="SW88 Logo"
              className="w-11 h-11 rounded-xl border border-[#E6B84F]/45 shadow-md"
            />
            <div className="text-left">
              <div className="font-display font-extrabold text-xl tracking-tight text-[#F5F7FA]">
                SW<span className="text-[#E6B84F]">88</span>
              </div>
              <div className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Gaming Platform
              </div>
            </div>
          </div>

          {activeGame && (
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-[#E6B84F]/12 border border-[#E6B84F]/30 px-3 py-1 text-xs font-bold text-[#F3D27A] mt-1">
              <Gamepad2 className="w-3.5 h-3.5 shrink-0 text-[#E6B84F]" />
              <span>Paused: {activeGame.name}</span>
            </div>
          )}
        </div>

        {/* Animated Offline Character / Signal Mascot */}
        <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
          {/* Outer rotating radar dashed ring */}
          <svg
            viewBox="0 0 160 160"
            className="absolute inset-0 w-full h-full"
            style={{ animation: 'sw88RadarSpin 12s linear infinite' }}
            aria-hidden="true"
          >
            <circle
              cx="80"
              cy="80"
              r="72"
              fill="none"
              stroke="#E6B84F"
              strokeOpacity="0.28"
              strokeWidth="2"
              strokeDasharray="8 8"
            />
            <circle cx="80" cy="8" r="3.5" fill="#E6B84F" />
          </svg>

          {/* Pulsing inner ring */}
          <div
            className="absolute w-28 h-28 rounded-full bg-amber-500/10 border border-amber-400/25"
            style={{ animation: 'sw88SignalPulse 2.2s ease-in-out infinite' }}
          />

          {/* Floating Animated Offline Astro-Gaming Mascot */}
          <svg
            viewBox="0 0 120 120"
            className="relative w-28 h-28 drop-shadow-[0_12px_24px_rgba(0,0,0,0.65)]"
            style={{ animation: 'sw88OfflineHover 3.2s ease-in-out infinite' }}
            aria-hidden="true"
          >
            {/* Antenna & Disconnected Spark */}
            <line x1="60" y1="24" x2="60" y2="12" stroke="#E6B84F" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="60" cy="10" r="4.5" fill="#F59E0B" />
            <path d="M44 16 Q60 4 76 16" fill="none" stroke="#F59E0B" strokeOpacity="0.6" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 4" />

            {/* Robot / Gamer Helmet */}
            <rect x="28" y="24" width="64" height="52" rx="18" fill="#1C2231" stroke="#E6B84F" strokeWidth="3" />
            {/* Visor Screen */}
            <rect x="36" y="34" width="48" height="28" rx="10" fill="#0B0D11" stroke="#374151" strokeWidth="1.5" />
            {/* Disconnected X Eyes */}
            <path d="M46 44 L52 50 M52 44 L46 50" stroke="#F59E0B" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M68 44 L74 50 M74 44 L68 50" stroke="#F59E0B" strokeWidth="2.8" strokeLinecap="round" />
            {/* Mouth Wave */}
            <path d="M52 56 Q60 53 68 56" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" />

            {/* Side Earphones */}
            <rect x="20" y="40" width="8" height="20" rx="4" fill="#E6B84F" />
            <rect x="92" y="40" width="8" height="20" rx="4" fill="#E6B84F" />

            {/* Body & SW88 Emblem */}
            <rect x="38" y="78" width="44" height="24" rx="10" fill="#181D2B" stroke="#E6B84F" strokeOpacity="0.65" strokeWidth="2.5" />
            <circle cx="60" cy="90" r="5" fill="#E6B84F" />
          </svg>
        </div>

        {/* Required Offline Copy */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300 bg-amber-500/12 border border-amber-400/30 rounded-lg px-2.5 py-1">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Connection Lost</span>
          </div>
          <h2 id="sw88-offline-title" className="font-display font-extrabold text-2xl text-[#F5F7FA]">
            You Are Offline
          </h2>
          <p className="text-sm text-[#D1D5DB]">
            Please Check Your Internet Connection
          </p>
          <p className="text-xs text-[#9CA3AF] leading-relaxed pt-1">
            {activeGame
              ? `Your ${activeGame.name} session is safely paused and will restore automatically as soon as your network returns.`
              : 'Waiting for your internet connection to return. SW88 will restore automatically.'}
          </p>
        </div>

        {/* Auto-reconnect Scanner & Manual Retry */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-center gap-2 text-xs text-amber-200/90 bg-[#0B0D11] border border-white/10 rounded-xl py-2.5 px-3">
            <Wifi className={`w-4 h-4 text-amber-400 shrink-0 ${isChecking ? 'animate-pulse' : ''}`} />
            <span>
              {isChecking
                ? 'Checking connection to SW88 server...'
                : 'Automatically detecting reconnection...'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void retryNow()}
            disabled={isChecking}
            className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Checking Network...' : 'Retry Connection'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
