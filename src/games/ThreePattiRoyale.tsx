import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, Wallet as WalletIcon } from 'lucide-react';
import { apiFetch, formatRs } from '../lib/api';
import type { GameInfo, Wallet } from '../types';
import { PATTI_NOTES } from './pattiNotes';

interface Card {
  r: number;
  s: number;
}

interface PattiPlayer {
  name: string;
  bal: number;
  h: boolean;
  persName: string | null;
  col: string;
  seen: boolean;
  packed: boolean;
  won: boolean;
  shown: boolean;
  paid: number;
  cards: Card[] | null;
  handEval: { t: number; top: number; score: number; name: string } | null;
}

interface PattiState {
  roundId: string;
  tableId?: string;
  boot: number;
  blindMax: number;
  pot: number;
  stake: number;
  turn: number;
  phase: 'play' | 'end';
  reveal: boolean;
  winnerIdx: number | null;
  winHandName: string | null;
  logs: string[];
  players: PattiPlayer[];
}

interface ThreePattiProps {
  game: GameInfo;
  wallet: Wallet;
  onWalletSync: (w: Wallet) => void;
  onExit: () => void;
  onGoDeposit: () => void;
}

function cardStr(c: Card) {
  const R: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return (R[c.r] || String(c.r)) + '♠♥♦♣'[c.s];
}

function noteDenominations(amount: number, maxCount = 8): number[] {
  const out: number[] = [];
  let rem = Math.floor(amount);
  for (const d of [100, 50, 20, 5]) {
    while (rem >= d && out.length < maxCount) {
      out.push(d);
      rem -= d;
    }
  }
  return out;
}

export function ThreePattiRoyale({ game, wallet, onWalletSync, onExit, onGoDeposit }: ThreePattiProps) {
  const [state, setState] = useState<PattiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [tl, setTl] = useState(10);
  const [endCountdown, setEndCountdown] = useState<number | null>(null);
  const [sayBanner, setSayBanner] = useState<{
    icon: string;
    name: string;
    tag: string;
    detail: string;
    amt?: string;
    kind: string;
  } | null>(null);
  const [bigNote, setBigNote] = useState<string | null>(null);
  const [winRain, setWinRain] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);

  // Real Matchmaking & Connection State
  const [mmPhase, setMmPhase] = useState<{
    active: boolean;
    step: number; // 1..6
    statusText: string;
    subText: string;
    retrying: boolean;
    errorKind: 'none' | 'balance' | 'server' | 'maintenance';
    errorMessage: string | null;
  }>({
    active: true,
    step: 1,
    statusText: 'Finding available tables...',
    subText: 'Checking SW88 3 Patti table availability',
    retrying: false,
    errorKind: 'none',
    errorMessage: null,
  });

  const acRef = useRef<AudioContext | null>(null);
  const potRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const stateRef = useRef<PattiState | null>(null);
  const mountedRef = useRef(true);
  stateRef.current = state;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beep = useCallback(
    (f: number, d = 0.08, t: OscillatorType = 'sine', v = 0.06) => {
      if (!sound) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        acRef.current = acRef.current || new AC();
        const ac = acRef.current;
        if (ac.state === 'suspended') ac.resume();
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = t;
        o.frequency.value = f;
        g.gain.value = v;
        o.connect(g);
        g.connect(ac.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
        o.stop(ac.currentTime + d);
      } catch {
        // ignore audio errors
      }
    },
    [sound]
  );

  const chime = useCallback(() => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.08), i * 110));
  }, [beep]);

  const parseSayBanner = useCallback((msg: string) => {
    if (!msg) return;
    const clean = msg.replace(/^\u{1F3C6}\s*/u, '');
    const m = clean.match(
      /^(.+?) (looked at their cards|doubled|raised|played|asked for a SHOW|packed|ran out of time|wins)(.*)$/
    );
    if (!m) return;
    const n = m[1];
    const verb = m[2];
    const rest = m[3];
    const map: Record<string, [string, string, string, string?]> = {
      'looked at their cards': ['👁', 'SEEN', 'sn', 'looked at their cards'],
      doubled: ['⏫', 'DOUBLED', 'dbl'],
      raised: ['⏫', 'DOUBLED', 'dbl'],
      played: ['🪙', 'PLAYED', ''],
      'asked for a SHOW': ['🎴', 'SHOW', 'sh'],
      packed: ['🚫', 'PACKED', 'pk'],
      'ran out of time': ['⏱', 'TIME UP', 'pk', 'auto packed'],
      wins: ['🏆', 'WINS', 'sn'],
    };
    const M = map[verb];
    if (!M) return;
    const amtMatch = rest.match(/Rs ?(\d+)/);
    const detail =
      M[3] ||
      rest
        .replace(/\(?Rs ?\d+\)?/, '')
        .replace(/[()]/g, '')
        .replace(/^[\s—·]+|[\s·]+$/g, '')
        .trim();
    setSayBanner({
      icon: M[0],
      name: n,
      tag: M[1],
      detail,
      amt: amtMatch ? amtMatch[1] : undefined,
      kind: M[2],
    });
  }, []);

  const flyNotesAnim = useCallback((seatIdx: number, amt: number) => {
    const seatEl = seatRefs.current[seatIdx];
    const potEl = potRef.current;
    if (!seatEl || !potEl) return;
    const A = seatEl.getBoundingClientRect();
    const B = potEl.getBoundingClientRect();
    const x0 = A.left + A.width / 2;
    const y0 = A.top + A.height / 2;
    const dx = B.left + B.width / 2 - x0;
    const dy = B.top + B.height / 2 - y0;
    const width = window.innerWidth < 600 ? 64 : 86;
    const notes = noteDenominations(amt, 3);
    notes.forEach((d, k) => {
      const img = document.createElement('img');
      img.src = PATTI_NOTES[d];
      img.alt = `Rs ${d}`;
      img.style.position = 'fixed';
      img.style.left = `${x0 - width / 2}px`;
      img.style.top = `${y0 - width / 4}px`;
      img.style.width = `${width}px`;
      img.style.zIndex = '60';
      img.style.pointerEvents = 'none';
      img.style.borderRadius = '4px';
      img.style.boxShadow = '0 4px 10px rgba(0,0,0,0.6)';
      document.body.appendChild(img);
      img
        .animate(
          [
            { transform: 'translate(0,0) rotate(0deg) scale(.8)', opacity: 1 },
            {
              transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 40 - 20}deg) scale(1)`,
              opacity: 0.95,
            },
          ],
          { duration: 600, delay: k * 90, easing: 'ease-out', fill: 'both' }
        )
        .finished.then(() => img.remove())
        .catch(() => img.remove());
    });
  }, []);

  const startRound = useCallback(
    async (forfeitPrevious = false, newTable = false) => {
      setBusy(true);
      setBigNote(null);
      setWinRain(null);
      setEndCountdown(null);
      setSayBanner(null);
      try {
        const res = await apiFetch<{ state: PattiState; wallet: Wallet }>('/api/games/3patti/start', {
          method: 'POST',
          body: JSON.stringify({
            forfeitPrevious,
            newTable,
            idempotencyKey: `3p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          }),
        });
        if (!mountedRef.current) return null;
        setState(res.state);
        onWalletSync(res.wallet);
        setTl(10);
        beep(300, 0.1, 'square');
        return res;
      } catch (err: any) {
        if (!mountedRef.current) return null;
        setBigNote(err?.message || 'Unable to start round. Please top up your SW88 wallet.');
        throw err;
      } finally {
        if (mountedRef.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [beep, onWalletSync]
  );

  const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runMatchmaking = useCallback(
    async (forceNewTable = false, attempt = 0): Promise<void> => {
      setLoading(true);
      setBigNote(null);
      setWinRain(null);
      setEndCountdown(null);
      setSayBanner(null);

      try {
        // Stage 1: Finding available tables... (real health probe)
        setMmPhase({
          active: true,
          step: 1,
          statusText: 'Finding available tables...',
          subText: forceNewTable ? 'Locating a new live Teen Patti table' : 'Scanning active SW88 tables',
          retrying: attempt > 0,
          errorKind: 'none',
          errorMessage: null,
        });
        await apiFetch('/api/health');
        if (!mountedRef.current) return;
        await waitMs(220);

        // Stage 2: Searching for players... (real matchmaking check)
        setMmPhase({
          active: true,
          step: 2,
          statusText: 'Searching for players...',
          subText: 'Matching table seats and stake limits',
          retrying: attempt > 0,
          errorKind: 'none',
          errorMessage: null,
        });
        const mmInfo = await apiFetch<{
          ok: boolean;
          tableReady: boolean;
          boot: number;
          hasActiveRound: boolean;
          walletBalance: number;
        }>('/api/games/3patti/matchmaking');
        if (!mountedRef.current) return;
        await waitMs(220);

        // Stage 3: Connecting to game server...
        setMmPhase({
          active: true,
          step: 3,
          statusText: 'Connecting to game server...',
          subText: `Boot stake Rs ${mmInfo.boot} verified`,
          retrying: attempt > 0,
          errorKind: 'none',
          errorMessage: null,
        });
        if (!mmInfo.tableReady) {
          throw new Error('Server is currently busy.');
        }
        await waitMs(200);

        // Stage 4: Synchronizing player information... (active round & live wallet)
        setMmPhase({
          active: true,
          step: 4,
          statusText: 'Synchronizing player information...',
          subText: 'Syncing wallet balance & table roster',
          retrying: attempt > 0,
          errorKind: 'none',
          errorMessage: null,
        });
        const [activeRes, walletRes] = await Promise.all([
          apiFetch<{ active: boolean; state?: PattiState; wallet?: Wallet }>('/api/games/3patti/active'),
          apiFetch<{ wallet: Wallet }>('/api/wallet'),
        ]);
        if (!mountedRef.current) return;
        if (walletRes?.wallet) onWalletSync(walletRes.wallet);
        await waitMs(220);

        // Stage 5: Preparing game room...
        setMmPhase({
          active: true,
          step: 5,
          statusText: 'Preparing game room...',
          subText: activeRes.active && !forceNewTable ? 'Restoring your active table session' : 'Shuffling deck & dealing cards',
          retrying: attempt > 0,
          errorKind: 'none',
          errorMessage: null,
        });

        if (activeRes.active && activeRes.state && !forceNewTable) {
          setState(activeRes.state);
          if (activeRes.wallet) onWalletSync(activeRes.wallet);
          setTl(10);
        } else {
          await startRound(forceNewTable, forceNewTable);
        }
        if (!mountedRef.current) return;

        // Stage 6: Successfully joined the game!
        setMmPhase({
          active: true,
          step: 6,
          statusText: 'Successfully joined the game!',
          subText: 'Entering live table...',
          retrying: false,
          errorKind: 'none',
          errorMessage: null,
        });
        await waitMs(380);
        if (!mountedRef.current) return;
        setMmPhase((prev) => ({ ...prev, active: false }));
        setLoading(false);
      } catch (err: any) {
        if (!mountedRef.current) return;
        const status = err?.status || 0;
        const code = err?.code || '';
        const msg = err?.message || 'Unable to connect to game server.';

        // Deterministic errors: Insufficient balance, Maintenance Mode, or Game disabled
        if (code === 'MAINTENANCE_MODE' || status === 503) {
          setMmPhase({
            active: true,
            step: 3,
            statusText: 'Server is currently unavailable',
            subText: 'Platform maintenance in progress',
            retrying: false,
            errorKind: 'maintenance',
            errorMessage: msg,
          });
          setLoading(false);
          return;
        }
        if (code === 'INSUFFICIENT_BALANCE' || status === 400 || status === 403) {
          setBigNote(msg);
          setMmPhase({
            active: true,
            step: 2,
            statusText: 'Unable to join table',
            subText: msg,
            retrying: false,
            errorKind: 'balance',
            errorMessage: msg,
          });
          setLoading(false);
          return;
        }

        // Genuine server/network unavailability -> display real retry status progression
        if (attempt < 2) {
          const retryMessages = [
            ['Unable to find an available room.', 'Searching for another game server...'],
            ['Server is currently busy.', 'Reconnecting to game server...'],
          ];
          const [t1, t2] = retryMessages[attempt] || retryMessages[0];
          setMmPhase({
            active: true,
            step: 3,
            statusText: t1,
            subText: t2,
            retrying: true,
            errorKind: 'server',
            errorMessage: msg,
          });
          await waitMs(1000);
          if (!mountedRef.current) return;
          setMmPhase((prev) => ({
            ...prev,
            statusText: 'Retrying connection...',
            subText: `Attempt ${attempt + 2} of 3`,
          }));
          await waitMs(700);
          if (!mountedRef.current) return;
          return runMatchmaking(forceNewTable, attempt + 1);
        }

        setMmPhase({
          active: true,
          step: 3,
          statusText: 'Unable to find an available room.',
          subText: 'Server is currently busy or unreachable.',
          retrying: false,
          errorKind: 'server',
          errorMessage: msg,
        });
        setLoading(false);
      }
    },
    [onWalletSync, startRound]
  );

  // Run genuine matchmaking on mount
  useEffect(() => {
    runMatchmaking(false, 0);
  }, []);

  const runAction = useCallback(
    async (action: 'see' | 'bet' | 'double' | 'pack' | 'show' | 'timeout-pack' | 'ai-turn') => {
      const cur = stateRef.current;
      if (!cur || cur.phase !== 'play') return;
      if (action !== 'ai-turn' && busy) return;
      setBusy(true);
      try {
        const res = await apiFetch<{
          state: PattiState;
          wallet: Wallet;
          eventMsg?: string;
          actorIdx?: number;
          paidAmount?: number;
        }>('/api/games/3patti/action', {
          method: 'POST',
          body: JSON.stringify({
            roundId: cur.roundId,
            action,
            actionId: `${cur.roundId}-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          }),
        });

        setState(res.state);
        onWalletSync(res.wallet);
        setTl(10);

        if (res.eventMsg) {
          parseSayBanner(res.eventMsg);
        }
        if (res.paidAmount && res.paidAmount > 0) {
          beep(700, 0.05, 'square', 0.04);
          flyNotesAnim(res.actorIdx ?? 0, res.paidAmount);
        }
        if (action === 'see') {
          beep(500, 0.12, 'triangle');
        }
        if (action === 'pack' || action === 'timeout-pack') {
          beep(200, 0.2, 'sawtooth', 0.04);
        }

        if (res.state.phase === 'end') {
          const wIdx = res.state.winnerIdx ?? 0;
          const winner = res.state.players[wIdx];
          if (winner?.h) {
            chime();
            const potWon = res.state.logs[0]?.match(/Rs (\d+)/)?.[1];
            setWinRain(Number(potWon || 0));
          } else {
            beep(220, 0.3, 'sawtooth', 0.05);
          }
          setEndCountdown(5);
        }
      } catch (err: any) {
        setBigNote(err?.message || 'Action failed.');
      } finally {
        setBusy(false);
      }
    },
    [beep, busy, chime, flyNotesAnim, onWalletSync, parseSayBanner]
  );

  // Turn countdown timer & AI turn scheduler
  useEffect(() => {
    if (!state || state.phase !== 'play') return;

    const timerId = setInterval(() => {
      setTl((prev) => {
        if (prev <= 1) {
          if (state.turn === 0 && !state.players[0]?.packed) {
            runAction('timeout-pack');
          }
          return 0;
        }
        if (prev <= 6 && state.turn === 0 && !state.players[0]?.packed) {
          beep(prev <= 3 ? 1300 : 950, 0.08, 'square', 0.05);
        }
        return prev - 1;
      });
    }, 1000);

    let aiTimeout: ReturnType<typeof setTimeout> | null = null;
    if (state.turn !== 0) {
      const thinkMs = 1100 + Math.floor(Math.random() * 1400);
      aiTimeout = setTimeout(() => {
        runAction('ai-turn');
      }, thinkMs);
    }

    return () => {
      clearInterval(timerId);
      if (aiTimeout) clearTimeout(aiTimeout);
    };
  }, [state?.roundId, state?.phase, state?.turn, state?.players[0]?.seen, state?.players[0]?.packed]);

  // End-of-round 5-second auto next round on the same table
  useEffect(() => {
    if (endCountdown === null) return;
    if (endCountdown <= 0) {
      startRound(false, false).catch(() => {});
      return;
    }
    const id = setTimeout(() => setEndCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(id);
  }, [endCountdown, startRound]);

  const handleExit = async () => {
    if (state && state.phase === 'play') {
      try {
        const res = await apiFetch<{ wallet: Wallet }>('/api/games/3patti/forfeit', { method: 'POST' });
        if (res.wallet) onWalletSync(res.wallet);
      } catch {
        // ignore
      }
    }
    onExit();
  };

  const me = state?.players[0];
  const myTurn = Boolean(state && state.phase === 'play' && state.turn === 0 && !me?.packed);
  const activeCount = state ? state.players.filter((p) => !p.packed).length : 0;
  const activeOther = state ? state.players.find((p) => !p.packed && !p.h) : undefined;
  const c1 = state && me ? (me.seen ? 2 : 1) * state.stake : game.minStake;
  const c2 = c1 * 2;
  const canBet = myTurn && wallet.mainBalance >= c1 && (me?.seen || state!.stake <= state!.blindMax);
  const canRaise =
    myTurn &&
    (me?.seen || state!.stake * 2 <= state!.blindMax) &&
    wallet.mainBalance >= c2 &&
    Boolean(state?.players.filter((p) => !p.packed).every((q) => q.h || (q.seen ? 2 : 1) * (state!.stake * 2) <= q.bal));
  const canSee = Boolean(state && state.phase === 'play' && me && !me.seen && !me.packed);
  const canShow =
    myTurn &&
    wallet.mainBalance >= c1 &&
    !(me?.seen && (activeCount !== 2 || (!activeOther?.seen && state!.pot <= 1000)));

  const lowBalance = wallet.mainBalance < (state?.phase === 'play' && myTurn ? c1 : game.minStake);

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_50%_0,#2a1a12,#0d0a08)] text-[#f6efe0] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Header matching 3 Patti Royale */}
      <header className="max-w-4xl w-full mx-auto px-2.5 sm:px-3 py-2 sm:py-2.5 flex items-center justify-between gap-1.5 sm:gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleExit}
            className="min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3 rounded-lg bg-[#1a1411] border border-[#4a3a2c] text-xs font-semibold text-[#f6efe0] hover:border-[#e6b84f] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="sm:hidden">Home</span>
            <span className="hidden sm:inline">SW88 Home</span>
          </button>
          <h1 className="font-serif font-bold text-sm sm:text-xl text-[#e6b84f] tracking-wide sm:tracking-wider whitespace-nowrap">
            ♠ 3 PATTI <span className="hidden xs:inline">ROYALE</span> ♥
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
          <div className="flex items-center gap-1.5 sm:gap-2 bg-black/65 border-2 border-[#e6b84f] rounded-xl px-2.5 sm:px-3 py-1 shadow-[0_0_14px_rgba(230,184,79,0.28)]">
            <span className="text-[10px] tracking-[0.15em] text-[#a99f8c] font-bold hidden sm:inline">BALANCE</span>
            <b className="font-mono-nums text-sm sm:text-xl font-black text-[#e6b84f]">
              {formatRs(wallet.mainBalance)}
            </b>
          </div>
          {lowBalance && (
            <button
              type="button"
              onClick={onGoDeposit}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-[#e6b84f] text-[#2b1a06] text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer"
            >
              <WalletIcon className="w-3.5 h-3.5" />
              <span>Deposit</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSound((s) => !s)}
            className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-2.5 rounded-lg bg-[#1a1411] border border-[#4a3a2c] text-[#f6efe0] cursor-pointer"
            aria-label="Toggle sound"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-2.5 rounded-lg bg-[#1a1411] border border-[#4a3a2c] text-[11px] sm:text-xs font-semibold cursor-pointer"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => runMatchmaking(true, 0)}
            disabled={busy || loading}
            className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-[#1a1411] border border-[#4a3a2c] text-[11px] sm:text-xs font-semibold hover:border-[#e6b84f] disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            New Table
          </button>
        </div>
      </header>

      {/* Main Felt Table */}
      <main className="flex-1 max-w-[600px] w-full mx-auto px-2 pb-3 flex flex-col gap-2.5 sm:gap-3">
        <div className="flex-1 bg-[radial-gradient(ellipse_at_center,#0f5a38,#0a3d27)] border-[5px] sm:border-[8px] border-[#3b2415] rounded-[22px] sm:rounded-[36px] shadow-[inset_0_0_60px_rgba(0,0,0,0.55),0_10px_30px_rgba(0,0,0,0.65)] p-2 sm:p-4 flex flex-col justify-between gap-2 sm:gap-2.5 relative min-h-[450px] sm:min-h-[540px] select-none">
          {mmPhase.active || loading || !state ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center p-5">
              {mmPhase.errorKind === 'none' || mmPhase.retrying ? (
                <>
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <div
                      className={`w-16 h-16 rounded-full border-4 ${
                        mmPhase.step === 6
                          ? 'border-emerald-400 bg-emerald-500/20'
                          : mmPhase.retrying
                          ? 'border-[#5a4636] border-t-amber-400 animate-spin'
                          : 'border-[#4a3a2c] border-t-[#e6b84f] animate-spin'
                      }`}
                    />
                    <span className="absolute font-mono-nums font-extrabold text-sm text-[#e6b84f]">
                      {mmPhase.step === 6 ? '✓' : `${mmPhase.step}/6`}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div
                      className={`font-display font-extrabold text-base sm:text-lg ${
                        mmPhase.step === 6 ? 'text-emerald-300' : 'text-[#e6b84f]'
                      }`}
                    >
                      {mmPhase.statusText}
                    </div>
                    <p className="text-xs text-[#f6efe0]/75">{mmPhase.subText}</p>
                  </div>

                  {/* 6-step progress pipeline */}
                  <div className="w-full max-w-xs space-y-2 text-left bg-black/35 border border-white/10 rounded-2xl p-3.5">
                    {[
                      'Finding available tables...',
                      'Searching for players...',
                      'Connecting to game server...',
                      'Synchronizing player information...',
                      'Preparing game room...',
                      'Successfully joined the game!',
                    ].map((label, idx) => {
                      const stepNo = idx + 1;
                      const done = mmPhase.step > stepNo || mmPhase.step === 6;
                      const current = mmPhase.step === stepNo && mmPhase.step !== 6;
                      return (
                        <div key={label} className="flex items-center gap-2.5 text-xs">
                          <span
                            className={`w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold shrink-0 ${
                              done
                                ? 'bg-emerald-500 text-black'
                                : current
                                ? 'bg-[#e6b84f] text-[#2b1a06] animate-pulse'
                                : 'bg-white/10 text-white/40'
                            }`}
                          >
                            {done ? '✓' : stepNo}
                          </span>
                          <span
                            className={
                              done
                                ? 'text-emerald-300 font-semibold'
                                : current
                                ? 'text-white font-bold'
                                : 'text-white/45'
                            }
                          >
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 max-w-sm">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-400/40 grid place-items-center text-red-300 font-bold text-lg">
                    !
                  </div>
                  <div className="space-y-1">
                    <div className="text-lg font-bold text-white">{mmPhase.statusText}</div>
                    <p className="text-xs text-[#f6efe0]/80 leading-relaxed">
                      {mmPhase.errorMessage || bigNote || `Minimum boot stake is Rs ${game.minStake}.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {mmPhase.errorKind === 'balance' && (
                      <button
                        type="button"
                        onClick={onGoDeposit}
                        className="min-h-[44px] px-5 rounded-xl bg-[#e6b84f] text-[#2b1a06] font-extrabold text-sm cursor-pointer"
                      >
                        Deposit Funds
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runMatchmaking(false, 0)}
                      className="min-h-[44px] px-5 rounded-xl bg-[#2d2420] border border-[#5a4636] text-sm font-semibold cursor-pointer"
                    >
                      Retry Connection
                    </button>
                    <button
                      type="button"
                      onClick={onExit}
                      className="min-h-[44px] px-4 rounded-xl bg-black/40 border border-white/15 text-xs font-semibold cursor-pointer"
                    >
                      Back to Lobby
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Opponent Seats */}
              <div className="grid grid-cols-2 gap-2">
                {state.players.slice(1).map((p, idx) => {
                  const seatIdx = idx + 1;
                  const isTurn = state.phase === 'play' && state.turn === seatIdx;
                  const stLabel = p.packed ? 'Packed' : p.seen ? 'Seen' : 'Blind';
                  return (
                    <div
                      key={p.name + seatIdx}
                      ref={(el) => {
                        seatRefs.current[seatIdx] = el;
                      }}
                      className={`relative rounded-2xl p-2 text-center transition border-2 ${
                        p.packed
                          ? 'opacity-45 bg-black/40 border-transparent'
                          : p.seen
                          ? 'bg-[#f5c518] text-[#1b1300]'
                          : 'bg-white text-[#111]'
                      } ${isTurn ? 'border-[#e6b84f] shadow-[0_0_18px_rgba(230,184,79,0.55)]' : 'border-transparent'} ${
                        p.won ? 'ring-3 ring-[#e6b84f]' : ''
                      }`}
                    >
                      {isTurn && (
                        <div
                          className={`absolute top-1.5 right-1.5 w-9 h-9 rounded-full grid place-items-center bg-black/80 ${
                            tl <= 5 ? 'text-white bg-[#3a0d10]' : 'text-[#e6b84f]'
                          }`}
                        >
                          <svg viewBox="0 0 46 46" className="absolute inset-0 w-full h-full -rotate-90">
                            <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                            <circle
                              cx="23"
                              cy="23"
                              r="19"
                              fill="none"
                              stroke={tl <= 5 ? '#ff5a5a' : '#e6b84f'}
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeDasharray="119.4"
                              style={{ animation: 'sw88Ring 10s linear forwards', animationDelay: `-${10 - tl}s` }}
                            />
                          </svg>
                          <span className="relative font-black text-xs tabular-nums">{tl}</span>
                        </div>
                      )}
                      <div
                        className="w-9 h-9 rounded-full mx-auto mb-1 grid place-items-center font-bold text-sm text-white border-2 border-[#e6b84f]"
                        style={{ backgroundColor: p.col }}
                      >
                        {p.name[0]}
                      </div>
                      <div className="text-xs font-bold truncate">{p.name}</div>
                      <div
                        className={`text-[11px] font-black tracking-wider uppercase ${
                          p.packed ? 'text-[#ff7a7a]' : p.seen ? 'text-[#7a5a00]' : 'text-[#2563eb]'
                        }`}
                      >
                        {stLabel}
                        {isTurn ? ' · thinking…' : ''}
                      </div>
                      <div className="flex justify-center gap-1 my-1">
                        {(p.cards || [null, null, null]).map((c, ci) =>
                          c ? (
                            <div
                              key={ci}
                              className={`w-8 sm:w-12 h-11 sm:h-16 rounded-md bg-[#fffdf6] grid place-items-center font-serif font-bold text-[11px] sm:text-base shadow ${
                                c.s === 1 || c.s === 2 ? 'text-[#d9363e]' : 'text-[#111]'
                              } ${p.won && state.reveal ? 'animate-[sw88Glow_0.5s_ease-in-out_6]' : ''}`}
                            >
                              {cardStr(c)}
                            </div>
                          ) : (
                            <div
                              key={ci}
                              className="w-8 sm:w-12 h-11 sm:h-16 rounded-md border-2 border-[#f1e3c0] bg-[repeating-linear-gradient(45deg,#7a1020,#7a1020_5px,#5a0a16_5px,#5a0a16_10px)] shadow"
                            />
                          )
                        )}
                      </div>
                      <div className="text-[11px] font-semibold opacity-80 font-mono-nums">
                        Rs {p.bal} · in {p.paid}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Center Pot & Action Banner */}
              <div className="flex flex-col items-center justify-center text-center py-1">
                <div ref={potRef} className="font-sans">
                  <div className="text-xs tracking-[0.18em] text-[#f6efe0]/75 font-bold">POT</div>
                  <b className="block text-3xl sm:text-4xl font-black text-[#e6b84f] drop-shadow-[0_2px_8px_#000] tabular-nums">
                    {formatRs(state.pot)}
                  </b>
                  <div className="flex justify-center items-center min-h-[48px] mt-1.5">
                    {noteDenominations(state.pot, 8).map((d, k) => (
                      <img
                        key={k}
                        src={PATTI_NOTES[d]}
                        alt={`Rs ${d}`}
                        className="w-16 sm:w-24 rounded shadow-[0_3px_9px_rgba(0,0,0,0.75)] -ml-10 first:ml-0"
                        style={{ transform: `rotate(${((k * 37) % 11) - 5}deg)` }}
                      />
                    ))}
                  </div>
                </div>

                {sayBanner && (
                  <div className="mt-2 max-w-[95%] flex justify-center">
                    <div
                      className={`flex items-center gap-2.5 bg-[#120d0a]/95 border border-[#5a4636] border-l-[5px] rounded-xl px-3.5 py-1.5 shadow-xl text-left ${
                        sayBanner.kind === 'dbl'
                          ? 'border-l-[#ff6b3d]'
                          : sayBanner.kind === 'pk'
                          ? 'border-l-[#8a8a8a]'
                          : sayBanner.kind === 'sn'
                          ? 'border-l-[#4cf08a]'
                          : sayBanner.kind === 'sh'
                          ? 'border-l-white'
                          : 'border-l-[#e6b84f]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-[#e6b84f]/20 grid place-items-center text-base shrink-0">
                        {sayBanner.icon}
                      </div>
                      <div>
                        <b className="block text-xs sm:text-sm text-white leading-tight">{sayBanner.name}</b>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-[#e6b84f]">
                          {sayBanner.tag}
                          {sayBanner.detail ? ` · ${sayBanner.detail}` : ''}
                        </span>
                      </div>
                      {sayBanner.amt && <div className="ml-2 font-black text-sm text-[#e6b84f]">Rs {sayBanner.amt}</div>}
                    </div>
                  </div>
                )}

                <div className="text-xs sm:text-sm font-semibold text-white min-h-[20px] mt-1.5">
                  {state.phase === 'end'
                    ? `${state.players[state.winnerIdx ?? 0]?.h ? 'You win' : `${state.players[state.winnerIdx ?? 0]?.name} wins`}!${
                        state.winHandName ? ` — ${state.winHandName}` : ''
                      }`
                    : myTurn
                    ? wallet.mainBalance < c1
                      ? 'Insufficient wallet balance to bet — please deposit or pack.'
                      : me?.seen
                      ? 'Your turn — you can see your cards'
                      : 'Your turn — playing blind'
                    : `${state.players[state.turn]?.name}'s turn…`}
                </div>
              </div>

              {/* Human Seat */}
              {me && (
                <div
                  ref={(el) => {
                    seatRefs.current[0] = el;
                  }}
                  className={`relative rounded-2xl p-2.5 text-center transition border-2 ${
                    me.packed
                      ? 'opacity-50 bg-black/45 border-transparent'
                      : me.seen
                      ? 'bg-[#f5c518] text-[#1b1300]'
                      : 'bg-white text-[#111]'
                  } ${myTurn ? 'border-[#2ee66b] shadow-[0_0_16px_rgba(46,230,107,0.75)]' : 'border-transparent'} ${
                    me.won ? 'ring-3 ring-[#e6b84f]' : ''
                  }`}
                >
                  {myTurn && (
                    <div
                      className={`absolute top-2 right-2 w-10 h-10 rounded-full grid place-items-center bg-black/85 ${
                        tl <= 5 ? 'text-white bg-[#3a0d10]' : 'text-[#e6b84f]'
                      }`}
                    >
                      <svg viewBox="0 0 46 46" className="absolute inset-0 w-full h-full -rotate-90">
                        <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                        <circle
                          cx="23"
                          cy="23"
                          r="19"
                          fill="none"
                          stroke={tl <= 5 ? '#ff5a5a' : '#e6b84f'}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray="119.4"
                          style={{ animation: 'sw88Ring 10s linear forwards', animationDelay: `-${10 - tl}s` }}
                        />
                      </svg>
                      <span className="relative font-black text-sm tabular-nums">{tl}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-xs font-extrabold">{me.name} (You)</span>
                    <span
                      className={`text-[11px] font-black uppercase tracking-wider ${
                        me.packed ? 'text-[#d9363e]' : me.seen ? 'text-[#7a5a00]' : 'text-[#2563eb]'
                      }`}
                    >
                      · {me.packed ? 'Packed' : me.seen ? 'Seen' : 'Blind'}
                      {me.handEval ? ` (${me.handEval.name})` : ''}
                    </span>
                  </div>

                  <div className="flex justify-center gap-2 my-1">
                    {(me.cards || [null, null, null]).map((c, ci) =>
                      c ? (
                        <div
                          key={ci}
                          className={`w-[58px] sm:w-[76px] h-[84px] sm:h-[110px] rounded-lg bg-[#fffdf6] grid place-items-center font-serif font-bold text-xl sm:text-[28px] shadow-md ${
                            c.s === 1 || c.s === 2 ? 'text-[#d9363e]' : 'text-[#111]'
                          } ${me.won && state.reveal ? 'animate-[sw88Glow_0.5s_ease-in-out_6]' : ''}`}
                        >
                          {cardStr(c)}
                        </div>
                      ) : (
                        <div
                          key={ci}
                          className="w-[58px] sm:w-[76px] h-[84px] sm:h-[110px] rounded-lg border-2 border-[#f1e3c0] bg-[repeating-linear-gradient(45deg,#7a1020,#7a1020_6px,#5a0a16_6px,#5a0a16_12px)] shadow-md"
                        />
                      )
                    )}
                  </div>

                  <div className="text-sm font-black font-mono-nums">
                    {formatRs(wallet.mainBalance)} · in {me.paid}
                  </div>
                </div>
              )}

              {/* Table Info Pill */}
              <div className="flex items-center justify-between text-[10px] font-mono-nums text-[#f6efe0]/60 px-1">
                <span>TABLE {state.tableId || state.roundId}</span>
                <span>ROUND {state.roundId} · BOOT Rs {state.boot}</span>
              </div>

              {/* Controls */}
              {state.phase === 'play' ? (
                me?.packed ? (
                  <div className="rounded-xl bg-black/55 border border-[#e6b84f]/30 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-extrabold text-[#ff7a7a] uppercase tracking-wider">You Packed · Cards Revealed</span>
                      <div className="text-[#f6efe0]/80 mt-0.5">
                        Remaining active players are continuing this round until showdown…
                      </div>
                    </div>
                    <span className="font-mono-nums font-bold text-[#e6b84f] animate-pulse">
                      Watching Live
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    <button
                      type="button"
                      disabled={!canBet || busy}
                      onClick={() => runAction('bet')}
                      className="min-h-[48px] rounded-xl bg-[#e6b84f] text-[#2b1a06] font-extrabold text-xs sm:text-sm disabled:opacity-35 cursor-pointer"
                    >
                      {me?.seen ? 'Chaal' : 'Blind'} {c1}
                    </button>
                    <button
                      type="button"
                      disabled={!canRaise || busy}
                      onClick={() => runAction('double')}
                      className="min-h-[48px] rounded-xl bg-[#2d2420] border border-[#5a4636] text-[#f6efe0] font-bold text-xs sm:text-sm disabled:opacity-35 cursor-pointer"
                    >
                      Double {c2}
                    </button>
                    <button
                      type="button"
                      disabled={!canSee || busy}
                      onClick={() => runAction('see')}
                      className="min-h-[48px] rounded-xl bg-[#2d2420] border border-[#5a4636] text-[#f6efe0] font-bold text-xs sm:text-sm disabled:opacity-35 cursor-pointer"
                    >
                      See cards
                    </button>
                    <button
                      type="button"
                      disabled={!myTurn || busy}
                      onClick={() => runAction('pack')}
                      className="min-h-[48px] rounded-xl bg-[#d9363e] text-white font-bold text-xs sm:text-sm disabled:opacity-35 cursor-pointer"
                    >
                      Pack
                    </button>
                    <button
                      type="button"
                      disabled={!canShow || busy}
                      onClick={() => runAction('show')}
                      className="min-h-[48px] rounded-xl bg-[#2d2420] border border-[#5a4636] text-[#f6efe0] font-bold text-xs sm:text-sm disabled:opacity-35 cursor-pointer col-span-2 sm:col-span-1"
                    >
                      Show {c1}
                    </button>
                  </div>
                )
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => startRound(false, false).catch(() => {})}
                    disabled={busy}
                    className="min-h-[48px] rounded-xl bg-[#e6b84f] text-[#2b1a06] font-extrabold text-sm cursor-pointer"
                  >
                    Next round {endCountdown !== null ? `(${endCountdown}s)` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={handleExit}
                    className="min-h-[48px] rounded-xl bg-[#d9363e] text-white font-bold text-sm cursor-pointer"
                  >
                    Exit table
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Betting history collapsible */}
        {showLog && state && (
          <div className="rounded-2xl bg-[#1a1411] border border-[#3a2d22] p-3 text-xs max-h-48 overflow-y-auto">
            <h3 className="font-bold text-[#e6b84f] mb-1.5">Table Betting History</h3>
            <div className="space-y-1 text-[#d9d0bd]">
              {state.logs.map((line, i) => (
                <div key={i} className="border-b border-[#2a211a] pb-1">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Big alert modal */}
      {bigNote && state && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#2a0c0f] border-2 border-[#ff5a5a] rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <p className="font-bold text-base text-white">{bigNote}</p>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={onGoDeposit}
                className="min-h-[42px] px-4 rounded-xl bg-[#e6b84f] text-[#2b1a06] font-bold text-sm cursor-pointer"
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => setBigNote(null)}
                className="min-h-[42px] px-4 rounded-xl bg-white/10 text-white font-semibold text-sm cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Win coin shower overlay */}
      {winRain !== null && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden grid place-items-center">
          <div className="text-center animate-[sw88WinBanner_3.6s_forwards]">
            <div className="text-xl sm:text-3xl font-black tracking-[0.3em] text-white drop-shadow-[0_2px_8px_#000]">
              YOU WIN
            </div>
            <div className="font-serif text-5xl sm:text-7xl font-black text-[#e6b84f] drop-shadow-[0_0_30px_#e6b84f]">
              {formatRs(winRain)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
