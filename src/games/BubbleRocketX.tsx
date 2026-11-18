import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, Wallet as WalletIcon } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { GameInfo, Wallet } from '../types';

const R = 18;
const W = 360;
const TOP = 8;
const RH = R * 1.732;
const SZ = (R + 6) * 2;
const COL = ['#f0445f', '#3b82f6', '#10c98f', '#ffc83d', '#a56bff', '#22d3ee'];

interface BubbleCell {
  c: number;
  x: number;
  hp: number;
  t: 'n' | 'frozen' | 'rainbow' | 'bomb' | 'light';
}

interface BubbleState {
  roundId: string;
  bet: number;
  H: number;
  lineY: number;
  ly: number;
  loseR: number;
  gr: number;
  par: number;
  grid: Array<Array<BubbleCell | null>>;
  shots: number;
  shotNo: number;
  pops: number;
  blasts: number;
  win: number;
  cur: BubbleCell;
  nxt: BubbleCell;
  rounds: Array<{ won: number; r: number; x?: number }>;
  over: boolean;
}

interface BubbleRocketProps {
  game: GameInfo;
  wallet: Wallet;
  onWalletSync: (w: Wallet) => void;
  onExit: () => void;
  onGoDeposit: () => void;
}

const ladder = (b: number, n: number) => (n < 1 ? 0 : Math.round((b / 2) * 2 ** (n - 1)));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => 'रु ' + fmt(n);

function odd(r: number, par: number) {
  return (r + par) & 1;
}
function cols(r: number, par: number) {
  return odd(r, par) ? 9 : 10;
}
function cellPos(r: number, c: number, par: number): [number, number] {
  return [(odd(r, par) ? 2 * R : R) + 2 * R * c, TOP + R + r * RH];
}

function shade(h: string, k: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => Math.round(parseInt(h.substring(i, i + 2), 16) * k).toString(16).padStart(2, '0'))
      .join('')
  );
}
function tint(h: string, k: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => {
        const v = parseInt(h.substring(i, i + 2), 16);
        return Math.round(v + (255 - v) * k)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

const SPRITE_CACHE: Record<string, HTMLCanvasElement> = {};
function getSprite(b: BubbleCell, dpr: number): HTMLCanvasElement {
  const key = `${b.t === 'rainbow' || b.t === 'bomb' || b.t === 'light' ? b.t : b.c}|${b.x}|${b.hp > 1 ? 1 : 0}|${dpr}`;
  if (SPRITE_CACHE[key]) return SPRITE_CACHE[key];

  const c = document.createElement('canvas');
  c.width = c.height = SZ * dpr;
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const m = SZ / 2;
  const r = R - 1;

  if (b.x) {
    const g = x.createRadialGradient(m, m, r * 0.6, m, m, m);
    g.addColorStop(0, '#ffcf4acc');
    g.addColorStop(1, '#ffcf4a00');
    x.fillStyle = g;
    x.beginPath();
    x.arc(m, m, m, 0, Math.PI * 2);
    x.fill();
  }

  let f: CanvasGradient;
  const col = COL[b.c] || COL[0];
  if (b.t === 'rainbow') {
    f = x.createLinearGradient(m - r, m - r, m + r, m + r);
    ['#ff5470', '#ffcf4a', '#35e0a1', '#3da5ff', '#a45cff'].forEach((q, i) => f.addColorStop(i / 4, q));
  } else if (b.t === 'bomb' || b.t === 'light') {
    f = x.createRadialGradient(m - 5, m - 6, 2, m, m, r);
    f.addColorStop(0, '#667');
    f.addColorStop(1, '#1b2050');
  } else {
    f = x.createRadialGradient(m - r * 0.3, m - r * 0.35, 1, m, m, r * 1.05);
    f.addColorStop(0, tint(col, 0.55));
    f.addColorStop(0.4, col);
    f.addColorStop(1, shade(col, 0.6));
  }

  x.fillStyle = f;
  x.beginPath();
  x.arc(m, m, r, 0, Math.PI * 2);
  x.fill();

  if (b.t === 'n' || b.t === 'frozen') {
    x.fillStyle = '#ffffff59';
    x.beginPath();
    x.ellipse(m - r * 0.3, m - r * 0.42, r * 0.38, r * 0.2, -0.6, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#ffffff30';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(m, m, r - 3, 0.15 * Math.PI, 0.85 * Math.PI);
    x.stroke();
  }

  x.beginPath();
  x.arc(m, m, r, 0, Math.PI * 2);
  x.lineWidth = b.x ? 3 : 1.5;
  x.strokeStyle = b.x ? '#ffcf4a' : b.t === 'n' || b.t === 'frozen' ? shade(col, 0.5) : '#ffffff55';
  x.stroke();

  if (b.hp > 1) {
    x.fillStyle = '#d6f1ff55';
    x.beginPath();
    x.arc(m, m, r, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#fff';
    x.lineWidth = 2;
    x.stroke();
  }

  const label = b.x ? `${b.x}x` : b.t === 'bomb' ? '💣' : b.t === 'light' ? '⚡' : '';
  if (label) {
    x.font = '800 13px system-ui,sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 3;
    x.strokeStyle = '#000b';
    x.strokeText(label, m, m + 1);
    x.fillStyle = '#fff';
    x.fillText(label, m, m + 1);
  }
  return (SPRITE_CACHE[key] = c);
}

const TUT_STEPS = [
  {
    title: '1. Add your bet',
    body: 'Your default bet is रु 50. Press + to add रु 50 or − to remove रु 50. When you press Play, the bet is deducted from your SW88 balance. With less than रु 50 you cannot play.',
  },
  {
    title: '2. Blast bubbles, get paid',
    body: 'Match 3 or more bubbles of the same color to blast them. Your 1st blast pays half your bet (e.g. रु 50 ÷ 2 = रु 25). Frozen bubbles take 2 hits to pop.',
  },
  {
    title: '3. Do not cross the danger line',
    body: 'Missing a blast adds a new top row. If bubbles cross the dashed red DANGER LINE at any moment, the round ends immediately and reward is lost.',
  },
  {
    title: '4. Your reward doubles',
    body: 'Every blast doubles your reward: 1st = Bet ÷ 2, 2nd = Bet, 3rd = 2× Bet, 4th = 4× Bet, 5th = 8× Bet. Survive all 5 shots to claim your reward!',
  },
  {
    title: '5. Special Power Bubbles',
    body: 'Watch for Rainbow (🌈 matches nearby color), Bomb (💣 blasts surrounding bubbles), and Lightning (⚡ clears an entire row).',
  },
  {
    title: '6. Aim & Fire',
    body: 'Tap or drag anywhere on the board to aim and release to fire. On desktop, use ← → keys to aim and Space to fire.',
  },
];

export function BubbleRocketX({ game, wallet, onWalletSync, onExit, onGoDeposit }: BubbleRocketProps) {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [bet, setBet] = useState(Math.max(50, game.minStake || 50));
  const [sound, setSound] = useState(true);
  const [music, setMusic] = useState(true);
  const [st, setSt] = useState<BubbleState | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tutIdx, setTutIdx] = useState<number | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  const [summary, setSummary] = useState<{
    out: boolean;
    bet: number;
    played: number;
    wonCount: number;
    lostCount: number;
    potential: number;
    final: number;
    win: boolean;
    rounds: Array<{ won: number; r: number; x?: number }>;
  } | null>(null);

  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const angRef = useRef(-Math.PI / 2);
  const flyRef = useRef<{ x: number; y: number; vx: number; vy: number; c: number; t: BubbleCell['t']; targetAng: number } | null>(null);
  const partsRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; l: number; c: string }>>([]);
  const fallRef = useRef<Array<{ x: number; y: number; vy: number; b: BubbleCell }>>([]);
  const flRef = useRef<Array<{ x: number; y: number; t: string; l: number; c: string }>>([]);
  const stRef = useRef<BubbleState | null>(null);
  stRef.current = st;

  const acRef = useRef<AudioContext | null>(null);
  const musRef = useRef<{ id: number; t: number; n: number; g: GainNode | null }>({ id: 0, t: 0, n: 0, g: null });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  }, []);

  const tone = useCallback(
    (f: number, d: number, ty: OscillatorType = 'sine', v = 0.1, sl = 0, dl = 0) => {
      if (!sound) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        acRef.current = acRef.current || new AC();
        const ac = acRef.current;
        if (ac.state === 'suspended') ac.resume();
        const t = ac.currentTime + dl;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = ty;
        o.frequency.setValueAtTime(f, t);
        if (sl) o.frequency.exponentialRampToValueAtTime(sl, t + d);
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + d);
      } catch {
        // ignore
      }
    },
    [sound]
  );

  // Ambient music scheduler
  useEffect(() => {
    if (!music) {
      if (musRef.current.id) {
        clearInterval(musRef.current.id);
        musRef.current.id = 0;
      }
      return;
    }
    const CH: Array<[number, number[]]> = [
      [110, [440, 523.25, 659.25]],
      [87.31, [349.23, 440, 523.25]],
      [130.81, [523.25, 659.25, 392]],
      [98, [392, 493.88, 587.33]],
    ];
    const startMus = () => {
      if (musRef.current.id) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        acRef.current = acRef.current || new AC();
        const ac = acRef.current;
        if (ac.state === 'suspended') ac.resume();
        const g = ac.createGain();
        g.gain.value = 0.65;
        g.connect(ac.destination);
        musRef.current = { id: 0, t: ac.currentTime + 0.1, n: 0, g };
        const sched = () => {
          while (musRef.current.t < ac.currentTime + 0.6) {
            const b = Math.floor(musRef.current.n / 8) % 4;
            const k = musRef.current.n % 8;
            const [bass, ar] = CH[b];
            const d = 0.28;
            const playNote = (freq: number, t: number, dur: number, ty: OscillatorType, vol: number) => {
              const o = ac.createOscillator();
              const gn = ac.createGain();
              o.type = ty;
              o.frequency.value = freq;
              gn.gain.setValueAtTime(0, t);
              gn.gain.linearRampToValueAtTime(vol, t + 0.02);
              gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
              o.connect(gn).connect(g);
              o.start(t);
              o.stop(t + dur + 0.05);
            };
            if (k === 0) playNote(bass, musRef.current.t, d * 7, 'sine', 0.07);
            if (k === 4) playNote(bass, musRef.current.t, d * 3, 'sine', 0.05);
            playNote(ar[[0, 1, 2, 1, 0, 2, 1, 2][k]], musRef.current.t, d * 1.6, 'triangle', 0.035);
            musRef.current.t += d;
            musRef.current.n++;
          }
        };
        sched();
        musRef.current.id = window.setInterval(sched, 250);
      } catch {
        // ignore
      }
    };
    const onPtr = () => startMus();
    window.addEventListener('pointerdown', onPtr, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onPtr);
      if (musRef.current.id) {
        clearInterval(musRef.current.id);
        musRef.current.id = 0;
      }
    };
  }, [music]);

  // Resume active Bubble round if user refreshed mid-round
  useEffect(() => {
    apiFetch<{ active: boolean; state?: BubbleState; wallet?: Wallet }>('/api/games/bubble/active')
      .then((res) => {
        if (res.active && res.state) {
          setSt(res.state);
          if (res.wallet) onWalletSync(res.wallet);
          setScreen('game');
        }
      })
      .catch(() => {});
  }, []);

  const updateBet = (val: number) => {
    const step = 50;
    const min = Math.max(50, game.minStake || 50);
    const maxCap = Math.min(game.maxStake || 5000, Math.max(min, Math.floor(wallet.mainBalance / 50) * 50));
    const rounded = Math.round(val / step) * step;
    setBet(Math.max(min, Math.min(rounded, maxCap)));
  };

  const startRound = async () => {
    if (wallet.mainBalance < bet) {
      showToast(`Insufficient balance. Need ${money(bet)}.`);
      return;
    }
    setBusy(true);
    setSummary(null);
    partsRef.current = [];
    fallRef.current = [];
    flRef.current = [];
    flyRef.current = null;
    angRef.current = -Math.PI / 2;

    try {
      const wrapH = wrapRef.current?.clientHeight || 560;
      const wrapW = wrapRef.current?.clientWidth || 360;
      const boardHeight = Math.max(460, Math.min(720, Math.round((W * wrapH) / Math.max(240, wrapW))));
      const res = await apiFetch<{ state: BubbleState; wallet: Wallet }>('/api/games/bubble/start', {
        method: 'POST',
        body: JSON.stringify({
          bet,
          boardHeight,
          idempotencyKey: `brx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      setSt(res.state);
      onWalletSync(res.wallet);
      setScreen('game');
      tone(660, 0.1, 'triangle', 0.08);
      setTimeout(() => tone(990, 0.16, 'triangle', 0.08), 110);
    } catch (err: any) {
      showToast(err?.message || 'Unable to start round.');
    } finally {
      setBusy(false);
    }
  };

  const submitShotToServer = useCallback(
    async (roundId: string, shotIndex: number, angle: number) => {
      try {
        const res = await apiFetch<{
          state: BubbleState;
          hitR: number;
          hitC: number;
          blast: boolean;
          crossed: boolean;
          poppedList: Array<{ r: number; c: number; colorIdx: number; frozenCrack: boolean }>;
          droppedList: Array<{ r: number; c: number; cell: BubbleCell }>;
          payout: number;
          wallet: Wallet;
        }>('/api/games/bubble/shot', {
          method: 'POST',
          body: JSON.stringify({ roundId, shotIndex, angle }),
        });

        flyRef.current = null;
        setSt(res.state);
        onWalletSync(res.wallet);

        // Spawn particles for popped & dropped bubbles
        for (const p of res.poppedList || []) {
          const [px, py] = cellPos(p.r, p.c, res.state.par);
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * 6.28;
            const sp = 1 + Math.random() * 3.5;
            partsRef.current.push({
              x: px,
              y: py,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              l: 1,
              c: p.frozenCrack ? '#bfe6ff' : COL[p.colorIdx] || '#fff',
            });
          }
        }
        for (const d of res.droppedList || []) {
          const [px, py] = cellPos(d.r, d.c, res.state.par);
          fallRef.current.push({ x: px, y: py, vy: 0, b: d.cell });
        }

        const [lx, ly] = cellPos(res.hitR, res.hitC, res.state.par);
        if (res.blast) {
          flRef.current.push({ x: lx, y: ly, t: money(res.state.win), l: 1.2, c: '#ffcf4a' });
          tone(520, 0.14, 'sine', 0.1, 1200);
          tone(1319, 0.12, 'square', 0.04, 0, 0.05);
        } else {
          tone(170, 0.1, 'sine', 0.1, 70);
        }

        if (res.crossed || res.state.over) {
          const finalOut = Boolean(res.crossed);
          const finalWin = finalOut ? 0 : res.payout;
          const isWin = !finalOut && finalWin >= res.state.bet;
          if (isWin) {
            [523, 659, 784, 1047].forEach((f, idx) => tone(f, 0.22, 'square', 0.06, 0, idx * 0.08));
          } else {
            [392, 370, 311].forEach((f, idx) => tone(f, 0.28, 'triangle', 0.09, f * 0.9, idx * 0.2));
          }
          setTimeout(() => {
            const played = res.state.rounds.length;
            const wonCount = res.state.rounds.filter((x) => x.won).length;
            setSummary({
              out: finalOut,
              bet: res.state.bet,
              played,
              wonCount,
              lostCount: played - wonCount,
              potential: res.state.win,
              final: finalWin,
              win: isWin,
              rounds: res.state.rounds,
            });
          }, 700);
        }
      } catch (err: any) {
        flyRef.current = null;
        showToast(err?.message || 'Shot failed');
      } finally {
        setBusy(false);
      }
    },
    [onWalletSync, showToast, tone]
  );

  const fireShot = useCallback(() => {
    const cur = stRef.current;
    if (!cur || cur.over || cur.shots <= 0 || busy || flyRef.current) return;
    setBusy(true);
    const ang = angRef.current;
    flyRef.current = {
      x: W / 2,
      y: cur.ly - 26,
      vx: Math.cos(ang) * 0.84,
      vy: Math.sin(ang) * 0.84,
      c: cur.cur.c,
      t: cur.cur.t,
      targetAng: ang,
    };
    tone(260, 0.2, 'sine', 0.08, 900);
  }, [busy, tone]);

  // Canvas animation & rendering loop
  useEffect(() => {
    if (screen !== 'game' || !st) return;
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const fit = () => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (!cw || !ch) return;
      cv.width = W * dpr;
      cv.height = st.H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(cw / W, ch / st.H);
      cv.style.width = `${W * scale}px`;
      cv.style.height = `${st.H * scale}px`;
    };
    fit();
    window.addEventListener('resize', fit);

    const hitAny = (x: number, y: number, grid: Array<Array<BubbleCell | null>>, par: number) => {
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (!grid[r][c]) continue;
          const [px, py] = cellPos(r, c, par);
          if ((px - x) ** 2 + (py - y) ** 2 < (R * 1.8) ** 2) return true;
        }
      }
      return false;
    };

    const traj = (cur: BubbleState, ang: number) => {
      const pts: Array<[number, number, number?]> = [];
      let x = W / 2;
      let y = cur.ly - 26;
      let vx = Math.cos(ang) * 6;
      let vy = Math.sin(ang) * 6;
      for (let i = 0; i < 240; i++) {
        x += vx;
        y += vy;
        if (x < R) {
          x = R;
          vx = -vx;
          pts.push([x, y]);
        }
        if (x > W - R) {
          x = W - R;
          vx = -vx;
          pts.push([x, y]);
        }
        if (y <= TOP + R || hitAny(x, y, cur.grid, cur.par)) break;
        if (i % 4 === 0) pts.push([x, y, 1]);
      }
      return pts;
    };

    let raf = 0;
    let last = performance.now();
    let submitted = false;

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(40, t - last || 16);
      last = t;
      const k = dt / 16.67;
      const cur = stRef.current;
      if (!cur) return;

      const fly = flyRef.current;
      if (fly && !submitted) {
        let left = 0.84 * dt;
        while (left > 0 && flyRef.current) {
          const step = Math.min(4, left);
          left -= step;
          const m = step / 0.84;
          fly.x += fly.vx * m;
          fly.y += fly.vy * m;
          if (fly.x < R) {
            fly.x = R;
            fly.vx *= -1;
            tone(420, 0.1, 'triangle', 0.06, 720);
          }
          if (fly.x > W - R) {
            fly.x = W - R;
            fly.vx *= -1;
            tone(420, 0.1, 'triangle', 0.06, 720);
          }
          if (fly.y <= TOP + R || hitAny(fly.x, fly.y, cur.grid, cur.par)) {
            submitted = true;
            submitShotToServer(cur.roundId, cur.shotNo, fly.targetAng);
            break;
          }
        }
      } else if (!fly) {
        submitted = false;
      }

      for (const p of partsRef.current) {
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.vy += 0.12 * k;
        p.l -= 0.03 * k;
      }
      partsRef.current = partsRef.current.filter((p) => p.l > 0);
      for (const f of fallRef.current) {
        f.vy += 0.5 * k;
        f.y += f.vy * k;
      }
      fallRef.current = fallRef.current.filter((f) => f.y < cur.H + 30);
      for (const f of flRef.current) {
        f.y -= 0.7 * k;
        f.l -= 0.014 * k;
      }
      flRef.current = flRef.current.filter((f) => f.l > 0);

      ctx.clearRect(0, 0, W, cur.H);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#6a8dff';
      ctx.beginPath();
      ctx.moveTo(0, TOP);
      ctx.lineTo(W, TOP);
      ctx.stroke();

      const near = cur.grid.some((row, r) => r >= cur.loseR - 1 && row.some(Boolean));
      ctx.strokeStyle = near ? `rgba(255,84,112,${0.6 + 0.4 * Math.sin(t / 120)})` : '#ff547099';
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.moveTo(0, cur.lineY);
      ctx.lineTo(W, cur.lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8da1';
      ctx.font = '700 10px Sora,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('DANGER LINE', 8, cur.lineY + 13);

      cur.grid.forEach((row, r) => {
        row.forEach((b, c) => {
          if (b) {
            const [px, py] = cellPos(r, c, cur.par);
            const sp = getSprite(b, dpr);
            ctx.drawImage(sp, px - SZ / 2, py - SZ / 2, SZ, SZ);
          }
        });
      });

      fallRef.current.forEach((f) => {
        const sp = getSprite(f.b, dpr);
        ctx.drawImage(sp, f.x - SZ / 2, f.y - SZ / 2, SZ, SZ);
      });

      for (const p of partsRef.current) {
        ctx.globalAlpha = p.l;
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      if (!flyRef.current && !cur.over) {
        for (const [x, y, d] of traj(cur, angRef.current)) {
          ctx.fillStyle = d ? '#ffffffaa' : '#a45cff';
          ctx.fillRect(x - (d ? 1.5 : 3), y - (d ? 1.5 : 3), d ? 3 : 6, d ? 3 : 6);
        }
      }

      // Launcher base & turret
      ctx.save();
      ctx.translate(W / 2, cur.ly);
      ctx.fillStyle = '#1c2a7a';
      ctx.strokeStyle = '#6a8dff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 16, 34, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(angRef.current + Math.PI / 2);
      ctx.fillStyle = '#e8ecff';
      ctx.beginPath();
      ctx.moveTo(0, -44);
      ctx.lineTo(11, -14);
      ctx.lineTo(11, 10);
      ctx.lineTo(-11, 10);
      ctx.lineTo(-11, -14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff5470';
      ctx.fillRect(-11, 2, 22, 8);
      ctx.restore();

      if (!flyRef.current && !cur.over && cur.shots > 0) {
        const sp = getSprite(cur.cur, dpr);
        const d = SZ * 0.9;
        ctx.drawImage(
          sp,
          W / 2 + Math.cos(angRef.current) * 20 - d / 2,
          cur.ly + Math.sin(angRef.current) * 20 - 2 - d / 2,
          d,
          d
        );
      } else if (flyRef.current) {
        const sp = getSprite({ c: flyRef.current.c, t: flyRef.current.t, x: 0, hp: 1 }, dpr);
        ctx.drawImage(sp, flyRef.current.x - SZ / 2, flyRef.current.y - SZ / 2, SZ, SZ);
      }

      ctx.textAlign = 'center';
      ctx.font = '800 17px Sora,sans-serif';
      for (const f of flRef.current) {
        ctx.globalAlpha = Math.min(1, f.l);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000a';
        ctx.strokeText(f.t, f.x, f.y);
        ctx.fillStyle = f.c;
        ctx.fillText(f.t, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [screen, st?.roundId, submitShotToServer, tone]);

  // Keyboard aim/fire
  useEffect(() => {
    if (screen !== 'game') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        angRef.current = Math.max(-Math.PI + 0.17, Math.min(-0.17, angRef.current - 0.05));
        e.preventDefault();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        angRef.current = Math.max(-Math.PI + 0.17, Math.min(-0.17, angRef.current + 0.05));
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
        e.preventDefault();
        fireShot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, fireShot]);

  const aimPointer = (clientX: number, clientY: number) => {
    const cv = cvRef.current;
    const cur = stRef.current;
    if (!cv || !cur) return;
    const r = cv.getBoundingClientRect();
    const x = ((clientX - r.left) * W) / r.width;
    const y = ((clientY - r.top) * cur.H) / r.height;
    angRef.current = Math.max(-Math.PI + 0.17, Math.min(-0.17, Math.atan2(Math.min(y - cur.ly, -20), x - W / 2)));
  };

  const leaveRound = async () => {
    setAskLeave(false);
    if (st && !st.over) {
      try {
        const res = await apiFetch<{ wallet: Wallet }>('/api/games/bubble/leave', {
          method: 'POST',
          body: JSON.stringify({ roundId: st.roundId }),
        });
        if (res.wallet) onWalletSync(res.wallet);
        showToast('Round left. Winnings did not count.');
      } catch {
        // ignore
      }
    }
    setSt(null);
    setSummary(null);
    setScreen('menu');
  };

  const chipStyle = (r: BubbleCell) => {
    if (r.t === 'rainbow') return 'linear-gradient(135deg,#f55,#fd3,#4d8,#4af,#a5f)';
    if (r.t !== 'n') return '#1b2050';
    return `radial-gradient(circle at 35% 30%,#ffffff88,${COL[r.c] || COL[0]} 40%)`;
  };

  return (
    <div
      className="min-h-dvh bg-[radial-gradient(90%_60%_at_50%_0,#1a2263,#070b1f_70%)] text-[#f2f5ff] flex flex-col relative overflow-hidden select-none"
      style={{ fontFamily: 'Sora, "Noto Sans Devanagari", system-ui, sans-serif' }}
    >
      {/* Floating ambient background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-35">
        <span
          className="absolute w-24 h-24 rounded-full left-[6%] top-[62%] animate-[sw88FloatOrb_9s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle at 32% 28%,#fff8,#ff4d6d 55%,transparent 72%)' }}
        />
        <span
          className="absolute w-16 h-16 rounded-full left-[78%] top-[18%] animate-[sw88FloatOrb_9s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle at 32% 28%,#fff8,#3da5ff 55%,transparent 72%)', animationDelay: '-2s' }}
        />
        <span
          className="absolute w-28 h-28 rounded-full left-[72%] top-[68%] animate-[sw88FloatOrb_9s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle at 32% 28%,#fff8,#a45cff 55%,transparent 72%)', animationDelay: '-4s' }}
        />
      </div>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#18214d] border border-white/20 px-4 py-2 rounded-xl text-xs font-semibold shadow-xl">
          {toast}
        </div>
      )}

      {screen === 'menu' ? (
        <div className="relative flex-1 max-w-[480px] w-full mx-auto px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col justify-center gap-3.5 sm:gap-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onExit}
              className="min-h-[40px] px-3 rounded-xl bg-[#0f1634] border border-white/15 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>SW88 Home</span>
            </button>
            <div className="bg-[#0f1634] border border-white/15 rounded-xl px-3.5 sm:px-4 py-1.5 font-extrabold text-xs sm:text-sm text-[#ffcf4a] tabular-nums">
              {money(wallet.mainBalance)}
            </div>
          </div>

          <div className="text-center font-extrabold text-3xl sm:text-5xl leading-none tracking-tight bg-gradient-to-b from-white via-[#9db4ff] to-[#c58bff] bg-clip-text text-transparent drop-shadow-[0_6px_24px_rgba(106,92,255,0.45)] my-1 sm:my-2">
            BUBBLE
            <br />
            ROCKET <span className="text-[#ffcf4a]">X</span>
          </div>

          <div className="rounded-[22px] bg-gradient-to-b from-[#18214d] to-[#0f1634] border border-white/15 p-4 shadow-2xl space-y-2.5">
            <label className="block text-center text-xs text-[#8b97c9]">
              Bet amount (minimum {money(game.minStake || 50)})
            </label>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => updateBet(bet - 50)}
                className="w-[50px] h-[50px] rounded-2xl bg-[#070b1f] border border-white/15 text-2xl font-bold cursor-pointer"
              >
                −
              </button>
              <div className="flex-1 h-[50px] rounded-2xl bg-[#070b1f] border border-white/15 flex items-center justify-center font-extrabold text-xl sm:text-2xl text-[#ffcf4a] tabular-nums">
                {money(bet)}
              </div>
              <button
                type="button"
                onClick={() => updateBet(bet + 50)}
                className="w-[50px] h-[50px] rounded-2xl bg-[#070b1f] border border-white/15 text-2xl font-bold cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          {wallet.mainBalance < (game.minStake || 50) && (
            <div className="rounded-xl bg-[#ff5470]/15 border border-[#ff5470]/35 p-3 text-center space-y-2">
              <div className="text-xs font-bold text-[#ff8da1]">
                Insufficient balance. Minimum bet is {money(game.minStake || 50)}.
              </div>
              <button
                type="button"
                onClick={onGoDeposit}
                className="min-h-[40px] px-4 rounded-xl bg-[#ffcf4a] text-[#070b1f] font-extrabold text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <WalletIcon className="w-3.5 h-3.5" />
                <span>Deposit Funds</span>
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={busy || wallet.mainBalance < (game.minStake || 50)}
            onClick={startRound}
            className="w-full rounded-[18px] py-3.5 sm:py-4 font-extrabold text-lg sm:text-xl bg-gradient-to-br from-[#6a8dff] to-[#a45cff] shadow-[0_10px_30px_rgba(106,92,255,0.45)] disabled:opacity-40 cursor-pointer"
          >
            {busy ? 'Starting…' : 'Play'}
          </button>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTutIdx(0)}
              className="rounded-xl py-3 bg-[#0f1634] border border-white/15 font-bold text-xs cursor-pointer"
            >
              How to play
            </button>
            <button
              type="button"
              onClick={() => setSound((s) => !s)}
              className="rounded-xl py-3 bg-[#0f1634] border border-white/15 font-bold text-xs cursor-pointer inline-flex items-center justify-center gap-1"
            >
              {sound ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>Sound {sound ? 'on' : 'off'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMusic((m) => !m)}
              className="rounded-xl py-3 bg-[#0f1634] border border-white/15 font-bold text-xs cursor-pointer"
            >
              Music {music ? 'on' : 'off'}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 max-w-[480px] w-full mx-auto px-2.5 sm:px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-[calc(env(safe-area-inset-bottom)+10px)] flex flex-col gap-2 h-dvh">
          {/* HUD */}
          <div className="grid grid-cols-[44px_repeat(4,1fr)] gap-1.5">
            <button
              type="button"
              onClick={() => (st && !st.over ? setAskLeave(true) : setScreen('menu'))}
              className="rounded-xl bg-[#0f1634] border border-white/15 font-bold text-base cursor-pointer"
              aria-label="Leave round"
            >
              ✕
            </button>
            <div className="rounded-xl bg-[#0f1634] border border-white/15 py-1.5 px-1 text-center">
              <small className="block text-[9px] text-[#8b97c9] font-bold">COINS</small>
              <b className="text-xs sm:text-sm font-extrabold tabular-nums">{money(wallet.mainBalance)}</b>
            </div>
            <div className="rounded-xl bg-[#0f1634] border border-white/15 py-1.5 px-1 text-center">
              <small className="block text-[9px] text-[#8b97c9] font-bold">SHOTS</small>
              <b className="text-xs sm:text-sm font-extrabold tabular-nums">{st?.shots ?? 0}/5</b>
            </div>
            <div className="rounded-xl bg-[#0f1634] border border-white/15 py-1.5 px-1 text-center">
              <small className="block text-[9px] text-[#8b97c9] font-bold">WINNING</small>
              <b className="text-xs sm:text-sm font-extrabold text-[#ffcf4a] tabular-nums">{money(st?.win ?? 0)}</b>
            </div>
            <div className="rounded-xl bg-[#0f1634] border border-white/15 py-1.5 px-1 text-center">
              <small className="block text-[9px] text-[#8b97c9] font-bold">NEXT</small>
              <b className="text-xs sm:text-sm font-extrabold text-[#9db4ff] tabular-nums">
                {st && st.blasts >= 5 ? '—' : money(ladder(st?.bet ?? bet, (st?.blasts ?? 0) + 1))}
              </b>
            </div>
          </div>

          {/* Canvas Board */}
          <div ref={wrapRef} className="flex-1 min-h-0 flex items-center justify-center">
            <canvas
              ref={cvRef}
              onPointerDown={(e) => aimPointer(e.clientX, e.clientY)}
              onPointerMove={(e) => {
                if (e.buttons || e.pointerType === 'mouse') aimPointer(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                aimPointer(e.clientX, e.clientY);
                fireShot();
              }}
              className="rounded-2xl border border-white/15 bg-gradient-to-b from-[#0e1544] to-[#070a22] touch-none cursor-crosshair"
            />
          </div>

          {/* Bottom Rocket Bar */}
          {st && (
            <div className="flex items-center justify-between gap-3 bg-[#0f1634] border border-white/15 rounded-2xl px-3.5 py-2">
              <div className="flex items-center gap-3">
                <div>
                  <small className="block text-[9px] text-[#8b97c9] font-bold mb-0.5">ROCKET</small>
                  <div
                    className="w-9 h-9 rounded-full border-2 border-white/40 grid place-items-center text-sm"
                    style={{ background: chipStyle(st.cur) }}
                  >
                    {st.cur.t === 'bomb' ? '💣' : st.cur.t === 'light' ? '⚡' : st.cur.t === 'rainbow' ? '🌈' : ''}
                  </div>
                </div>
                <div>
                  <small className="block text-[9px] text-[#8b97c9] font-bold mb-0.5">NEXT</small>
                  <div
                    className="w-7 h-7 rounded-full border border-white/35 grid place-items-center text-xs"
                    style={{ background: chipStyle(st.nxt) }}
                  >
                    {st.nxt.t === 'bomb' ? '💣' : st.nxt.t === 'light' ? '⚡' : st.nxt.t === 'rainbow' ? '🌈' : ''}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <small className="block text-[9px] text-[#8b97c9] font-bold mb-1">SHOTS</small>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`w-3 h-3 rounded-full transition ${
                        i < st.shots ? 'bg-[#6a8dff] shadow-[0_0_8px_#6a8dff]' : 'bg-[#2b3470] scale-75'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tutorial Modal */}
      {tutIdx !== null && (
        <div className="fixed inset-0 z-50 bg-[#050818]/90 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-gradient-to-b from-[#18214d] to-[#0f1634] border border-white/15 p-5 shadow-2xl space-y-4">
            <h2 className="text-xl font-extrabold text-white">{TUT_STEPS[tutIdx].title}</h2>
            <p className="text-sm text-[#c9d2f5] leading-relaxed">{TUT_STEPS[tutIdx].body}</p>
            <div className="flex gap-1.5 justify-center">
              {TUT_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-2 rounded-full transition ${i === tutIdx ? 'w-6 bg-[#6a8dff]' : 'w-2 bg-[#2b3470]'}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {tutIdx > 0 && (
                <button
                  type="button"
                  onClick={() => setTutIdx(tutIdx - 1)}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#0f1634] border border-white/15 font-bold text-sm cursor-pointer"
                >
                  Back
                </button>
              )}
              {tutIdx < TUT_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setTutIdx(tutIdx + 1)}
                  className="flex-[2] min-h-[44px] rounded-xl bg-gradient-to-br from-[#6a8dff] to-[#a45cff] font-extrabold text-sm cursor-pointer"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setTutIdx(null)}
                  className="flex-[2] min-h-[44px] rounded-xl bg-gradient-to-br from-[#6a8dff] to-[#a45cff] font-extrabold text-sm cursor-pointer"
                >
                  Got it
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation Modal */}
      {askLeave && (
        <div className="fixed inset-0 z-50 bg-[#050818]/90 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#18214d] to-[#0f1634] border border-white/15 p-5 shadow-2xl space-y-4">
            <h2 className="text-xl font-extrabold">Leave this round?</h2>
            <p className="text-sm text-[#c9d2f5]">
              If you leave before all 5 shots, your winnings do not count and your bet is lost.
            </p>
            <button
              type="button"
              onClick={() => setAskLeave(false)}
              className="w-full min-h-[46px] rounded-xl bg-gradient-to-br from-[#6a8dff] to-[#a45cff] font-extrabold text-sm cursor-pointer"
            >
              Keep playing
            </button>
            <button
              type="button"
              onClick={leaveRound}
              className="w-full min-h-[44px] rounded-xl bg-[#0f1634] border border-white/15 font-bold text-sm cursor-pointer"
            >
              Leave round
            </button>
          </div>
        </div>
      )}

      {/* Round Summary Modal */}
      {summary && (
        <div className="fixed inset-0 z-50 bg-[#050818]/90 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl bg-gradient-to-b from-[#18214d] to-[#0f1634] border border-white/15 p-5 shadow-2xl space-y-3">
            <h2 className="text-lg font-extrabold text-center">
              {summary.out ? 'DISQUALIFIED' : 'ROUND COMPLETED'}
            </h2>
            <div className={`text-4xl font-extrabold text-center ${summary.win ? 'text-[#ffcf4a]' : 'text-[#ff5470]'}`}>
              {summary.win ? 'WIN' : 'LOSE'}
            </div>
            <div className={`text-3xl font-extrabold text-center tabular-nums ${summary.win ? 'text-[#ffcf4a]' : 'text-[#ff5470]'}`}>
              {money(summary.final)}
            </div>
            <p className="text-xs text-center text-[#c9d2f5]">
              {summary.out
                ? 'You crossed the danger line, so your reward does not count.'
                : summary.win
                ? 'Credited directly to your SW88 wallet.'
                : 'Final amount is less than your bet.'}
            </p>

            <div className="text-xs font-bold text-[#8b97c9] pt-1">SUMMARY</div>
            <table className="w-full text-xs border-collapse">
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="py-1.5">Total shots completed</td>
                  <td className="py-1.5 text-right font-bold">{summary.played}/5</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-1.5">Blasts / Misses</td>
                  <td className="py-1.5 text-right font-bold">
                    {summary.wonCount} / {summary.lostCount}
                  </td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-1.5">Crossed danger line</td>
                  <td className={`py-1.5 text-right font-bold ${summary.out ? 'text-[#ff5470]' : 'text-[#35e0a1]'}`}>
                    {summary.out ? 'Yes' : 'No'}
                  </td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-1.5">Total betting amount</td>
                  <td className="py-1.5 text-right font-bold">{money(summary.bet)}</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-1.5">Final amount earned</td>
                  <td className="py-1.5 text-right font-bold text-[#ffcf4a]">{money(summary.final)}</td>
                </tr>
              </tbody>
            </table>

            <div className="text-xs font-bold text-[#8b97c9] pt-1">REWARD PER SHOT</div>
            <table className="w-full text-xs border-collapse">
              <tbody>
                {[0, 1, 2, 3, 4].map((i) => {
                  const r = summary.rounds[i];
                  return (
                    <tr key={i} className="border-b border-white/10">
                      <td className="py-1.5">Shot {i + 1}</td>
                      <td className={`py-1.5 ${r?.won ? 'text-[#35e0a1]' : r?.x ? 'text-[#ff5470]' : 'text-[#8b97c9]'}`}>
                        {!r ? 'Not played' : r.x ? '⚠ Crossed line' : r.won ? '✔ Blast' : '✖ Miss'}
                      </td>
                      <td className="py-1.5 text-right font-bold">{r?.won ? money(r.r) : 'रु 0'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex flex-col gap-2 pt-2">
              {wallet.mainBalance >= bet ? (
                <button
                  type="button"
                  onClick={startRound}
                  className="w-full min-h-[46px] rounded-xl bg-gradient-to-br from-[#6a8dff] to-[#a45cff] font-extrabold text-sm cursor-pointer"
                >
                  PLAY AGAIN ({money(bet)})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onGoDeposit}
                  className="w-full min-h-[46px] rounded-xl bg-[#ffcf4a] text-[#070b1f] font-extrabold text-sm cursor-pointer"
                >
                  DEPOSIT TO PLAY AGAIN
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSummary(null);
                  setSt(null);
                  setScreen('menu');
                }}
                className="w-full min-h-[42px] rounded-xl bg-[#0f1634] border border-white/15 font-bold text-sm cursor-pointer"
              >
                MAIN MENU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
