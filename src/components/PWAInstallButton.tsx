import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { copyToClipboard } from '../lib/api';

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
    isInstalled,
    isIos,
    isEmbeddedIframe,
    canDirectInstall,
    appInfo,
    setupPhase,
    specialDownloadUrl,
    triggerAutoSetup,
  } = usePWAInstall();

  const [showIosSheet, setShowIosSheet] = useState(false);
  const [showWebViewNotice, setShowWebViewNotice] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const hasApk = Boolean(appInfo?.hasApk && appInfo?.apkDownloadUrl);

  const handleClick = async () => {
    if (isInstalled) return;
    const outcome = await triggerAutoSetup();
    if (outcome === 'ios_sheet') {
      setShowIosSheet(true);
    } else if (outcome === 'webview_escape' || outcome === 'unsupported') {
      setShowWebViewNotice(true);
    }
  };

  const handleCopyDownloadLink = async () => {
    const ok = await copyToClipboard(specialDownloadUrl);
    if (ok) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    }
  };

  const isWorking =
    setupPhase === 'preparing' || setupPhase === 'prompting' || setupPhase === 'downloading';

  const cardButtonLabel = (() => {
    if (setupPhase === 'downloading') return 'Downloading SW88.apk...';
    if (setupPhase === 'preparing') return 'Setting Up Installer...';
    if (setupPhase === 'prompting') return 'Confirm Setup...';
    if (hasApk) return 'Download & Auto-Setup APK';
    if (canDirectInstall) return 'Install SW88 App Now';
    return 'Download & Auto-Setup App';
  })();

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
                  : hasApk
                    ? `Direct Android APK v${appInfo?.version || '1.0.0'} ready for automatic download & setup.`
                    : 'One-tap automatic setup on Android, iPhone, or Desktop for full-screen mobile gameplay.'}
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
              disabled={isWorking}
              onClick={handleClick}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer px-4"
            >
              {isWorking ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Download className="w-4 h-4 shrink-0" />
              )}
              <span>{cardButtonLabel}</span>
            </button>
          )}

          {/* Special Download Link Bar */}
          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
            <a
              href="/download"
              className="text-[#9CA3AF] hover:text-[#E6B84F] inline-flex items-center gap-1 truncate max-w-full"
            >
              <span>Download page:</span>
              <span className="font-mono-nums text-[#F5F7FA] underline decoration-white/20">/download</span>
            </a>
            <button
              type="button"
              onClick={handleCopyDownloadLink}
              className="min-h-[34px] px-2.5 rounded-lg bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-semibold text-[#F5F7FA] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#E6B84F]" />
                  <span>Copy Download Link</span>
                </>
              )}
            </button>
          </div>
        </div>

        {showIosSheet && <IosInstallModal onClose={() => setShowIosSheet(false)} />}
        {showWebViewNotice && (
          <DirectLinkModal
            specialDownloadUrl={specialDownloadUrl}
            isEmbeddedIframe={isEmbeddedIframe}
            isIos={isIos}
            onClose={() => setShowWebViewNotice(false)}
          />
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
      <div className={`inline-flex items-center gap-1.5 ${fullWidth ? 'w-full' : ''}`}>
        <button
          type="button"
          disabled={isWorking}
          onClick={handleClick}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6B84F]/40 bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-bold tracking-tight hover:brightness-105 active:scale-[0.98] disabled:opacity-75 transition cursor-pointer whitespace-nowrap shrink-0 ${
            compact
              ? 'min-h-[40px] sm:min-h-[44px] px-3 sm:px-3.5 py-2 text-xs'
              : 'min-h-[46px] px-4 py-2.5 text-sm'
          } ${fullWidth ? 'flex-1 min-w-0' : ''}`}
        >
          {isWorking ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <Download className="w-4 h-4 shrink-0" />
          )}
          {compact ? (
            <>
              <span className="sm:hidden">
                {setupPhase === 'preparing' ? 'Setting up...' : hasApk ? 'Get APK' : 'Install App'}
              </span>
              <span className="hidden sm:inline">
                {setupPhase === 'preparing'
                  ? 'SETTING UP...'
                  : hasApk
                    ? 'DOWNLOAD SW88 APK'
                    : 'DOWNLOAD SW88 APP'}
              </span>
            </>
          ) : (
            <span className="truncate">
              {setupPhase === 'downloading'
                ? 'DOWNLOADING APK...'
                : setupPhase === 'preparing'
                  ? 'SETTING UP...'
                  : setupPhase === 'prompting'
                    ? 'CONFIRM SETUP...'
                    : hasApk
                      ? 'DOWNLOAD SW88 APK'
                      : canDirectInstall
                        ? 'INSTALL SW88 APP'
                        : 'DOWNLOAD SW88 APP'}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleCopyDownloadLink}
          title="Copy special /download link"
          aria-label="Copy special app download link"
          className={`inline-flex items-center justify-center rounded-xl border border-white/15 bg-[#14171F] hover:border-[#E6B84F]/60 text-[#F5F7FA] cursor-pointer shrink-0 ${
            compact ? 'min-h-[40px] sm:min-h-[44px] min-w-[40px] sm:min-w-[44px] px-2.5' : 'min-h-[46px] min-w-[46px] px-3'
          }`}
        >
          {copiedLink ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4 text-[#E6B84F]" />
          )}
        </button>
      </div>

      {showIosSheet && <IosInstallModal onClose={() => setShowIosSheet(false)} />}
      {showWebViewNotice && (
        <DirectLinkModal
          specialDownloadUrl={specialDownloadUrl}
          isEmbeddedIframe={isEmbeddedIframe}
          isIos={isIos}
          onClose={() => setShowWebViewNotice(false)}
        />
      )}
    </>
  );
}

function IosInstallModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-[#F5F7FA]">Add SW88 on iPhone / iPad</h3>
            <p className="text-sm text-[#9CA3AF] mt-1">
              Apple Safari adds apps to your home screen via the Share button.
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

        <ol className="space-y-3 text-sm text-[#D1D5DB] bg-[#0B0D11] rounded-xl p-4 border border-white/10">
          <li className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
              1
            </span>
            <span>
              Tap the <Share className="inline w-4 h-4 mx-0.5 text-[#E6B84F]" /> Share icon in Safari.
            </span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[#E6B84F]/20 text-[#E6B84F] font-bold flex items-center justify-center text-xs shrink-0">
              2
            </span>
            <span>Tap &ldquo;Add to Home Screen&rdquo;, then tap &ldquo;Add&rdquo;.</span>
          </li>
        </ol>

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-sm hover:brightness-105 cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function DirectLinkModal({
  specialDownloadUrl,
  isEmbeddedIframe,
  isIos,
  onClose,
}: {
  specialDownloadUrl: string;
  isEmbeddedIframe: boolean;
  isIos: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(specialDownloadUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-[#F5F7FA]">Direct SW88 Installer Link</h3>
            <p className="text-sm text-[#9CA3AF] mt-1">
              {isEmbeddedIframe
                ? 'Open the dedicated installer page in a full browser window to run automatic setup.'
                : isIos
                  ? 'Open this link in Safari on iPhone or Chrome on Android for direct app installation.'
                  : 'Open the dedicated download page directly in Chrome or Edge to launch automatic setup.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close download link modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 font-mono-nums text-xs text-[#D1D5DB] break-all">
          {specialDownloadUrl}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <a
            href={`${specialDownloadUrl}?auto=1`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm inline-flex items-center justify-center gap-2"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>Open Installer</span>
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[44px] px-4 rounded-xl border border-white/15 bg-[#0B0D11] text-sm font-bold text-[#F5F7FA] inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#E6B84F]" />}
            <span>{copied ? 'Copied' : 'Copy Link'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
