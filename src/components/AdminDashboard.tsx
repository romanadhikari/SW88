import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  Download,
  Eye,
  FileText,
  Gamepad2,
  LayoutDashboard,
  Link2,
  Lock,
  LogOut,
  Menu,
  Percent,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import {
  apiFetch,
  copyToClipboard,
  formatNpr,
  formatNstDateShort,
  formatNstDateTime,
  getStoredToken,
  useNstClock,
} from '../lib/api';
import type { User, WithdrawalRecord } from '../types';
import { BrandMark } from './BrandMark';

type AdminSection =
  | 'overview'
  | 'users'
  | 'wallets'
  | 'deposits'
  | 'qr'
  | 'transfer-monitor'
  | 'agent-transfers'
  | 'friend-transfers'
  | 'commissions'
  | 'withdrawals'
  | 'games'
  | 'game-transactions'
  | 'reports'
  | 'banned'
  | 'audit-logs'
  | 'security'
  | 'settings';

interface AdminDashboardProps {
  user: User;
  liveTickVersion: number;
  onUserUpdate: (user: User) => void;
  onLogout: () => void;
}

function AuthenticatedScreenshot({ depositId }: { depositId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    const load = async () => {
      try {
        const token = getStoredToken();
        const res = await fetch(`/api/admin/deposits/${encodeURIComponent(depositId)}/screenshot`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Screenshot unavailable');
        }
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        if (active) setUrl(objUrl);
      } catch (e: any) {
        if (active) setErr(e?.message || 'Screenshot could not be loaded.');
      }
    };
    load();
    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [depositId]);

  if (err) {
    return (
      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-6 text-center text-xs text-[#9CA3AF]">
        {err}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-8 text-center text-xs text-[#9CA3AF]">
        Loading screenshot...
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Deposit ${depositId} screenshot`}
      referrerPolicy="no-referrer"
      className="max-h-[420px] w-auto mx-auto rounded-xl border border-white/10 object-contain"
    />
  );
}

function StatusLabel({ value }: { value: string }) {
  const s = (value || '').toUpperCase();
  const color =
    s === 'ACTIVE' || s === 'APPROVED' || s === 'PAID' || s === 'WIN' || s === 'COMPLETED' || s === 'ENABLED'
      ? 'text-emerald-400'
      : s === 'SUSPENDED' || s === 'BANNED' || s === 'REJECTED' || s === 'PAYMENT FAILED' || s === 'LOSS' || s === 'FAILED' || s === 'REVERSED' || s === 'DISABLED'
        ? 'text-red-400'
        : s === 'PROCESSING'
          ? 'text-sky-400'
          : 'text-[#E6B84F]';
  return <span className={`text-xs font-bold ${color}`}>{value}</span>;
}

export function AdminDashboard({ user, liveTickVersion, onUserUpdate, onLogout }: AdminDashboardProps) {
  const nstClock = useNstClock();
  const [section, setSection] = useState<AdminSection>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Overview state
  const [range, setRange] = useState<'today' | 'yesterday' | '7d' | 'month' | 'custom'>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [overview, setOverview] = useState<any>(null);

  // Users / Wallets state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string>('');
  const [selectedUserDetail, setSelectedUserDetail] = useState<any>(null);
  const [adjustModalUser, setAdjustModalUser] = useState<any>(null);
  const [adjDirection, setAdjDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [adjAmount, setAdjAmount] = useState('500');
  const [adjReason, setAdjReason] = useState('');
  const [adjCountWinnings, setAdjCountWinnings] = useState(false);
  const [banModalUser, setBanModalUser] = useState<any>(null);
  const [banReason, setBanReason] = useState('');

  // Deposits & QR state
  const [depositFilter, setDepositFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [deposits, setDeposits] = useState<any[]>([]);
  const [inspectDeposit, setInspectDeposit] = useState<any>(null);
  const [depAdminMsg, setDepAdminMsg] = useState('');
  const [qrAdmin, setQrAdmin] = useState<any>(null);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [qrInstructions, setQrInstructions] = useState('');
  const [qrActiveToggle, setQrActiveToggle] = useState(true);

  // Transfers & Commissions
  const [agentTransfers, setAgentTransfers] = useState<any[]>([]);
  const [friendTransfers, setFriendTransfers] = useState<any[]>([]);
  const [unifiedTransfers, setUnifiedTransfers] = useState<any[]>([]);
  const [unifiedSummary, setUnifiedSummary] = useState<any>(null);
  const [txTypeFilter, setTxTypeFilter] = useState<'ALL' | 'AGENT' | 'FRIEND'>('ALL');
  const [txDirectionFilter, setTxDirectionFilter] = useState<'ALL' | 'INCOMING' | 'OUTGOING'>('ALL');
  const [txStatusFilter, setTxStatusFilter] = useState<string>('ALL');
  const [txUidFilter, setTxUidFilter] = useState('');
  const [txAgentUidFilter, setTxAgentUidFilter] = useState('');
  const [txIdFilter, setTxIdFilter] = useState('');
  const [txStartDate, setTxStartDate] = useState('');
  const [txEndDate, setTxEndDate] = useState('');
  const [commissions, setCommissions] = useState<{ records: any[]; totals: any }>({ records: [], totals: null });

  // Withdrawals
  const [wdrFilter, setWdrFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [reviewWdr, setReviewWdr] = useState<WithdrawalRecord | null>(null);
  const [wdrReviewNote, setWdrReviewNote] = useState('');
  const [payModalWdr, setPayModalWdr] = useState<WithdrawalRecord | null>(null);
  const [payStatusNext, setPayStatusNext] = useState<'NOT PAID' | 'PROCESSING' | 'PAID' | 'PAYMENT FAILED'>('PAID');
  const [payNote, setPayNote] = useState('');

  // Games & Game Transactions
  const [adminGames, setAdminGames] = useState<any[]>([]);
  const [gameEdits, setGameEdits] = useState<Record<string, { enabled: boolean; minStake: number; maxStake: number; houseEdgePct: number }>>({});
  const [gameTxFilterGame, setGameTxFilterGame] = useState('');
  const [gameTxFilterResult, setGameTxFilterResult] = useState('');
  const [gameRounds, setGameRounds] = useState<any[]>([]);

  // Reports, Banned, Audit Logs, Settings, Security & System Health
  const [reportRange, setReportRange] = useState<'today' | 'yesterday' | '7d' | 'month' | 'custom'>('7d');
  const [reportStart, setReportStart] = useState('');
  const [reportEnd, setReportEnd] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [bannedUsers, setBannedUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [sysHealth, setSysHealth] = useState<any>(null);
  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMessage, setMaintMessage] = useState('');
  const [maintBusy, setMaintBusy] = useState(false);

  // Mobile App Distribution & Special Link state
  const [appDistConfig, setAppDistConfig] = useState<any>(null);
  const [appMode, setAppMode] = useState<'pwa' | 'uploaded' | 'external'>('pwa');
  const [appExternalUrl, setAppExternalUrl] = useState('');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [appDistBusy, setAppDistBusy] = useState(false);
  const [copiedDownloadUrl, setCopiedDownloadUrl] = useState(false);

  // Admin Security Credentials Form
  const [secUsername, setSecUsername] = useState(user.username);
  const [secCurrentPassword, setSecCurrentPassword] = useState('');
  const [secNewPassword, setSecNewPassword] = useState('');
  const [secConfirmPassword, setSecConfirmPassword] = useState('');
  const [secBusy, setSecBusy] = useState(false);
  const [secNotice, setSecNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadSectionData = useCallback(async () => {
    try {
      if (section === 'overview') {
        const qs = new URLSearchParams({ range });
        if (range === 'custom' && customStart && customEnd) {
          qs.set('start', customStart);
          qs.set('end', customEnd);
        }
        const data = await apiFetch(`/api/admin/overview?${qs.toString()}`);
        setOverview(data);
      } else if (section === 'users' || section === 'wallets') {
        const qs = new URLSearchParams();
        if (globalSearch) qs.set('search', globalSearch);
        if (section === 'users' && userStatusFilter) qs.set('status', userStatusFilter);
        const data = await apiFetch<{ users: any[] }>(`/api/admin/users?${qs.toString()}`);
        setUsersList(data.users || []);
      } else if (section === 'deposits') {
        const qs = depositFilter === 'ALL' ? '' : `?status=${depositFilter}`;
        const data = await apiFetch<{ deposits: any[] }>(`/api/admin/deposits${qs}`);
        setDeposits(data.deposits || []);
      } else if (section === 'qr') {
        const data = await apiFetch<any>('/api/admin/qr');
        setQrAdmin(data);
        setQrInstructions(data.instructions || '');
        setQrActiveToggle(Boolean(data.active));
      } else if (section === 'transfer-monitor') {
        const qs = new URLSearchParams({
          type: txTypeFilter,
          direction: txDirectionFilter,
          status: txStatusFilter,
        });
        if (globalSearch) qs.set('search', globalSearch);
        if (txUidFilter.trim()) qs.set('uid', txUidFilter.trim());
        if (txAgentUidFilter.trim()) qs.set('agentUid', txAgentUidFilter.trim());
        if (txIdFilter.trim()) qs.set('txId', txIdFilter.trim());
        if (txStartDate) qs.set('start', txStartDate);
        if (txEndDate) qs.set('end', txEndDate);
        const data = await apiFetch<{ transfers: any[]; summary: any }>(`/api/admin/transfers?${qs.toString()}`);
        setUnifiedTransfers(data.transfers || []);
        setUnifiedSummary(data.summary || null);
      } else if (section === 'agent-transfers') {
        const qs = new URLSearchParams();
        if (globalSearch) qs.set('search', globalSearch);
        if (txUidFilter.trim()) qs.set('uid', txUidFilter.trim());
        if (txAgentUidFilter.trim()) qs.set('agentUid', txAgentUidFilter.trim());
        if (txIdFilter.trim()) qs.set('txId', txIdFilter.trim());
        if (txStatusFilter && txStatusFilter !== 'ALL') qs.set('status', txStatusFilter);
        if (txStartDate) qs.set('start', txStartDate);
        if (txEndDate) qs.set('end', txEndDate);
        const qStr = qs.toString();
        const data = await apiFetch<{ transfers: any[] }>(`/api/admin/agent-transfers${qStr ? `?${qStr}` : ''}`);
        setAgentTransfers(data.transfers || []);
      } else if (section === 'friend-transfers') {
        const qs = new URLSearchParams();
        if (globalSearch) qs.set('search', globalSearch);
        if (txUidFilter.trim()) qs.set('uid', txUidFilter.trim());
        if (txIdFilter.trim()) qs.set('txId', txIdFilter.trim());
        if (txStatusFilter && txStatusFilter !== 'ALL') qs.set('status', txStatusFilter);
        if (txStartDate) qs.set('start', txStartDate);
        if (txEndDate) qs.set('end', txEndDate);
        const qStr = qs.toString();
        const data = await apiFetch<{ transfers: any[] }>(`/api/admin/friend-transfers${qStr ? `?${qStr}` : ''}`);
        setFriendTransfers(data.transfers || []);
      } else if (section === 'commissions') {
        const data = await apiFetch<{ records: any[]; totals: any }>('/api/admin/commissions');
        setCommissions(data);
      } else if (section === 'withdrawals') {
        const data = await apiFetch<{ withdrawals: WithdrawalRecord[] }>(`/api/admin/withdrawals?status=${wdrFilter}`);
        setWithdrawals(data.withdrawals || []);
      } else if (section === 'games') {
        const data = await apiFetch<{ games: any[] }>('/api/admin/games');
        setAdminGames(data.games || []);
        const map: Record<string, any> = {};
        for (const g of data.games || []) {
          map[g.id] = {
            enabled: g.enabled,
            minStake: g.minStake,
            maxStake: g.maxStake,
            houseEdgePct: g.houseEdgePct,
          };
        }
        setGameEdits(map);
      } else if (section === 'game-transactions') {
        const qs = new URLSearchParams();
        if (gameTxFilterGame) qs.set('gameId', gameTxFilterGame);
        if (gameTxFilterResult) qs.set('result', gameTxFilterResult);
        if (globalSearch) qs.set('search', globalSearch);
        const data = await apiFetch<{ rounds: any[] }>(`/api/admin/game-transactions?${qs.toString()}`);
        setGameRounds(data.rounds || []);
      } else if (section === 'reports') {
        const qs = new URLSearchParams({ range: reportRange });
        if (reportRange === 'custom' && reportStart && reportEnd) {
          qs.set('start', reportStart);
          qs.set('end', reportEnd);
        }
        const data = await apiFetch(`/api/admin/reports?${qs.toString()}`);
        setReportData(data);
      } else if (section === 'banned') {
        const data = await apiFetch<{ bans: any[] }>('/api/admin/banned-users');
        setBannedUsers(data.bans || []);
      } else if (section === 'audit-logs') {
        const data = await apiFetch<{ logs: any[] }>('/api/admin/audit-logs');
        setAuditLogs(data.logs || []);
      } else if (section === 'settings') {
        const [setData, healthData, distData] = await Promise.all([
          apiFetch<{ settings: Record<string, string> }>('/api/admin/settings'),
          apiFetch<any>('/api/admin/system/health'),
          apiFetch<any>('/api/app/download-info'),
        ]);
        setSettingsMap(setData.settings || {});
        setSysHealth(healthData);
        setMaintEnabled(Boolean(healthData?.maintenance?.enabled));
        setMaintMessage(healthData?.maintenance?.message || '');
        setAppDistConfig(distData);
        setAppMode(distData?.mode || 'pwa');
        setAppExternalUrl(distData?.externalUrl || '');
        setAppVersion(distData?.version || '1.0.0');
      }
    } catch (err: any) {
      flash('err', err?.message || 'Could not load admin section');
    }
  }, [
    section,
    range,
    customStart,
    customEnd,
    globalSearch,
    userStatusFilter,
    depositFilter,
    txTypeFilter,
    txDirectionFilter,
    txStatusFilter,
    txUidFilter,
    txAgentUidFilter,
    txIdFilter,
    txStartDate,
    txEndDate,
    wdrFilter,
    gameTxFilterGame,
    gameTxFilterResult,
    reportRange,
    reportStart,
    reportEnd,
    flash,
  ]);

  useEffect(() => {
    loadSectionData();
  }, [loadSectionData, liveTickVersion]);

  const handleToggleUserStatus = async (u: any) => {
    const next = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await apiFetch(`/api/admin/users/${u.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next, reason: `Admin toggled status to ${next}` }),
      });
      flash('ok', `User ${u.uid} status updated to ${next}.`);
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Status update failed.');
    }
  };

  const handlePermanentBan = async (e: FormEvent) => {
    e.preventDefault();
    if (!banModalUser) return;
    try {
      await apiFetch(`/api/admin/users/${banModalUser.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: banReason }),
      });
      flash('ok', `User ${banModalUser.uid} permanently banned & session revoked.`);
      setBanModalUser(null);
      setBanReason('');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Ban failed.');
    }
  };

  const handleWalletAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustModalUser) return;
    try {
      await apiFetch(`/api/admin/users/${adjustModalUser.id}/wallet-adjust`, {
        method: 'POST',
        body: JSON.stringify({
          direction: adjDirection,
          amount: Number(adjAmount),
          reason: adjReason,
          countAsWinnings: adjCountWinnings,
        }),
      });
      flash('ok', `Wallet ${adjDirection.toLowerCase()}ed NPR ${adjAmount} for ${adjustModalUser.uid}.`);
      setAdjustModalUser(null);
      setAdjReason('');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Wallet adjustment failed.');
    }
  };

  const handleReviewDeposit = async (action: 'APPROVE' | 'REJECT') => {
    if (!inspectDeposit) return;
    try {
      await apiFetch(`/api/admin/deposits/${inspectDeposit.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, adminMessage: depAdminMsg }),
      });
      flash('ok', `Deposit ${inspectDeposit.id} ${action === 'APPROVE' ? 'approved & credited' : 'rejected'}.`);
      setInspectDeposit(null);
      setDepAdminMsg('');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Deposit review failed.');
    }
  };

  const handleSaveQr = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      if (qrFile) fd.append('qr', qrFile);
      fd.append('instructions', qrInstructions);
      fd.append('active', String(qrActiveToggle));
      await apiFetch('/api/admin/qr', { method: 'POST', body: fd, isFormData: true });
      flash('ok', 'Deposit QR settings updated.');
      setQrFile(null);
      if (qrPreview) URL.revokeObjectURL(qrPreview);
      setQrPreview(null);
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'QR update failed.');
    }
  };

  const handleRemoveQr = async () => {
    try {
      await apiFetch('/api/admin/qr', { method: 'DELETE' });
      flash('ok', 'Active deposit QR removed.');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Could not remove QR.');
    }
  };

  const handleReviewWithdrawal = async (action: 'APPROVE' | 'REJECT') => {
    if (!reviewWdr) return;
    try {
      await apiFetch(`/api/admin/withdrawals/${reviewWdr.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, note: wdrReviewNote }),
      });
      flash('ok', `Withdrawal ${reviewWdr.id} ${action === 'APPROVE' ? 'approved' : 'rejected & refunded'}.`);
      setReviewWdr(null);
      setWdrReviewNote('');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Withdrawal review failed.');
    }
  };

  const handleUpdatePaymentStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!payModalWdr) return;
    try {
      await apiFetch(`/api/admin/withdrawals/${payModalWdr.id}/payment-status`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: payStatusNext, adminNote: payNote }),
      });
      flash('ok', `Withdrawal ${payModalWdr.id} payment status updated to ${payStatusNext}.`);
      setPayModalWdr(null);
      setPayNote('');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Payment status update failed.');
    }
  };

  const handleSaveGame = async (gameId: string) => {
    const ed = gameEdits[gameId];
    if (!ed) return;
    try {
      await apiFetch(`/api/admin/games/${gameId}`, {
        method: 'PATCH',
        body: JSON.stringify(ed),
      });
      flash('ok', 'Game settings saved.');
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Game update failed.');
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: settingsMap }),
      });
      flash('ok', 'Platform settings updated.');
    } catch (err: any) {
      flash('err', err?.message || 'Settings save failed.');
    }
  };

  const handleToggleAgentRole = async (u: any) => {
    const next = !u.is_agent;
    try {
      await apiFetch(`/api/admin/users/${u.id}/agent`, {
        method: 'POST',
        body: JSON.stringify({ isAgent: next }),
      });
      flash('ok', `User ${u.uid} ${next ? 'designated as verified Agent' : 'removed from Agent designation'}.`);
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Agent designation update failed.');
    }
  };

  const handleUpdateAdminCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setSecNotice(null);
    if (!secCurrentPassword) {
      setSecNotice({ kind: 'err', text: 'Current password is required.' });
      return;
    }
    if (secNewPassword || secConfirmPassword) {
      if (secNewPassword.length < 6) {
        setSecNotice({ kind: 'err', text: 'New password must be at least 6 characters.' });
        return;
      }
      if (secNewPassword !== secConfirmPassword) {
        setSecNotice({ kind: 'err', text: 'New password and confirm password do not match.' });
        return;
      }
    }
    setSecBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; user: User; message: string }>('/api/auth/admin/credentials', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: secCurrentPassword,
          newUsername: secUsername.trim(),
          newPassword: secNewPassword,
          confirmPassword: secConfirmPassword,
        }),
      });
      onUserUpdate(res.user);
      setSecUsername(res.user.username);
      setSecCurrentPassword('');
      setSecNewPassword('');
      setSecConfirmPassword('');
      setSecNotice({ kind: 'ok', text: res.message || 'Admin credentials updated successfully.' });
      flash('ok', 'Admin login credentials updated.');
    } catch (err: any) {
      setSecNotice({ kind: 'err', text: err?.message || 'Could not update admin credentials.' });
    } finally {
      setSecBusy(false);
    }
  };

  const handleSaveMaintenance = async (enabledVal: boolean) => {
    setMaintBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; maintenance: { enabled: boolean; message: string } }>(
        '/api/admin/system/maintenance',
        {
          method: 'POST',
          body: JSON.stringify({ enabled: enabledVal, message: maintMessage }),
        }
      );
      setMaintEnabled(res.maintenance.enabled);
      setMaintMessage(res.maintenance.message);
      flash('ok', `Maintenance mode ${res.maintenance.enabled ? 'ENABLED' : 'DISABLED'}.`);
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Failed to update maintenance mode.');
    } finally {
      setMaintBusy(false);
    }
  };

  const handleBackupDb = async () => {
    try {
      const res = await apiFetch<{ filename: string; backups?: any[] }>('/api/admin/backup', { method: 'POST' });
      flash('ok', `SQLite database backup created: ${res.filename}`);
      if (res.backups) {
        setSysHealth((prev: any) => (prev ? { ...prev, backups: res.backups } : prev));
      }
      loadSectionData();
    } catch (err: any) {
      flash('err', err?.message || 'Backup failed.');
    }
  };

  const specialDownloadUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/download` : '/download';

  const handleCopySpecialDownloadUrl = async () => {
    const ok = await copyToClipboard(specialDownloadUrl);
    if (ok) {
      setCopiedDownloadUrl(true);
      flash('ok', `Special app download link copied: ${specialDownloadUrl}`);
      window.setTimeout(() => setCopiedDownloadUrl(false), 2400);
    }
  };

  const handleSaveAppDistConfig = async (e: FormEvent) => {
    e.preventDefault();
    setAppDistBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; config: any }>('/api/admin/app/config', {
        method: 'POST',
        body: JSON.stringify({
          mode: appMode,
          externalUrl: appExternalUrl.trim(),
          version: appVersion.trim() || '1.0.0',
        }),
      });
      setAppDistConfig(res.config);
      setAppMode(res.config.mode);
      flash('ok', 'Mobile app download settings updated.');
    } catch (err: any) {
      flash('err', err?.message || 'Failed to update app distribution settings.');
    } finally {
      setAppDistBusy(false);
    }
  };

  const handleUploadApk = async () => {
    if (!apkFile) {
      flash('err', 'Please select a .apk file first.');
      return;
    }
    setAppDistBusy(true);
    try {
      const fd = new FormData();
      fd.append('apk', apkFile);
      fd.append('version', appVersion.trim() || '1.0.0');
      const res = await apiFetch<{ ok: boolean; config: any }>('/api/admin/app/apk', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setAppDistConfig(res.config);
      setAppMode(res.config.mode);
      setApkFile(null);
      flash('ok', `SW88 APK v${res.config.version} uploaded and set as live download!`);
    } catch (err: any) {
      flash('err', err?.message || 'APK upload failed.');
    } finally {
      setAppDistBusy(false);
    }
  };

  const handleDeleteApk = async () => {
    setAppDistBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; config: any }>('/api/admin/app/apk', {
        method: 'DELETE',
      });
      setAppDistConfig(res.config);
      setAppMode('pwa');
      flash('ok', 'Uploaded APK removed. Switched to 1-Tap Auto-Setup Web App mode.');
    } catch (err: any) {
      flash('err', err?.message || 'Failed to remove APK.');
    } finally {
      setAppDistBusy(false);
    }
  };

  const handleExportReportCsv = () => {
    if (!reportData) return;
    const rows: string[][] = [
      ['SW88 Platform Report', `Range: ${reportRange}`],
      [],
      ['Section', 'Metric', 'Value'],
      ['Deposits', 'Approved Count', String(reportData.deposits?.approvedCount || 0)],
      ['Deposits', 'Approved Amount (NPR)', String(reportData.deposits?.approvedAmount || 0)],
      ['Deposits', 'Rejected Count', String(reportData.deposits?.rejectedCount || 0)],
      ['Withdrawals', 'Approved Amount (NPR)', String(reportData.withdrawals?.approvedAmount || 0)],
      ['Withdrawals', 'Paid Amount (NPR)', String(reportData.withdrawals?.paidAmount || 0)],
      ['Transfers', 'Agent Transfer Volume (NPR)', String(reportData.transfers?.agentVolume || 0)],
      ['Transfers', 'Friend Transfer Volume (NPR)', String(reportData.transfers?.friendVolume || 0)],
      ['Transfers', 'Commission Collected (NPR)', String(reportData.transfers?.totalCommission || 0)],
      [],
      ['Game ID', 'Game Name', 'Rounds', 'Total Stake', 'Total Payout', 'Net Revenue'],
      ...(reportData.perGame || []).map((g: any) => [
        g.id,
        g.name,
        String(g.rounds),
        String(g.totalStake),
        String(g.totalPayout),
        String(g.netRevenue),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sw88-report-${reportRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sidebarItems: Array<{ id: AdminSection; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'users', label: 'Users Management', icon: Users },
    { id: 'wallets', label: 'Wallet Management', icon: WalletIcon },
    { id: 'deposits', label: 'Deposit Requests', icon: Download },
    { id: 'qr', label: 'Deposit QR Management', icon: QrCode },
    { id: 'transfer-monitor', label: 'Transfer Monitor', icon: ArrowRightLeft },
    { id: 'agent-transfers', label: 'Agent Transfers', icon: Send },
    { id: 'friend-transfers', label: 'Friend Transfers', icon: TrendingUp },
    { id: 'commissions', label: 'Commission Records', icon: Percent },
    { id: 'withdrawals', label: 'Withdrawal Requests', icon: CreditCard },
    { id: 'games', label: 'Game Management', icon: Gamepad2 },
    { id: 'game-transactions', label: 'Game Transactions', icon: Activity },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'banned', label: 'Permanently Banned Users', icon: Ban },
    { id: 'audit-logs', label: 'Admin Activity Logs', icon: FileText },
    { id: 'security', label: 'Security Settings', icon: Lock },
    { id: 'settings', label: 'Settings & DB Health', icon: Settings },
  ];

  const pendingDepCount = overview?.kpis?.totalPendingDepositCount || 0;
  const pendingWdrCount = overview?.gamesAndWithdrawalsSummary?.pendingWithdrawalsCount || 0;

  return (
    <div className="min-h-dvh bg-[#0B0D11] text-[#F5F7FA] flex">
      {/* Sidebar Desktop + Mobile Drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-dvh w-64 bg-[#10131B] border-r border-white/10 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-4 border-b border-white/10 flex items-center justify-between">
          <BrandMark subtitle="Admin Console" />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-[#9CA3AF] hover:text-white cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full min-h-[40px] px-3 rounded-xl text-left text-xs font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                  active
                    ? 'bg-[#E6B84F]/15 text-[#E6B84F] border border-[#E6B84F]/30'
                    : 'text-[#9CA3AF] hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] border-t border-white/10 text-xs space-y-2">
          <div className="px-2 py-1.5 rounded-lg bg-[#0B0D11] border border-white/5">
            <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">Admin Session</div>
            <div className="font-bold text-[#F5F7FA] mt-0.5 truncate">
              {user.username} ({user.uid})
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[40px] rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 font-bold text-xs inline-flex items-center justify-center gap-1.5 hover:bg-red-500/20 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 sm:h-16 bg-[#0B0D11]/95 backdrop-blur border-b border-white/10 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden min-h-[38px] min-w-[38px] rounded-xl bg-[#14171F] border border-white/10 flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <span className="sm:hidden font-display font-extrabold text-sm text-[#E6B84F] truncate">
              SW88 Admin
            </span>

            <div className="relative hidden sm:block w-64 md:w-80">
              <Search className="w-4 h-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search UID, username, or ID..."
                className="w-full min-h-[38px] pl-9 pr-3 rounded-xl bg-[#14171F] border border-white/10 text-xs text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={handleCopySpecialDownloadUrl}
              className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-[#E6B84F]/15 border border-[#E6B84F]/35 text-[#E6B84F] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              title="Copy Special App Download Link"
            >
              {copiedDownloadUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{copiedDownloadUrl ? 'Link Copied' : 'App Download Link'}</span>
            </button>

            <div className="rounded-xl bg-[#14171F] border border-white/10 px-2.5 sm:px-3 py-1.5 text-right leading-tight">
              <div className="font-mono-nums font-bold text-[11px] sm:text-xs text-[#E6B84F]">{nstClock.time} NST</div>
              <div className="text-[10px] text-[#9CA3AF] hidden sm:block">{nstClock.date} · UTC+05:45</div>
            </div>

            <button
              type="button"
              onClick={() => setSection(pendingDepCount > 0 ? 'deposits' : 'withdrawals')}
              className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs font-semibold flex items-center gap-1.5 sm:gap-2 cursor-pointer"
              title="Pending Approvals"
            >
              <ShieldAlert className="w-4 h-4 text-[#E6B84F]" />
              <span className="hidden md:inline text-[#9CA3AF]">Pending:</span>
              <span className="font-mono-nums font-bold text-[#F5F7FA]">
                {pendingDepCount + pendingWdrCount}
              </span>
            </button>

            <button
              type="button"
              onClick={loadSectionData}
              className="min-h-[38px] min-w-[38px] rounded-xl bg-[#14171F] border border-white/10 flex items-center justify-center text-[#9CA3AF] hover:text-white cursor-pointer"
              aria-label="Refresh section"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="p-3 sm:p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] space-y-5 sm:space-y-6 max-w-7xl w-full mx-auto">
          <div className="relative sm:hidden">
            <Search className="w-4 h-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search UID, username, or ID..."
              className="w-full min-h-[42px] pl-9 pr-3 rounded-xl bg-[#14171F] border border-white/10 text-xs text-[#F5F7FA] placeholder:text-[#6B7280] focus:outline-none focus:border-[#E6B84F]"
            />
          </div>
          {toast && (
            <div
              className={`rounded-xl border p-3.5 text-xs sm:text-sm flex items-center justify-between ${
                toast.kind === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ==================== 1. OVERVIEW ==================== */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold">Executive Overview</h1>
                  <p className="text-xs text-[#9CA3AF]">All metrics filtered by Nepal Standard Time (UTC+05:45)</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 bg-[#14171F] border border-white/10 p-1 rounded-xl">
                  {(
                    [
                      ['today', 'Today'],
                      ['yesterday', 'Yesterday'],
                      ['7d', 'Last 7 Days'],
                      ['month', 'This Month'],
                      ['custom', 'Custom NST'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRange(id)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                        range === id ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF] hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {range === 'custom' && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#14171F] border border-white/10 p-3 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="text-[#9CA3AF]">From (NST)</span>
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#0B0D11] border border-white/10 text-[#F5F7FA]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[#9CA3AF]">To (NST)</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#0B0D11] border border-white/10 text-[#F5F7FA]"
                    />
                  </label>
                </div>
              )}

              {overview && (
                <>
                  {/* 6 Core Separated KPI Cards */}
                  <section aria-label="Primary Platform Financials" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Deposits Approved</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-emerald-400 mt-1.5">
                        {formatNpr(overview.kpis.totalDepositsApproved)}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1 font-mono-nums">
                        {overview.kpis.totalDepositsApprovedCount} approved requests in range
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Pending Deposit Requests</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-[#E6B84F] mt-1.5">
                        {overview.kpis.totalPendingDepositCount} Requests
                      </div>
                      <div className="text-[11px] text-[#9CA3AF] mt-1 font-mono-nums">
                        {formatNpr(overview.kpis.totalPendingDepositAmount)} awaiting review
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Users Wallet Balance</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-[#F5F7FA] mt-1.5">
                        {formatNpr(overview.kpis.totalUsersWalletBalance)}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1 font-mono-nums">
                        Reserved: {formatNpr(overview.kpis.totalUsersReservedWithdrawal)} · Winnings:{' '}
                        {formatNpr(overview.kpis.totalUsersWithdrawableWinnings)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Agent Transfer Volume</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-sky-400 mt-1.5">
                        {formatNpr(overview.kpis.totalAgentTransferVolume)}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1 font-mono-nums">
                        {overview.kpis.totalAgentTransferCount} zero-commission transfers
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Friend Transfer Volume</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-[#F5F7FA] mt-1.5">
                        {formatNpr(overview.kpis.totalFriendTransferVolume)}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1 font-mono-nums">
                        {overview.kpis.totalFriendTransferCount} peer transfers
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-[#E6B84F]/30 p-5">
                      <div className="text-xs text-[#9CA3AF]">Total Commission Collected</div>
                      <div className="font-mono-nums font-extrabold text-2xl text-[#E6B84F] mt-1.5">
                        {formatNpr(overview.kpis.totalCommissionCollected)}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1">10% Friend Transfer platform fee</div>
                    </div>
                  </section>

                  {/* Strictly Separate Games & Withdrawals Summary */}
                  <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display font-bold text-base">Games &amp; Withdrawals Summary</h2>
                      <span className="text-xs text-[#9CA3AF] font-mono-nums">
                        Users: {overview.userCounts?.totalUsers || 0} Total · {overview.userCounts?.activeUsers || 0} Active ·{' '}
                        {overview.userCounts?.bannedUsers || 0} Banned
                      </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Game Stakes</div>
                        <div className="font-mono-nums font-bold text-base mt-1">
                          {formatNpr(overview.gamesAndWithdrawalsSummary.totalGameStakes)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Game Payouts</div>
                        <div className="font-mono-nums font-bold text-base mt-1">
                          {formatNpr(overview.gamesAndWithdrawalsSummary.totalGamePayouts)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Net Game Revenue</div>
                        <div
                          className={`font-mono-nums font-bold text-base mt-1 ${
                            overview.gamesAndWithdrawalsSummary.totalGameNetRevenue >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {formatNpr(overview.gamesAndWithdrawalsSummary.totalGameNetRevenue)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Game Rounds</div>
                        <div className="font-mono-nums font-bold text-base mt-1">
                          {overview.gamesAndWithdrawalsSummary.totalGameRounds}
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Pending Withdrawals</div>
                        <div className="font-mono-nums font-bold text-base text-[#E6B84F] mt-1">
                          {overview.gamesAndWithdrawalsSummary.pendingWithdrawalsCount} (
                          {formatNpr(overview.gamesAndWithdrawalsSummary.pendingWithdrawalsAmount)})
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                        <div className="text-[#9CA3AF]">Paid Withdrawals</div>
                        <div className="font-mono-nums font-bold text-base text-emerald-400 mt-1">
                          {overview.gamesAndWithdrawalsSummary.paidWithdrawalsCount} (
                          {formatNpr(overview.gamesAndWithdrawalsSummary.paidWithdrawalsAmount)})
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Recent Activity */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-3">
                      <h3 className="font-display font-bold text-sm">Recent Deposits</h3>
                      <div className="space-y-2 text-xs">
                        {(overview.recentActivity?.deposits || []).map((d: any) => (
                          <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-white/5">
                            <span>
                              <strong>{d.username}</strong> ({d.user_uid})
                            </span>
                            <span className="font-mono-nums font-bold">{formatNpr(d.amount)}</span>
                            <StatusLabel value={d.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-3">
                      <h3 className="font-display font-bold text-sm">Recent Withdrawals</h3>
                      <div className="space-y-2 text-xs">
                        {(overview.recentActivity?.withdrawals || []).map((w: any) => (
                          <div key={w.id} className="flex items-center justify-between py-1.5 border-b border-white/5">
                            <span>
                              <strong>{w.username}</strong> ({w.method})
                            </span>
                            <span className="font-mono-nums font-bold">{formatNpr(w.amount)}</span>
                            <StatusLabel value={w.payment_status === 'PAID' ? 'PAID' : w.request_status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ==================== 2 & 3. USERS & WALLETS MANAGEMENT ==================== */}
          {(section === 'users' || section === 'wallets') && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">
                  {section === 'users' ? 'Users Management' : 'Wallet Management'}
                </h1>
                {section === 'users' && (
                  <select
                    value={userStatusFilter}
                    onChange={(e) => setUserStatusFilter(e.target.value)}
                    className="min-h-[38px] px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs text-[#F5F7FA]"
                  >
                    <option value="">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="BANNED">Banned</option>
                  </select>
                )}
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">UID</th>
                      <th className="py-2.5 pr-4">Username</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5 pr-4">Main Balance</th>
                      <th className="py-2.5 pr-4">Winnings</th>
                      <th className="py-2.5 pr-4">Reserved</th>
                      <th className="py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {usersList.map((u) => (
                      <tr key={u.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold text-[#E6B84F]">{u.uid}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-1.5 font-bold">
                            <span>{u.username}</span>
                            {Boolean(u.is_agent) && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] font-extrabold">
                                AGENT
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#9CA3AF]">{u.display_name}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={u.status} />
                        </td>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(u.main_balance)}</td>
                        <td className="py-3 pr-4 font-mono-nums text-emerald-400">
                          {formatNpr(u.withdrawable_winnings)}
                        </td>
                        <td className="py-3 pr-4 font-mono-nums text-amber-300">
                          {formatNpr(u.reserved_withdrawal)}
                        </td>
                        <td className="py-3 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              const d = await apiFetch(`/api/admin/users/${u.id}`);
                              setSelectedUserDetail(d);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#0B0D11] border border-white/10 hover:border-white/30 cursor-pointer"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustModalUser(u);
                              setAdjDirection('CREDIT');
                              setAdjAmount('500');
                              setAdjReason('');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#E6B84F]/15 text-[#E6B84F] font-semibold cursor-pointer"
                          >
                            Adjust
                          </button>
                          {u.status !== 'BANNED' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleAgentRole(u)}
                                className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                                  u.is_agent
                                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                    : 'bg-white/5 hover:bg-white/10 text-[#9CA3AF]'
                                }`}
                              >
                                {u.is_agent ? 'Unmark Agent' : 'Mark Agent'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleUserStatus(u)}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer"
                              >
                                {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBanModalUser(u);
                                  setBanReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-300 font-semibold cursor-pointer"
                              >
                                Perm Ban
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 4. DEPOSIT REQUESTS ==================== */}
          {section === 'deposits' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Deposit Requests</h1>
                <div className="flex gap-1 bg-[#14171F] border border-white/10 p-1 rounded-xl">
                  {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setDepositFilter(tab)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                        depositFilter === tab ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">ID</th>
                      <th className="py-2.5 pr-4">Player</th>
                      <th className="py-2.5 pr-4">Amount</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5 pr-4">Submitted (NST)</th>
                      <th className="py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {deposits.map((d) => (
                      <tr key={d.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{d.id}</td>
                        <td className="py-3 pr-4">
                          {d.username} (<span className="font-mono-nums text-[#E6B84F]">{d.user_uid}</span>)
                        </td>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(d.amount)}</td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={d.status} />
                        </td>
                        <td className="py-3 pr-4 text-[#9CA3AF]">{formatNstDateShort(d.created_at)}</td>
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={() => {
                              setInspectDeposit(d);
                              setDepAdminMsg(d.admin_message || '');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#E6B84F]/15 text-[#E6B84F] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 5. DEPOSIT QR MANAGEMENT ==================== */}
          {section === 'qr' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-5 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <h1 className="font-display text-xl font-extrabold">Current Live Deposit QR</h1>
                {qrAdmin?.hasFile && qrAdmin.imageUrl ? (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-white p-4 max-w-[260px] mx-auto">
                      <img
                        src={qrAdmin.imageUrl}
                        alt="Current Admin QR"
                        referrerPolicy="no-referrer"
                        className="w-full h-auto object-contain"
                      />
                    </div>
                    <div className="text-xs flex items-center justify-between">
                      <span className="text-[#9CA3AF]">Status:</span>
                      <StatusLabel value={qrAdmin.active ? 'ACTIVE' : 'PAUSED'} />
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveQr}
                      className="w-full min-h-[42px] rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold cursor-pointer"
                    >
                      Remove QR Code
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-8 text-center text-xs text-[#9CA3AF]">
                    No QR uploaded yet. Players currently see: &ldquo;Deposits are temporarily unavailable.&rdquo;
                  </div>
                )}
              </section>

              <section className="lg:col-span-7 rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <h2 className="font-display text-lg font-bold">Upload / Update Deposit QR</h2>
                <form onSubmit={handleSaveQr} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      New QR Image (PNG, JPG, WEBP)
                    </label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setQrFile(f);
                        if (qrPreview) URL.revokeObjectURL(qrPreview);
                        setQrPreview(f ? URL.createObjectURL(f) : null);
                      }}
                      className="block w-full text-xs text-[#9CA3AF] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-[#0B0D11] file:text-[#E6B84F] file:font-bold"
                    />
                    {qrPreview && (
                      <img src={qrPreview} alt="QR preview" className="mt-3 max-h-40 rounded-xl bg-white p-2" />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      Payment Instructions Shown to Players
                    </label>
                    <textarea
                      rows={3}
                      value={qrInstructions}
                      onChange={(e) => setQrInstructions(e.target.value)}
                      placeholder="Scan with Fonepay / eSewa / Mobile Banking, include your User ID in remarks, and upload screenshot."
                      className="w-full p-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qrActiveToggle}
                      onChange={(e) => setQrActiveToggle(e.target.checked)}
                      className="h-4 w-4 accent-[#E6B84F]"
                    />
                    <span>QR Active (Accepting Player Deposits)</span>
                  </label>

                  <button
                    type="submit"
                    className="min-h-[46px] px-6 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold text-sm inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Save &amp; Publish QR Settings</span>
                  </button>
                </form>
              </section>
            </div>
          )}

          {/* ==================== 5B. UNIFIED TRANSFER MONITOR ==================== */}
          {section === 'transfer-monitor' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold">Automatic Transfer Monitor</h1>
                  <p className="text-xs text-[#9CA3AF]">
                    Real-time audit ledger of every automatic Agent &amp; Friend transfer (incoming &amp; outgoing)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTxTypeFilter('ALL');
                    setTxDirectionFilter('ALL');
                    setTxStatusFilter('ALL');
                    setTxUidFilter('');
                    setTxAgentUidFilter('');
                    setTxIdFilter('');
                    setTxStartDate('');
                    setTxEndDate('');
                  }}
                  className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs font-semibold text-[#9CA3AF] hover:text-white cursor-pointer"
                >
                  Clear Filters
                </button>
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <input
                  type="text"
                  value={txUidFilter}
                  onChange={(e) => setTxUidFilter(e.target.value.toUpperCase())}
                  placeholder="Filter by User ID (UID)..."
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums uppercase"
                />
                <input
                  type="text"
                  value={txAgentUidFilter}
                  onChange={(e) => setTxAgentUidFilter(e.target.value.toUpperCase())}
                  placeholder="Filter by Agent UID..."
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums uppercase"
                />
                <input
                  type="text"
                  value={txIdFilter}
                  onChange={(e) => setTxIdFilter(e.target.value.toUpperCase())}
                  placeholder="Filter by Transaction ID..."
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums uppercase"
                />
                <select
                  value={txTypeFilter}
                  onChange={(e) => setTxTypeFilter(e.target.value as any)}
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10"
                >
                  <option value="ALL">All Types (Agent + Friend)</option>
                  <option value="AGENT">Agent Transfers Only</option>
                  <option value="FRIEND">Friend Transfers Only</option>
                </select>
                <select
                  value={txDirectionFilter}
                  onChange={(e) => setTxDirectionFilter(e.target.value as any)}
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10"
                >
                  <option value="ALL">All Directions (Incoming &amp; Outgoing)</option>
                  <option value="OUTGOING">Outgoing (User as Sender)</option>
                  <option value="INCOMING">Incoming (User as Receiver)</option>
                </select>
                <select
                  value={txStatusFilter}
                  onChange={(e) => setTxStatusFilter(e.target.value)}
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="PENDING">PENDING</option>
                  <option value="FAILED">FAILED</option>
                  <option value="REVERSED">REVERSED</option>
                </select>
                <input
                  type="date"
                  value={txStartDate}
                  onChange={(e) => setTxStartDate(e.target.value)}
                  aria-label="Filter start NST date"
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10"
                />
                <input
                  type="date"
                  value={txEndDate}
                  onChange={(e) => setTxEndDate(e.target.value)}
                  aria-label="Filter end NST date"
                  className="min-h-[38px] px-3 rounded-xl bg-[#0B0D11] border border-white/10"
                />
              </div>

              {unifiedSummary && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5">
                    <div className="text-[#9CA3AF]">Matching Transfers</div>
                    <div className="font-mono-nums font-extrabold text-lg mt-0.5">{unifiedSummary.totalCount}</div>
                  </div>
                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5">
                    <div className="text-[#9CA3AF]">Total Transferred</div>
                    <div className="font-mono-nums font-extrabold text-lg text-[#E6B84F] mt-0.5">
                      {formatNpr(unifiedSummary.totalAmount)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5">
                    <div className="text-[#9CA3AF]">Agent Volume</div>
                    <div className="font-mono-nums font-extrabold text-lg text-sky-400 mt-0.5">
                      {formatNpr(unifiedSummary.agentVolume)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5">
                    <div className="text-[#9CA3AF]">Friend Volume</div>
                    <div className="font-mono-nums font-extrabold text-lg text-emerald-400 mt-0.5">
                      {formatNpr(unifiedSummary.friendVolume)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-3.5">
                    <div className="text-[#9CA3AF]">Commission Fee</div>
                    <div className="font-mono-nums font-extrabold text-lg mt-0.5">
                      {formatNpr(unifiedSummary.totalCommission)}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">Transaction ID</th>
                      <th className="py-2.5 pr-4">Type</th>
                      <th className="py-2.5 pr-4">Sender</th>
                      <th className="py-2.5 pr-4">Receiver</th>
                      <th className="py-2.5 pr-4">Amount</th>
                      <th className="py-2.5 pr-4">Fee</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {unifiedTransfers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#9CA3AF]">
                          No transfers match the active filters.
                        </td>
                      </tr>
                    ) : (
                      unifiedTransfers.map((t) => (
                        <tr key={`${t.transfer_type}-${t.id}`}>
                          <td className="py-3 pr-4 font-mono-nums font-bold">{t.id}</td>
                          <td className="py-3 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                                t.transfer_type === 'AGENT'
                                  ? 'bg-sky-500/15 text-sky-300'
                                  : 'bg-[#E6B84F]/15 text-[#E6B84F]'
                              }`}
                            >
                              {t.transfer_type}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {t.sender_username} (<span className="font-mono-nums text-[#E6B84F]">{t.sender_uid}</span>)
                          </td>
                          <td className="py-3 pr-4">
                            {t.receiver_username} (<span className="font-mono-nums text-emerald-400">{t.receiver_uid}</span>)
                          </td>
                          <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(t.amount)}</td>
                          <td className="py-3 pr-4 font-mono-nums text-[#9CA3AF]">{formatNpr(t.commission_amount)}</td>
                          <td className="py-3 pr-4">
                            <StatusLabel value={t.status || 'COMPLETED'} />
                          </td>
                          <td className="py-3 text-[#9CA3AF] whitespace-nowrap">{formatNstDateTime(t.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 6. AGENT TRANSFERS ==================== */}
          {section === 'agent-transfers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Agent Transfers (0% Commission)</h1>
                <div className="flex flex-wrap gap-2 text-xs">
                  <input
                    type="text"
                    value={txAgentUidFilter}
                    onChange={(e) => setTxAgentUidFilter(e.target.value.toUpperCase())}
                    placeholder="Agent UID..."
                    className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 font-mono-nums uppercase"
                  />
                  <input
                    type="text"
                    value={txUidFilter}
                    onChange={(e) => setTxUidFilter(e.target.value.toUpperCase())}
                    placeholder="User UID..."
                    className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 font-mono-nums uppercase"
                  />
                  <input
                    type="text"
                    value={txIdFilter}
                    onChange={(e) => setTxIdFilter(e.target.value.toUpperCase())}
                    placeholder="TX ID..."
                    className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 font-mono-nums uppercase"
                  />
                </div>
              </div>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">ID</th>
                      <th className="py-2.5 pr-4">Sender</th>
                      <th className="py-2.5 pr-4">Receiver</th>
                      <th className="py-2.5 pr-4">Amount</th>
                      <th className="py-2.5 pr-4">Sender Balance After</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {agentTransfers.map((t) => (
                      <tr key={t.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{t.id}</td>
                        <td className="py-3 pr-4">
                          {t.sender_username} ({t.sender_uid})
                        </td>
                        <td className="py-3 pr-4">
                          {t.receiver_username} ({t.receiver_uid})
                        </td>
                        <td className="py-3 pr-4 font-mono-nums font-bold text-emerald-400">
                          {formatNpr(t.amount)}
                        </td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(t.sender_remaining_balance)}</td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={t.status || 'COMPLETED'} />
                        </td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 7. FRIEND TRANSFERS ==================== */}
          {section === 'friend-transfers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Friend Transfers (10% Commission)</h1>
                <div className="flex flex-wrap gap-2 text-xs">
                  <input
                    type="text"
                    value={txUidFilter}
                    onChange={(e) => setTxUidFilter(e.target.value.toUpperCase())}
                    placeholder="User UID..."
                    className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 font-mono-nums uppercase"
                  />
                  <input
                    type="text"
                    value={txIdFilter}
                    onChange={(e) => setTxIdFilter(e.target.value.toUpperCase())}
                    placeholder="TX ID..."
                    className="min-h-[36px] px-3 rounded-xl bg-[#14171F] border border-white/10 font-mono-nums uppercase"
                  />
                </div>
              </div>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">ID</th>
                      <th className="py-2.5 pr-4">Sender</th>
                      <th className="py-2.5 pr-4">Receiver</th>
                      <th className="py-2.5 pr-4">Transfer Amount</th>
                      <th className="py-2.5 pr-4">10% Commission</th>
                      <th className="py-2.5 pr-4">Total Debited</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {friendTransfers.map((t) => (
                      <tr key={t.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{t.id}</td>
                        <td className="py-3 pr-4">
                          {t.sender_username} ({t.sender_uid})
                        </td>
                        <td className="py-3 pr-4">
                          {t.receiver_username} ({t.receiver_uid})
                        </td>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(t.amount)}</td>
                        <td className="py-3 pr-4 font-mono-nums font-bold text-[#E6B84F]">
                          {formatNpr(t.commission_amount)}
                        </td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(t.total_deduction)}</td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={t.status || 'COMPLETED'} />
                        </td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 8. COMMISSION RECORDS ==================== */}
          {section === 'commissions' && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold">Commission Records</h1>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-[#14171F] border border-[#E6B84F]/30 p-4">
                  <div className="text-xs text-[#9CA3AF]">Total Commission Collected</div>
                  <div className="font-mono-nums font-extrabold text-2xl text-[#E6B84F] mt-1">
                    {formatNpr(commissions.totals?.totalCommission || 0)}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4">
                  <div className="text-xs text-[#9CA3AF]">Friend Transfer Volume</div>
                  <div className="font-mono-nums font-extrabold text-2xl mt-1">
                    {formatNpr(commissions.totals?.friendVolume || 0)}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4">
                  <div className="text-xs text-[#9CA3AF]">Agent Transfer Volume (0%)</div>
                  <div className="font-mono-nums font-extrabold text-2xl mt-1">
                    {formatNpr(commissions.totals?.agentVolume || 0)}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">ID</th>
                      <th className="py-2.5 pr-4">Source</th>
                      <th className="py-2.5 pr-4">Sender</th>
                      <th className="py-2.5 pr-4">Receiver</th>
                      <th className="py-2.5 pr-4">Amount</th>
                      <th className="py-2.5 pr-4">Rate</th>
                      <th className="py-2.5 pr-4">Commission</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {commissions.records.map((c) => (
                      <tr key={c.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{c.id}</td>
                        <td className="py-3 pr-4">{c.source_type}</td>
                        <td className="py-3 pr-4">{c.sender_uid}</td>
                        <td className="py-3 pr-4">{c.receiver_uid}</td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(c.transfer_amount)}</td>
                        <td className="py-3 pr-4 font-mono-nums">{c.commission_rate_pct}%</td>
                        <td className="py-3 pr-4 font-mono-nums font-bold text-[#E6B84F]">
                          {formatNpr(c.commission_collected)}
                        </td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 9. WITHDRAWAL REQUESTS ==================== */}
          {section === 'withdrawals' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Withdrawal Requests</h1>
                <div className="flex gap-1 bg-[#14171F] border border-white/10 p-1 rounded-xl">
                  {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setWdrFilter(tab)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                        wdrFilter === tab ? 'bg-[#E6B84F] text-[#0B0D11]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">ID</th>
                      <th className="py-2.5 pr-4">Player</th>
                      <th className="py-2.5 pr-4">Amount</th>
                      <th className="py-2.5 pr-4">Payout Destination</th>
                      <th className="py-2.5 pr-4">Request Status</th>
                      <th className="py-2.5 pr-4">Payment Status</th>
                      <th className="py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{w.id}</td>
                        <td className="py-3 pr-4">
                          {w.username} (<span className="font-mono-nums text-[#E6B84F]">{w.user_uid}</span>)
                        </td>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{formatNpr(w.amount)}</td>
                        <td className="py-3 pr-4">
                          <div className="font-bold">{w.method} · {w.account_holder_name}</div>
                          <div className="text-[11px] text-[#9CA3AF] font-mono-nums">
                            {w.method === 'ESEWA'
                              ? w.esewa_mobile
                              : `${w.bank_name} · ${w.bank_account_number} (${w.bank_branch})`}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={w.request_status} />
                        </td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={w.payment_status} />
                        </td>
                        <td className="py-3 flex flex-wrap gap-1.5">
                          {w.request_status === 'PENDING' && (
                            <button
                              type="button"
                              onClick={() => {
                                setReviewWdr(w);
                                setWdrReviewNote('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[#E6B84F]/15 text-[#E6B84F] font-bold cursor-pointer"
                            >
                              Review
                            </button>
                          )}
                          {w.request_status === 'APPROVED' && w.payment_status !== 'PAID' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayModalWdr(w);
                                setPayStatusNext('PAID');
                                setPayNote(w.admin_note || '');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-bold cursor-pointer"
                            >
                              Update Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 10. GAME MANAGEMENT ==================== */}
          {section === 'games' && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold">Game Management</h1>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {adminGames.map((g) => {
                  const ed = gameEdits[g.id] || {
                    enabled: g.enabled,
                    minStake: g.minStake,
                    maxStake: g.maxStake,
                    houseEdgePct: g.houseEdgePct,
                  };
                  return (
                    <div key={g.id} className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="font-display font-bold text-lg">{g.name}</h2>
                        <StatusLabel value={ed.enabled ? 'ENABLED' : 'DISABLED'} />
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs rounded-xl bg-[#0B0D11] border border-white/5 p-3">
                        <div>
                          <div className="text-[#9CA3AF]">Rounds</div>
                          <div className="font-mono-nums font-bold">{g.stats?.rounds || 0}</div>
                        </div>
                        <div>
                          <div className="text-[#9CA3AF]">Net Revenue</div>
                          <div className="font-mono-nums font-bold text-emerald-400">
                            {formatNpr(g.stats?.netRevenue || 0)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 text-xs">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span>Game Active</span>
                          <input
                            type="checkbox"
                            checked={ed.enabled}
                            onChange={(e) =>
                              setGameEdits((m) => ({ ...m, [g.id]: { ...ed, enabled: e.target.checked } }))
                            }
                            className="h-4 w-4 accent-[#E6B84F]"
                          />
                        </label>
                        <div>
                          <label className="block text-[#9CA3AF] mb-1">Min Stake (NPR)</label>
                          <input
                            type="number"
                            value={ed.minStake}
                            onChange={(e) =>
                              setGameEdits((m) => ({ ...m, [g.id]: { ...ed, minStake: Number(e.target.value) } }))
                            }
                            className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0D11] border border-white/10 font-mono-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[#9CA3AF] mb-1">Max Stake (NPR)</label>
                          <input
                            type="number"
                            value={ed.maxStake}
                            onChange={(e) =>
                              setGameEdits((m) => ({ ...m, [g.id]: { ...ed, maxStake: Number(e.target.value) } }))
                            }
                            className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0D11] border border-white/10 font-mono-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[#9CA3AF] mb-1">Transparent House Edge (%)</label>
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={ed.houseEdgePct}
                            onChange={(e) =>
                              setGameEdits((m) => ({
                                ...m,
                                [g.id]: { ...ed, houseEdgePct: Number(e.target.value) },
                              }))
                            }
                            className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0D11] border border-white/10 font-mono-nums"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSaveGame(g.id)}
                        className="w-full min-h-[42px] rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-xs cursor-pointer"
                      >
                        Save Game Settings
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== 11. GAME TRANSACTIONS ==================== */}
          {section === 'game-transactions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Game Transactions</h1>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={gameTxFilterGame}
                    onChange={(e) => setGameTxFilterGame(e.target.value)}
                    className="min-h-[38px] px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs"
                  >
                    <option value="">All Games</option>
                    <option value="3-patti-royale">3 Patti Royale</option>
                    <option value="bubble-rocket-x">Bubble Rocket X</option>
                    <option value="skyline-crash">Skyline Crash</option>
                  </select>
                  <select
                    value={gameTxFilterResult}
                    onChange={(e) => setGameTxFilterResult(e.target.value)}
                    className="min-h-[38px] px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs"
                  >
                    <option value="">All Results</option>
                    <option value="WIN">WIN</option>
                    <option value="LOSS">LOSS</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">Round ID</th>
                      <th className="py-2.5 pr-4">Game</th>
                      <th className="py-2.5 pr-4">Player</th>
                      <th className="py-2.5 pr-4">Stake</th>
                      <th className="py-2.5 pr-4">Payout</th>
                      <th className="py-2.5 pr-4">Net Result</th>
                      <th className="py-2.5 pr-4">Result</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {gameRounds.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold">{r.id}</td>
                        <td className="py-3 pr-4">{r.game_name}</td>
                        <td className="py-3 pr-4">
                          {r.username} ({r.user_uid})
                        </td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(r.stake)}</td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(r.payout)}</td>
                        <td
                          className={`py-3 pr-4 font-mono-nums font-bold ${
                            r.net_result >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatNpr(r.net_result)}
                        </td>
                        <td className="py-3 pr-4">
                          <StatusLabel value={r.result} />
                        </td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 12. REPORTS & ANALYTICS ==================== */}
          {section === 'reports' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Reports &amp; Analytics</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={reportRange}
                    onChange={(e) => setReportRange(e.target.value as any)}
                    className="min-h-[38px] px-3 rounded-xl bg-[#14171F] border border-white/10 text-xs"
                  >
                    <option value="today">Today (NST)</option>
                    <option value="yesterday">Yesterday (NST)</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="month">This Month</option>
                    <option value="custom">Custom Range</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleExportReportCsv}
                    className="min-h-[38px] px-4 rounded-xl bg-[#E6B84F] text-[#0B0D11] text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {reportRange === 'custom' && (
                <div className="flex gap-3 text-xs">
                  <input
                    type="date"
                    value={reportStart}
                    onChange={(e) => setReportStart(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-[#14171F] border border-white/10"
                  />
                  <input
                    type="date"
                    value={reportEnd}
                    onChange={(e) => setReportEnd(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-[#14171F] border border-white/10"
                  />
                </div>
              )}

              {reportData && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 space-y-2">
                      <div className="font-bold text-sm text-[#E6B84F]">Deposits Breakdown</div>
                      <div className="flex justify-between">
                        <span>Approved</span>
                        <strong className="font-mono-nums">
                          {reportData.deposits?.approvedCount || 0} · {formatNpr(reportData.deposits?.approvedAmount)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Rejected</span>
                        <strong className="font-mono-nums">
                          {reportData.deposits?.rejectedCount || 0} · {formatNpr(reportData.deposits?.rejectedAmount)}
                        </strong>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 space-y-2">
                      <div className="font-bold text-sm text-emerald-400">Withdrawals Breakdown</div>
                      <div className="flex justify-between">
                        <span>Approved</span>
                        <strong className="font-mono-nums">
                          {reportData.withdrawals?.approvedCount || 0} · {formatNpr(reportData.withdrawals?.approvedAmount)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Paid Out</span>
                        <strong className="font-mono-nums">
                          {reportData.withdrawals?.paidCount || 0} · {formatNpr(reportData.withdrawals?.paidAmount)}
                        </strong>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 space-y-2">
                      <div className="font-bold text-sm text-sky-400">Transfers &amp; Commissions</div>
                      <div className="flex justify-between">
                        <span>Agent Volume</span>
                        <strong className="font-mono-nums">{formatNpr(reportData.transfers?.agentVolume)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Friend Volume</span>
                        <strong className="font-mono-nums">{formatNpr(reportData.transfers?.friendVolume)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Commission Collected</span>
                        <strong className="font-mono-nums text-[#E6B84F]">
                          {formatNpr(reportData.transfers?.totalCommission)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                    <h2 className="font-display font-bold text-sm mb-3">Per-Game Performance</h2>
                    <table className="w-full text-left text-xs">
                      <thead className="text-[#9CA3AF] border-b border-white/10">
                        <tr>
                          <th className="py-2 pr-4">Game</th>
                          <th className="py-2 pr-4">Rounds</th>
                          <th className="py-2 pr-4">Total Stake</th>
                          <th className="py-2 pr-4">Total Payout</th>
                          <th className="py-2">Net Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {(reportData.perGame || []).map((g: any) => (
                          <tr key={g.id}>
                            <td className="py-3 pr-4 font-bold">{g.name}</td>
                            <td className="py-3 pr-4 font-mono-nums">{g.rounds}</td>
                            <td className="py-3 pr-4 font-mono-nums">{formatNpr(g.totalStake)}</td>
                            <td className="py-3 pr-4 font-mono-nums">{formatNpr(g.totalPayout)}</td>
                            <td className="py-3 font-mono-nums font-bold text-emerald-400">
                              {formatNpr(g.netRevenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 13. PERMANENTLY BANNED USERS ==================== */}
          {section === 'banned' && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold">Permanently Banned Users</h1>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">UID</th>
                      <th className="py-2.5 pr-4">Username</th>
                      <th className="py-2.5 pr-4">Ban Reason</th>
                      <th className="py-2.5 pr-4">Frozen Balance</th>
                      <th className="py-2.5 pr-4">Banned By</th>
                      <th className="py-2.5">Banned At (NST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {bannedUsers.map((b) => (
                      <tr key={b.id}>
                        <td className="py-3 pr-4 font-mono-nums font-bold text-red-400">{b.user_uid}</td>
                        <td className="py-3 pr-4 font-bold">{b.username}</td>
                        <td className="py-3 pr-4 text-[#D1D5DB]">{b.reason}</td>
                        <td className="py-3 pr-4 font-mono-nums">{formatNpr(b.main_balance)}</td>
                        <td className="py-3 pr-4 font-mono-nums">{b.banned_by_uid}</td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(b.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 14. ADMIN ACTIVITY LOGS ==================== */}
          {section === 'audit-logs' && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold">Admin Activity Logs</h1>
              <div className="rounded-2xl bg-[#14171F] border border-white/10 p-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[#9CA3AF] border-b border-white/10">
                    <tr>
                      <th className="py-2.5 pr-4">Action</th>
                      <th className="py-2.5 pr-4">Admin UID</th>
                      <th className="py-2.5 pr-4">Affected Record</th>
                      <th className="py-2.5 pr-4">Reason / Summary</th>
                      <th className="py-2.5">NST Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {auditLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-3 pr-4 font-bold text-[#E6B84F]">{l.action}</td>
                        <td className="py-3 pr-4 font-mono-nums">{l.admin_uid}</td>
                        <td className="py-3 pr-4">{l.affected_record}</td>
                        <td className="py-3 pr-4 text-[#9CA3AF]">{l.reason || '—'}</td>
                        <td className="py-3 text-[#9CA3AF]">{formatNstDateTime(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 14B. ADMIN SECURITY SETTINGS ==================== */}
          {section === 'security' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h1 className="font-display text-2xl font-extrabold flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-[#E6B84F]" />
                  <span>Admin Security Settings</span>
                </h1>
                <p className="text-xs text-[#9CA3AF] mt-1">
                  Update your Administrator Login ID and password. Changes are hashed securely with bcrypt and apply immediately to all future login sessions.
                </p>
              </div>

              {secNotice && (
                <div
                  className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
                    secNotice.kind === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  {secNotice.text}
                </div>
              )}

              <form
                onSubmit={handleUpdateAdminCredentials}
                className="rounded-2xl bg-[#14171F] border border-white/10 p-5 sm:p-6 space-y-4"
              >
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3.5 text-xs flex items-center justify-between">
                  <div>
                    <div className="text-[#9CA3AF]">Current Admin Session</div>
                    <div className="font-bold text-[#F5F7FA] mt-0.5">{user.username}</div>
                  </div>
                  <span className="font-mono-nums font-bold text-[#E6B84F]">{user.uid}</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Admin Login ID / Username
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={32}
                    value={secUsername}
                    onChange={(e) => setSecUsername(e.target.value)}
                    placeholder="Enter admin username..."
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Current Password (Required to Authorize Changes)
                  </label>
                  <input
                    type="password"
                    required
                    value={secCurrentPassword}
                    onChange={(e) => setSecCurrentPassword(e.target.value)}
                    placeholder="Enter current admin password"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      New Admin Password (Optional if keeping password)
                    </label>
                    <input
                      type="password"
                      minLength={6}
                      value={secNewPassword}
                      onChange={(e) => setSecNewPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      minLength={6}
                      value={secConfirmPassword}
                      onChange={(e) => setSecConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA] focus:outline-none focus:border-[#E6B84F]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={secBusy}
                  className="min-h-[46px] px-6 rounded-xl bg-gradient-to-r from-[#E6B84F] to-[#D49B2A] text-[#0B0D11] font-extrabold text-sm hover:brightness-105 disabled:opacity-40 cursor-pointer"
                >
                  {secBusy ? 'Updating Credentials...' : 'Update Admin Login Credentials'}
                </button>
              </form>
            </div>
          )}

          {/* ==================== 15. SETTINGS, MAINTENANCE & DB HEALTH ==================== */}
          {section === 'settings' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold">Platform Settings, Maintenance &amp; DB Protection</h1>
                <button
                  type="button"
                  onClick={handleBackupDb}
                  className="min-h-[42px] px-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>Create SQLite Backup Now</span>
                </button>
              </div>

              {/* Safe Maintenance Mode Controls */}
              <section className="rounded-2xl bg-[#14171F] border border-amber-500/25 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display font-bold text-lg flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                      <span>Safe Maintenance Mode</span>
                    </h2>
                    <p className="text-xs text-[#9CA3AF] mt-0.5">
                      Pause user gameplay, deposits, withdrawals, and transfers safely while preserving all database records and balances.
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                      maintEnabled
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {maintEnabled ? 'MAINTENANCE ACTIVE' : 'LIVE OPERATIONS'}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#9CA3AF] mb-1.5">
                    Maintenance Banner Message Shown to Players
                  </label>
                  <textarea
                    rows={2}
                    value={maintMessage}
                    onChange={(e) => setMaintMessage(e.target.value)}
                    placeholder="SW88 is currently undergoing scheduled maintenance..."
                    className="w-full p-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={maintBusy}
                    onClick={() => handleSaveMaintenance(!maintEnabled)}
                    className={`min-h-[42px] px-5 rounded-xl font-extrabold text-xs cursor-pointer disabled:opacity-40 ${
                      maintEnabled
                        ? 'bg-emerald-500 text-black'
                        : 'bg-amber-500 text-black'
                    }`}
                  >
                    {maintEnabled ? 'Disable Maintenance Mode (Resume Live)' : 'Enable Safe Maintenance Mode'}
                  </button>
                  <button
                    type="button"
                    disabled={maintBusy}
                    onClick={() => handleSaveMaintenance(maintEnabled)}
                    className="min-h-[42px] px-4 rounded-xl bg-[#0B0D11] border border-white/15 text-xs font-bold text-[#F5F7FA] cursor-pointer disabled:opacity-40"
                  >
                    Save Maintenance Message
                  </button>
                </div>
              </section>

              {/* Database Security, Integrity & Auto-Backups */}
              {sysHealth && (
                <section className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display font-bold text-lg flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      <span>Database Integrity &amp; Automated Backups</span>
                    </h2>
                    <StatusLabel value={sysHealth.integrity?.ok ? 'ACTIVE' : 'PAYMENT FAILED'} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                      <div className="text-[#9CA3AF]">SQLite Integrity</div>
                      <div className="font-mono-nums font-bold text-emerald-400 mt-1">
                        {sysHealth.integrity?.sqliteIntegrity || 'ok'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                      <div className="text-[#9CA3AF]">Foreign Key Errors</div>
                      <div className="font-mono-nums font-bold mt-1">{sysHealth.integrity?.foreignKeyErrors ?? 0}</div>
                    </div>
                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                      <div className="text-[#9CA3AF]">Negative Wallets</div>
                      <div className="font-mono-nums font-bold mt-1">{sysHealth.integrity?.negativeWallets ?? 0}</div>
                    </div>
                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3">
                      <div className="text-[#9CA3AF]">Schema Migration</div>
                      <div className="font-mono-nums font-bold text-[#E6B84F] mt-1">
                        v{sysHealth.integrity?.migrationVersion ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-4 space-y-2">
                      <div className="font-bold text-sm">SQLite Snapshot Backups ({(sysHealth.backups || []).length})</div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {(sysHealth.backups || []).length === 0 ? (
                          <div className="text-[#9CA3AF]">No backup snapshots yet.</div>
                        ) : (
                          sysHealth.backups.map((b: any) => (
                            <div key={b.filename} className="flex items-center justify-between py-1 border-b border-white/5">
                              <span className="font-mono-nums truncate max-w-[230px]">{b.filename}</span>
                              <span className="text-[#9CA3AF] font-mono-nums">
                                {Math.round((b.sizeBytes || 0) / 1024)} KB · {formatNstDateShort(b.createdAt)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-4 space-y-2">
                      <div className="font-bold text-sm">Persistent System Error Log</div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {(sysHealth.errorLogs || []).length === 0 ? (
                          <div className="text-emerald-400">Zero unhandled system errors logged.</div>
                        ) : (
                          sysHealth.errorLogs.slice(0, 15).map((e: any) => (
                            <div key={e.id} className="py-1 border-b border-white/5 space-y-0.5">
                              <div className="flex justify-between text-red-300 font-bold">
                                <span>{e.context}</span>
                                <span className="text-[#9CA3AF] font-normal">{formatNstDateShort(e.created_at)}</span>
                              </div>
                              <div className="text-[#9CA3AF] truncate">{e.message}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Mobile App Distribution & Special Download Link */}
              <section className="rounded-2xl bg-[#14171F] border border-[#E6B84F]/30 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display font-bold text-lg flex items-center gap-2">
                      <Smartphone className="w-5 h-5 text-[#E6B84F]" />
                      <span>Mobile App Download Link &amp; APK Distribution</span>
                    </h2>
                    <p className="text-xs text-[#9CA3AF] mt-0.5">
                      Share your dedicated download-only page link or optionally upload an Android .apk installer.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopySpecialDownloadUrl}
                    className="min-h-[40px] px-4 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedDownloadUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedDownloadUrl ? 'Special Link Copied' : 'Copy Special /download Link'}</span>
                  </button>
                </div>

                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono-nums text-[#E6B84F] break-all select-all">{specialDownloadUrl}</span>
                  <a
                    href="/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-[#F5F7FA] hover:text-[#E6B84F] underline shrink-0"
                  >
                    Open /download Page
                  </a>
                </div>

                <form onSubmit={handleSaveAppDistConfig} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1">Distribution Mode</label>
                      <select
                        value={appMode}
                        onChange={(e) => setAppMode(e.target.value as 'pwa' | 'uploaded' | 'external')}
                        className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                      >
                        <option value="pwa">1-Tap Auto Web App Installer (Default)</option>
                        <option value="uploaded">Uploaded Android APK File</option>
                        <option value="external">External APK Download Link</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1">App Version Label</label>
                      <input
                        type="text"
                        value={appVersion}
                        onChange={(e) => setAppVersion(e.target.value)}
                        placeholder="1.0.0"
                        className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums text-sm text-[#F5F7FA]"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={appDistBusy}
                        className="w-full min-h-[42px] px-4 rounded-xl bg-[#0B0D11] border border-white/15 hover:border-[#E6B84F]/60 text-xs font-bold text-[#F5F7FA] cursor-pointer disabled:opacity-40"
                      >
                        {appDistBusy ? 'Saving...' : 'Save Distribution Mode'}
                      </button>
                    </div>
                  </div>

                  {appMode === 'external' && (
                    <div>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-[#E6B84F]" />
                        <span>Direct External .apk URL</span>
                      </label>
                      <input
                        type="url"
                        value={appExternalUrl}
                        onChange={(e) => setAppExternalUrl(e.target.value)}
                        placeholder="https://example.com/SW88-App.apk"
                        className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                      />
                    </div>
                  )}
                </form>

                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-[#F5F7FA]">Optional Android APK File Upload (Max 100 MB)</span>
                    {appDistConfig?.apkFilename && (
                      <span className="font-mono-nums text-emerald-400">
                        Active file: {appDistConfig.apkFilename} ({Math.max(1, Math.round((appDistConfig.apkSizeBytes || 0) / 1024))} KB)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="file"
                      accept=".apk,application/vnd.android.package-archive"
                      onChange={(e) => setApkFile(e.target.files?.[0] || null)}
                      className="text-xs text-[#9CA3AF] file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-white/15 file:bg-[#14171F] file:text-[#F5F7FA] file:font-semibold file:cursor-pointer"
                    />
                    <button
                      type="button"
                      disabled={appDistBusy || !apkFile}
                      onClick={handleUploadApk}
                      className="min-h-[40px] px-4 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload &amp; Publish .apk</span>
                    </button>
                    {appDistConfig?.apkFilename && (
                      <button
                        type="button"
                        disabled={appDistBusy}
                        onClick={handleDeleteApk}
                        className="min-h-[40px] px-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove APK</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <form onSubmit={handleSaveSettings} className="rounded-2xl bg-[#14171F] border border-white/10 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(settingsMap)
                    .filter(([key]) => !key.startsWith('app_'))
                    .map(([key, val]) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-[#9CA3AF] mb-1">{key}</label>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => setSettingsMap((m) => ({ ...m, [key]: e.target.value }))}
                        className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm text-[#F5F7FA]"
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="submit"
                  className="min-h-[46px] px-6 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold text-sm cursor-pointer"
                >
                  Save Platform Settings
                </button>
              </form>
            </div>
          )}
        </main>
      </div>

      {/* ==================== ADMIN MODALS ==================== */}
      {selectedUserDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[85dvh] rounded-2xl bg-[#14171F] border border-white/15 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-lg">
                  User {selectedUserDetail.user?.username} ({selectedUserDetail.user?.uid})
                </h3>
                {Boolean(selectedUserDetail.user?.is_agent) && (
                  <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-extrabold">
                    AGENT
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setSelectedUserDetail(null)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-[#0B0D11] p-3">
                  <div className="text-[#9CA3AF]">Main</div>
                  <div className="font-mono-nums font-bold text-[#E6B84F]">
                    {formatNpr(selectedUserDetail.user?.main_balance)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] p-3">
                  <div className="text-[#9CA3AF]">Winnings</div>
                  <div className="font-mono-nums font-bold text-emerald-400">
                    {formatNpr(selectedUserDetail.user?.withdrawable_winnings)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] p-3">
                  <div className="text-[#9CA3AF]">Total Staked</div>
                  <div className="font-mono-nums font-bold">{formatNpr(selectedUserDetail.user?.total_staked)}</div>
                </div>
                <div className="rounded-xl bg-[#0B0D11] p-3">
                  <div className="text-[#9CA3AF]">Total Won</div>
                  <div className="font-mono-nums font-bold">{formatNpr(selectedUserDetail.user?.total_won)}</div>
                </div>
              </div>

              {selectedUserDetail.transferSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-[#0B0D11] border border-white/5 p-3">
                    <div className="text-[#9CA3AF]">Agent Sent</div>
                    <div className="font-mono-nums font-bold text-sky-400">
                      {formatNpr(selectedUserDetail.transferSummary.agentSent)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#0B0D11] border border-white/5 p-3">
                    <div className="text-[#9CA3AF]">Agent Received</div>
                    <div className="font-mono-nums font-bold text-emerald-400">
                      {formatNpr(selectedUserDetail.transferSummary.agentReceived)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#0B0D11] border border-white/5 p-3">
                    <div className="text-[#9CA3AF]">Friend Sent</div>
                    <div className="font-mono-nums font-bold text-[#E6B84F]">
                      {formatNpr(selectedUserDetail.transferSummary.friendSent)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#0B0D11] border border-white/5 p-3">
                    <div className="text-[#9CA3AF]">Friend Received</div>
                    <div className="font-mono-nums font-bold text-emerald-400">
                      {formatNpr(selectedUserDetail.transferSummary.friendReceived)}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-bold text-sm mb-2">Recent Wallet Ledger</h4>
                <div className="space-y-1.5">
                  {(selectedUserDetail.ledger || []).slice(0, 15).map((l: any) => (
                    <div key={l.id} className="flex justify-between py-1 border-b border-white/5">
                      <span>{l.tx_type}</span>
                      <span className="font-mono-nums font-bold">{formatNpr(l.amount)}</span>
                      <span className="text-[#9CA3AF]">{formatNstDateShort(l.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-sm mb-2">Individual Agent &amp; Friend Transfers</h4>
                <div className="space-y-1.5">
                  {[...(selectedUserDetail.agentTransfers || []), ...(selectedUserDetail.friendTransfers || [])]
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                    .slice(0, 20)
                    .map((t: any) => (
                      <div key={`${t.transfer_type}-${t.id}`} className="flex flex-wrap justify-between gap-2 py-1.5 border-b border-white/5">
                        <span className="font-mono-nums font-bold">{t.id}</span>
                        <span className="text-[#9CA3AF]">
                          {t.transfer_type} · {t.sender_uid} → {t.receiver_uid}
                        </span>
                        <span className="font-mono-nums font-bold text-emerald-400">{formatNpr(t.amount)}</span>
                        <span className="text-[#9CA3AF]">{formatNstDateShort(t.created_at)}</span>
                      </div>
                    ))}
                  {(!selectedUserDetail.agentTransfers?.length && !selectedUserDetail.friendTransfers?.length) && (
                    <div className="text-[#9CA3AF]">No agent or friend transfers recorded for this user.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {adjustModalUser && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleWalletAdjust}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4"
          >
            <h3 className="font-display font-bold text-lg">
              Adjust Wallet · {adjustModalUser.username} ({adjustModalUser.uid})
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjDirection('CREDIT')}
                className={`min-h-[40px] rounded-xl font-bold text-xs cursor-pointer ${
                  adjDirection === 'CREDIT' ? 'bg-emerald-500 text-black' : 'bg-[#0B0D11] border border-white/10'
                }`}
              >
                CREDIT (+)
              </button>
              <button
                type="button"
                onClick={() => setAdjDirection('DEBIT')}
                className={`min-h-[40px] rounded-xl font-bold text-xs cursor-pointer ${
                  adjDirection === 'DEBIT' ? 'bg-red-500 text-white' : 'bg-[#0B0D11] border border-white/10'
                }`}
              >
                DEBIT (-)
              </button>
            </div>
            <input
              type="number"
              min={1}
              required
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              placeholder="Amount (NPR)"
              className="w-full min-h-[44px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 font-mono-nums text-sm"
            />
            <input
              type="text"
              required
              minLength={3}
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Audit reason (required)"
              className="w-full min-h-[44px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
            />
            {adjDirection === 'CREDIT' && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjCountWinnings}
                  onChange={(e) => setAdjCountWinnings(e.target.checked)}
                  className="h-4 w-4 accent-[#E6B84F]"
                />
                <span>Also add to Withdrawable Winnings</span>
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdjustModalUser(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 min-h-[42px] rounded-xl bg-[#E6B84F] text-[#0B0D11] text-xs font-extrabold cursor-pointer"
              >
                Apply Adjustment
              </button>
            </div>
          </form>
        </div>
      )}

      {banModalUser && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handlePermanentBan}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-red-500/40 p-5 space-y-4"
          >
            <div className="flex items-center gap-2 text-red-400 font-bold">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-display text-lg">Permanently Ban {banModalUser.uid}</h3>
            </div>
            <p className="text-xs text-[#D1D5DB]">
              This immediately revokes all active sessions, blocks login, and locks the account permanently.
            </p>
            <input
              type="text"
              required
              minLength={3}
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Enter permanent ban reason..."
              className="w-full min-h-[44px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBanModalUser(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold cursor-pointer"
              >
                Confirm Permanent Ban
              </button>
            </div>
          </form>
        </div>
      )}

      {inspectDeposit && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-xl max-h-[90dvh] rounded-2xl bg-[#14171F] border border-white/15 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-display font-bold text-base">
                Deposit {inspectDeposit.id} · {formatNpr(inspectDeposit.amount)}
              </h3>
              <button type="button" onClick={() => setInspectDeposit(null)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="flex justify-between">
                <span>
                  Player: <strong>{inspectDeposit.username}</strong> ({inspectDeposit.user_uid})
                </span>
                <StatusLabel value={inspectDeposit.status} />
              </div>

              {inspectDeposit.screenshotAvailable ? (
                <AuthenticatedScreenshot depositId={inspectDeposit.id} />
              ) : (
                <div className="rounded-xl bg-[#0B0D11] border border-white/10 p-6 text-center text-[#9CA3AF]">
                  Payment screenshot automatically purged 5 minutes after review.
                </div>
              )}

              {inspectDeposit.status === 'PENDING' && (
                <div className="space-y-3 pt-2 border-t border-white/10">
                  <input
                    type="text"
                    value={depAdminMsg}
                    onChange={(e) => setDepAdminMsg(e.target.value)}
                    placeholder="Admin review note / rejection reason..."
                    className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReviewDeposit('REJECT')}
                      className="flex-1 min-h-[44px] rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 font-bold cursor-pointer"
                    >
                      Reject Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewDeposit('APPROVE')}
                      className="flex-1 min-h-[44px] rounded-xl bg-emerald-500 text-black font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve &amp; Credit</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {reviewWdr && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4 text-xs">
            <h3 className="font-display font-bold text-lg">
              Review Withdrawal {reviewWdr.id} · {formatNpr(reviewWdr.amount)}
            </h3>
            <div className="rounded-xl bg-[#0B0D11] p-3 space-y-1">
              <div>Method: <strong>{reviewWdr.method}</strong></div>
              <div>Holder: <strong>{reviewWdr.account_holder_name}</strong></div>
              <div>
                Account:{' '}
                <strong className="font-mono-nums">
                  {reviewWdr.method === 'ESEWA'
                    ? reviewWdr.esewa_mobile
                    : `${reviewWdr.bank_name} · ${reviewWdr.bank_account_number} (${reviewWdr.bank_branch})`}
                </strong>
              </div>
            </div>
            <input
              type="text"
              value={wdrReviewNote}
              onChange={(e) => setWdrReviewNote(e.target.value)}
              placeholder="Admin note or rejection reason..."
              className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReviewWdr(null)}
                className="px-4 min-h-[42px] rounded-xl border border-white/15 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleReviewWithdrawal('REJECT')}
                className="flex-1 min-h-[42px] rounded-xl bg-red-500/15 text-red-300 font-bold cursor-pointer"
              >
                Reject &amp; Refund
              </button>
              <button
                type="button"
                onClick={() => handleReviewWithdrawal('APPROVE')}
                className="flex-1 min-h-[42px] rounded-xl bg-[#E6B84F] text-[#0B0D11] font-extrabold cursor-pointer"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {payModalWdr && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdatePaymentStatus}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#14171F] border border-white/15 p-5 space-y-4 text-xs"
          >
            <h3 className="font-display font-bold text-lg">
              Update Payment Status · {payModalWdr.id}
            </h3>
            <select
              value={payStatusNext}
              onChange={(e) => setPayStatusNext(e.target.value as any)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
            >
              <option value="NOT PAID">NOT PAID</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="PAID">PAID (Marks withdrawal completed)</option>
              <option value="PAYMENT FAILED">PAYMENT FAILED</option>
            </select>
            <input
              type="text"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="Transaction reference / payment note..."
              className="w-full min-h-[42px] px-3 rounded-xl bg-[#0B0D11] border border-white/10 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPayModalWdr(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 min-h-[42px] rounded-xl bg-emerald-500 text-black font-extrabold cursor-pointer"
              >
                Save Status
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
