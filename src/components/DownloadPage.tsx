import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Gamepad2,
  Loader2,
  Share,
  Share2,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { copyToClipboard } from '../lib/api';
import { BrandMark } from './BrandMark';

interface DownloadPageProps {
  onOpenApp: () => void;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return 'Compact Web Package';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function DownloadPage({ onOpenApp }: DownloadPageProps) {
  const {
    isInstalled,
    isIos,
    isEmbeddedIframe,
    swReady,
    canDirectInstall,
    appInfo,
    setupPhase,
    specialDownloadUrl,
    triggerAutoSetup,
  } = usePWAInstall();

  const [copiedLink, setCopiedLink] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [autoAttempted, setAutoAttempted] = useState(false);

  const canShareNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const hasApk = Boolean(appInfo?.hasApk && appInfo?.apkDownloadUrl);

  // If opened with ?auto=1 outside an iframe, trigger APK download automatically if configured
  useEffect(() => {
    if (autoAttempted || isEmbeddedIframe) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auto') === '1' && appInfo !== null) {
      setAutoAttempted(true);
      if (hasApk) {
        triggerAutoSetup();
      }
    }
  }, [appInfo, autoAttempted, hasApk, isEmbeddedIframe, triggerAutoSetup]);

  const handleCopySpecialLink = async () => {
    const ok = await copyToClipboard(specialDownloadUrl);
    if (ok) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2400);
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: 'Download SW88 Mobile App',
        text: 'Install the official SW88 Gaming & Wallet app directly on your phone:',
        url: specialDownloadUrl,
      });
    } catch {
      handleCopySpecialLink();
    }
  };

  const handlePrimaryDownload = async () => {
    await triggerAutoSetup();
  };

  const primaryButtonLabel = (() => {
    if (isInstalled || setupPhase === 'installed') return 'Open SW88 App';
    if (setupPhase === 'downloading') return 'Downloading SW88.apk...';
    if (setupPhase === 'preparing') return 'Setting Up Installer...';
    if (setupPhase === 'prompting') return 'Confirm Setup in Browser...';
    if (setupPhase === 'ready_tap') return 'Tap to Complete Setup';
    if (hasApk) return 'Download & Auto-Setup SW88 (.apk)';
    if (canDirectInstall) return 'Install SW88 App Now';
    if (isEmbeddedIframe) return 'Open Direct Installer Window';
    return 'Download & Auto-Setup SW88 App';
  })();

  const packageSpecs = hasApk
    ? `Android APK v${appInfo?.version || '1.0.0'} · ${formatFileSize(appInfo?.apkSizeBytes || 0)}`
    : `Instant Mobile App · v${appInfo?.version || '1.0.0'} · ${swReady ? 'Offline Ready' : 'Web Engine Ready'}`;

  return (
    <div className="min-h-dvh bg-[#0B0D11] text-[#F5F7FA] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Clean 3-Zone Top Bar */}
      <header className="w-full max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 border-b border-white/10">
        <BrandMark subtitle="Mobile App" />
        <button
          type="button"
          onClick={onOpenApp}
          className="min-h-[40px] px-3.5 rounded-xl border border-white/15 bg-[#14171F] hover:border-[#E6B84F]/60 text-xs sm:text-sm font-semibold text-[#F5F7FA] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
        >
          <span>Open Web App</span>
          <ArrowRight className="w-3.5 h-3.5 text-[#E6B84F]" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-6 sm:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Left Hero Column */}
          <section className="lg:col-span-6 flex flex-col justify-center space-y-5 text-center lg:text-left">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#E6B84F]">
              Official SW88 Mobile Distribution
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.08] text-[#F5F7FA] [text-wrap:balance]">
              Install <span className="text-[#E6B84F]">SW88</span> on Your Phone in One Tap.
            </h1>

            <p className="text-sm sm:text-base text-[#9CA3AF] max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Full-screen live gameplay, centralized NPR wallet transfers, and instant real-time round updates directly from your home screen.
            </p>

            <div className="space-y-3 pt-1 max-w-lg mx-auto lg:mx-0 text-left">
              <div className="flex items-start gap-3 py-2.5 border-b border-white/10">
                <Gamepad2 className="w-5 h-5 text-[#E6B84F] shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-[#D1D5DB]">
                  <span className="font-semibold text-[#F5F7FA]">All 3 Live Games Included</span>
                  <span className="text-[#9CA3AF]"> — 3 Patti Royale, Bubble Rocket X, and Skyline Crash.</span>
                </div>
              </div>
              <div className="flex items-start gap-3 py-2.5 border-b border-white/10">
                <Wallet className="w-5 h-5 text-[#E6B84F] shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-[#D1D5DB]">
                  <span className="font-semibold text-[#F5F7FA]">Real-Time NPR Wallet</span>
                  <span className="text-[#9CA3AF]"> — Instant Agent transfers, Friend transfers, and QR deposits.</span>
                </div>
              </div>
              <div className="flex items-start gap-3 py-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-[#D1D5DB]">
                  <span className="font-semibold text-[#F5F7FA]">Zero App Store Redirects</span>
                  <span className="text-[#9CA3AF]"> — Direct encrypted setup straight from SW88 servers.</span>
                </div>
              </div>
            </div>
          </section>

          {/* Right Installer & Special Link Card */}
          <section className="lg:col-span-6 flex flex-col justify-center">
            <div className="rounded-3xl bg-[#14171F] border border-white/10 p-5 sm:p-7 shadow-2xl space-y-5">
              {/* App Header Identity */}
              <div className="flex items-center gap-4">
                {!iconError ? (
                  <img
                    src="/pwa-192x192.png"
                    alt="SW88 App Icon"
                    referrerPolicy="no-referrer"
                    onError={() => setIconError(true)}
                    className="w-16 h-16 rounded-2xl border border-[#E6B84F]/40 bg-[#0B0D11] object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl border border-[#E6B84F]/40 bg-[#0B0D11] flex items-center justify-center shrink-0">
                    <Smartphone className="w-8 h-8 text-[#E6B84F]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-display font-extrabold text-xl text-[#F5F7FA] truncate">
                    SW88 Gaming &amp; Wallet
                  </h2>
                  <div className="text-xs text-[#9CA3AF] mt-1 font-mono-nums">
                    {packageSpecs}
                  </div>
                </div>
              </div>

              {/* Dynamic Setup State Feedback */}
              {(setupPhase === 'preparing' || setupPhase === 'prompting' || setupPhase === 'downloading') && (
                <div className="rounded-2xl bg-[#0B0D11] border border-[#E6B84F]/30 p-4 flex items-center gap-3 text-xs sm:text-sm text-[#E6B84F]">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>
                    {setupPhase === 'downloading'
                      ? 'Downloading SW88.apk package — open the downloaded file to finish Android setup.'
                      : setupPhase === 'prompting'
                        ? 'System installer opened — confirm "Install" to add SW88 to your device.'
                        : 'Preparing offline engine and verifying automatic app installer...'}
                  </span>
                </div>
              )}

              {(isInstalled || setupPhase === 'installed') && (
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3 text-xs sm:text-sm text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>SW88 App is installed and ready on this device.</span>
                </div>
              )}

              {setupPhase === 'dismissed' && (
                <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-3.5 text-xs text-[#D1D5DB]">
                  Installation was cancelled. Tap the button below anytime to run setup again.
                </div>
              )}

              {setupPhase === 'iframe_redirect' && (
                <div className="rounded-2xl bg-[#0B0D11] border border-[#E6B84F]/30 p-4 space-y-2.5 text-xs text-[#D1D5DB]">
                  <p className="font-semibold text-[#F5F7FA]">
                    Direct installer opened in a full browser window.
                  </p>
                  <p className="text-[#9CA3AF]">
                    If the new window did not open automatically, tap below to launch the installer directly:
                  </p>
                  <a
                    href={`${specialDownloadUrl}?auto=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold text-[#E6B84F] hover:underline"
                  >
                    <span>Open Direct SW88 Installer</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {setupPhase === 'webview_escape' && (
                <div className="rounded-2xl bg-[#0B0D11] border border-[#E6B84F]/30 p-4 space-y-2.5 text-xs text-[#D1D5DB]">
                  <p className="font-semibold text-[#F5F7FA]">
                    You opened this link inside an in-app browser.
                  </p>
                  <p className="text-[#9CA3AF]">
                    In-app browsers restrict app installation. Copy this link and open it in Chrome or Safari for 1-tap automatic setup:
                  </p>
                  <button
                    type="button"
                    onClick={handleCopySpecialLink}
                    className="min-h-[40px] px-3.5 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Link Copied' : 'Copy Link for Chrome / Safari'}</span>
                  </button>
                </div>
              )}

              {setupPhase === 'ios_sheet' && (
                <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-4 space-y-2 text-xs text-[#D1D5DB]">
                  <div className="font-bold text-[#F5F7FA]">iPhone / iPad Quick Add</div>
                  <div className="text-[#9CA3AF] leading-relaxed">
                    Apple iOS installs web apps through Safari: tap <Share className="inline w-3.5 h-3.5 mx-0.5 text-[#E6B84F]" /> <strong className="text-[#F5F7FA]">Share</strong>, then tap <strong className="text-[#F5F7FA]">Add to Home Screen</strong>.
                  </div>
                </div>
              )}

              {setupPhase === 'unsupported' && (
                <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-4 space-y-2 text-xs text-[#D1D5DB]">
                  <div className="font-semibold text-[#F5F7FA]">
                    {isIos
                      ? 'Tap Safari Share -> Add to Home Screen to install SW88 on iPhone.'
                      : 'Browser auto-prompt is unavailable or SW88 is already installed.'}
                  </div>
                  <div className="text-[#9CA3AF]">
                    You can launch SW88 directly in your browser below or copy this link to Chrome on Android for 1-tap installation.
                  </div>
                </div>
              )}

              {/* Primary CTA */}
              {isInstalled || setupPhase === 'installed' ? (
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="w-full min-h-[48px] px-5 rounded-2xl bg-emerald-500 hover:brightness-105 text-[#0B0D11] font-extrabold text-sm sm:text-base inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform cursor-pointer"
                >
                  <span>Open SW88 App</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={setupPhase === 'preparing' || setupPhase === 'prompting'}
                  onClick={handlePrimaryDownload}
                  className="w-full min-h-[48px] px-5 rounded-2xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm sm:text-base inline-flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-70 transition-transform cursor-pointer"
                >
                  {setupPhase === 'preparing' || setupPhase === 'prompting' || setupPhase === 'downloading' ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Download className="w-4 h-4 shrink-0" />
                  )}
                  <span>{primaryButtonLabel}</span>
                </button>
              )}

              {/* Special Download Link Box */}
              <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#F5F7FA]">Special App Download Link</span>
                  <span className="text-[#9CA3AF]">Direct shareable URL</span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex-1 min-w-0 min-h-[42px] px-3 rounded-xl bg-[#14171F] border border-white/10 flex items-center">
                    <span className="font-mono-nums text-xs text-[#D1D5DB] truncate select-all">
                      {specialDownloadUrl}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopySpecialLink}
                      className="flex-1 sm:flex-none min-h-[42px] px-3.5 rounded-xl bg-[#14171F] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold text-[#F5F7FA] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#E6B84F]" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>

                    {canShareNative && (
                      <button
                        type="button"
                        onClick={handleNativeShare}
                        className="min-h-[42px] min-w-[42px] px-3 rounded-xl bg-[#14171F] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold text-[#F5F7FA] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        aria-label="Share download link"
                      >
                        <Share2 className="w-3.5 h-3.5 text-[#E6B84F]" />
                        <span className="sm:hidden">Share</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between gap-3 text-xs text-[#9CA3AF]">
                <span>Prefer browser play?</span>
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="font-semibold text-[#E6B84F] hover:underline whitespace-nowrap cursor-pointer"
                >
                  Continue to SW88 Login / Portal
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
