import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthPage } from './components/AuthPage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { UserPortal, type UserTab } from './components/UserPortal';
import { BubbleRocketX } from './games/BubbleRocketX';
import { SkylineCrash, type SkylinePublicState } from './games/SkylineCrash';
import { ThreePattiRoyale } from './games/ThreePattiRoyale';
import { apiFetch, getStoredToken, onBannedEvent, setStoredToken } from './lib/api';
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

  const wsRef = useRef<WebSocket | null>(null);

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

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user?.id, clearSession, loadGames, loadNotifications, refreshWallet]);

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
      <OfflineIndicator />
    </>
  );
}
