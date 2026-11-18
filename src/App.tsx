import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthPage } from './components/AuthPage';
import { MobileGameRestrictionModal } from './components/MobileGameRestrictionModal';
import { MobileInstallPrompt } from './components/MobileInstallPrompt';
import { OfflineIndicator } from './components/OfflineIndicator';
import { UserPortal, type UserTab } from './components/UserPortal';
import { BubbleRocketX } from './games/BubbleRocketX';
import { SkylineCrash, type SkylinePublicState } from './games/SkylineCrash';
import { ThreePattiRoyale } from './games/ThreePattiRoyale';
import { usePWAInstall } from './hooks/usePWAInstall';
import { apiFetch, getStoredToken, onBannedEvent, setStoredToken } from './lib/api';
import { syncClientSeo } from './lib/seo';
import type { BannedPayload, GameInfo, MaintenanceState, NotificationItem, User, Wallet } from './types';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bannedNotice, setBannedNotice] = useState<BannedPayload | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ enabled: false, message: '' });

  const [portalTab, setPortalTab] = useState<UserTab>('home');
  const [activeGame, setActiveGame] = useState<GameInfo | null>(null);
  const [qrVersion, setQrVersion] = useState(0);
  const [adminLiveTick, setAdminLiveTick] = useState(0);
  const [liveSkyline, setLiveSkyline] = useState<SkylinePublicState | null>(null);

  const { isMobileBrowserRestricted } = usePWAInstall();
  const wsRef = useRef<WebSocket | null>(null);
  const deepLinkAppliedRef = useRef(false);

  const clearSession = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setWallet(null);
    setActiveGame(null);
    setNotifications([]);
    setUnreadCount(0);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const loadGames = useCallback(async () => {
    try {
      const res = await apiFetch<{ games: GameInfo[] }>('/api/games');
      setGames(res.games || []);
    } catch {
      // ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications');
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // ignore
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const res = await apiFetch<{ wallet: Wallet }>('/api/wallet');
      if (res.wallet) setWallet(res.wallet);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    onBannedEvent((payload) => {
      clearSession();
      setBannedNotice(payload);
    });
    return () => onBannedEvent(null);
  }, [clearSession]);

  // Initial session hydration
  useEffect(() => {
    const init = async () => {
      try {
        const sys = await apiFetch<{ maintenance?: MaintenanceState }>('/api/system/status');
        if (sys?.maintenance) setMaintenance(sys.maintenance);
      } catch {
        // ignore
      }
      const token = getStoredToken();
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const res = await apiFetch<{ user: User; wallet: Wallet }>('/api/auth/me');
        setUser(res.user);
        setWallet(res.wallet);
      } catch {
        setStoredToken(null);
      } finally {
        setBooting(false);
      }
    };
    init();
  }, []);

  // Load initial data + attach WebSocket when logged in
  useEffect(() => {
    if (!user) return;
    loadGames();
    loadNotifications();

    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const token = getStoredToken();
      if (!token || closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const { type, payload } = msg || {};
          if (type === 'wallet:updated' && payload) {
            setWallet(payload);
          } else if (type === 'notification:new') {
            loadNotifications();
            setAdminLiveTick((n) => n + 1);
          } else if (type === 'account:banned' && payload) {
            clearSession();
            setBannedNotice({
              title: payload.title || 'YOUR ACCOUNT HAS BEEN PERMANENTLY BANNED',
              message:
                payload.message ||
                'Your SW88 account has been permanently banned by the app owner. You no longer have access to this account or its platform services. If you believe this action was made by mistake, please contact official SW88 support.',
            });
          } else if (type === 'account:status' && payload?.status) {
            setUser((prev) => (prev ? { ...prev, status: payload.status } : prev));
          } else if (type === 'qr:updated') {
            setQrVersion((v) => v + 1);
          } else if (type === 'games:updated') {
            loadGames();
          } else if (type === 'skyline:state' && payload) {
            setLiveSkyline(payload);
          } else if (type === 'skyline:settled') {
            refreshWallet();
          } else if (type === 'deposit:new' || type === 'withdrawal:new') {
            setAdminLiveTick((n) => n + 1);
          } else if (type === 'system:maintenance' && payload) {
            setMaintenance({
              enabled: Boolean(payload.enabled),
              message: String(payload.message || ''),
            });
          }
        } catch {
          // ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    const onNetworkRestored = () => {
      refreshWallet();
      loadGames();
      loadNotifications();
    };
    window.addEventListener('sw88:reconnected', onNetworkRestored);

    return () => {
      closed = true;
      window.removeEventListener('sw88:reconnected', onNetworkRestored);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user?.id, clearSession, loadGames, loadNotifications, refreshWallet]);

  // Apply shareable deep link (/play/<gameId> or /?game=<gameId>) once user & games load
  useEffect(() => {
    if (!user || user.role === 'ADMIN' || games.length === 0 || deepLinkAppliedRef.current) return;
    deepLinkAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const queryGame = params.get('game')?.trim().toLowerCase();
    const pathMatch = window.location.pathname.toLowerCase().match(/^\/(?:play|game|games)\/([a-z0-9-]+)\/?$/);
    const requestedGameId = queryGame || pathMatch?.[1] || '';
    if (requestedGameId) {
      const target = games.find((g) => g.id === requestedGameId);
      if (target && !maintenance.enabled) {
        setActiveGame(target);
      }
    }
  }, [games, maintenance.enabled, user]);

  // Sync dynamic Open Graph / SEO tags as user navigates
  useEffect(() => {
    if (activeGame) {
      const ogImageMap: Record<string, string> = {
        '3-patti-royale': '/og-3patti.jpg',
        'bubble-rocket-x': '/og-bubble.jpg',
        'skyline-crash': '/og-skyline.jpg',
      };
      syncClientSeo({
        title: `${activeGame.name} on SW88 — Live Mobile Gaming`,
        description: activeGame.description,
        path: `/play/${activeGame.id}`,
        imagePath: ogImageMap[activeGame.id] || '/og-preview.png',
      });
    } else if (portalTab === 'wallet') {
      syncClientSeo({
        title: 'SW88 Wallet — Instant Deposits, Withdrawals & Transfers',
        description: 'Manage your unified SW88 wallet balance, QR deposits, withdrawals, and instant transfers.',
        path: '/wallet',
        imagePath: '/og-preview.png',
      });
    } else {
      syncClientSeo({
        title: 'SW88 — Live Royale Cards, Crash & Arcade Gaming',
        description:
          'Play 3 Patti Royale, Bubble Rocket X, and Skyline Crash on SW88 with instant centralized wallet & standalone mobile app.',
        path: '/',
        imagePath: '/og-preview.png',
      });
    }
  }, [activeGame, portalTab]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    clearSession();
  };

  const renderContent = () => {
    if (booting) {
      return (
        <div className="min-h-dvh bg-[#0B0D11] text-[#F5F7FA] flex flex-col items-center justify-center gap-3 px-4 text-center">
          <div className="font-display font-extrabold text-3xl tracking-tight">
            SW<span className="text-[#E6B84F]">88</span>
          </div>
          <div className="text-xs text-[#9CA3AF]">Connecting to secure wallet &amp; game engine...</div>
        </div>
      );
    }

    if (!user || !wallet) {
      return (
        <AuthPage
          bannedNotice={bannedNotice}
          onDismissBanned={() => setBannedNotice(null)}
          onSuccess={({ user: nextUser, wallet: nextWallet }) => {
            setBannedNotice(null);
            setUser(nextUser);
            setWallet(nextWallet);
            setPortalTab('home');
            setActiveGame(null);
          }}
        />
      );
    }

    if (user.role === 'ADMIN') {
      return (
        <AdminDashboard
          user={user}
          liveTickVersion={adminLiveTick}
          onUserUpdate={setUser}
          onLogout={handleLogout}
        />
      );
    }

    if (activeGame) {
      const goDeposit = () => {
        setActiveGame(null);
        setPortalTab('wallet');
      };
      const exitGame = () => {
        setActiveGame(null);
        refreshWallet();
      };

      // Update #3: On mobile devices, game-playing is accessible ONLY through the installed SW88 app
      if (isMobileBrowserRestricted) {
        return <MobileGameRestrictionModal asPage game={activeGame} onClose={exitGame} />;
      }

      if (activeGame.id === '3-patti-royale') {
        return (
          <ThreePattiRoyale
            game={activeGame}
            wallet={wallet}
            onWalletSync={setWallet}
            onExit={exitGame}
            onGoDeposit={goDeposit}
          />
        );
      }
      if (activeGame.id === 'bubble-rocket-x') {
        return (
          <BubbleRocketX
            game={activeGame}
            wallet={wallet}
            onWalletSync={setWallet}
            onExit={exitGame}
            onGoDeposit={goDeposit}
          />
        );
      }
      if (activeGame.id === 'skyline-crash') {
        return (
          <SkylineCrash
            game={activeGame}
            wallet={wallet}
            liveSkyline={liveSkyline}
            onWalletSync={setWallet}
            onExit={exitGame}
            onGoDeposit={goDeposit}
          />
        );
      }
    }

    return (
      <UserPortal
        user={user}
        wallet={wallet}
        games={games}
        notifications={notifications}
        unreadCount={unreadCount}
        qrVersion={qrVersion}
        maintenance={maintenance}
        activeTab={portalTab}
        onTabChange={setPortalTab}
        onLaunchGame={(g) => {
          if (maintenance.enabled) return;
          setActiveGame(g);
        }}
        onUserUpdate={setUser}
        onWalletSync={setWallet}
        onNotificationsRefresh={loadNotifications}
        onLogout={handleLogout}
      />
    );
  };

  return (
    <>
      {renderContent()}
      <MobileInstallPrompt />
      <OfflineIndicator activeGame={activeGame} />
    </>
  );
}
