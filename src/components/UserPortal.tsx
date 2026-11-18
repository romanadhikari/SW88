import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Gamepad2,
  History,
  Home,
  Image as ImageIcon,
  Lock,
  LogOut,
  Play,
  QrCode,
  Send,
  Shield,
  TrendingUp,
  Upload,
  User as UserIcon,
  Users,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import thumb3Patti from '../assets/images/sw88_thumb_3patti_1794976007848.jpg';
import thumbBubble from '../assets/images/sw88_thumb_bubble_1794976008608.jpg';
import thumbSkyline from '../assets/images/sw88_thumb_skyline_1794976008575.jpg';
import { apiFetch, copyToClipboard, formatNpr, formatNstDateShort, formatNstDateTime } from '../lib/api';
import type {
  DepositRecord,
  GameInfo,
  MaintenanceState,
  NotificationItem,
  QrInfo,
  User,
  Wallet,
  WithdrawalRecord,
} from '../types';
import { BrandMark } from './BrandMark';
import { LegalModal } from './LegalModal';
import { PWAInstallButton } from './PWAInstallButton';

export type UserTab = 'home' | 'wallet' | 'earn' | 'history' | 'profile';

const GAME_THUMBNAILS: Record<string, string> = {
  '3-patti-royale': thumb3Patti,
  'bubble-rocket-x': thumbBubble,
  'skyline-crash': thumbSkyline,
};

interface UserPortalProps {
  user: User;
  wallet: Wallet;
  games: GameInfo[];
  notifications: NotificationItem[];
  unreadCount: number;
  qrVersion: number;
  maintenance?: MaintenanceState;
  activeTab: UserTab;
  onTabChange: (tab: UserTab) => void;
  onLaunchGame: (game: GameInfo) => void;
  onUserUpdate: (user: User) => void;
  onWalletSync: (wallet: Wallet) => void;
  onNotificationsRefresh: () => void;
  onLogout: () => void;
}

function StatusText({ status }: { status: string }) {
  const s = (status || '').toUpperCase();
  const color =
    s === 'APPROVED' || s === 'PAID' || s === 'WIN' || s === 'ACTIVE' || s === 'COMPLETED'
      ? 'text-emerald-400'
      : s === 'REJECTED' || s === 'PAYMENT FAILED' || s === 'LOSS' || s === 'SUSPENDED' || s === 'BANNED'
        ? 'text-red-400'
        : s === 'PROCESSING'
          ? 'text-sky-400'
          : 'text-[#E6B84F]';
  return <span className={`font-semibold text-xs tracking-wide ${color}`}>{status}</span>;
}

export function UserPortal({
  user,
  wallet,
  games,
  notifications,
  unreadCount,
  qrVersion,
  maintenance,
  activeTab,
  onTabChange,
  onLaunchGame,
  onUserUpdate,
  onWalletSync,
  onNotificationsRefresh,
  onLogout,
}: UserPortalProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);

  // Wallet states
  const [walletMode, setWalletMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null);
  const [depAmount, setDepAmount] = useState('500');
  const [depFile, setDepFile] = useState<File | null>(null);
  const [depPreview, setDepPreview] = useState<string | null>(null);
  const [depBusy, setDepBusy] = useState(false);
  const [depNotice, setDepNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [myDeposits, setMyDeposits] = useState<DepositRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Withdrawal states
  const [wdrAmount, setWdrAmount] = useState('1000');
  const [wdrMethod, setWdrMethod] = useState<'ESEWA' | 'BANK'>('ESEWA');
  const [wdrHolder, setWdrHolder] = useState('');
  const [wdrEsewa, setWdrEsewa] = useState('');
  const [wdrBankName, setWdrBankName] = useState('');
  const [wdrBankAcc, setWdrBankAcc] = useState('');
  const [wdrBankBranch, setWdrBankBranch] = useState('');
  const [wdrConfirmOpen, setWdrConfirmOpen] = useState(false);
  const [wdrBusy, setWdrBusy] = useState(false);
  const [wdrNotice, setWdrNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [myWithdrawals, setMyWithdrawals] = useState<WithdrawalRecord[]>([]);

  // Earn Money: Agent & Friend Transfer states
  const [agentUid, setAgentUid] = useState('');
  const [agentAmt, setAgentAmt] = useState('200');
  const [agentTarget, setAgentTarget] = useState<{ uid: string; username: string; displayName: string } | null>(null);
  const [agentLookupErr, setAgentLookupErr] = useState<string | null>(null);
  const [agentConfirmOpen, setAgentConfirmOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentNotice, setAgentNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [friendUid, setFriendUid] = useState('');
  const [friendAmt, setFriendAmt] = useState('100');
  const [friendTarget, setFriendTarget] = useState<{ uid: string; username: string; displayName: string } | null>(null);
  const [friendLookupErr, setFriendLookupErr] = useState<string | null>(null);
  const [friendConfirmOpen, setFriendConfirmOpen] = useState(false);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendNotice, setFriendNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // History states
  const [histSubTab, setHistSubTab] = useState<'all' | 'deposits' | 'withdrawals' | 'agent' | 'friend' | 'games'>('all');
  const [historyData, setHistoryData] = useState<{
    ledger: any[];
    deposits: any[];
    withdrawals: WithdrawalRecord[];
    agentTransfers: any[];
    friendTransfers: any[];
    gameRounds: any[];
  } | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  // Profile states
  const [displayNameInput, setDisplayNameInput] = useState(user.displayName);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');
  const [passMsg, setPassMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dailyLimitInput, setDailyLimitInput] = useState(user.responsibleDailyLimit ? String(user.responsibleDailyLimit) : '');
  const [selfExcludeDays, setSelfExcludeDays] = useState<string>('');
  const [rgMsg, setRgMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Broken thumbnail fallback state
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDisplayNameInput(user.displayName);
    setDailyLimitInput(user.responsibleDailyLimit ? String(user.responsibleDailyLimit) : '');
  }, [user]);

  const loadQr = useCallback(async () => {
    try {
      const q = await apiFetch<QrInfo>('/api/qr');
      setQrInfo(q);
    } catch {
      // ignore
    }
  }, []);

  const loadWalletLists = useCallback(async () => {
    try {
      const [dRes, wRes, walRes] = await Promise.all([
        apiFetch<{ deposits: DepositRecord[] }>('/api/deposits/my'),
        apiFetch<{ withdrawals: WithdrawalRecord[] }>('/api/withdrawals/my'),
        apiFetch<{ wallet: Wallet }>('/api/wallet'),
      ]);
      setMyDeposits(dRes.deposits || []);
      setMyWithdrawals(wRes.withdrawals || []);
      if (walRes.wallet) onWalletSync(walRes.wallet);
    } catch {
      // ignore
    }
  }, [onWalletSync]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const data = await apiFetch<any>('/api/history');
      setHistoryData(data);
    } catch {
      // ignore
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQr();
  }, [loadQr, qrVersion]);

  useEffect(() => {
    if (activeTab === 'wallet') {
      loadQr();
      loadWalletLists();
    } else if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadQr, loadWalletLists, loadHistory]);

  const handleCopyUid = async () => {
    const ok = await copyToClipboard(user.uid);
    if (ok) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2600);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) });
      onNotificationsRefresh();
    } catch {
      // ignore
    }
  };

  const handleSelectScreenshot = (file: File | null) => {
    if (depPreview) URL.revokeObjectURL(depPreview);
    setDepFile(file);
    setDepPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleDepositSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDepNotice(null);
    const amt = Number(depAmount);
    if (!Number.isFinite(amt) || amt < 100) {
      setDepNotice({ kind: 'err', text: 'Minimum deposit amount is NPR 100.' });
      return;
    }
    if (!depFile) {
      setDepNotice({ kind: 'err', text: 'Please upload your payment screenshot before submitting.' });
      return;
    }
    setDepBusy(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(amt));
      fd.append('screenshot', depFile);
      const res = await apiFetch<{ message: string }>('/api/deposits', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setDepNotice({
        kind: 'ok',
        text: res.message || 'Your deposit request has been submitted and is pending admin review.',
      });
      setDepAmount('500');
      handleSelectScreenshot(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadWalletLists();
      onNotificationsRefresh();
    } catch (err: any) {
      setDepNotice({ kind: 'err', text: err?.message || 'Deposit submission failed.' });
    } finally {
      setDepBusy(false);
    }
  };

  const withdrawableAmount = Math.max(0, Math.min(wallet.withdrawableWinnings, wallet.mainBalance));

  const handleOpenWdrConfirm = (e: FormEvent) => {
    e.preventDefault();
    setWdrNotice(null);
    const amt = Number(wdrAmount);
    if (!Number.isFinite(amt) || amt < 1000 || amt > 10000) {
      setWdrNotice({ kind: 'err', text: 'Withdrawal amount must be between NPR 1,000 and NPR 10,000.' });
      return;
    }
    if (amt > withdrawableAmount) {
      setWdrNotice({
        kind: 'err',
        text: `Only game winnings are eligible for withdrawal. Available winnings: ${formatNpr(withdrawableAmount)}.`,
      });
      return;
    }
    if (wdrHolder.trim().length < 2) {
      setWdrNotice({ kind: 'err', text: 'Enter the account holder full name.' });
      return;
    }
    if (wdrMethod === 'ESEWA' && !/^[0-9]{10}$/.test(wdrEsewa.trim())) {
      setWdrNotice({ kind: 'err', text: 'Enter a valid 10-digit eSewa mobile number.' });
      return;
    }
    if (wdrMethod === 'BANK' && (!wdrBankName.trim() || wdrBankAcc.trim().length < 5 || !wdrBankBranch.trim())) {
      setWdrNotice({ kind: 'err', text: 'Complete bank name, account number, and branch.' });
      return;
    }
    setWdrConfirmOpen(true);
  };

  const handleConfirmWithdrawal = async () => {
    setWdrBusy(true);
    try {
      const res = await apiFetch<{ wallet: Wallet; message: string }>('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(wdrAmount),
          method: wdrMethod,
          accountHolderName: wdrHolder.trim(),
          esewaMobile: wdrMethod === 'ESEWA' ? wdrEsewa.trim() : undefined,
          bankName: wdrMethod === 'BANK' ? wdrBankName.trim() : undefined,
          bankAccountNumber: wdrMethod === 'BANK' ? wdrBankAcc.trim() : undefined,
          bankBranch: wdrMethod === 'BANK' ? wdrBankBranch.trim() : undefined,
        }),
      });
      onWalletSync(res.wallet);
      setWdrNotice({ kind: 'ok', text: res.message || 'Withdrawal request submitted.' });
      setWdrConfirmOpen(false);
      loadWalletLists();
      onNotificationsRefresh();
    } catch (err: any) {
      setWdrConfirmOpen(false);
      setWdrNotice({ kind: 'err', text: err?.message || 'Withdrawal request failed.' });
    } finally {
      setWdrBusy(false);
    }
  };

  const lookupUid = async (uid: string, kind: 'agent' | 'friend') => {
    const clean = uid.trim().toUpperCase();
    if (kind === 'agent') {
      setAgentTarget(null);
      setAgentLookupErr(null);
    } else {
      setFriendTarget(null);
      setFriendLookupErr(null);
    }
    if (clean.length < 4) return;
    try {
      const target = await apiFetch<{ uid: string; username: string; displayName: string }>(
        `/api/transfers/lookup/${encodeURIComponent(clean)}`
      );
      if (kind === 'agent') setAgentTarget(target);
      else setFriendTarget(target);
    } catch (err: any) {
      if (kind === 'agent') setAgentLookupErr(err?.message || 'User ID not found.');
      else setFriendLookupErr(err?.message || 'User ID not found.');
    }
  };

  const handleOpenAgentConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setAgentNotice(null);
    const amt = Number(agentAmt);
    if (wallet.availableBalance < 1500) {
      setAgentNotice({ kind: 'err', text: 'Minimum balance of NPR 1,500 is required for Agent transfers.' });
      return;
    }
    if (!Number.isFinite(amt) || amt < 200) {
      setAgentNotice({ kind: 'err', text: 'Minimum Agent transfer amount is NPR 200.' });
      return;
    }
    if (wallet.availableBalance - amt < 1500) {
      setAgentNotice({
        kind: 'err',
        text: 'You must retain at least NPR 1,500 in your wallet after completing an Agent transfer.',
      });
      return;
    }
    let verified = agentTarget;
    if (!verified || verified.uid !== agentUid.trim().toUpperCase()) {
      try {
        verified = await apiFetch<{ uid: string; username: string; displayName: string }>(
          `/api/transfers/lookup/${encodeURIComponent(agentUid.trim().toUpperCase())}`
        );
        setAgentTarget(verified);
        setAgentLookupErr(null);
      } catch (err: any) {
        setAgentLookupErr(err?.message || 'Verify a valid Receiver User ID first.');
        return;
      }
    }
    setAgentConfirmOpen(true);
  };

  const handleConfirmAgentTransfer = async () => {
    setAgentBusy(true);
    try {
      const res = await apiFetch<{
        wallet: Wallet;
        transfer: { id: string; amount: number; receiver_uid?: string; receiverUid?: string };
      }>('/api/transfers/agent', {
        method: 'POST',
        body: JSON.stringify({
          receiverUid: agentTarget?.uid || agentUid.trim().toUpperCase(),
          amount: Number(agentAmt),
          idempotencyKey: `agt-${user.uid}-${Date.now()}`,
        }),
      });
      onWalletSync(res.wallet);
      const recvUid = res.transfer.receiver_uid || res.transfer.receiverUid || agentTarget?.uid || '';
      setAgentNotice({
        kind: 'ok',
        text: `Agent transfer ${res.transfer.id} complete: ${formatNpr(res.transfer.amount)} sent to ${recvUid} with 0% commission.`,
      });
      setAgentUid('');
      setAgentTarget(null);
      setAgentConfirmOpen(false);
      onNotificationsRefresh();
    } catch (err: any) {
      setAgentConfirmOpen(false);
      setAgentNotice({ kind: 'err', text: err?.message || 'Agent transfer failed.' });
    } finally {
      setAgentBusy(false);
    }
  };

  const friendNumAmt = Number(friendAmt) || 0;
  const friendFee = Math.round(friendNumAmt * 0.1 * 100) / 100;
  const friendTotalDebit = Math.round((friendNumAmt + friendFee) * 100) / 100;

  const handleOpenFriendConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setFriendNotice(null);
    if (!Number.isFinite(friendNumAmt) || friendNumAmt < 100) {
      setFriendNotice({ kind: 'err', text: 'Minimum Friend transfer amount is NPR 100.' });
      return;
    }
    if (wallet.availableBalance < friendTotalDebit) {
      setFriendNotice({
        kind: 'err',
        text: `Insufficient balance. Need ${formatNpr(friendTotalDebit)} (includes 10% commission of ${formatNpr(friendFee)}).`,
      });
      return;
    }
    let verified = friendTarget;
    if (!verified || verified.uid !== friendUid.trim().toUpperCase()) {
      try {
        verified = await apiFetch<{ uid: string; username: string; displayName: string }>(
          `/api/transfers/lookup/${encodeURIComponent(friendUid.trim().toUpperCase())}`
        );
        setFriendTarget(verified);
        setFriendLookupErr(null);
      } catch (err: any) {
        setFriendLookupErr(err?.message || 'Verify a valid Receiver User ID first.');
        return;
      }
    }
    setFriendConfirmOpen(true);
  };

  const handleConfirmFriendTransfer = async () => {
    setFriendBusy(true);
    try {
      const res = await apiFetch<{
        wallet: Wallet;
        transfer: {
          id: string;
          amount: number;
          commission_amount?: number;
          commissionAmount?: number;
          receiver_uid?: string;
          receiverUid?: string;
        };
      }>('/api/transfers/friend', {
        method: 'POST',
        body: JSON.stringify({
          receiverUid: friendTarget?.uid || friendUid.trim().toUpperCase(),
          amount: friendNumAmt,
          idempotencyKey: `frd-${user.uid}-${Date.now()}`,
        }),
      });
      onWalletSync(res.wallet);
      const recvUid = res.transfer.receiver_uid || res.transfer.receiverUid || friendTarget?.uid || '';
      const comm = res.transfer.commission_amount ?? res.transfer.commissionAmount ?? friendFee;
      setFriendNotice({
        kind: 'ok',
        text: `Friend transfer ${res.transfer.id} complete: ${formatNpr(res.transfer.amount)} delivered to ${recvUid} (Commission: ${formatNpr(comm)}).`,
      });
      setFriendUid('');
      setFriendTarget(null);
      setFriendConfirmOpen(false);
      onNotificationsRefresh();
    } catch (err: any) {
      setFriendConfirmOpen(false);
      setFriendNotice({ kind: 'err', text: err?.message || 'Friend transfer failed.' });
    } finally {
      setFriendBusy(false);
    }
  };

  const handleSaveDisplayName = async (e: FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    try {
      const res = await apiFetch<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayNameInput.trim() }),
      });
      onUserUpdate(res.user);
      setProfileMsg({ kind: 'ok', text: 'Display name updated.' });
    } catch (err: any) {
      setProfileMsg({ kind: 'err', text: err?.message || 'Update failed.' });
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    if (newPass !== confPass) {
      setPassMsg({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curPass, newPassword: newPass, confirmPassword: confPass }),
      });
      setCurPass('');
      setNewPass('');
      setConfPass('');
      setPassMsg({ kind: 'ok', text: 'Password updated successfully.' });
    } catch (err: any) {
      setPassMsg({ kind: 'err', text: err?.message || 'Could not update password.' });
    }
  };

  const handleSaveResponsibleGaming = async (e: FormEvent) => {
    e.preventDefault();
    setRgMsg(null);
    try {
      const payload: Record<string, any> = {
        dailyLimit: dailyLimitInput.trim() ? Number(dailyLimitInput) : null,
      };
      if (selfExcludeDays) {
        payload.selfExcludeDays = Number(selfExcludeDays);
      }
      const res = await apiFetch<{
        ok: boolean;
        responsibleDailyLimit: number | null;
        selfExcludedUntil: string | null;
      }>('/api/auth/responsible-gaming', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUserUpdate({
        ...user,
        responsibleDailyLimit: res.responsibleDailyLimit,
        selfExcludedUntil: res.selfExcludedUntil,
      });
      setSelfExcludeDays('');
      setRgMsg({ kind: 'ok', text: 'Responsible gaming preferences saved.' });
    } catch (err: any) {
      setRgMsg({ kind: 'err', text: err?.message || 'Could not update responsible gaming settings.' });
    }
  };

  const navItems: Array<{ id: UserTab; label: string; icon: any }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'wallet', label: 'Wallet', icon: WalletIcon },
    { id: 'earn', label: 'Earn Money', icon: TrendingUp },
    { id: 'history', label: 'History', icon: History },
    { id: 'profile', label: 'Profile', icon: UserIcon },
  ];

  return (
    <div className="min-h-dvh bg-[#0B0D11] text-[#F5F7FA] pb-[calc(env(safe-area-inset-bottom)+76px)] lg:pb-10">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0B0D11]/95 backdrop-blur border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 lg:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-6 min-w-0">
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="cursor-pointer text-left shrink-0"
            >
              <BrandMark subtitle="Player Portal" />
            </button>

            <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onTabChange(item.id)}
                    className={`min-h-[40px] px-3.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition cursor-pointer ${
                      active
                        ? 'bg-[#E6B84F]/15 text-[#E6B84F]'
                        : 'text-[#9CA3AF] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setWalletMode('deposit');
                onTabChange('wallet');
              }}
              className="min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3.5 rounded-xl bg-[#14171F] border border-white/10 hover:border-[#E6B84F]/40 flex items-center gap-1.5 sm:gap-2 cursor-pointer max-w-[148px] sm:max-w-none"
              title="Open Wallet"
            >
              <WalletIcon className="w-4 h-4 text-[#E6B84F] shrink-0" />
              <span className="font-mono-nums font-bold text-xs sm:text-sm text-[#F5F7FA] truncate">
                {formatNpr(wallet.mainBalance)}
              </span>
              <span className="hidden sm:inline-block text-[11px] font-bold text-[#0B0D11] bg-[#E6B84F] px-2 py-0.5 rounded-md">
                + Deposit
              </span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Notifications"
                className="min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl bg-[#14171F] border border-white/10 hover:border-white/25 flex items-center justify-center relative cursor-pointer"
              >
                <Bell className="w-4 h-4 text-[#D1D5DB]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E6B84F] text-[#0B0D11] text-[10px] font-extrabold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="fixed inset-x-3 top-[68px] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96 rounded-2xl bg-[#14171F] border border-white/15 shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                    <span className="font-display font-bold text-sm">Notifications</span>
                    <div className="flex items-center gap-3">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-xs font-semibold text-[#E6B84F] hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setNotifOpen(false)}
                        className="text-[#9CA3AF] hover:text-white cursor-pointer"
                        aria-label="Close notifications"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#9CA3AF]">No notifications yet.</div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3.5 text-xs space-y-1 ${n.is_read ? 'opacity-75' : 'bg-[#E6B84F]/5'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#F5F7FA]">{n.title}</span>
                            <span className="text-[11px] text-[#6B7280] shrink-0">
                              {formatNstDateShort(n.created_at)}
                            </span>
                          </div>
                          <p className="text-[#D1D5DB] leading-relaxed">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onLogout}
              aria-label="Logout"
              className="min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3 rounded-xl bg-[#14171F] border border-white/10 hover:border-red-500/40 text-xs font-semibold text-[#D1D5DB] hover:text-red-300 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 space-y-5 sm:space-y-6">
        {maintenance?.enabled && (
          <div
            role="status"
            className="rounded-2xl bg-amber-500/10 border border-amber-400/35 p-4 sm:p-5 flex items-start gap-3 text-sm text-amber-200"
          >
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-100">Scheduled Maintenance Mode Active</div>
              <p className="text-xs text-amber-200/90 mt-1 leading-relaxed">
                {maintenance.message ||
                  'SW88 is currently undergoing scheduled maintenance. All accounts, wallet balances, and transaction histories remain completely safe.'}
              </p>
              <p className="text-[11px] text-amber-300/80 mt-1">
                New games, deposits, withdrawals, and transfers are temporarily paused until maintenance finishes.
              </p>
            </div>
          </div>
        )}

        {user.status === 'SUSPENDED' && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-4 flex items-start gap-3 text-sm text-red-300">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-red-200">Account Temporarily Suspended</div>
              <p className="text-xs mt-0.5">
                Deposits, withdrawals, transfers, and gameplay are paused until reactivated by an administrator.
              </p>
            </div>
          </div>
        )}

        {/* ==================== HOME TAB ==================== */}
        {activeTab === 'home' && (
          <div className="space-y-6 sm:space-y-7">
            <section className="rounded-2xl bg-gradient-to-br from-[#161A24] via-[#14171F] to-[#11131A] border border-white/10 p-4 sm:p-7">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-center">
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF]">
                    <span className="font-semibold text-[#E6B84F]">SW88 VERIFIED MEMBER</span>
                    <span>·</span>
                    <span>{user.displayName}</span>
                    <span>·</span>
                    <StatusText status={user.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <div>
                      <div className="text-xs text-[#9CA3AF]">Username</div>
                      <h1 className="font-display text-xl sm:text-3xl font-extrabold text-[#F5F7FA] break-all">
                        {user.username}
                      </h1>
                    </div>

                    <div className="h-9 w-px bg-white/10 hidden sm:block" />

                    <div>
                      <div className="text-xs text-[#9CA3AF]">Unique User ID</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono-nums font-extrabold text-base sm:text-lg tracking-widest text-[#E6B84F]">
                          {user.uid}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyUid}
                          className="min-h-[34px] px-2.5 sm:px-3 rounded-lg bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold text-[#F5F7FA] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedId ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">COPIED</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#E6B84F]" />
                              <span>COPY ID</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {copiedId && (
                    <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>User ID Copied Successfully.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setWalletMode('deposit');
                        onTabChange('wallet');
                      }}
                      className="min-h-[46px] px-3.5 sm:px-5 rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 sm:gap-2 hover:brightness-105 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4 shrink-0" />
                      <span>Deposit via QR</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onTabChange('earn')}
                      className="min-h-[46px] px-3.5 sm:px-4 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/50 text-xs sm:text-sm font-semibold text-[#F5F7FA] inline-flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer"
                    >
                      <TrendingUp className="w-4 h-4 text-[#E6B84F] shrink-0" />
                      <span>Earn &amp; Transfer</span>
                    </button>

                    <div className="col-span-2 sm:col-span-1">
                      <PWAInstallButton fullWidth />
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 grid grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="col-span-2 rounded-xl bg-[#0B0D11] border border-[#E6B84F]/25 p-3.5 sm:p-4">
                    <div className="text-xs text-[#9CA3AF]">Main Wallet Balance</div>
                    <div className="font-mono-nums font-extrabold text-2xl sm:text-3xl text-[#E6B84F] mt-1">
                      {formatNpr(wallet.mainBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 sm:p-3.5">
                    <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Withdrawable Winnings</div>
                    <div className="font-mono-nums font-bold text-sm sm:text-base text-emerald-400 mt-1">
                      {formatNpr(withdrawableAmount)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 sm:p-3.5">
                    <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Reserved Withdrawal</div>
                    <div className="font-mono-nums font-bold text-sm sm:text-base text-[#F5F7FA] mt-1">
                      {formatNpr(wallet.reservedWithdrawal)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* AVAILABLE GAMES DIRECTLY ON HOME */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Gamepad2 className="w-5 h-5 text-[#E6B84F]" />
                  <h2 className="font-display text-lg sm:text-xl font-extrabold tracking-tight">
                    AVAILABLE GAMES
                  </h2>
                </div>
                <span className="text-xs text-[#9CA3AF]">Real-time unified wallet · Fair RNG</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {games.map((g) => {
                  const thumbSrc = GAME_THUMBNAILS[g.id] || g.thumbnail;
                  const broken = brokenThumbs[g.id];
                  const disabled = !g.enabled || user.status !== 'ACTIVE' || Boolean(maintenance?.enabled);
                  return (
                    <article
                      key={g.id}
                      className="rounded-2xl bg-[#14171F] border border-white/10 overflow-hidden flex flex-col hover:border-[#E6B84F]/40 transition"
                    >
                      <div className="aspect-[16/9] bg-[#0B0D11] relative overflow-hidden">
                        {!broken && thumbSrc ? (
                          <img
                            src={thumbSrc}
                            alt={g.name}
                            referrerPolicy="no-referrer"
                            onError={() => setBrokenThumbs((m) => ({ ...m, [g.id]: true }))}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#E6B84F]">
                            <Gamepad2 className="w-10 h-10" />
                          </div>
                        )}
                        {!g.enabled && (
                          <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-xs font-bold uppercase tracking-wider text-red-300">
                            Temporarily Disabled by Admin
                          </div>
                        )}
                      </div>

                      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-display font-extrabold text-lg text-[#F5F7FA]">{g.name}</h3>
                            <span
                              className={`text-[11px] font-bold ${
                                g.enabled ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {g.enabled ? 'LIVE' : 'PAUSED'}
                            </span>
                          </div>
                          <p className="text-xs text-[#9CA3AF] leading-relaxed">{g.description}</p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-xs border-t border-white/5 pt-3">
                            <span className="text-[#9CA3AF]">Stake Range</span>
                            <span className="font-mono-nums font-bold text-[#F5F7FA]">
                              {formatNpr(g.minStake)} – {formatNpr(g.maxStake)}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onLaunchGame(g)}
                            className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
                          >
                            <Play className="w-4 h-4 fill-current" />
                            <span>
                              {maintenance?.enabled
                                ? 'Paused for Maintenance'
                                : g.enabled
                                  ? 'Play Now'
                                  : 'Unavailable'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ==================== WALLET TAB ==================== */}
        {activeTab === 'wallet' && (
          <div className="space-y-5 sm:space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
              <div className="rounded-2xl bg-[#14171F] border border-[#E6B84F]/30 p-3.5 sm:p-4">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Main Balance</div>
                <div className="font-mono-nums font-extrabold text-lg sm:text-2xl text-[#E6B84F] mt-1">
                  {formatNpr(wallet.mainBalance)}
                </div>
              </div>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5 sm:p-4">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Available to Play</div>
                <div className="font-mono-nums font-extrabold text-lg sm:text-2xl text-[#F5F7FA] mt-1">
                  {formatNpr(wallet.availableBalance)}
                </div>
              </div>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5 sm:p-4">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Reserved Withdrawal</div>
                <div className="font-mono-nums font-extrabold text-lg sm:text-2xl text-amber-300 mt-1">
                  {formatNpr(wallet.reservedWithdrawal)}
                </div>
              </div>
              <div className="rounded-2xl bg-[#14171F] border border-emerald-500/25 p-3.5 sm:p-4">
                <div className="text-[11px] sm:text-xs text-[#9CA3AF]">Withdrawable Winnings</div>
                <div className="font-mono-nums font-extrabold text-lg sm:text-2xl text-emerald-400 mt-1">
                  {formatNpr(withdrawableAmount)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto rounded-xl bg-[#14171F] border border-white/10 p-1 gap-1">
              <button
                type="button"
                onClick={() => setWalletMode('deposit')}
                className={`min-h-[44px] px-3 sm:px-5 rounded-lg text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition ${
                  walletMode === 'deposit' ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF] hover:text-white'
                }`}
              >
                <QrCode className="w-4 h-4 shrink-0" />
                <span>QR Deposit</span>
              </button>
              <button
                type="button"
                onClick={() => setWalletMode('withdraw')}
                className={`min-h-[44px] px-3 sm:px-5 rounded-lg text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition ${
                  walletMode === 'withdraw' ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF] hover:text-white'
                }`}
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>Withdraw</span>
              </button>
            </div>

            {walletMode === 'deposit' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <section className="lg:col-span-5 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-bold text-lg">Official SW88 Payment QR</h2>
                    <QrCode className="w-5 h-5 text-[#E6B84F]" />
                  </div>

                  {qrInfo?.active && qrInfo.imageUrl ? (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-white p-4 max-w-[260px] mx-auto">
                        <img
                          src={qrInfo.imageUrl}
                          alt="SW88 Deposit QR"
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-contain"
                        />
                      </div>
                      {qrInfo.instructions && (
                        <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3.5 text-xs text-[#D1D5DB] leading-relaxed">
                          <div className="font-bold text-[#E6B84F] mb-1">Payment Instructions</div>
                          <p>{qrInfo.instructions}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#0B0D11] border border-amber-500/25 p-6 text-center space-y-2">
                      <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
                      <div className="font-bold text-sm text-amber-200">
                        {qrInfo?.unavailableMessage || 'Deposits are temporarily unavailable.'}
                      </div>
                      <p className="text-xs text-[#9CA3AF]">
                        Please check back shortly when an administrator activates the deposit QR.
                      </p>
                    </div>
                  )}
                </section>

                <section className="lg:col-span-7 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-5">
                  <h2 className="font-display font-bold text-lg">Submit Deposit Proof</h2>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#0B0D11] border border-white/10 p-3.5 text-xs">
                    <div>
                      <div className="text-[#9CA3AF]">User ID (Read-Only)</div>
                      <div className="font-mono-nums font-bold text-sm text-[#E6B84F] mt-0.5">{user.uid}</div>
                    </div>
                    <div>
                      <div className="text-[#9CA3AF]">Username</div>
                      <div className="font-bold text-sm text-[#F5F7FA] mt-0.5">{user.username}</div>
                    </div>
                  </div>

                  {depNotice && (
                    <div
                      className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
                        depNotice.kind === 'ok'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/30 text-red-300'
                      }`}
                    >
                      {depNotice.text}
                    </div>
                  )}

                  <form onSubmit={handleDepositSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Deposit Amount (Minimum NPR 100)
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={10}
                        required
                        value={depAmount}
                        onChange={(e) => setDepAmount(e.target.value)}
                        className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold text-base text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                      />
                      <div className="grid grid-cols-4 gap-2 mt-2">
                        {[100, 500, 1000, 5000].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setDepAmount(String(v))}
                            className="min-h-[36px] rounded-lg bg-[#0B0D11] border border-white/10 text-xs font-mono-nums font-bold text-[#D1D5DB] hover:border-[#E6B84F]/50 cursor-pointer"
                          >
                            {v.toLocaleString()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Upload Payment Screenshot (JPG, PNG, WEBP · Max 5MB)
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleSelectScreenshot(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      {!depPreview ? (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full min-h-[110px] rounded-xl border border-dashed border-white/20 bg-[#0B0D11] hover:border-[#E6B84F]/60 flex flex-col items-center justify-center gap-2 text-xs text-[#9CA3AF] cursor-pointer"
                        >
                          <Upload className="w-5 h-5 text-[#E6B84F]" />
                          <span>Click to choose payment receipt screenshot</span>
                        </button>
                      ) : (
                        <div className="rounded-xl bg-[#0B0D11] border border-white/15 p-3 space-y-2">
                          <img
                            src={depPreview}
                            alt="Deposit screenshot preview"
                            className="max-h-52 mx-auto rounded-lg object-contain"
                          />
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#9CA3AF] truncate">{depFile?.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectScreenshot(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                              }}
                              className="text-red-400 hover:underline font-semibold cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={depBusy || !qrInfo?.active || Boolean(maintenance?.enabled)}
                      className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 disabled:opacity-40 cursor-pointer"
                    >
                      {maintenance?.enabled
                        ? 'Deposits Paused During Maintenance'
                        : depBusy
                          ? 'Submitting Request...'
                          : 'Submit Deposit Request'}
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-12 rounded-2xl bg-[#14171F] border border-white/10 p-4 sm:p-5 space-y-3">
                  <h3 className="font-display font-bold text-base">Recent Deposit Requests</h3>
                  {myDeposits.length === 0 ? (
                    <p className="text-xs text-[#9CA3AF]">No deposit requests submitted yet.</p>
                  ) : (
                    <>
                      <div className="md:hidden space-y-2.5">
                        {myDeposits.map((d) => (
                          <div key={d.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 text-xs space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-nums font-bold text-[#F5F7FA]">{d.id}</span>
                              <span className="font-mono-nums font-extrabold text-[#E6B84F]">{formatNpr(d.amount)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <StatusText status={d.status} />
                              <span className="text-[11px] text-[#9CA3AF]">{formatNstDateTime(d.created_at)}</span>
                            </div>
                            {d.admin_message && (
                              <div className="text-[11px] text-[#D1D5DB] pt-1 border-t border-white/5">
                                {d.admin_message}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="text-[#9CA3AF] border-b border-white/10">
                            <tr>
                              <th className="py-2.5 pr-4">ID</th>
                              <th className="py-2.5 pr-4">Amount</th>
                              <th className="py-2.5 pr-4">Status</th>
                              <th className="py-2.5 pr-4">Admin Message</th>
                              <th className="py-2.5">Submitted (NST)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {myDeposits.map((d) => (
                              <tr key={d.id}>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{d.id}</td>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(d.amount)}</td>
                                <td className="py-3 pr-4">
                                  <StatusText status={d.status} />
                                </td>
                                <td className="py-3 pr-4 text-[#D1D5DB]">{d.admin_message || 'Pending admin review'}</td>
                                <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(d.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <section className="lg:col-span-6 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                  <div className="space-y-1">
                    <h2 className="font-display font-bold text-lg">Request Withdrawal</h2>
                    <p className="text-xs text-[#9CA3AF]">
                      Only game winnings are withdrawable. Limits: NPR 1,000 minimum · NPR 10,000 maximum per request.
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#0B0D11] border border-emerald-500/20 p-3.5 flex items-center justify-between">
                    <span className="text-xs text-[#9CA3AF]">Eligible Winnings Balance</span>
                    <span className="font-mono-nums font-extrabold text-base text-emerald-400">
                      {formatNpr(withdrawableAmount)}
                    </span>
                  </div>

                  {wdrNotice && (
                    <div
                      className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
                        wdrNotice.kind === 'ok'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/30 text-red-300'
                      }`}
                    >
                      {wdrNotice.text}
                    </div>
                  )}

                  <form onSubmit={handleOpenWdrConfirm} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setWdrMethod('ESEWA')}
                        className={`min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer ${
                          wdrMethod === 'ESEWA'
                            ? 'bg-emerald-500/15 border-emerald-400 text-emerald-300'
                            : 'bg-[#0B0D11] border-white/10 text-[#9CA3AF]'
                        }`}
                      >
                        eSewa Wallet
                      </button>
                      <button
                        type="button"
                        onClick={() => setWdrMethod('BANK')}
                        className={`min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer ${
                          wdrMethod === 'BANK'
                            ? 'bg-[#E6B84F]/15 border-[#E6B84F] text-[#E6B84F]'
                            : 'bg-[#0B0D11] border-white/10 text-[#9CA3AF]'
                        }`}
                      >
                        Bank Transfer
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Amount (NPR 1,000 – NPR 10,000)
                      </label>
                      <input
                        type="number"
                        min={1000}
                        max={10000}
                        required
                        value={wdrAmount}
                        onChange={(e) => setWdrAmount(e.target.value)}
                        className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold text-base text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Account Holder Name
                      </label>
                      <input
                        type="text"
                        required
                        value={wdrHolder}
                        onChange={(e) => setWdrHolder(e.target.value)}
                        placeholder="e.g. Ram Rai"
                        className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                      />
                    </div>

                    {wdrMethod === 'ESEWA' ? (
                      <div>
                        <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                          10-Digit eSewa Mobile Number
                        </label>
                        <input
                          type="tel"
                          required
                          maxLength={10}
                          value={wdrEsewa}
                          onChange={(e) => setWdrEsewa(e.target.value.replace(/\D/g, ''))}
                          placeholder="98XXXXXXXX"
                          className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">Bank Name</label>
                          <input
                            type="text"
                            required
                            value={wdrBankName}
                            onChange={(e) => setWdrBankName(e.target.value)}
                            placeholder="e.g. Nabil Bank"
                            className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                              Account Number
                            </label>
                            <input
                              type="text"
                              required
                              value={wdrBankAcc}
                              onChange={(e) => setWdrBankAcc(e.target.value)}
                              placeholder="Account number"
                              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">Branch</label>
                            <input
                              type="text"
                              required
                              value={wdrBankBranch}
                              onChange={(e) => setWdrBankBranch(e.target.value)}
                              placeholder="e.g. Kathmandu"
                              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={Boolean(maintenance?.enabled)}
                      className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 disabled:opacity-40 cursor-pointer"
                    >
                      {maintenance?.enabled ? 'Withdrawals Paused During Maintenance' : 'Review & Submit Withdrawal'}
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-6 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-3">
                  <h3 className="font-display font-bold text-lg">Withdrawal Tracking</h3>
                  {myWithdrawals.length === 0 ? (
                    <p className="text-xs text-[#9CA3AF]">No withdrawal requests submitted yet.</p>
                  ) : (
                    <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                      {myWithdrawals.map((w) => (
                        <div
                          key={w.id}
                          className="rounded-xl bg-[#0B0D11] border border-white/10 p-3.5 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono-nums font-bold text-[#F5F7FA]">
                              {w.id} · {w.method}
                            </span>
                            <span className="font-mono-nums font-extrabold text-sm text-[#E6B84F]">
                              {formatNpr(w.amount)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px]">
                            <span>
                              Request: <StatusText status={w.request_status} />
                            </span>
                            <span>·</span>
                            <span>
                              Payout: <StatusText status={w.payment_status} />
                            </span>
                          </div>
                          {(w.admin_note || w.rejection_reason) && (
                            <div className="text-[#D1D5DB] bg-white/5 rounded-lg p-2">
                              {w.rejection_reason || w.admin_note}
                            </div>
                          )}
                          <div className="text-[#6B7280]">{formatNstDateTime(w.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {/* ==================== EARN MONEY TAB ==================== */}
        {activeTab === 'earn' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Become an Agent & Earn */}
            <section className="rounded-2xl bg-[#14171F] border border-[#E6B84F]/30 p-5 sm:p-6 space-y-5">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-extrabold text-[#F5F7FA]">Become an Agent &amp; Earn</h2>
                  <span className="text-xs font-extrabold text-emerald-400">0% FEE</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Qualified members with at least NPR 1,500 can transfer funds directly to any player User ID with zero commission. You must keep at least NPR 1,500 after sending.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">Min Balance</div>
                  <div className="font-mono-nums font-bold text-[#F5F7FA] mt-0.5">NPR 1,500</div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">Min Transfer</div>
                  <div className="font-mono-nums font-bold text-[#F5F7FA] mt-0.5">NPR 200</div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">Commission</div>
                  <div className="font-mono-nums font-bold text-emerald-400 mt-0.5">0%</div>
                </div>
              </div>

              {wallet.availableBalance < 1700 && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-3 text-xs text-amber-200">
                  Your current available balance is <strong className="font-mono-nums">{formatNpr(wallet.availableBalance)}</strong>. To send the minimum NPR 200 while retaining NPR 1,500, you need at least NPR 1,700 available.
                </div>
              )}

              {agentNotice && (
                <div
                  className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
                    agentNotice.kind === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  {agentNotice.text}
                </div>
              )}

              <form onSubmit={handleOpenAgentConfirm} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Receiver 6-Character User ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      maxLength={8}
                      value={agentUid}
                      onChange={(e) => {
                        setAgentUid(e.target.value.toUpperCase());
                        setAgentTarget(null);
                        setAgentLookupErr(null);
                      }}
                      placeholder="e.g. RAMR27"
                      className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold uppercase text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                    />
                    <button
                      type="button"
                      onClick={() => lookupUid(agentUid, 'agent')}
                      className="min-h-[46px] px-4 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold cursor-pointer"
                    >
                      Verify ID
                    </button>
                  </div>
                  {agentTarget && (
                    <div className="mt-2 text-xs text-emerald-400 font-semibold">
                      Verified Receiver: {agentTarget.displayName} (@{agentTarget.username} · {agentTarget.uid})
                    </div>
                  )}
                  {agentLookupErr && <div className="mt-2 text-xs text-red-400">{agentLookupErr}</div>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Transfer Amount (Min NPR 200)
                  </label>
                  <input
                    type="number"
                    min={200}
                    required
                    value={agentAmt}
                    onChange={(e) => setAgentAmt(e.target.value)}
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold text-base text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={Boolean(maintenance?.enabled)}
                  className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{maintenance?.enabled ? 'Paused During Maintenance' : 'Send Agent Transfer'}</span>
                </button>
              </form>
            </section>

            {/* Friend Transfer & Earn */}
            <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-6 space-y-5">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-extrabold text-[#F5F7FA]">Friend Transfer &amp; Earn</h2>
                  <span className="text-xs font-extrabold text-[#E6B84F]">10% ON TOP</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Send funds to any friend User ID starting from NPR 100. Your friend receives 100% of the transfer amount; a 10% platform commission is paid on top by the sender.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">Receiver Gets</div>
                  <div className="font-mono-nums font-bold text-emerald-400 mt-0.5 truncate">
                    {formatNpr(friendNumAmt)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">10% Fee</div>
                  <div className="font-mono-nums font-bold text-[#E6B84F] mt-0.5 truncate">
                    {formatNpr(friendFee)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-2.5 sm:p-3">
                  <div className="text-[#9CA3AF]">Total Debit</div>
                  <div className="font-mono-nums font-bold text-[#F5F7FA] mt-0.5 truncate">
                    {formatNpr(friendTotalDebit)}
                  </div>
                </div>
              </div>

              {friendNotice && (
                <div
                  className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
                    friendNotice.kind === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  {friendNotice.text}
                </div>
              )}

              <form onSubmit={handleOpenFriendConfirm} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Friend 6-Character User ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      maxLength={8}
                      value={friendUid}
                      onChange={(e) => {
                        setFriendUid(e.target.value.toUpperCase());
                        setFriendTarget(null);
                        setFriendLookupErr(null);
                      }}
                      placeholder="e.g. RAMR27"
                      className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold uppercase text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                    />
                    <button
                      type="button"
                      onClick={() => lookupUid(friendUid, 'friend')}
                      className="min-h-[46px] px-4 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold cursor-pointer"
                    >
                      Verify ID
                    </button>
                  </div>
                  {friendTarget && (
                    <div className="mt-2 text-xs text-emerald-400 font-semibold">
                      Verified Friend: {friendTarget.displayName} (@{friendTarget.username} · {friendTarget.uid})
                    </div>
                  )}
                  {friendLookupErr && <div className="mt-2 text-xs text-red-400">{friendLookupErr}</div>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Transfer Amount (Min NPR 100)
                  </label>
                  <input
                    type="number"
                    min={100}
                    required
                    value={friendAmt}
                    onChange={(e) => setFriendAmt(e.target.value)}
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums font-bold text-base text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={Boolean(maintenance?.enabled)}
                  className="w-full min-h-[48px] rounded-xl bg-[#0B0D11] border border-[#E6B84F] text-[#E6B84F] font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-[#E6B84F]/10 disabled:opacity-40 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>{maintenance?.enabled ? 'Paused During Maintenance' : 'Send Friend Transfer'}</span>
                </button>
              </form>
            </section>
          </div>
        )}

        {/* ==================== HISTORY TAB ==================== */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex overflow-x-auto no-scrollbar sm:flex-wrap gap-1.5 bg-[#14171F] border border-white/10 rounded-xl p-1.5">
              {(
                [
                  ['all', 'All Transactions'],
                  ['deposits', 'Deposits'],
                  ['withdrawals', 'Withdrawals'],
                  ['agent', 'Agent Transfers'],
                  ['friend', 'Friend Transfers'],
                  ['games', 'Game History'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setHistSubTab(id)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold cursor-pointer transition whitespace-nowrap shrink-0 ${
                    histSubTab === id ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5 sm:p-5">
              {histLoading || !historyData ? (
                <div className="py-10 text-center text-xs text-[#9CA3AF]">Loading history...</div>
              ) : (
                <>
                  {/* Mobile Card Lists */}
                  <div className="md:hidden space-y-2.5 text-xs">
                    {histSubTab === 'all' &&
                      (historyData.ledger.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No transactions yet.</div>
                      ) : (
                        historyData.ledger.map((tx: any) => {
                          const isCredit = tx.direction === 'CREDIT' || tx.direction === 'RELEASE';
                          return (
                            <div key={tx.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-[#F5F7FA]">{tx.tx_type}</span>
                                <span className={`font-mono-nums font-bold ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {isCredit ? '+' : '-'}
                                  {formatNpr(tx.amount)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
                                <span className="truncate">{tx.note || tx.related_id || '—'}</span>
                                <span className="font-mono-nums shrink-0">Bal: {formatNpr(tx.new_balance)}</span>
                              </div>
                              <div className="text-[11px] text-[#6B7280]">{formatNstDateTime(tx.created_at)}</div>
                            </div>
                          );
                        })
                      ))}

                    {histSubTab === 'deposits' &&
                      (historyData.deposits.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No deposits yet.</div>
                      ) : (
                        historyData.deposits.map((d: any) => (
                          <div key={d.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-nums font-bold">{d.id}</span>
                              <span className="font-mono-nums font-bold text-[#E6B84F]">{formatNpr(d.amount)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <StatusText status={d.status} />
                              <span className="text-[11px] text-[#9CA3AF]">{formatNstDateTime(d.created_at)}</span>
                            </div>
                            {d.admin_message && <div className="text-[11px] text-[#9CA3AF]">{d.admin_message}</div>}
                          </div>
                        ))
                      ))}

                    {histSubTab === 'withdrawals' &&
                      (historyData.withdrawals.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No withdrawals yet.</div>
                      ) : (
                        historyData.withdrawals.map((w) => (
                          <div key={w.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-nums font-bold">{w.id} · {w.method}</span>
                              <span className="font-mono-nums font-bold text-[#E6B84F]">{formatNpr(w.amount)}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span>Req: <StatusText status={w.request_status} /></span>
                              <span>·</span>
                              <span>Pay: <StatusText status={w.payment_status} /></span>
                            </div>
                            {(w.rejection_reason || w.admin_note) && (
                              <div className="text-[11px] text-[#9CA3AF]">{w.rejection_reason || w.admin_note}</div>
                            )}
                            <div className="text-[11px] text-[#6B7280]">{formatNstDateTime(w.created_at)}</div>
                          </div>
                        ))
                      ))}

                    {histSubTab === 'agent' &&
                      (historyData.agentTransfers.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No agent transfers yet.</div>
                      ) : (
                        historyData.agentTransfers.map((t: any) => {
                          const sent = t.sender_id === user.id;
                          return (
                            <div key={t.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex items-center gap-1 font-bold ${sent ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {sent ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                                  {sent ? 'Sent' : 'Received'}
                                </span>
                                <span className="font-mono-nums font-bold">{formatNpr(t.amount)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#D1D5DB]">
                                <span>{sent ? `${t.receiver_username} (${t.receiver_uid})` : `${t.sender_username} (${t.sender_uid})`}</span>
                                <span className="font-mono-nums text-[#6B7280]">{t.id}</span>
                              </div>
                              <div className="text-[11px] text-[#6B7280]">{formatNstDateTime(t.created_at)}</div>
                            </div>
                          );
                        })
                      ))}

                    {histSubTab === 'friend' &&
                      (historyData.friendTransfers.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No friend transfers yet.</div>
                      ) : (
                        historyData.friendTransfers.map((t: any) => {
                          const sent = t.sender_id === user.id;
                          return (
                            <div key={t.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`font-bold ${sent ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {sent ? 'Sent' : 'Received'}
                                </span>
                                <span className="font-mono-nums font-bold">{formatNpr(t.amount)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#D1D5DB]">
                                <span>{sent ? `${t.receiver_username} (${t.receiver_uid})` : `${t.sender_username} (${t.sender_uid})`}</span>
                                {sent && <span className="font-mono-nums text-[#E6B84F]">Fee: {formatNpr(t.commission_amount)}</span>}
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
                                <span className="font-mono-nums">{t.id}</span>
                                <span>{formatNstDateTime(t.created_at)}</span>
                              </div>
                            </div>
                          );
                        })
                      ))}

                    {histSubTab === 'games' &&
                      (historyData.gameRounds.length === 0 ? (
                        <div className="py-8 text-center text-[#9CA3AF]">No game rounds played yet.</div>
                      ) : (
                        historyData.gameRounds.map((r: any) => (
                          <div key={r.id} className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#F5F7FA]">{r.game_name}</span>
                              <span className={`font-mono-nums font-bold ${r.net_result >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {r.net_result >= 0 ? '+' : ''}
                                {formatNpr(r.net_result)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
                              <span>Stake {formatNpr(r.stake)} · Payout {formatNpr(r.payout)}</span>
                              <StatusText status={r.result} />
                            </div>
                            <div className="text-[11px] text-[#6B7280]">{formatNstDateTime(r.created_at)}</div>
                          </div>
                        ))
                      ))}
                  </div>

                  {/* Desktop Tables */}
                  <div className="hidden md:block overflow-x-auto">
                    {histSubTab === 'all' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">Type</th>
                            <th className="py-2.5 pr-4">Amount</th>
                            <th className="py-2.5 pr-4">Balance After</th>
                            <th className="py-2.5 pr-4">Details</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.ledger.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-[#9CA3AF]">
                                No transactions yet.
                              </td>
                            </tr>
                          ) : (
                            historyData.ledger.map((tx: any) => {
                              const isCredit = tx.direction === 'CREDIT' || tx.direction === 'RELEASE';
                              return (
                                <tr key={tx.id}>
                                  <td className="py-3 pr-4 font-bold text-[#F5F7FA]">{tx.tx_type}</td>
                                  <td
                                    className={`py-3 pr-4 font-mono-nums font-bold ${
                                      isCredit ? 'text-emerald-400' : 'text-red-400'
                                    }`}
                                  >
                                    {isCredit ? '+' : '-'}
                                    {formatNpr(tx.amount)}
                                  </td>
                                  <td className="py-3 pr-4 font-mono-nums text-[#D1D5DB]">
                                    {formatNpr(tx.new_balance)}
                                  </td>
                                  <td className="py-3 pr-4 text-[#9CA3AF]">{tx.note || tx.related_id || '—'}</td>
                                  <td className="py-3 text-[#9CA3AF] whitespace-nowrap">
                                    {formatNstDateTime(tx.created_at)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}

                    {histSubTab === 'deposits' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">ID</th>
                            <th className="py-2.5 pr-4">Amount</th>
                            <th className="py-2.5 pr-4">Status</th>
                            <th className="py-2.5 pr-4">Admin Note</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.deposits.map((d: any) => (
                            <tr key={d.id}>
                              <td className="py-3 pr-4 font-mono-nums font-bold">{d.id}</td>
                              <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(d.amount)}</td>
                              <td className="py-3 pr-4">
                                <StatusText status={d.status} />
                              </td>
                              <td className="py-3 pr-4 text-[#9CA3AF]">{d.admin_message || '—'}</td>
                              <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(d.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {histSubTab === 'withdrawals' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">ID</th>
                            <th className="py-2.5 pr-4">Method</th>
                            <th className="py-2.5 pr-4">Amount</th>
                            <th className="py-2.5 pr-4">Request</th>
                            <th className="py-2.5 pr-4">Payment</th>
                            <th className="py-2.5 pr-4">Note</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.withdrawals.map((w) => (
                            <tr key={w.id}>
                              <td className="py-3 pr-4 font-mono-nums font-bold">{w.id}</td>
                              <td className="py-3 pr-4">{w.method}</td>
                              <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(w.amount)}</td>
                              <td className="py-3 pr-4">
                                <StatusText status={w.request_status} />
                              </td>
                              <td className="py-3 pr-4">
                                <StatusText status={w.payment_status} />
                              </td>
                              <td className="py-3 pr-4 text-[#9CA3AF]">{w.rejection_reason || w.admin_note || '—'}</td>
                              <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(w.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {histSubTab === 'agent' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">ID</th>
                            <th className="py-2.5 pr-4">Direction</th>
                            <th className="py-2.5 pr-4">Counterparty</th>
                            <th className="py-2.5 pr-4">Amount</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.agentTransfers.map((t: any) => {
                            const sent = t.sender_id === user.id;
                            return (
                              <tr key={t.id}>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{t.id}</td>
                                <td className="py-3 pr-4">
                                  <span className={`inline-flex items-center gap-1 font-bold ${sent ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {sent ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                                    {sent ? 'Sent' : 'Received'}
                                  </span>
                                </td>
                                <td className="py-3 pr-4">
                                  {sent ? `${t.receiver_username} (${t.receiver_uid})` : `${t.sender_username} (${t.sender_uid})`}
                                </td>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(t.amount)}</td>
                                <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(t.created_at)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}

                    {histSubTab === 'friend' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">ID</th>
                            <th className="py-2.5 pr-4">Direction</th>
                            <th className="py-2.5 pr-4">Counterparty</th>
                            <th className="py-2.5 pr-4">Amount</th>
                            <th className="py-2.5 pr-4">10% Fee</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.friendTransfers.map((t: any) => {
                            const sent = t.sender_id === user.id;
                            return (
                              <tr key={t.id}>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{t.id}</td>
                                <td className="py-3 pr-4 font-bold">
                                  <span className={sent ? 'text-red-400' : 'text-emerald-400'}>
                                    {sent ? 'Sent' : 'Received'}
                                  </span>
                                </td>
                                <td className="py-3 pr-4">
                                  {sent ? `${t.receiver_username} (${t.receiver_uid})` : `${t.sender_username} (${t.sender_uid})`}
                                </td>
                                <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(t.amount)}</td>
                                <td className="py-3 pr-4 font-mono-nums text-[#E6B84F]">
                                  {sent ? formatNpr(t.commission_amount) : '—'}
                                </td>
                                <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(t.created_at)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}

                    {histSubTab === 'games' && (
                      <table className="w-full text-left text-xs">
                        <thead className="text-[#9CA3AF] border-b border-white/10">
                          <tr>
                            <th className="py-2.5 pr-4">Game</th>
                            <th className="py-2.5 pr-4">Stake</th>
                            <th className="py-2.5 pr-4">Payout</th>
                            <th className="py-2.5 pr-4">Net</th>
                            <th className="py-2.5 pr-4">Outcome</th>
                            <th className="py-2.5">NST Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {historyData.gameRounds.map((r: any) => (
                            <tr key={r.id}>
                              <td className="py-3 pr-4 font-bold">{r.game_name}</td>
                              <td className="py-3 pr-4 font-mono-nums">{formatNpr(r.stake)}</td>
                              <td className="py-3 pr-4 font-mono-nums">{formatNpr(r.payout)}</td>
                              <td
                                className={`py-3 pr-4 font-mono-nums font-bold ${
                                  r.net_result >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {r.net_result >= 0 ? '+' : ''}
                                {formatNpr(r.net_result)}
                              </td>
                              <td className="py-3 pr-4">
                                <StatusText status={r.result} />
                              </td>
                              <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(r.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ==================== PROFILE TAB ==================== */}
        {activeTab === 'profile' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-5 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
              <h2 className="font-display font-bold text-lg">Account Overview</h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-[#9CA3AF]">Username</span>
                  <span className="font-bold">{user.username}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-[#9CA3AF]">Unique User ID</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-nums font-extrabold text-[#E6B84F]">{user.uid}</span>
                    <button
                      type="button"
                      onClick={handleCopyUid}
                      className="px-2.5 py-1 rounded-lg bg-[#0B0D11] border border-white/15 text-xs font-bold cursor-pointer"
                    >
                      {copiedId ? 'COPIED' : 'COPY ID'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-[#9CA3AF]">Account Status</span>
                  <StatusText status={user.status} />
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-[#9CA3AF]">Main Balance</span>
                  <span className="font-mono-nums font-bold text-[#E6B84F]">{formatNpr(wallet.mainBalance)}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[#9CA3AF]">Registered (NST)</span>
                  <span className="text-xs text-[#D1D5DB]">{formatNstDateTime(user.createdAt)}</span>
                </div>
              </div>

              {copiedId && (
                <div className="text-xs font-semibold text-emerald-400">User ID Copied Successfully.</div>
              )}

              <button
                type="button"
                onClick={() => setLegalOpen(true)}
                className="w-full min-h-[44px] rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/50 text-xs font-bold text-[#F5F7FA] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Shield className="w-4 h-4 text-[#E6B84F]" />
                <span>View Terms, Privacy &amp; Responsible Gaming</span>
              </button>

              <PWAInstallButton variant="card" />
            </section>

            <div className="lg:col-span-7 space-y-6">
              <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <h2 className="font-display font-bold text-base">Edit Display Name</h2>
                {profileMsg && (
                  <div className={`text-xs ${profileMsg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {profileMsg.text}
                  </div>
                )}
                <form onSubmit={handleSaveDisplayName} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={40}
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-sm cursor-pointer"
                  >
                    Save Name
                  </button>
                </form>
              </section>

              <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#E6B84F]" />
                  <h2 className="font-display font-bold text-base">Change Password</h2>
                </div>
                {passMsg && (
                  <div className={`text-xs ${passMsg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {passMsg.text}
                  </div>
                )}
                <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="password"
                    required
                    value={curPass}
                    onChange={(e) => setCurPass(e.target.value)}
                    placeholder="Current password"
                    className="min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder="New password"
                    className="min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confPass}
                    onChange={(e) => setConfPass(e.target.value)}
                    placeholder="Confirm new"
                    className="min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                  />
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      className="min-h-[44px] px-5 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-sm font-bold cursor-pointer"
                    >
                      Update Password
                    </button>
                  </div>
                </form>
              </section>

              <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#E6B84F]" />
                  <h2 className="font-display font-bold text-base">Responsible Gaming Controls</h2>
                </div>
                {user.selfExcludedUntil && (
                  <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
                    Self-exclusion active until: <strong>{formatNstDateTime(user.selfExcludedUntil)}</strong>
                  </div>
                )}
                {rgMsg && (
                  <div className={`text-xs ${rgMsg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {rgMsg.text}
                  </div>
                )}
                <form onSubmit={handleSaveResponsibleGaming} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Daily Spending Limit (NPR)</label>
                    <input
                      type="number"
                      min={100}
                      value={dailyLimitInput}
                      onChange={(e) => setDailyLimitInput(e.target.value)}
                      placeholder="No limit set"
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums text-sm text-[#F5F7FA]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Temporary Self-Exclusion</label>
                    <select
                      value={selfExcludeDays}
                      onChange={(e) => setSelfExcludeDays(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                    >
                      <option value="">Keep current status</option>
                      <option value="1">Exclude for 24 Hours</option>
                      <option value="7">Exclude for 7 Days</option>
                      <option value="30">Exclude for 30 Days</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      className="min-h-[44px] px-5 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-sm font-bold cursor-pointer"
                    >
                      Save Responsible Gaming Settings
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0B0D11]/95 backdrop-blur border-t border-white/10 px-1 pt-1 pb-[calc(env(safe-area-inset-bottom)+4px)] grid grid-cols-5"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`min-h-[46px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-semibold cursor-pointer ${
                active ? 'text-[#E6B84F]' : 'text-[#9CA3AF]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">
                {item.id === 'earn' ? (
                  <>
                    <span className="sm:hidden">Earn</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Confirmation Modals */}
      {wdrConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4">
            <h3 className="font-display font-bold text-lg">Confirm Withdrawal</h3>
            <div className="text-xs space-y-2 text-[#D1D5DB]">
              <div className="flex justify-between gap-2">
                <span>Amount</span>
                <strong className="font-mono-nums text-[#E6B84F]">{formatNpr(Number(wdrAmount))}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Method</span>
                <strong>{wdrMethod}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Account Holder</span>
                <strong className="text-right break-words">{wdrHolder}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Destination</span>
                <strong className="font-mono-nums text-right break-all">
                  {wdrMethod === 'ESEWA' ? wdrEsewa : `${wdrBankName} · ${wdrBankAcc}`}
                </strong>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWdrConfirmOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-sm font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={wdrBusy}
                onClick={handleConfirmWithdrawal}
                className="flex-1 min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] text-sm font-extrabold cursor-pointer"
              >
                {wdrBusy ? 'Submitting...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {agentConfirmOpen && agentTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4">
            <h3 className="font-display font-bold text-lg">Confirm Agent Transfer</h3>
            <div className="text-xs space-y-2 text-[#D1D5DB]">
              <div className="flex justify-between gap-2">
                <span>Receiver</span>
                <strong className="text-right">
                  {agentTarget.displayName} ({agentTarget.uid})
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Amount</span>
                <strong className="font-mono-nums text-[#E6B84F]">{formatNpr(Number(agentAmt))}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Agent Commission</span>
                <strong className="text-emerald-400">0% (NPR 0)</strong>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAgentConfirmOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-sm font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={agentBusy}
                onClick={handleConfirmAgentTransfer}
                className="flex-1 min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] text-sm font-extrabold cursor-pointer"
              >
                {agentBusy ? 'Sending...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {friendConfirmOpen && friendTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4">
            <h3 className="font-display font-bold text-lg">Confirm Friend Transfer</h3>
            <div className="text-xs space-y-2 text-[#D1D5DB]">
              <div className="flex justify-between gap-2">
                <span>Receiver</span>
                <strong className="text-right">
                  {friendTarget.displayName} ({friendTarget.uid})
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Receiver Credits</span>
                <strong className="font-mono-nums text-emerald-400">{formatNpr(friendNumAmt)}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>10% Platform Commission</span>
                <strong className="font-mono-nums text-[#E6B84F]">{formatNpr(friendFee)}</strong>
              </div>
              <div className="flex justify-between gap-2 border-t border-white/10 pt-2">
                <span>Total Wallet Debit</span>
                <strong className="font-mono-nums text-white">{formatNpr(friendTotalDebit)}</strong>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFriendConfirmOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-sm font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={friendBusy}
                onClick={handleConfirmFriendTransfer}
                className="flex-1 min-h-[44px] rounded-xl bg-[#E6B84F] text-[#0B0D11] text-sm font-extrabold cursor-pointer"
              >
                {friendBusy ? 'Sending...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LegalModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  );
}
