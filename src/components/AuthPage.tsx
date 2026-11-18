import { useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, Ban, Eye, EyeOff, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { ApiError, apiFetch, setStoredToken } from '../lib/api';
import type { BannedPayload, User, Wallet } from '../types';
import { BrandMark } from './BrandMark';
import { LegalModal } from './LegalModal';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthPageProps {
  onSuccess: (payload: { token: string; user: User; wallet: Wallet }) => void;
  bannedNotice: BannedPayload | null;
  onDismissBanned: () => void;
}

export function AuthPage({ onSuccess, bannedNotice, onDismissBanned }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ageVerified, setAgeVerified] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBanned, setLocalBanned] = useState<BannedPayload | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);

  const activeBan = bannedNotice || localBanned;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLocalBanned(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiFetch<{ token: string; user: User; wallet: Wallet }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });
        setStoredToken(res.token);
        onSuccess(res);
      } else {
        const res = await apiFetch<{ token: string; user: User; wallet: Wallet }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, confirmPassword, ageVerified }),
        });
        setStoredToken(res.token);
        onSuccess(res);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_BANNED') {
        setLocalBanned({
          title: err.title || 'YOUR ACCOUNT HAS BEEN PERMANENTLY BANNED',
          message: err.message,
        });
      } else {
        setError(err?.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (activeBan) {
    return (
      <div className="min-h-dvh bg-[#0B0D11] flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl bg-[#14171F] border border-red-500/40 p-7 sm:p-9 shadow-[0_24px_64px_rgba(239,68,68,0.18)] text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
            <Ban className="w-8 h-8" />
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-red-400">
            {activeBan.title}
          </h1>
          <p className="text-sm sm:text-base text-[#D1D5DB] leading-relaxed">
            {activeBan.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setLocalBanned(null);
              onDismissBanned();
            }}
            className="min-h-[44px] px-6 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-[#F5F7FA] hover:bg-white/10 cursor-pointer"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0B0D11] text-[#F5F7FA] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="w-full max-w-6xl mx-auto px-3.5 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
        <BrandMark subtitle="Gaming & Wallet" />
        <PWAInstallButton compact />
      </header>

      <main className="flex-1 flex items-center justify-center px-3.5 sm:px-6 py-4 sm:py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
          <div className="order-2 lg:order-1 lg:col-span-6 space-y-4 sm:space-y-5 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 text-[11px] sm:text-xs font-bold uppercase tracking-[0.14em] sm:tracking-[0.16em] text-[#E6B84F]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Centralized Wallet · Live Gaming · NST Audited</span>
            </div>
            <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.08] text-[#F5F7FA]">
              One Unified Wallet Across Every <span className="text-[#E6B84F]">SW88</span> Game.
            </h1>
            <p className="text-xs sm:text-base text-[#9CA3AF] max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Sign in with your SW88 username or 6-character User ID. Deposit via verified QR, play 3 Patti Royale, Bubble Rocket X, and Skyline Crash from a single real-time balance, and withdraw winnings directly.
            </p>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-1 sm:pt-2 max-w-lg mx-auto lg:mx-0 text-left">
              <div className="rounded-xl bg-[#14171F] border border-white/10 p-2.5 sm:p-3.5">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Min Deposit</div>
                <div className="font-mono-nums font-bold text-xs sm:text-base text-[#F5F7FA] mt-0.5">NPR 100</div>
              </div>
              <div className="rounded-xl bg-[#14171F] border border-white/10 p-2.5 sm:p-3.5">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Agent Rate</div>
                <div className="font-mono-nums font-bold text-xs sm:text-base text-emerald-400 mt-0.5">0% Fee</div>
              </div>
              <div className="rounded-xl bg-[#14171F] border border-white/10 p-2.5 sm:p-3.5">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Withdrawals</div>
                <div className="font-mono-nums font-bold text-xs sm:text-base text-[#E6B84F] mt-0.5">eSewa &amp; Bank</div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2 lg:col-span-6">
            <div className="w-full max-w-md mx-auto rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-8 shadow-2xl">
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#0B0D11] border border-white/10 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`min-h-[44px] rounded-lg text-sm font-bold transition cursor-pointer ${
                    mode === 'login'
                      ? 'bg-[#E6B84F] text-[#0B0D11] shadow'
                      : 'text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className={`min-h-[44px] rounded-lg text-sm font-bold transition cursor-pointer ${
                    mode === 'register'
                      ? 'bg-[#E6B84F] text-[#0B0D11] shadow'
                      : 'text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {error && (
                <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'login' ? (
                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      Username or 6-Character User ID
                    </label>
                    <div className="relative">
                      <UserCheck className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="e.g. Ram Rai or RAMR27"
                        className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      Choose Username
                    </label>
                    <div className="relative">
                      <UserCheck className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. Ram Rai"
                        className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full min-h-[46px] pl-10 pr-11 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#9CA3AF] hover:text-white cursor-pointer"
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type={showPass ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
                        />
                      </div>
                    </div>

                    <label className="flex items-start gap-2.5 text-xs text-[#9CA3AF] cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={ageVerified}
                        onChange={(e) => setAgeVerified(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#0B0D11] accent-[#E6B84F]"
                      />
                      <span>
                        I confirm I am at least 18 years old and agree to SW88{' '}
                        <button
                          type="button"
                          onClick={() => setLegalOpen(true)}
                          className="text-[#E6B84F] underline hover:brightness-110 cursor-pointer"
                        >
                          Terms, Privacy &amp; Responsible Gaming Rules
                        </button>
                        .
                      </span>
                    </label>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-50 cursor-pointer transition"
                >
                  <span>{loading ? 'Please wait...' : mode === 'login' ? 'Sign In to SW88' : 'Create SW88 Account'}</span>
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B7280]">
        <span>SW88 Platform · 18+ Responsible Gaming</span>
        <button
          type="button"
          onClick={() => setLegalOpen(true)}
          className="text-[#9CA3AF] hover:text-[#E6B84F] cursor-pointer"
        >
          Terms · Privacy · Responsible Gaming
        </button>
      </footer>

      <LegalModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  );
}
