import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import { apiFetch, formatRs } from '../lib/api';
import type { GameInfo, Wallet } from '../types';

export interface SkylineMyBet {
  amount: number;
  cashed: boolean;
  cashoutMult: number | null;
  payout: number;
}

export interface SkylineHistoryItem {
  roundId: string;
  m: number;
  maxReached: boolean;
}

export interface SkylinePublicState {
  phase: 'WAITING' | 'FLYING' | 'CRASHED';
  roundId: string;
  countdownMs: number;
  elapsedMs: number;
  multiplier: number;
  speed: number;
  maxMultiplier: number;
  history: SkylineHistoryItem[];
  myBet?: SkylineMyBet | null;
}

interface SkylineCrashProps {
  game: GameInfo;
  wallet: Wallet;
  liveSkyline: SkylinePublicState | null;
  onWalletSync: (wallet: Wallet) => void;
  onExit: () => void;
  onGoDeposit: () => void;
}

function rngColor(m: number) {
  return m < 1.5
    ? '#38bdf8'
    : m < 2
      ? '#34d399'
      : m < 3
        ? '#facc15'
        : m < 5
          ? '#fb923c'
          : m < 10
            ? '#f472b6'
            : '#a78bfa';
}

export function SkylineCrash({
  game,
  wallet,
  liveSkyline,
  onWalletSync,
  onExit,
  onGoDeposit,
}: SkylineCrashProps) {
  const minStake = game.minStake || 50;
  const maxStake = game.maxStake || 10000;

  const [betAmt, setBetAmt] = useState<number>(Math.max(50, minStake));
  const [phase, setPhase] = useState<'WAITING' | 'FLYING' | 'CRASHED'>('WAITING');
  const [roundId, setRoundId] = useState<string>('');
  const [countdownSec, setCountdownSec] = useState<number>(5);
  const [displayMult, setDisplayMult] = useState<number>(1.0);
  const [maxMultiplier, setMaxMultiplier] = useState<number>(16.8);
  const [history, setHistory] = useState<SkylineHistoryItem[]>([]);
  const [myBet, setMyBet] = useState<SkylineMyBet | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: '' | 'err' | 'ok' }>({
    text: 'Connecting to live Skyline round...',
    kind: '',
  });
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Mutable animation & audio state refs
  const phaseRef = useRef<'WAITING' | 'FLYING' | 'CRASHED'>('WAITING');
  const roundIdRef = useRef<string>('');
  const flyStartLocalRef = useRef<number>(performance.now());
  const waitEndLocalRef = useRef<number>(performance.now() + 5000);
  const speedRef = useRef<number>(0.11);
  const multRef = useRef<number>(1.0);
  const ptsRef = useRef<Array<[number, number]>>([]);
  const faRef = useRef<number>(0);
  const curColRef = useRef<string>('#38bdf8');
  const lastTickRef = useRef<number>(0);
  const cloudsRef = useRef<Array<{ x: number; y: number; s: number }>>([]);
  const sizeRef = useRef<{ W: number; H: number }>({ W: 480, H: 320 });

  // Web Audio refs
  const acRef = useRef<AudioContext | null>(null);
  const engRef = useRef<{ o: OscillatorNode; g: GainNode } | null>(null);
  const mutedRef = useRef<boolean>(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const getAu = useCallback(() => {
    if (!acRef.current) {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx) acRef.current = new Ctx();
      } catch {
        // ignore audio blocked
      }
    }
    if (acRef.current && acRef.current.state === 'suspended') {
      acRef.current.resume().catch(() => {});
    }
    return acRef.current;
  }, []);

  const tone = useCallback(
    (f: number, d: number, ty: OscillatorType = 'sine', v = 0.15, sl?: number, dl = 0) => {
      if (mutedRef.current) return;
      const a = getAu();
      if (!a) return;
      try {
        const T = a.currentTime + dl;
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = ty;
        o.frequency.setValueAtTime(f, T);
        if (sl) o.frequency.exponentialRampToValueAtTime(sl, T + d);
        g.gain.setValueAtTime(v, T);
        g.gain.exponentialRampToValueAtTime(0.001, T + d);
        o.connect(g);
        g.connect(a.destination);
        o.start(T);
        o.stop(T + d);
      } catch {
        // ignore
      }
    },
    [getAu]
  );

  const noise = useCallback(
    (d: number, v: number) => {
      if (mutedRef.current) return;
      const a = getAu();
      if (!a) return;
      try {
        const n = Math.floor(a.sampleRate * d);
        const b = a.createBuffer(1, n, a.sampleRate);
        const x = b.getChannelData(0);
        for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const s = a.createBufferSource();
        const g = a.createGain();
        s.buffer = b;
        g.gain.value = v;
        s.connect(g);
        g.connect(a.destination);
        s.start();
      } catch {
        // ignore
      }
    },
    [getAu]
  );

  const engStart = useCallback(() => {
    if (mutedRef.current || engRef.current) return;
    const a = getAu();
    if (!a) return;
    try {
      const o = a.createOscillator();
      const f = a.createBiquadFilter();
      const g = a.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 70;
      f.type = 'lowpass';
      f.frequency.value = 500;
      g.gain.setValueAtTime(0, a.currentTime);
      g.gain.linearRampToValueAtTime(0.045, a.currentTime + 0.4);
      o.connect(f);
      f.connect(g);
      g.connect(a.destination);
      o.start();
      engRef.current = { o, g };
    } catch {
      // ignore
    }
  }, [getAu]);

  const engSet = useCallback((m: number) => {
    const a = acRef.current;
    if (engRef.current && a) {
      engRef.current.o.frequency.setTargetAtTime(70 + Math.min(m, 25) * 8, a.currentTime, 0.1);
    }
  }, []);

  const engStop = useCallback(() => {
    const e = engRef.current;
    const a = acRef.current;
    if (!e || !a) return;
    engRef.current = null;
    try {
      e.g.gain.setTargetAtTime(0, a.currentTime, 0.04);
      setTimeout(() => {
        try {
          e.o.stop();
        } catch {
          // ignore
        }
      }, 300);
    } catch {
      // ignore
    }
  }, []);

  const snd = useCallback(
    (k: 'bet' | 'cancel' | 'tick' | 'cash' | 'band' | 'crash') => {
      if (k === 'bet') tone(520, 0.12, 'triangle', 0.16, 780);
      else if (k === 'cancel') tone(420, 0.1, 'triangle', 0.12, 260);
      else if (k === 'tick') tone(760, 0.06, 'square', 0.04);
      else if (k === 'cash') {
        tone(880, 0.16, 'sine', 0.2);
        tone(1320, 0.3, 'sine', 0.18, undefined, 0.12);
      } else if (k === 'band') tone(1000, 0.08, 'sine', 0.08);
      else if (k === 'crash') {
        noise(0.5, 0.28);
        tone(220, 0.6, 'sawtooth', 0.2, 40);
      }
    },
    [tone, noise]
  );

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      engStop();
      if (acRef.current) {
        acRef.current.close().catch(() => {});
      }
    };
  }, [engStop]);

  // Apply server state snapshots cleanly
  const applyServerState = useCallback(
    (s: SkylinePublicState) => {
      speedRef.current = s.speed || 0.11;
      setMaxMultiplier(s.maxMultiplier || 16.8);
      setHistory(s.history || []);

      if (s.myBet !== undefined) {
        setMyBet(s.myBet);
      }

      const prevPhase = phaseRef.current;
      const prevRound = roundIdRef.current;

      if (s.roundId !== prevRound) {
        roundIdRef.current = s.roundId;
        setRoundId(s.roundId);
        if (s.myBet === undefined) {
          setMyBet(null);
        }
        ptsRef.current = [];
        faRef.current = 0;
      }

      if (s.phase === 'WAITING') {
        waitEndLocalRef.current = performance.now() + (s.countdownMs || 0);
        const secs = Math.max(1, Math.ceil((s.countdownMs || 0) / 1000));
        setCountdownSec(secs);
        if (prevPhase !== 'WAITING') {
          ptsRef.current = [];
          faRef.current = 0;
          multRef.current = 1.0;
          setDisplayMult(1.0);
          engStop();
          setMsg((m) => (m.kind === 'ok' || m.kind === 'err' ? m : { text: 'Place a bet before the round starts.', kind: '' }));
        }
      } else if (s.phase === 'FLYING') {
        flyStartLocalRef.current = performance.now() - (s.elapsedMs || 0);
        if (prevPhase !== 'FLYING') {
          ptsRef.current = [];
          const elapsedSec = (s.elapsedMs || 0) / 1000;
          if (elapsedSec > 0.05) {
            const steps = Math.min(80, Math.floor(elapsedSec * 20));
            for (let i = 0; i <= steps; i++) {
              const t = (elapsedSec * i) / Math.max(1, steps);
              ptsRef.current.push([t, Math.exp(speedRef.current * t)]);
            }
          }
          engStart();
        }
      } else if (s.phase === 'CRASHED') {
        multRef.current = s.multiplier;
        setDisplayMult(s.multiplier);
        if (prevPhase !== 'CRASHED') {
          faRef.current = 1;
          engStop();
          snd('crash');
          const hitMax = s.multiplier >= (s.maxMultiplier || 16.8);
          setMyBet((curr) => {
            if (!curr || curr.cashed) return curr;
            if (hitMax) {
              const winAmt = Math.floor(curr.amount * (s.maxMultiplier || 16.8));
              snd('cash');
              setMsg({
                text: `Maximum ${s.maxMultiplier}x reached. Auto cashed out, won ${formatRs(winAmt - curr.amount)}`,
                kind: 'ok',
              });
              return { ...curr, cashed: true, cashoutMult: s.maxMultiplier, payout: winAmt };
            }
            setMsg({
              text: `Round ended at ${s.multiplier.toFixed(2)}x. Bet lost: ${formatRs(curr.amount)}`,
              kind: 'err',
            });
            return curr;
          });
        }
      }

      phaseRef.current = s.phase;
      setPhase(s.phase);
    },
    [engStart, engStop, snd]
  );

  // Hydrate initial state + fallback poll if needed
  const fetchState = useCallback(async () => {
    try {
      const res = await apiFetch<SkylinePublicState & { wallet?: Wallet }>('/api/games/skyline/state');
      applyServerState(res);
      if (res.wallet) onWalletSync(res.wallet);
    } catch {
      // ignore transient network
    }
  }, [applyServerState, onWalletSync]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (liveSkyline) {
      applyServerState(liveSkyline);
    }
  }, [liveSkyline, applyServerState]);

  // Keep countdown ticking smoothly during WAITING
  useEffect(() => {
    const iv = setInterval(() => {
      if (phaseRef.current === 'WAITING') {
        const left = Math.max(0, waitEndLocalRef.current - performance.now());
        const sec = Math.max(0, Math.ceil(left / 1000));
        setCountdownSec(sec);
        if (sec > 0 && sec !== lastTickRef.current) {
          lastTickRef.current = sec;
          if (sec <= 3) snd('tick');
        }
      }
    }, 100);
    return () => clearInterval(iv);
  }, [snd]);

  // Canvas animation loop matching plan_0aedfa90.html
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const sizeCv = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect();
      const W = Math.max(200, r.width);
      const H = Math.max(200, r.height);
      sizeRef.current = { W, H };
      cv.width = W * d;
      cv.height = H * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (!cloudsRef.current.length) {
        for (let i = 0; i < 6; i++) {
          cloudsRef.current.push({
            x: Math.random() * W,
            y: 20 + Math.random() * H * 0.55,
            s: 0.6 + Math.random() * 0.9,
          });
        }
      }
    };
    sizeCv();
    window.addEventListener('resize', sizeCv);

    const drawPlane = (now: number) => {
      ctx.fillStyle = '#e23b3b';
      ctx.beginPath();
      ctx.moveTo(-30, -3);
      ctx.quadraticCurveTo(-8, -12, 18, -9);
      ctx.lineTo(27, -5);
      ctx.lineTo(27, 5);
      ctx.quadraticCurveTo(0, 10, -30, 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-28, -3);
      ctx.lineTo(-38, -18);
      ctx.lineTo(-27, -17);
      ctx.lineTo(-19, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b92b2b';
      ctx.beginPath();
      ctx.ellipse(-30, 0, 8, 2.5, 0, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(2, 3, 15, 3.6, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#bfe6ff';
      ctx.beginPath();
      ctx.moveTo(-6, -9);
      ctx.quadraticCurveTo(2, -17, 10, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(26, -6, 4, 12);
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(8, 5);
      ctx.lineTo(8, 12);
      ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(8, 13, 3.2, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath();
      ctx.ellipse(31, 0, 1.8, 4 + 12 * Math.abs(Math.cos(now / 35)), 0, 0, 7);
      ctx.fill();
    };

    const drawCloud = (c: { x: number; y: number; s: number }) => {
      ctx.beginPath();
      const r = 16 * c.s;
      ctx.arc(c.x, c.y, r, 0, 7);
      ctx.arc(c.x + r * 1.1, c.y - r * 0.3, r * 1.2, 0, 7);
      ctx.arc(c.x + r * 2.3, c.y, r, 0, 7);
      ctx.fill();
    };

    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { W, H } = sizeRef.current;

      if (phaseRef.current === 'FLYING') {
        const t = Math.max(0, (now - flyStartLocalRef.current) / 1000);
        const m = Math.exp(speedRef.current * t);
        multRef.current = m;
        setDisplayMult(m);
        ptsRef.current.push([t, m]);
        if (ptsRef.current.length > 600) ptsRef.current.shift();
        engSet(m);
      }

      const col = phaseRef.current === 'CRASHED' ? '#ef4b4b' : rngColor(multRef.current);
      if (col !== curColRef.current) {
        if (curColRef.current && phaseRef.current === 'FLYING') snd('band');
        curColRef.current = col;
        if (stageRef.current) stageRef.current.style.setProperty('--c', col);
      }

      ctx.clearRect(0, 0, W, H);
      const sp = phaseRef.current === 'FLYING' ? 40 : 8;
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      cloudsRef.current.forEach((c) => {
        c.x -= sp * c.s * dt;
        if (c.x < -80 * c.s) {
          c.x = W + 20;
          c.y = 20 + Math.random() * H * 0.55;
        }
        drawCloud(c);
      });

      const pad = 34;
      const x0 = pad;
      const y0 = H - pad;
      let tmax = 6;
      let mmax = 2;
      const pts = ptsRef.current;
      if (pts.length) {
        tmax = Math.max(6, pts[pts.length - 1][0] * 1.08);
        mmax = Math.max(2, multRef.current * 1.12);
      }
      const X = (t: number) => x0 + (t / tmax) * (W - pad * 2 - 20);
      const Y = (m: number) => y0 - ((m - 1) / (mmax - 1)) * (H - pad * 2 - 10);

      let px = x0;
      let py = y0;
      let ang = -0.25;
      let alpha = 1;

      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        pts.forEach((p) => ctx.lineTo(X(p[0]), Y(p[1])));
        const e = pts[pts.length - 1];
        px = X(e[0]);
        py = Y(e[1]);
        const q = pts[Math.max(0, pts.length - 6)];
        ang = Math.atan2(py - Y(q[1]), px - X(q[0]));
        ctx.lineTo(px, y0);
        ctx.closePath();
        ctx.fillStyle = col + '30';
        ctx.fill();

        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (phaseRef.current !== 'FLYING') {
        py = y0 + Math.sin(now / 400) * 4;
      }

      if (phaseRef.current === 'CRASHED' && faRef.current > 0) {
        faRef.current -= dt * 1.2;
        const k = 1 - Math.max(faRef.current, 0);
        px += Math.cos(ang) * k * W * 0.5;
        py += Math.sin(ang) * k * W * 0.5;
        alpha = Math.max(0, faRef.current);
      }
      if (phaseRef.current === 'CRASHED' && faRef.current <= 0) alpha = 0;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(ang * 0.8);
      ctx.scale(1.15, 1.15);
      drawPlane(now);
      ctx.restore();

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeCv);
    };
  }, [engSet, snd]);

  const setCleanAmt = (v: number) => {
    const cap = Math.max(minStake, Math.min(maxStake, Math.floor(wallet.availableBalance || maxStake)));
    const next = Math.max(minStake, Math.min(cap, Math.floor(v)));
    setBetAmt(next);
    if (next > wallet.availableBalance) {
      setMsg({ text: 'Bet exceeds your balance.', kind: 'err' });
    } else {
      setMsg({ text: '', kind: '' });
    }
  };

  const handleAction = async () => {
    if (busy) return;
    getAu();
    if (phase === 'WAITING') {
      if (myBet) {
        setBusy(true);
        try {
          const res = await apiFetch<{ state: SkylinePublicState; wallet: Wallet }>('/api/games/skyline/cancel', {
            method: 'POST',
          });
          snd('cancel');
          setMyBet(null);
          onWalletSync(res.wallet);
          setMsg({ text: 'Bet cancelled and refunded.', kind: '' });
        } catch (err: any) {
          setMsg({ text: err?.message || 'Cancel failed', kind: 'err' });
        } finally {
          setBusy(false);
        }
        return;
      }

      if (wallet.availableBalance < minStake) {
        setMsg({ text: `Insufficient balance. Minimum bet is Rs ${minStake}.`, kind: 'err' });
        return;
      }
      if (betAmt < minStake || betAmt > maxStake) {
        setMsg({ text: `Bet must be between Rs ${minStake} and Rs ${maxStake}.`, kind: 'err' });
        return;
      }
      if (betAmt > wallet.availableBalance) {
        setMsg({ text: `Bet exceeds your balance of ${formatRs(wallet.availableBalance)}.`, kind: 'err' });
        return;
      }

      setBusy(true);
      try {
        const res = await apiFetch<{ state: SkylinePublicState; wallet: Wallet }>('/api/games/skyline/bet', {
          method: 'POST',
          body: JSON.stringify({
            amount: betAmt,
            idempotencyKey: `sky-${roundId}-${Date.now()}`,
          }),
        });
        snd('bet');
        setMyBet(res.state.myBet || { amount: betAmt, cashed: false, cashoutMult: null, payout: 0 });
        onWalletSync(res.wallet);
        setMsg({ text: `Bet placed: ${formatRs(betAmt)}`, kind: '' });
      } catch (err: any) {
        setMsg({ text: err?.message || 'Could not place bet', kind: 'err' });
      } finally {
        setBusy(false);
      }
    } else if (phase === 'FLYING' && myBet && !myBet.cashed) {
      setBusy(true);
      try {
        const res = await apiFetch<{
          state: SkylinePublicState;
          wallet: Wallet;
          payout: number;
          mult: number;
          netWin: number;
        }>('/api/games/skyline/cashout', {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: `sky-cash-${roundId}` }),
        });
        snd('cash');
        setMyBet({ amount: myBet.amount, cashed: true, cashoutMult: res.mult, payout: res.payout });
        onWalletSync(res.wallet);
        setMsg({
          text: `Cashed out at ${res.mult.toFixed(2)}x. Won ${formatRs(res.payout - myBet.amount)}`,
          kind: 'ok',
        });
      } catch (err: any) {
        setMsg({ text: err?.message || 'Could not cash out in time', kind: 'err' });
        fetchState();
      } finally {
        setBusy(false);
      }
    }
  };

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    if (next) engStop();
    else {
      getAu();
      if (phaseRef.current === 'FLYING') engStart();
    }
  };

  const activeCol = phase === 'CRASHED' ? '#ef4b4b' : rngColor(displayMult);
  const hitMax = phase === 'CRASHED' && displayMult >= maxMultiplier;
  const insufficient = !myBet && wallet.availableBalance < minStake;

  let actLabel = `Place bet ${formatRs(Math.max(betAmt, minStake))}`;
  let actStyle = 'bg-[#ffb703] text-[#2b1d00]';
  let actDisabled = busy;

  if (phase === 'WAITING') {
    if (myBet) {
      actLabel = `Cancel bet (${formatRs(myBet.amount)})`;
      actStyle = 'bg-transparent text-[#f2f5f9] border-2 border-[#222834]';
    } else if (insufficient) {
      actLabel = 'Insufficient balance';
      actStyle = 'bg-[#222834] text-[#8b94a3]';
      actDisabled = true;
    }
  } else if (phase === 'FLYING') {
    if (myBet && !myBet.cashed) {
      actLabel = `Cash out ${formatRs(Math.floor(myBet.amount * displayMult))}`;
      actStyle = 'bg-[#10b981] text-white';
    } else {
      actLabel = myBet?.cashed ? `Cashed Out @ ${myBet.cashoutMult?.toFixed(2)}x` : 'Wait for next round';
      actStyle = 'bg-[#222834] text-[#8b94a3]';
      actDisabled = true;
    }
  } else {
    actLabel = 'Wait for next round';
    actStyle = 'bg-[#222834] text-[#8b94a3]';
    actDisabled = true;
  }

  return (
    <div className="min-h-dvh bg-[#000000] text-[#f2f5f9] font-sans pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+16px)]">
      <main className="max-w-[540px] mx-auto px-3 sm:px-3.5 pt-2.5 sm:pt-3.5 pb-4 flex flex-col gap-2.5 sm:gap-3">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExit}
              className="min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3 rounded-xl bg-[#0d0f14] border border-[#222834] text-xs font-bold text-[#f2f5f9] hover:border-[#E6B84F]/50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>SW88</span>
            </button>
            <div className="font-display font-extrabold text-lg sm:text-xl tracking-tight">Skyline</div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="bg-[#0d0f14] border border-[#222834] rounded-xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 font-bold text-xs sm:text-sm font-mono-nums text-[#f2f5f9]">
              {formatRs(wallet.mainBalance)}
            </div>
            <button
              type="button"
              onClick={toggleSound}
              aria-label="Toggle sound"
              className="bg-[#0d0f14] border border-[#222834] rounded-xl p-2 text-[#f2f5f9] hover:border-white/25 cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4 text-[#8b94a3]" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-h-[30px] pb-0.5" aria-label="Previous rounds">
          {history.length === 0 ? (
            <span className="text-xs text-[#8b94a3]">Waiting for recent crash history...</span>
          ) : (
            history.slice(0, 7).map((h, i) => (
              <span
                key={`${h.roundId}-${i}`}
                style={{ color: rngColor(h.m) }}
                className="flex-none text-xs sm:text-[13px] font-bold font-mono-nums px-2.5 py-1 rounded-lg bg-[#0d0f14] border border-[#222834]"
              >
                {h.m.toFixed(2)}x
              </span>
            ))
          )}
        </div>

        <section
          ref={stageRef}
          style={{
            background: `radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, ${activeCol} 24%, #000), #000 72%)`,
          }}
          className="relative h-[36dvh] sm:h-[44dvh] max-h-[380px] min-h-[210px] sm:min-h-[250px] rounded-[20px] overflow-hidden border border-[#222834] transition-[background] duration-500"
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <div
              style={{
                color: activeCol,
                textShadow: `0 0 28px ${activeCol}`,
              }}
              className="font-display font-extrabold text-[clamp(52px,15vw,84px)] leading-none tabular-nums transition-colors duration-300"
            >
              {displayMult.toFixed(2)}x
            </div>
            <div
              className={`mt-2 text-[15px] ${
                phase === 'CRASHED' && !hitMax ? 'text-[#ef4b4b] font-bold' : 'text-slate-300 font-medium'
              }`}
            >
              {phase === 'WAITING'
                ? `Next round in ${countdownSec}s`
                : phase === 'CRASHED'
                  ? hitMax
                    ? `Maximum ${maxMultiplier}x reached`
                    : 'Flew away'
                  : ''}
            </div>
          </div>
        </section>

        <section className="bg-[#0d0f14] border border-[#222834] rounded-[20px] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!myBet}
              onClick={() => setCleanAmt(betAmt - 50)}
              aria-label="Decrease bet"
              className="w-[46px] h-[46px] rounded-xl border border-[#222834] bg-transparent text-[#f2f5f9] text-xl font-bold disabled:opacity-40 cursor-pointer"
            >
              −
            </button>
            <div className="flex-1 relative">
              <b className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8b94a3] font-bold text-sm">Rs</b>
              <input
                type="number"
                inputMode="numeric"
                min={minStake}
                max={maxStake}
                step={10}
                disabled={!!myBet}
                value={betAmt}
                onChange={(e) => setBetAmt(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                aria-label="Bet amount in rupees"
                className="w-full h-[46px] rounded-xl border border-[#222834] bg-transparent text-[#f2f5f9] font-bold font-mono-nums text-lg pl-11 pr-3 focus:outline-none focus:border-[#E6B84F]"
              />
            </div>
            <button
              type="button"
              disabled={!!myBet}
              onClick={() => setCleanAmt(betAmt + 50)}
              aria-label="Increase bet"
              className="w-[46px] h-[46px] rounded-xl border border-[#222834] bg-transparent text-[#f2f5f9] text-xl font-bold disabled:opacity-40 cursor-pointer"
            >
              +
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[50, 100, 200, 500].map((v) => (
              <button
                key={v}
                type="button"
                disabled={!!myBet}
                onClick={() => setCleanAmt(v)}
                className="h-9 rounded-[10px] border border-[#222834] bg-transparent text-[#f2f5f9] font-bold font-mono-nums text-sm hover:border-[#ffb703]/60 disabled:opacity-40 cursor-pointer"
              >
                {v}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={actDisabled}
            onClick={handleAction}
            className={`h-[60px] rounded-2xl text-xl font-extrabold font-mono-nums transition active:scale-[0.98] disabled:cursor-not-allowed cursor-pointer ${actStyle}`}
          >
            {actLabel}
          </button>

          <div
            className={`min-h-[20px] text-sm text-center ${
              msg.kind === 'err' ? 'text-[#ef4b4b]' : msg.kind === 'ok' ? 'text-[#10b981] font-bold' : 'text-[#8b94a3]'
            }`}
          >
            {msg.text}
          </div>

          {insufficient && (
            <button
              type="button"
              onClick={onGoDeposit}
              className="min-h-[42px] rounded-xl bg-[#E6B84F]/15 border border-[#E6B84F]/40 text-[#E6B84F] font-bold text-xs uppercase tracking-wider hover:bg-[#E6B84F]/25 cursor-pointer"
            >
              Deposit NPR to Play
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
