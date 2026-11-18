import crypto from 'crypto';
import { Router, type Response } from 'express';
import { db, getMaintenanceState } from './db.ts';
import { checkMaintenanceMode, requireAuth, requireActiveUser, type AuthedRequest } from './auth.ts';
import { broadcastAll, emitToUser } from './realtime.ts';
import { makeId, roundMoney } from './utils.ts';
import { creditWallet, debitWallet, getWallet } from './walletService.ts';

interface GameConfig {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  enabled: boolean;
  minStake: number;
  maxStake: number;
  houseEdgePct: number;
  settings: Record<string, any>;
}

export function getGameConfig(gameId: string): GameConfig {
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId) as any;
  if (!row) throw new Error(`Game ${gameId} not found`);
  let settings = {};
  try {
    settings = JSON.parse(row.settings_json || '{}');
  } catch {
    settings = {};
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    thumbnail: row.thumbnail,
    enabled: Boolean(row.enabled),
    minStake: Number(row.min_stake),
    maxStake: Number(row.max_stake),
    houseEdgePct: Number(row.house_edge_pct),
    settings,
  };
}

function recordLossStat(userId: number, lossAmount: number) {
  const amt = roundMoney(lossAmount);
  if (amt > 0) {
    db.prepare(`UPDATE wallets SET total_lost = total_lost + ?, updated_at = datetime('now') WHERE user_id = ?`).run(
      amt,
      userId
    );
  }
}

// ============================================================================
// 1. 3 PATTI ROYALE (SERVER-AUTHORITATIVE)
// ============================================================================

const FN =
  'Aarav Bikash Sujan Rohan Prabin Anil Sagar Nabin Dipesh Kiran Manish Rajesh Suresh Binod Ramesh Ashish Bibek Niraj Pawan Roshan Sandeep Tilak Utsav Yogesh Hari Gopal Krishna Madan Narayan Om Pratik Santosh Rabin Sunil Umesh Vivek Aman Dev Karan Rahul Bishal Sanjay Prakash Dinesh Rajan Bijay Kamal Laxman Bhim Arjun Ganesh Mahesh Naresh Shyam Dilip Rakesh Sudip Samir Sabin Anup Ajay Amit Binay Bipin Deepak Gaurav Himal Ishwor Jeevan Kushal Lokesh Manoj Nirajan Prem Puskar Rajendra Rupesh Sahil Saroj Shiva Subash Sushil Suman Tej Uttam Yubaraj Bhuwan Chiranjibi Dhiraj Devendra Nishan Padam Bhupendra Ritesh Sunny Anish Basanta Janak Khagendra Mohan Nirmal Rewat Tirtha Yam Sanju'.split(
    ' '
  );
const LN =
  'Sharma Thapa Karki Adhikari Gurung Rai Shrestha Tamang Poudel Bhandari Khadka Magar Basnet Limbu Chaudhary Neupane Subedi Bhattarai Koirala Dahal Ghimire Regmi Khanal Pandey Upadhyaya Acharya Bista Rana Oli Pokharel Lamichhane Dhakal Timilsina Baral Chhetri Basyal Sherpa Maharjan Dangol Joshi Pradhan Tuladhar Shakya Manandhar Rajbhandari Thakuri Kunwar Pun Ale Sunuwar Yadav Mahato Mandal Sah Gupta Singh Bohara Rawal Rokaya Bam Budha Malla Hamal Giri Puri Bhatta Mishra Jha'.split(
    ' '
  );
const PERS = [
  { n: 'Aggressive', agg: 0.7, fold: 0.16, bluff: 0.25, blind: false },
  { n: 'Cautious', agg: 0.25, fold: 0.3, bluff: 0.05, blind: false },
  { n: 'Tricky', agg: 0.45, fold: 0.22, bluff: 0.15, blind: false },
  { n: 'Blind Pro', agg: 0.85, fold: 0.1, bluff: 0.3, blind: true },
];
const PATTI_COLORS = ['#b3402d', '#2b6cb0', '#7b4fa0', '#2f855a', '#b7791f'];

interface Card {
  r: number; // 2..14
  s: number; // 0..3
}

function evalPattiHand(c: Card[]) {
  const r = c.map((x) => x.r).sort((a, b) => b - a);
  const fl = c.every((x) => x.s === c[0].s);
  let sq = false;
  let top = r[0];
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1) sq = true;
  else if (r[0] === 14 && r[1] === 3 && r[2] === 2) {
    sq = true;
    top = 15;
  }
  let t = 1;
  let a = 0;
  let b = 0;
  let k = 0;
  if (r[0] === r[1] && r[1] === r[2]) {
    t = 6;
    a = r[0];
  } else if (sq && fl) {
    t = 5;
    a = top;
  } else if (sq) {
    t = 4;
    a = top;
  } else if (fl) {
    t = 3;
    [a, b, k] = r;
  } else if (r[0] === r[1] || r[1] === r[2]) {
    t = 2;
    a = r[1];
    b = r[0] === r[1] ? r[2] : r[0];
  } else {
    t = 1;
    [a, b, k] = r;
  }
  const nm = ['', 'High Card', 'Pair', 'Color (Flush)', 'Sequence', 'Pure Sequence', 'Trail (Three of a Kind)'][t];
  return { t, top: r[0], score: t * 1e6 + a * 1e4 + b * 100 + k, name: nm };
}

const ALL_PATTI_SCORES = (() => {
  const arr: number[] = [];
  for (let x = 0; x < 52; x++) {
    for (let y = x + 1; y < 52; y++) {
      for (let z = y + 1; z < 52; z++) {
        const cards = [x, y, z].map((k) => ({ r: (k % 13) + 2, s: Math.floor(k / 13) }));
        arr.push(evalPattiHand(cards).score);
      }
    }
  }
  return arr.sort((u, v) => u - v);
})();

function pctlScore(sc: number): number {
  let lo = 0;
  let hi = ALL_PATTI_SCORES.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ALL_PATTI_SCORES[m] < sc) lo = m + 1;
    else hi = m;
  }
  return lo / ALL_PATTI_SCORES.length;
}

function cryptoRandomFloat(): number {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

function shuffleCrypto<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickAiName(used: string[]): string {
  for (let i = 0; i < 40; i++) {
    const name = `${FN[crypto.randomInt(0, FN.length)]} ${LN[crypto.randomInt(0, LN.length)]}`;
    if (!used.includes(name)) return name;
  }
  return `Player ${crypto.randomInt(100, 999)}`;
}

interface PattiPlayerState {
  name: string;
  bal: number;
  h?: boolean;
  p?: (typeof PERS)[number];
  col: string;
  cards: Card[];
  seen: boolean;
  packed: boolean;
  won: boolean;
  shown: boolean;
  turns: number;
  paid: number;
}

interface PattiState {
  roundId: string;
  tableId?: string;
  boot: number;
  blindMax: number;
  pot: number;
  stake: number;
  turn: number;
  first: number;
  lastRaiser: number;
  phase: 'play' | 'end';
  reveal: boolean;
  winnerIdx: number | null;
  winHandName: string | null;
  players: PattiPlayerState[];
  logs: string[];
}

function sanitizePattiState(st: PattiState, userMainBalance: number) {
  return {
    roundId: st.roundId,
    tableId: st.tableId || st.roundId,
    boot: st.boot,
    blindMax: st.blindMax,
    pot: st.pot,
    stake: st.stake,
    turn: st.turn,
    phase: st.phase,
    reveal: st.reveal,
    winnerIdx: st.winnerIdx,
    winHandName: st.winHandName,
    logs: st.logs.slice(0, 30),
    players: st.players.map((p, idx) => {
      const canSeeCards =
        idx === 0
          ? p.seen || p.shown || st.reveal
          : st.reveal && !p.packed;
      return {
        name: p.name,
        bal: idx === 0 ? userMainBalance : p.bal,
        h: Boolean(p.h),
        persName: p.p?.n || null,
        col: p.col,
        seen: p.seen,
        packed: p.packed,
        won: p.won,
        shown: p.shown,
        paid: p.paid,
        cards: canSeeCards ? p.cards : null,
        handEval: canSeeCards ? evalPattiHand(p.cards) : null,
      };
    }),
  };
}

function pattiCost(p: PattiPlayerState, stake: number, raise: boolean): number {
  return (p.seen ? 2 : 1) * stake * (raise ? 2 : 1);
}

function pattiCardStr(c: Card): string {
  const R: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return (R[c.r] || String(c.r)) + '♠♥♦♣'[c.s];
}

function settlePattiRound(
  roundId: string,
  userId: number,
  userUid: string,
  st: PattiState,
  winnerIdx: number,
  shown: boolean
) {
  st.phase = 'end';
  st.winnerIdx = winnerIdx;
  const winner = st.players[winnerIdx];
  winner.won = true;
  if (winner.h) winner.shown = true;
  if (shown) st.reveal = true;

  const h = evalPattiHand(winner.cards);
  st.winHandName = shown ? h.name : null;

  const amt = st.pot;
  if (winner.h) {
    winner.bal = roundMoney(winner.bal + amt);
  } else {
    winner.bal += amt;
  }

  if (shown) {
    const line = st.players
      .map((p) => (p.packed ? '' : `${p.name}: ${p.cards.map(pattiCardStr).join(' ')} (${evalPattiHand(p.cards).name})`))
      .filter(Boolean)
      .join(' | ');
    if (line) st.logs.unshift(line);
  }
  st.logs.unshift(`🏆 ${winner.name} wins Rs ${amt}${shown ? ' with ' + h.name : ''}`);

  const humanPaid = st.players[0].paid;
  let walletAfter = getWallet(userId).mainBalance;

  if (winner.h) {
    const payoutRes = creditWallet({
      userId,
      txType: 'GAME_PAYOUT',
      amount: amt,
      relatedId: roundId,
      idempotencyKey: `3patti-payout-${roundId}`,
      note: `3 Patti Royale win (Rs ${amt})`,
      countAsWinnings: true,
    });
    walletAfter = payoutRes.wallet.mainBalance;

    db.prepare(`
      UPDATE game_rounds
      SET stake = ?, payout = ?, net_result = ?, result = 'WIN', wallet_after = ?, state_json = ?, settled_at = datetime('now')
      WHERE id = ?
    `).run(humanPaid, amt, roundMoney(amt - humanPaid), walletAfter, JSON.stringify(st), roundId);

    db.prepare(`
      INSERT OR IGNORE INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
      VALUES (?, ?, '3-patti-royale', ?, ?, 'PAYOUT', ?, ?, ?, ?)
    `).run(makeId('GTX'), roundId, userId, userUid, amt, roundMoney(walletAfter - amt), walletAfter, `gtx-payout-${roundId}`);
  } else {
    db.prepare(`
      UPDATE game_rounds
      SET stake = ?, payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, state_json = ?, settled_at = datetime('now')
      WHERE id = ?
    `).run(humanPaid, roundMoney(-humanPaid), walletAfter, JSON.stringify(st), roundId);

    recordLossStat(userId, humanPaid);
  }

  st.pot = 0;
  return amt;
}

function advancePattiTurn(st: PattiState): { ended: boolean; winnerIdx?: number } {
  const active = st.players.filter((p) => !p.packed);
  if (active.length <= 1) {
    const winIdx = st.players.findIndex((p) => !p.packed);
    return { ended: true, winnerIdx: winIdx >= 0 ? winIdx : 1 };
  }
  do {
    st.turn = (st.turn + 1) % st.players.length;
  } while (st.players[st.turn].packed);
  return { ended: false };
}

// ============================================================================
// 2. BUBBLE ROCKET X (FAIR SERVER-AUTHORITATIVE)
// ============================================================================

const BRX_R = 18;
const BRX_W = 360;
const BRX_TOP = 8;
const BRX_RH = BRX_R * 1.732;
const BRX_LADDER = (b: number, n: number) => (n < 1 ? 0 : Math.round((b / 2) * 2 ** (n - 1)));

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

function brxOdd(r: number, par: number): number {
  return (r + par) & 1;
}
function brxCols(r: number, par: number): number {
  return brxOdd(r, par) ? 9 : 10;
}
function brxPos(r: number, c: number, par: number): [number, number] {
  return [(brxOdd(r, par) ? 2 * BRX_R : BRX_R) + 2 * BRX_R * c, BRX_TOP + BRX_R + r * BRX_RH];
}
function brxNb(r: number, c: number, par: number, gr: number): Array<[number, number]> {
  const dirs = brxOdd(r, par)
    ? [
        [0, -1],
        [0, 1],
        [-1, 0],
        [-1, 1],
        [1, 0],
        [1, 1],
      ]
    : [
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 0],
        [1, -1],
        [1, 0],
      ];
  return dirs
    .map(([a, b]) => [r + a, c + b] as [number, number])
    .filter(([a, b]) => a >= 0 && a < gr && b >= 0 && b < brxCols(a, par));
}

function brxPresentColors(grid: Array<Array<BubbleCell | null>>): number[] {
  const s = new Set<number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) s.add(cell.c);
    }
  }
  return [...s];
}

function brxMakeRocket(first: boolean, grid: Array<Array<BubbleCell | null>>): BubbleCell {
  const r = cryptoRandomFloat();
  const p = brxPresentColors(grid);
  let t: BubbleCell['t'] = 'n';
  if (!first) {
    if (r < 0.06) t = 'rainbow';
    else if (r < 0.09) t = 'bomb';
    else if (r < 0.12) t = 'light';
  }
  const c = p.length ? p[crypto.randomInt(0, p.length)] : 0;
  return { c, x: 0, hp: 1, t };
}

function brxDrop(st: BubbleState, silent: boolean) {
  const ok = new Set<string>();
  const q: Array<[number, number]> = [];
  st.grid[0].forEach((b, c) => {
    if (b) {
      ok.add(`0,${c}`);
      q.push([0, c]);
    }
  });
  while (q.length) {
    const [r, c] = q.pop()!;
    for (const [a, b] of brxNb(r, c, st.par, st.gr)) {
      if (st.grid[a][b] && !ok.has(`${a},${b}`)) {
        ok.add(`${a},${b}`);
        q.push([a, b]);
      }
    }
  }
  const dropped: Array<{ r: number; c: number; cell: BubbleCell }> = [];
  st.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell && !ok.has(`${r},${c}`)) {
        st.grid[r][c] = null;
        if (!silent) {
          st.pops++;
          dropped.push({ r, c, cell });
        }
      }
    });
  });
  return dropped;
}

function brxBuildBoard(H: number): { grid: Array<Array<BubbleCell | null>>; lineY: number; ly: number; loseR: number; gr: number } {
  const clampedH = Math.max(460, Math.min(820, Math.round(H || 560)));
  const lineY = clampedH - 150;
  const ly = clampedH - 52;
  const loseR = Math.ceil((lineY - BRX_TOP - 2 * BRX_R) / BRX_RH);
  const gr = loseR + 3;
  const par = 0;
  const k = 5; // consistent 5 colors (fair, zero secret rigging)
  const fz = 0.14;
  const rows = loseR - 2;

  const grid: Array<Array<BubbleCell | null>> = [];
  for (let r = 0; r < gr; r++) {
    const rowLen = brxCols(r, par);
    const row: Array<BubbleCell | null> = Array(rowLen).fill(null);
    grid.push(row);
    if (r < rows) {
      for (let c = 0; c < rowLen; c++) {
        if (r > 0 && cryptoRandomFloat() < 0.12) continue;
        let col = crypto.randomInt(0, k);
        const l = c > 0 ? grid[r][c - 1] : null;
        const u = r > 0 ? grid[r - 1][Math.min(c, brxCols(r - 1, par) - 1)] : null;
        if (cryptoRandomFloat() < 0.5) {
          const s = [l, u].filter(Boolean) as BubbleCell[];
          if (s.length) col = s[crypto.randomInt(0, s.length)].c;
        }
        const cell: BubbleCell = { c: col, x: 0, hp: 1, t: 'n' };
        if (cryptoRandomFloat() < fz) {
          cell.hp = 2;
          cell.t = 'frozen';
        }
        grid[r][c] = cell;
      }
    }
  }
  return { grid, lineY, ly, loseR, gr };
}

function brxHitAny(st: BubbleState, x: number, y: number): boolean {
  for (let r = 0; r < st.gr; r++) {
    const row = st.grid[r];
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      const [px, py] = brxPos(r, c, st.par);
      if ((px - x) ** 2 + (py - y) ** 2 < (BRX_R * 1.8) ** 2) return true;
    }
  }
  return false;
}

function brxSnap(st: BubbleState, x: number, y: number): [number, number] {
  let best: [number, number] | null = null;
  let bd = 1e12;
  for (let r = 0; r < st.gr; r++) {
    const len = brxCols(r, st.par);
    for (let c = 0; c < len; c++) {
      if (st.grid[r][c]) continue;
      if (r > 0 && !brxNb(r, c, st.par, st.gr).some(([a, b]) => st.grid[a][b])) continue;
      const [px, py] = brxPos(r, c, st.par);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) {
        bd = d;
        best = [r, c];
      }
    }
  }
  return best || [st.gr - 1, 0];
}

function brxFlood(st: BubbleState, r: number, c: number): Array<[number, number]> {
  const k = st.grid[r][c]?.c;
  const seen = new Set<string>([`${r},${c}`]);
  const q: Array<[number, number]> = [[r, c]];
  const out: Array<[number, number]> = [];
  while (q.length) {
    const [a, b] = q.pop()!;
    out.push([a, b]);
    for (const [x, y] of brxNb(a, b, st.par, st.gr)) {
      const o = st.grid[x][y];
      if (o && o.c === k && !seen.has(`${x},${y}`)) {
        seen.add(`${x},${y}`);
        q.push([x, y]);
      }
    }
  }
  return out;
}

function brxAddRow(st: BubbleState) {
  st.par ^= 1;
  const len = brxCols(0, st.par);
  const p = brxPresentColors(st.grid);
  const k = p.length ? p : [0];
  const newRow: Array<BubbleCell | null> = Array(len).fill(null);
  for (let c = 0; c < len; c++) {
    newRow[c] = { c: k[crypto.randomInt(0, k.length)], x: 0, hp: 1, t: 'n' };
  }
  st.grid.unshift(newRow);
  st.grid.pop();
}

function brxCrossed(st: BubbleState): boolean {
  return st.grid.some((row, r) => r >= st.loseR && row.some(Boolean));
}

// ============================================================================
// 3. SKYLINE CRASH LIVE SERVER ENGINE (FAIR & AUTHORITATIVE)
// ============================================================================

interface SkylineActiveBet {
  userId: number;
  userUid: string;
  username: string;
  roundId: string;
  betRoundId: string;
  amount: number;
  cashed: boolean;
  cashoutMult: number | null;
  payout: number;
}

class SkylineCrashEngine {
  phase: 'WAITING' | 'FLYING' | 'CRASHED' = 'WAITING';
  roundId = makeId('SKY');
  countdownMs = 5000;
  phaseStartMs = Date.now();
  crashPoint = 2.0;
  speed = 0.11;
  maxMultiplier = 16.8;
  houseEdgePct = 8;
  currentMult = 1.0;
  history: Array<{ roundId: string; m: number; maxReached: boolean }> = [];
  bets = new Map<number, SkylineActiveBet>();
  private tickTimer: NodeJS.Timeout | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    // Recover any dangling ACTIVE skyline rounds from before a crash/restart
    const dangling = db.prepare(`SELECT * FROM game_rounds WHERE game_id = 'skyline-crash' AND result = 'ACTIVE'`).all() as any[];
    for (const r of dangling) {
      try {
        creditWallet({
          userId: r.user_id,
          txType: 'GAME_REFUND',
          amount: r.stake,
          relatedId: r.id,
          idempotencyKey: `sky-recover-${r.id}`,
          note: 'Server restart refund for active Skyline Crash bet',
        });
        db.prepare(`UPDATE wallets SET total_staked = MAX(0, total_staked - ?) WHERE user_id = ?`).run(r.stake, r.user_id);
        db.prepare(`UPDATE game_rounds SET result = 'CANCELLED', settled_at = datetime('now') WHERE id = ?`).run(r.id);
      } catch {
        // Ignore duplicate
      }
    }

    this.enterWaiting();
    this.tickTimer = setInterval(() => this.tick(), 100);
  }

  private reloadConfig() {
    try {
      const cfg = getGameConfig('skyline-crash');
      this.houseEdgePct = Math.max(0, Math.min(30, cfg.houseEdgePct ?? 8));
      this.speed = Number(cfg.settings.speed || 0.11);
      this.maxMultiplier = Number(cfg.settings.maxMultiplier || 16.8);
      this.countdownMs = Math.max(3, Number(cfg.settings.countdownSeconds || 5)) * 1000;
    } catch {
      // keep defaults
    }
  }

  private generateFairCrashPoint(): number {
    // Fair inverse transform with transparent houseEdgePct, zero per-user or per-stake manipulation
    const buf = crypto.randomBytes(6);
    const num = buf.readUIntBE(0, 6);
    const u = num / 2 ** 48; // [0, 1)
    const edgeFactor = Math.max(0.5, 1 - this.houseEdgePct / 100);
    if (u < this.houseEdgePct / 100) {
      return 1.0;
    }
    const raw = Math.floor((100 * edgeFactor) / (1 - u)) / 100;
    return Math.min(this.maxMultiplier, Math.max(1.0, raw));
  }

  private enterWaiting() {
    this.reloadConfig();
    this.phase = 'WAITING';
    this.roundId = makeId('SKY');
    this.phaseStartMs = Date.now();
    this.currentMult = 1.0;
    this.bets.clear();
    this.broadcastState();
  }

  private enterFlying() {
    this.phase = 'FLYING';
    this.phaseStartMs = Date.now();
    this.crashPoint = this.generateFairCrashPoint();
    this.currentMult = 1.0;
    this.broadcastState();
  }

  private enterCrashed() {
    this.phase = 'CRASHED';
    this.phaseStartMs = Date.now();
    this.currentMult = this.crashPoint;
    const maxReached = this.crashPoint >= this.maxMultiplier;

    // Settle all remaining active bets
    for (const bet of this.bets.values()) {
      if (bet.cashed) continue;
      if (maxReached) {
        const winAmt = Math.floor(bet.amount * this.maxMultiplier);
        bet.cashed = true;
        bet.cashoutMult = this.maxMultiplier;
        bet.payout = winAmt;
        const payRes = creditWallet({
          userId: bet.userId,
          txType: 'GAME_PAYOUT',
          amount: winAmt,
          relatedId: bet.betRoundId,
          idempotencyKey: `sky-autocash-${bet.betRoundId}`,
          note: `Skyline Crash max ${this.maxMultiplier}x auto cashout`,
          countAsWinnings: true,
        });
        db.prepare(`
          UPDATE game_rounds
          SET payout = ?, net_result = ?, result = 'WIN', wallet_after = ?, settled_at = datetime('now')
          WHERE id = ?
        `).run(winAmt, roundMoney(winAmt - bet.amount), payRes.wallet.mainBalance, bet.betRoundId);
        db.prepare(`
          INSERT OR IGNORE INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
          VALUES (?, ?, 'skyline-crash', ?, ?, 'AUTO_CASHOUT', ?, ?, ?, ?)
        `).run(
          makeId('GTX'),
          bet.betRoundId,
          bet.userId,
          bet.userUid,
          winAmt,
          roundMoney(payRes.wallet.mainBalance - winAmt),
          payRes.wallet.mainBalance,
          `gtx-autocash-${bet.betRoundId}`
        );
        emitToUser(bet.userId, 'skyline:settled', {
          roundId: this.roundId,
          result: 'WIN',
          bet: bet.amount,
          payout: winAmt,
          mult: this.maxMultiplier,
        });
      } else {
        const walletNow = getWallet(bet.userId).mainBalance;
        db.prepare(`
          UPDATE game_rounds
          SET payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, settled_at = datetime('now')
          WHERE id = ?
        `).run(roundMoney(-bet.amount), walletNow, bet.betRoundId);
        recordLossStat(bet.userId, bet.amount);
        emitToUser(bet.userId, 'skyline:settled', {
          roundId: this.roundId,
          result: 'LOSS',
          bet: bet.amount,
          payout: 0,
          mult: this.crashPoint,
        });
      }
    }

    this.history.unshift({ roundId: this.roundId, m: this.crashPoint, maxReached });
    this.history = this.history.slice(0, 10);
    this.broadcastState();
  }

  private tick() {
    const now = Date.now();
    if (this.phase === 'WAITING') {
      const elapsed = now - this.phaseStartMs;
      if (elapsed >= this.countdownMs) {
        this.enterFlying();
      } else if (elapsed % 500 < 110) {
        this.broadcastState();
      }
    } else if (this.phase === 'FLYING') {
      const elapsedSec = (now - this.phaseStartMs) / 1000;
      const mult = Math.exp(this.speed * elapsedSec);
      if (mult >= this.crashPoint) {
        this.enterCrashed();
      } else {
        this.currentMult = Math.round(mult * 100) / 100;
        if (Math.floor(elapsedSec * 10) % 2 === 0) {
          this.broadcastState();
        }
      }
    } else if (this.phase === 'CRASHED') {
      if (now - this.phaseStartMs >= 3200) {
        this.enterWaiting();
      }
    }
  }

  getPublicState(userId?: number) {
    const now = Date.now();
    const myBet = userId ? this.bets.get(userId) || null : null;
    return {
      phase: this.phase,
      roundId: this.roundId,
      countdownMs: this.phase === 'WAITING' ? Math.max(0, this.countdownMs - (now - this.phaseStartMs)) : 0,
      elapsedMs: this.phase === 'FLYING' ? now - this.phaseStartMs : 0,
      multiplier: this.currentMult,
      speed: this.speed,
      maxMultiplier: this.maxMultiplier,
      history: this.history,
      myBet: myBet
        ? {
            amount: myBet.amount,
            cashed: myBet.cashed,
            cashoutMult: myBet.cashoutMult,
            payout: myBet.payout,
          }
        : null,
    };
  }

  private broadcastState() {
    broadcastAll('skyline:state', this.getPublicState());
  }

  placeBet(userId: number, userUid: string, username: string, amount: number, idempotencyKey?: string) {
    const cfg = getGameConfig('skyline-crash');
    if (!cfg.enabled) throw new Error('Skyline Crash is currently disabled by administrator.');
    if (this.phase !== 'WAITING') throw new Error('Betting is only allowed before takeoff.');

    const cleanAmt = Math.floor(Number(amount));
    if (!Number.isFinite(cleanAmt) || cleanAmt < cfg.minStake || cleanAmt > cfg.maxStake) {
      throw new Error(`Bet must be between NPR ${cfg.minStake} and NPR ${cfg.maxStake}.`);
    }

    const existing = this.bets.get(userId);
    if (existing) {
      return { state: this.getPublicState(userId), wallet: getWallet(userId), duplicate: true };
    }

    const betRoundId = makeId('RND');
    const debit = debitWallet({
      userId,
      txType: 'GAME_STAKE',
      amount: cleanAmt,
      relatedId: betRoundId,
      idempotencyKey: idempotencyKey || `sky-bet-${this.roundId}-${userId}`,
      note: `Skyline Crash bet (Round ${this.roundId})`,
      countAsStake: true,
    });

    if (!debit.duplicate) {
      const prevBal = roundMoney(debit.wallet.mainBalance + cleanAmt);
      db.prepare(`
        INSERT INTO game_rounds (id, game_id, user_id, user_uid, stake, payout, net_result, result, wallet_before, wallet_after, state_json, idempotency_key)
        VALUES (?, 'skyline-crash', ?, ?, ?, 0, 0, 'ACTIVE', ?, ?, ?, ?)
      `).run(
        betRoundId,
        userId,
        userUid,
        cleanAmt,
        prevBal,
        debit.wallet.mainBalance,
        JSON.stringify({ skylineRoundId: this.roundId }),
        idempotencyKey || null
      );

      db.prepare(`
        INSERT INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
        VALUES (?, ?, 'skyline-crash', ?, ?, 'BET_PLACED', ?, ?, ?, ?)
      `).run(makeId('GTX'), betRoundId, userId, userUid, cleanAmt, prevBal, debit.wallet.mainBalance, `gtx-sky-bet-${betRoundId}`);

      this.bets.set(userId, {
        userId,
        userUid,
        username,
        roundId: this.roundId,
        betRoundId,
        amount: cleanAmt,
        cashed: false,
        cashoutMult: null,
        payout: 0,
      });
    }

    return { state: this.getPublicState(userId), wallet: debit.wallet, duplicate: debit.duplicate };
  }

  cancelBet(userId: number) {
    if (this.phase !== 'WAITING') throw new Error('Cannot cancel after plane has taken off.');
    const bet = this.bets.get(userId);
    if (!bet) throw new Error('No active bet to cancel.');

    const refund = creditWallet({
      userId,
      txType: 'GAME_REFUND',
      amount: bet.amount,
      relatedId: bet.betRoundId,
      idempotencyKey: `sky-cancel-${bet.betRoundId}`,
      note: `Skyline Crash bet cancelled (${this.roundId})`,
    });

    if (!refund.duplicate) {
      db.prepare(`UPDATE wallets SET total_staked = MAX(0, total_staked - ?) WHERE user_id = ?`).run(bet.amount, userId);
      db.prepare(`UPDATE game_rounds SET result = 'CANCELLED', wallet_after = ?, settled_at = datetime('now') WHERE id = ?`).run(
        refund.wallet.mainBalance,
        bet.betRoundId
      );
      db.prepare(`
        INSERT INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after)
        VALUES (?, ?, 'skyline-crash', ?, ?, 'BET_CANCELLED', ?, ?, ?)
      `).run(
        makeId('GTX'),
        bet.betRoundId,
        userId,
        bet.userUid,
        bet.amount,
        roundMoney(refund.wallet.mainBalance - bet.amount),
        refund.wallet.mainBalance
      );
    }
    this.bets.delete(userId);
    return { state: this.getPublicState(userId), wallet: refund.wallet };
  }

  cashout(userId: number, idempotencyKey?: string) {
    if (this.phase !== 'FLYING') throw new Error('Plane is not in flight.');
    const bet = this.bets.get(userId);
    if (!bet) throw new Error('You do not have an active bet in this round.');
    if (bet.cashed) {
      return {
        state: this.getPublicState(userId),
        wallet: getWallet(userId),
        payout: bet.payout,
        mult: bet.cashoutMult,
        duplicate: true,
      };
    }

    const elapsedSec = (Date.now() - this.phaseStartMs) / 1000;
    const liveMult = Math.round(Math.exp(this.speed * elapsedSec) * 100) / 100;
    if (liveMult >= this.crashPoint) {
      this.enterCrashed();
      throw new Error('Plane already flew away.');
    }

    const payout = Math.floor(bet.amount * liveMult);
    bet.cashed = true;
    bet.cashoutMult = liveMult;
    bet.payout = payout;

    const payRes = creditWallet({
      userId,
      txType: 'GAME_PAYOUT',
      amount: payout,
      relatedId: bet.betRoundId,
      idempotencyKey: idempotencyKey || `sky-cashout-${bet.betRoundId}`,
      note: `Skyline Crash cashed out at ${liveMult.toFixed(2)}x`,
      countAsWinnings: true,
    });

    if (!payRes.duplicate) {
      const prevBal = roundMoney(payRes.wallet.mainBalance - payout);
      db.prepare(`
        UPDATE game_rounds
        SET payout = ?, net_result = ?, result = 'WIN', wallet_after = ?, settled_at = datetime('now')
        WHERE id = ?
      `).run(payout, roundMoney(payout - bet.amount), payRes.wallet.mainBalance, bet.betRoundId);

      db.prepare(`
        INSERT INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
        VALUES (?, ?, 'skyline-crash', ?, ?, 'CASHOUT', ?, ?, ?, ?)
      `).run(
        makeId('GTX'),
        bet.betRoundId,
        userId,
        bet.userUid,
        payout,
        prevBal,
        payRes.wallet.mainBalance,
        `gtx-cash-${bet.betRoundId}`
      );
    }

    return {
      state: this.getPublicState(userId),
      wallet: payRes.wallet,
      payout,
      mult: liveMult,
      netWin: roundMoney(payout - bet.amount),
      duplicate: false,
    };
  }
}

export const skylineEngine = new SkylineCrashEngine();

// ============================================================================
// GAME ROUTER
// ============================================================================

export const gameRouter = Router();
gameRouter.use(requireAuth, requireActiveUser);

// --- 3 PATTI ROYALE ENDPOINTS ---

gameRouter.get('/3patti/matchmaking', checkMaintenanceMode, (req: AuthedRequest, res: Response) => {
  const maint = getMaintenanceState();
  if (maint.enabled && req.user?.role !== 'ADMIN') {
    return res.status(503).json({ code: 'MAINTENANCE_MODE', error: maint.message });
  }
  const cfg = getGameConfig('3-patti-royale');
  if (!cfg.enabled) {
    return res.status(403).json({ error: '3 Patti Royale is currently disabled by administrator.' });
  }
  const boot = Number(cfg.settings.boot || cfg.minStake || 5);
  const wallet = getWallet(req.user!.id);
  const activeRow = db
    .prepare(`SELECT id FROM game_rounds WHERE game_id = '3-patti-royale' AND user_id = ? AND result = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`)
    .get(req.user!.id) as { id: string } | undefined;

  if (!activeRow && wallet.mainBalance < boot) {
    return res.status(400).json({
      code: 'INSUFFICIENT_BALANCE',
      error: `Insufficient balance to join table. Minimum boot stake is Rs ${boot}. Available: Rs ${wallet.mainBalance}.`,
      boot,
      walletBalance: wallet.mainBalance,
    });
  }

  return res.json({
    ok: true,
    tableReady: true,
    boot,
    minStake: cfg.minStake,
    maxStake: cfg.maxStake,
    hasActiveRound: Boolean(activeRow),
    activeRoundId: activeRow?.id || null,
    walletBalance: wallet.mainBalance,
    serverTime: new Date().toISOString(),
  });
});

gameRouter.get('/3patti/active', (req: AuthedRequest, res: Response) => {
  const row = db
    .prepare(`SELECT * FROM game_rounds WHERE game_id = '3-patti-royale' AND user_id = ? AND result = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`)
    .get(req.user!.id) as any;
  if (!row) return res.json({ active: false });
  const st = JSON.parse(row.state_json) as PattiState;
  const wallet = getWallet(req.user!.id);
  return res.json({
    active: true,
    state: sanitizePattiState(st, wallet.mainBalance),
    wallet,
  });
});

gameRouter.post('/3patti/start', checkMaintenanceMode, (req: AuthedRequest, res: Response) => {
  try {
    const cfg = getGameConfig('3-patti-royale');
    if (!cfg.enabled) return res.status(403).json({ error: '3 Patti Royale is currently disabled by administrator.' });

    const boot = Number(cfg.settings.boot || cfg.minStake || 5);
    const blindMax = Number(cfg.settings.blindMax || cfg.maxStake || 2000);
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;
    const forfeitPrevious = Boolean(req.body?.forfeitPrevious);
    const newTable = Boolean(req.body?.newTable);

    // Check existing active round
    const activeRow = db
      .prepare(`SELECT * FROM game_rounds WHERE game_id = '3-patti-royale' AND user_id = ? AND result = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`)
      .get(req.user!.id) as any;

    if (activeRow) {
      if (!forfeitPrevious) {
        const st = JSON.parse(activeRow.state_json) as PattiState;
        const wallet = getWallet(req.user!.id);
        return res.json({ state: sanitizePattiState(st, wallet.mainBalance), wallet, resumed: true });
      }
      // Forfeit abandoned active round cleanly
      const oldSt = JSON.parse(activeRow.state_json) as PattiState;
      const prevPaid = oldSt.players[0]?.paid || activeRow.stake;
      const wNow = getWallet(req.user!.id).mainBalance;
      db.prepare(`
        UPDATE game_rounds SET payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, settled_at = datetime('now') WHERE id = ?
      `).run(roundMoney(-prevPaid), wNow, activeRow.id);
      recordLossStat(req.user!.id, prevPaid);
    }

    // Preserve previous table roster & positions on continuous play unless newTable is requested
    let prevTableState: PattiState | null = null;
    if (!newTable) {
      const lastRow = db
        .prepare(`SELECT state_json FROM game_rounds WHERE game_id = '3-patti-royale' AND user_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(req.user!.id) as { state_json: string } | undefined;
      if (lastRow?.state_json) {
        try {
          prevTableState = JSON.parse(lastRow.state_json) as PattiState;
        } catch {
          prevTableState = null;
        }
      }
    }

    const roundId = makeId('RND');
    const debit = debitWallet({
      userId: req.user!.id,
      txType: 'GAME_STAKE',
      amount: boot,
      relatedId: roundId,
      idempotencyKey: idempotencyKey || `3patti-start-${roundId}`,
      note: `3 Patti Royale Boot (${roundId})`,
      countAsStake: true,
    });

    if (debit.duplicate) {
      const existing = db.prepare(`SELECT * FROM game_rounds WHERE idempotency_key = ?`).get(idempotencyKey) as any;
      if (existing) {
        return res.json({
          state: sanitizePattiState(JSON.parse(existing.state_json), debit.wallet.mainBalance),
          wallet: debit.wallet,
        });
      }
    }

    const deck: Card[] = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 2; r <= 14; r++) deck.push({ r, s });
    }
    const shuffled = shuffleCrypto(deck);

    const aiBal = () => Math.round((1500 + cryptoRandomFloat() * 5500) / 10) * 10;
    const prevAi1 = prevTableState?.players?.[1];
    const prevAi2 = prevTableState?.players?.[2];
    const ps = shuffleCrypto(PERS);
    const nm1 = prevAi1?.name || pickAiName([]);
    const nm2 = prevAi2?.name || pickAiName([nm1]);
    const tableId = prevTableState?.tableId || makeId('TBL');

    const ai1Bal = prevAi1 && prevAi1.bal >= boot * 5 ? prevAi1.bal - boot : aiBal() - boot;
    const ai2Bal = prevAi2 && prevAi2.bal >= boot * 5 ? prevAi2.bal - boot : aiBal() - boot;

    const players: PattiPlayerState[] = [
      {
        name: req.user!.displayName || 'You',
        bal: debit.wallet.mainBalance,
        h: true,
        col: PATTI_COLORS[0],
        cards: shuffled.slice(0, 3),
        seen: false,
        packed: false,
        won: false,
        shown: false,
        turns: 0,
        paid: boot,
      },
      {
        name: nm1,
        bal: ai1Bal,
        p: prevAi1?.p || ps[0],
        col: prevAi1?.col || PATTI_COLORS[2],
        cards: shuffled.slice(3, 6),
        seen: false,
        packed: false,
        won: false,
        shown: false,
        turns: 0,
        paid: boot,
      },
      {
        name: nm2,
        bal: ai2Bal,
        p: prevAi2?.p || ps[1],
        col: prevAi2?.col || PATTI_COLORS[4],
        cards: shuffled.slice(6, 9),
        seen: false,
        packed: false,
        won: false,
        shown: false,
        turns: 0,
        paid: boot,
      },
    ];

    const st: PattiState = {
      roundId,
      tableId,
      boot,
      blindMax,
      pot: boot * players.length,
      stake: boot,
      turn: 0,
      first: 0,
      lastRaiser: -1,
      phase: 'play',
      reveal: false,
      winnerIdx: null,
      winHandName: null,
      players,
      logs: [
        prevTableState && !newTable
          ? `— Continuous round on Table ${tableId}: boot Rs ${boot} each, pot Rs ${boot * players.length} —`
          : `— Joined Table ${tableId}: boot Rs ${boot} each, pot Rs ${boot * players.length} —`,
      ],
    };

    const walletBefore = roundMoney(debit.wallet.mainBalance + boot);
    db.prepare(`
      INSERT INTO game_rounds (id, game_id, user_id, user_uid, stake, payout, net_result, result, wallet_before, wallet_after, state_json, idempotency_key)
      VALUES (?, '3-patti-royale', ?, ?, ?, 0, 0, 'ACTIVE', ?, ?, ?, ?)
    `).run(roundId, req.user!.id, req.user!.uid, boot, walletBefore, debit.wallet.mainBalance, JSON.stringify(st), idempotencyKey || null);

    db.prepare(`
      INSERT INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after)
      VALUES (?, ?, '3-patti-royale', ?, ?, 'BOOT_STAKE', ?, ?, ?)
    `).run(makeId('GTX'), roundId, req.user!.id, req.user!.uid, boot, walletBefore, debit.wallet.mainBalance);

    return res.status(201).json({
      state: sanitizePattiState(st, debit.wallet.mainBalance),
      wallet: debit.wallet,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not start 3 Patti round' });
  }
});

gameRouter.post('/3patti/action', (req: AuthedRequest, res: Response) => {
  try {
    const roundId = String(req.body?.roundId || '');
    const action = String(req.body?.action || '');
    const actionId = req.body?.actionId ? String(req.body.actionId) : makeId('ACT');

    const row = db
      .prepare(`SELECT * FROM game_rounds WHERE id = ? AND user_id = ? AND game_id = '3-patti-royale'`)
      .get(roundId, req.user!.id) as any;
    if (!row) return res.status(404).json({ error: 'Round not found.' });

    const st = JSON.parse(row.state_json) as PattiState;
    if (st.phase !== 'play') {
      const w = getWallet(req.user!.id);
      return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w, alreadyEnded: true });
    }

    let eventMsg = '';
    const me = st.players[0];

    if (action === 'see') {
      if (me.packed || me.seen) {
        const w = getWallet(req.user!.id);
        return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w });
      }
      me.seen = true;
      eventMsg = `${me.name} looked at their cards (now seen)`;
      st.logs.unshift(eventMsg);
      db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
      const w = getWallet(req.user!.id);
      return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w, eventMsg });
    }

    if (action === 'pack' || action === 'timeout-pack') {
      if (st.turn !== 0 || me.packed) return res.status(400).json({ error: 'Not your turn.' });
      me.packed = true;
      me.shown = true;
      eventMsg =
        action === 'timeout-pack'
          ? `${me.name} ran out of time — auto packed`
          : `${me.name} packed`;
      st.logs.unshift(eventMsg);
      const adv = advancePattiTurn(st);
      if (adv.ended) {
        settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
      } else {
        // Keep round active so remaining active players continue playing normally
        db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
      }
      const w = getWallet(req.user!.id);
      return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w, eventMsg, actorIdx: 0 });
    }

    if (action === 'bet' || action === 'double') {
      if (st.turn !== 0 || me.packed) return res.status(400).json({ error: 'Not your turn.' });
      const isRaise = action === 'double';
      const nextStake = isRaise ? st.stake * 2 : st.stake;
      if (isRaise && !me.seen && nextStake > st.blindMax) {
        return res.status(400).json({ error: `Blind stake cannot exceed Rs ${st.blindMax}.` });
      }
      if (!isRaise && !me.seen && nextStake > st.blindMax) {
        return res.status(400).json({ error: 'Blind limit reached. Please see your cards.' });
      }

      const cost = (me.seen ? 2 : 1) * nextStake;
      const debit = debitWallet({
        userId: req.user!.id,
        txType: 'GAME_STAKE',
        amount: cost,
        relatedId: roundId,
        idempotencyKey: `3patti-act-${actionId}`,
        note: `3 Patti ${isRaise ? 'Double' : me.seen ? 'Chaal' : 'Blind'} (Rs ${cost})`,
        countAsStake: true,
      });

      if (!debit.duplicate) {
        if (isRaise) {
          st.stake = nextStake;
          st.lastRaiser = 0;
        }
        me.paid = roundMoney(me.paid + cost);
        me.bal = debit.wallet.mainBalance;
        me.turns++;
        st.pot = roundMoney(st.pot + cost);

        eventMsg = `${me.name} ${isRaise ? 'doubled' : 'played'} ${me.seen ? 'seen' : 'blind'} · Rs ${cost}${isRaise ? ' · stake Rs ' + st.stake : ''}`;
        st.logs.unshift(eventMsg);

        const prevBal = roundMoney(debit.wallet.mainBalance + cost);
        db.prepare(`
          INSERT OR IGNORE INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
          VALUES (?, ?, '3-patti-royale', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          makeId('GTX'),
          roundId,
          req.user!.id,
          req.user!.uid,
          isRaise ? 'DOUBLE' : 'BET',
          cost,
          prevBal,
          debit.wallet.mainBalance,
          `gtx-${actionId}`
        );

        const adv = advancePattiTurn(st);
        if (adv.ended) {
          settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
        } else {
          db.prepare(`UPDATE game_rounds SET stake = ?, wallet_after = ?, state_json = ? WHERE id = ?`).run(
            me.paid,
            debit.wallet.mainBalance,
            JSON.stringify(st),
            roundId
          );
        }
      }

      const w = getWallet(req.user!.id);
      return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w, eventMsg, paidAmount: cost });
    }

    if (action === 'show') {
      if (st.turn !== 0 || me.packed) return res.status(400).json({ error: 'Not your turn.' });
      const activeOthers = st.players.filter((p) => !p.packed && !p.h);
      if (me.seen && (activeOthers.length !== 1 || (!activeOthers[0].seen && st.pot <= 1000))) {
        return res.status(400).json({ error: 'Show is only allowed in heads-up when opponent is seen or pot exceeds Rs 1,000.' });
      }
      const cost = pattiCost(me, st.stake, false);
      const debit = debitWallet({
        userId: req.user!.id,
        txType: 'GAME_STAKE',
        amount: cost,
        relatedId: roundId,
        idempotencyKey: `3patti-show-${actionId}`,
        note: `3 Patti Show (Rs ${cost})`,
        countAsStake: true,
      });

      if (!debit.duplicate) {
        me.paid = roundMoney(me.paid + cost);
        me.bal = debit.wallet.mainBalance;
        st.pot = roundMoney(st.pot + cost);
        const prevBal = roundMoney(debit.wallet.mainBalance + cost);
        db.prepare(`
          INSERT OR IGNORE INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
          VALUES (?, ?, '3-patti-royale', ?, ?, 'SHOW', ?, ?, ?, ?)
        `).run(makeId('GTX'), roundId, req.user!.id, req.user!.uid, cost, prevBal, debit.wallet.mainBalance, `gtx-${actionId}`);

        const oppBest = activeOthers.reduce((m, x) =>
          evalPattiHand(x.cards).score > evalPattiHand(m.cards).score ? x : m
        );
        const myHand = evalPattiHand(me.cards);
        const oppHand = evalPattiHand(oppBest.cards);
        eventMsg = `${me.name} asked for a SHOW against ${activeOthers.map((x) => x.name).join(' & ')} (Rs ${cost})`;
        st.logs.unshift(eventMsg);
        const winner = myHand.score > oppHand.score ? me : oppBest;
        settlePattiRound(roundId, req.user!.id, req.user!.uid, st, st.players.indexOf(winner), true);
      }

      const w = getWallet(req.user!.id);
      return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w, eventMsg, paidAmount: cost });
    }

    if (action === 'ai-turn') {
      if (st.turn === 0) return res.status(400).json({ error: 'It is currently your turn.' });
      if (st.players[st.turn]?.packed) {
        const adv = advancePattiTurn(st);
        if (adv.ended) settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
        else db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
        const w = getWallet(req.user!.id);
        return res.json({ state: sanitizePattiState(st, w.mainBalance), wallet: w });
      }
      const i = st.turn;
      const p = st.players[i];
      const P = p.p || PERS[0];
      const activeList = st.players.filter((x) => !x.packed);
      const n = activeList.length;

      if (!p.seen && st.stake > st.blindMax) {
        p.seen = true;
        st.logs.unshift(`${p.name} looked at their cards (now seen)`);
      } else if (!p.seen) {
        const pr = (0.2 + p.turns * 0.14 + (st.stake >= 20 ? 0.3 : 0)) * (1 - P.agg * 0.4) * (P.blind ? 0.25 : 0.55);
        if (cryptoRandomFloat() < pr) {
          p.seen = true;
          st.logs.unshift(`${p.name} looked at their cards (now seen)`);
        }
      }

      const c0 = pattiCost(p, st.stake, false);
      const canRaise =
        st.stake * 2 <= 1e9 &&
        (p.seen || st.stake * 2 <= st.blindMax) &&
        pattiCost(p, st.stake, true) <= p.bal &&
        activeList.every((q) => q === p || (q.seen ? 2 : 1) * (st.stake * 2) <= q.bal);

      let paidAmount = 0;
      if (c0 > p.bal) {
        p.packed = true;
        eventMsg = `${p.name} packed`;
        st.logs.unshift(eventMsg);
        const adv = advancePattiTurn(st);
        if (adv.ended) {
          settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
        } else {
          db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
        }
      } else if (!p.seen) {
        if (st.stake >= 40 && !P.blind && cryptoRandomFloat() < 0.15) {
          p.packed = true;
          eventMsg = `${p.name} packed`;
          st.logs.unshift(eventMsg);
          const adv = advancePattiTurn(st);
          if (adv.ended) settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
          else db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
        } else if (p.turns > 1 && cryptoRandomFloat() < (0.12 + P.agg * 0.2) * (n === 2 ? 1 : 0.5)) {
          // AI Show
          p.bal -= c0;
          p.paid += c0;
          st.pot += c0;
          paidAmount = c0;
          const others = activeList.filter((x) => x !== p);
          const opp = others.reduce((m, x) => (evalPattiHand(x.cards).score > evalPattiHand(m.cards).score ? x : m));
          eventMsg = `${p.name} asked for a SHOW against ${others.map((x) => x.name).join(' & ')} (Rs ${c0})`;
          st.logs.unshift(eventMsg);
          const win = evalPattiHand(p.cards).score > evalPattiHand(opp.cards).score ? p : opp;
          settlePattiRound(roundId, req.user!.id, req.user!.uid, st, st.players.indexOf(win), true);
        } else {
          const raise = canRaise && cryptoRandomFloat() < 0.2 + P.agg * 0.5;
          if (raise) {
            st.stake *= 2;
            st.lastRaiser = i;
          }
          const amt = pattiCost(p, st.stake, false);
          p.bal -= amt;
          p.paid += amt;
          st.pot += amt;
          p.turns++;
          paidAmount = amt;
          eventMsg = `${p.name} ${raise ? 'doubled' : 'played'} blind · Rs ${amt}${raise ? ' · stake Rs ' + st.stake : ''}`;
          st.logs.unshift(eventMsg);
          const adv = advancePattiTurn(st);
          if (adv.ended) settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
          else db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
        }
      } else {
        const hv = evalPattiHand(p.cards);
        const op = n - 1;
        let eq = Math.pow(pctlScore(hv.score), op);
        if (st.lastRaiser >= 0 && st.lastRaiser !== i && st.players[st.lastRaiser]?.seen) eq *= 0.9;
        const odds = c0 / (st.pot + c0);
        let thr = odds * 0.7 + P.fold * 0.6 - 0.1 + (n > 2 ? Math.min(0.2, st.pot / 15000) : 0);
        if (p.turns < 2 && st.stake <= 10) thr -= 0.08;
        if (c0 > p.bal * 0.35 && eq < 0.5) thr += 0.12;
        const bluff = cryptoRandomFloat() < P.bluff * 0.6;

        if (eq < thr && !bluff) {
          p.packed = true;
          eventMsg = `${p.name} packed`;
          st.logs.unshift(eventMsg);
          const adv = advancePattiTurn(st);
          if (adv.ended) settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
          else db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
        } else {
          const otherSeen = activeList.find((x) => x !== p)?.seen;
          if (
            n === 2 &&
            (otherSeen || st.pot > 1000) &&
            ((eq > 0.6 && cryptoRandomFloat() < 0.45) ||
              (eq > 0.42 && st.pot >= 200 && cryptoRandomFloat() < 0.3) ||
              cryptoRandomFloat() < 0.1 + Math.min(0.6, st.pot / 6000 + p.turns * 0.03))
          ) {
            p.bal -= c0;
            p.paid += c0;
            st.pot += c0;
            paidAmount = c0;
            const others = activeList.filter((x) => x !== p);
            const opp = others.reduce((m, x) => (evalPattiHand(x.cards).score > evalPattiHand(m.cards).score ? x : m));
            eventMsg = `${p.name} asked for a SHOW against ${others.map((x) => x.name).join(' & ')} (Rs ${c0})`;
            st.logs.unshift(eventMsg);
            const win = evalPattiHand(p.cards).score > evalPattiHand(opp.cards).score ? p : opp;
            settlePattiRound(roundId, req.user!.id, req.user!.uid, st, st.players.indexOf(win), true);
          } else {
            const raise =
              canRaise &&
              ((eq > 0.58 && cryptoRandomFloat() < 0.3 + P.agg * 0.5) || (bluff && cryptoRandomFloat() < P.agg * 0.4));
            if (raise) {
              st.stake *= 2;
              st.lastRaiser = i;
            }
            const amt = pattiCost(p, st.stake, false);
            p.bal -= amt;
            p.paid += amt;
            st.pot += amt;
            p.turns++;
            paidAmount = amt;
            eventMsg = `${p.name} ${raise ? 'doubled' : 'played'} seen · Rs ${amt}${raise ? ' · stake Rs ' + st.stake : ''}`;
            st.logs.unshift(eventMsg);
            const adv = advancePattiTurn(st);
            if (adv.ended) settlePattiRound(roundId, req.user!.id, req.user!.uid, st, adv.winnerIdx!, false);
            else db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
          }
        }
      }

      const w = getWallet(req.user!.id);
      return res.json({
        state: sanitizePattiState(st, w.mainBalance),
        wallet: w,
        eventMsg,
        actorIdx: i,
        paidAmount,
      });
    }

    return res.status(400).json({ error: 'Unknown 3 Patti action.' });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Action failed' });
  }
});

gameRouter.post('/3patti/forfeit', (req: AuthedRequest, res: Response) => {
  const row = db
    .prepare(`SELECT * FROM game_rounds WHERE game_id = '3-patti-royale' AND user_id = ? AND result = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`)
    .get(req.user!.id) as any;
  if (!row) return res.json({ ok: true });
  const st = JSON.parse(row.state_json) as PattiState;
  const paid = st.players[0]?.paid || row.stake;
  const w = getWallet(req.user!.id);
  db.prepare(`
    UPDATE game_rounds SET stake = ?, payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, settled_at = datetime('now') WHERE id = ?
  `).run(paid, roundMoney(-paid), w.mainBalance, row.id);
  recordLossStat(req.user!.id, paid);
  return res.json({ ok: true, wallet: w });
});

// --- BUBBLE ROCKET X ENDPOINTS ---

gameRouter.get('/bubble/active', (req: AuthedRequest, res: Response) => {
  const row = db
    .prepare(`SELECT * FROM game_rounds WHERE game_id = 'bubble-rocket-x' AND user_id = ? AND result = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`)
    .get(req.user!.id) as any;
  if (!row) return res.json({ active: false });
  const st = JSON.parse(row.state_json) as BubbleState;
  return res.json({ active: true, state: st, wallet: getWallet(req.user!.id) });
});

gameRouter.post('/bubble/start', checkMaintenanceMode, (req: AuthedRequest, res: Response) => {
  try {
    const cfg = getGameConfig('bubble-rocket-x');
    if (!cfg.enabled) return res.status(403).json({ error: 'Bubble Rocket X is currently disabled by administrator.' });

    const bet = Math.floor(Number(req.body?.bet || 50));
    const boardHeight = Number(req.body?.boardHeight || 560);
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;

    if (!Number.isFinite(bet) || bet < cfg.minStake || bet > cfg.maxStake || bet % 50 !== 0) {
      return res.status(400).json({
        error: `Bet must be a multiple of NPR 50 between NPR ${cfg.minStake} and NPR ${cfg.maxStake}.`,
      });
    }

    // Forfeit any uncompleted previous round safely
    const prev = db
      .prepare(`SELECT * FROM game_rounds WHERE game_id = 'bubble-rocket-x' AND user_id = ? AND result = 'ACTIVE'`)
      .all(req.user!.id) as any[];
    for (const p of prev) {
      const wNow = getWallet(req.user!.id).mainBalance;
      db.prepare(`
        UPDATE game_rounds SET payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, settled_at = datetime('now') WHERE id = ?
      `).run(roundMoney(-p.stake), wNow, p.id);
      recordLossStat(req.user!.id, p.stake);
    }

    const roundId = makeId('RND');
    const debit = debitWallet({
      userId: req.user!.id,
      txType: 'GAME_STAKE',
      amount: bet,
      relatedId: roundId,
      idempotencyKey: idempotencyKey || `brx-start-${roundId}`,
      note: `Bubble Rocket X bet (NPR ${bet})`,
      countAsStake: true,
    });

    if (debit.duplicate) {
      const existing = db.prepare(`SELECT * FROM game_rounds WHERE idempotency_key = ?`).get(idempotencyKey) as any;
      if (existing) {
        return res.json({ state: JSON.parse(existing.state_json), wallet: debit.wallet });
      }
    }

    const board = brxBuildBoard(boardHeight);
    const st: BubbleState = {
      roundId,
      bet,
      H: Math.max(460, Math.min(820, Math.round(boardHeight || 560))),
      lineY: board.lineY,
      ly: board.ly,
      loseR: board.loseR,
      gr: board.gr,
      par: 0,
      grid: board.grid,
      shots: 5,
      shotNo: 0,
      pops: 0,
      blasts: 0,
      win: 0,
      cur: { c: 0, x: 0, hp: 1, t: 'n' },
      nxt: { c: 0, x: 0, hp: 1, t: 'n' },
      rounds: [],
      over: false,
    };
    brxDrop(st, true);
    st.cur = brxMakeRocket(true, st.grid);
    st.nxt = brxMakeRocket(false, st.grid);

    const walletBefore = roundMoney(debit.wallet.mainBalance + bet);
    db.prepare(`
      INSERT INTO game_rounds (id, game_id, user_id, user_uid, stake, payout, net_result, result, wallet_before, wallet_after, state_json, idempotency_key)
      VALUES (?, 'bubble-rocket-x', ?, ?, ?, 0, 0, 'ACTIVE', ?, ?, ?, ?)
    `).run(roundId, req.user!.id, req.user!.uid, bet, walletBefore, debit.wallet.mainBalance, JSON.stringify(st), idempotencyKey || null);

    db.prepare(`
      INSERT INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after)
      VALUES (?, ?, 'bubble-rocket-x', ?, ?, 'ROUND_STAKE', ?, ?, ?)
    `).run(makeId('GTX'), roundId, req.user!.id, req.user!.uid, bet, walletBefore, debit.wallet.mainBalance);

    return res.status(201).json({ state: st, wallet: debit.wallet });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not start Bubble Rocket X' });
  }
});

gameRouter.post('/bubble/shot', (req: AuthedRequest, res: Response) => {
  try {
    const roundId = String(req.body?.roundId || '');
    const rawAngle = Number(req.body?.angle);
    const shotIndex = Number(req.body?.shotIndex);

    const row = db
      .prepare(`SELECT * FROM game_rounds WHERE id = ? AND user_id = ? AND game_id = 'bubble-rocket-x'`)
      .get(roundId, req.user!.id) as any;
    if (!row) return res.status(404).json({ error: 'Round not found.' });

    const st = JSON.parse(row.state_json) as BubbleState;
    if (st.over || st.shots <= 0) {
      return res.json({ state: st, wallet: getWallet(req.user!.id), alreadyOver: true });
    }
    if (Number.isFinite(shotIndex) && shotIndex !== st.shotNo) {
      return res.json({ state: st, wallet: getWallet(req.user!.id), duplicate: true });
    }

    const ang = Math.max(-Math.PI + 0.17, Math.min(-0.17, rawAngle));
    st.shots--;
    const f = st.cur;
    let fx = BRX_W / 2;
    let fy = st.ly - 26;
    let vx = Math.cos(ang);
    let vy = Math.sin(ang);

    // Deterministic step simulation matching canvas loop
    for (let step = 0; step < 600; step++) {
      fx += vx * 4;
      fy += vy * 4;
      if (fx < BRX_R) {
        fx = BRX_R;
        vx = -vx;
      }
      if (fx > BRX_W - BRX_R) {
        fx = BRX_W - BRX_R;
        vx = -vx;
      }
      if (fy <= BRX_TOP + BRX_R || brxHitAny(st, fx, fy)) {
        break;
      }
    }

    const [r, c] = brxSnap(st, fx, fy);
    const landed: BubbleCell = { c: f.c, x: 0, t: f.t, hp: 1 };
    st.shotNo++;
    const beforePops = st.pops;

    if (landed.t === 'rainbow') {
      const counts: Record<number, number> = {};
      for (const [a, b] of brxNb(r, c, st.par, st.gr)) {
        const o = st.grid[a][b];
        if (o) counts[o.c] = (counts[o.c] || 0) + 1;
      }
      const bestColor = Object.keys(counts).sort((a, b) => counts[+b] - counts[+a])[0];
      if (bestColor !== undefined) landed.c = Number(bestColor);
    }

    st.grid[r][c] = landed;

    const removeCells = (list: Array<[number, number]>) => {
      const popped: Array<{ r: number; c: number; colorIdx: number; frozenCrack: boolean }> = [];
      for (const [rr, cc] of list) {
        const cell = st.grid[rr]?.[cc];
        if (!cell) continue;
        if (cell.hp > 1) {
          cell.hp--;
          cell.t = 'n';
          popped.push({ r: rr, c: cc, colorIdx: cell.c, frozenCrack: true });
        } else {
          st.grid[rr][cc] = null;
          st.pops++;
          popped.push({ r: rr, c: cc, colorIdx: cell.c, frozenCrack: false });
        }
      }
      return popped;
    };

    let poppedList: Array<{ r: number; c: number; colorIdx: number; frozenCrack: boolean }> = [];
    if (landed.t === 'bomb') {
      poppedList = removeCells([[r, c], ...brxNb(r, c, st.par, st.gr)]);
    } else if (landed.t === 'light') {
      const rowCells: Array<[number, number]> = [];
      st.grid[r].forEach((o, i) => {
        if (o) rowCells.push([r, i]);
      });
      poppedList = removeCells(rowCells);
    } else {
      const group = brxFlood(st, r, c);
      if (group.length >= 3) {
        poppedList = removeCells(group);
      }
    }

    const droppedList = brxDrop(st, false);
    const blast = st.pops > beforePops;
    if (blast) {
      st.blasts++;
      st.win = BRX_LADDER(st.bet, st.blasts);
      st.rounds.push({ won: 1, r: st.win });
    } else {
      st.rounds.push({ won: 0, r: 0 });
      brxAddRow(st);
    }

    const crossed = brxCrossed(st);
    let payout = 0;

    if (crossed) {
      const lastRound = st.rounds[st.rounds.length - 1];
      if (lastRound.won) {
        st.blasts--;
        st.win = BRX_LADDER(st.bet, st.blasts);
      }
      lastRound.won = 0;
      lastRound.r = 0;
      lastRound.x = 1;
      st.over = true;

      const wNow = getWallet(req.user!.id).mainBalance;
      db.prepare(`
        UPDATE game_rounds SET payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, state_json = ?, settled_at = datetime('now') WHERE id = ?
      `).run(roundMoney(-st.bet), wNow, JSON.stringify(st), roundId);
      recordLossStat(req.user!.id, st.bet);
    } else if (st.shots === 0) {
      st.over = true;
      payout = st.win;
      const isWin = payout >= st.bet;
      const netResult = roundMoney(payout - st.bet);

      if (payout > 0) {
        const payRes = creditWallet({
          userId: req.user!.id,
          txType: 'GAME_PAYOUT',
          amount: payout,
          relatedId: roundId,
          idempotencyKey: `brx-payout-${roundId}`,
          note: `Bubble Rocket X round payout (NPR ${payout})`,
          countAsWinnings: true,
        });
        const prevBal = roundMoney(payRes.wallet.mainBalance - payout);
        db.prepare(`
          INSERT OR IGNORE INTO game_transactions (id, round_id, game_id, user_id, user_uid, action, amount, wallet_before, wallet_after, idempotency_key)
          VALUES (?, ?, 'bubble-rocket-x', ?, ?, 'PAYOUT', ?, ?, ?, ?)
        `).run(makeId('GTX'), roundId, req.user!.id, req.user!.uid, payout, prevBal, payRes.wallet.mainBalance, `gtx-brx-${roundId}`);
      }

      const wNow = getWallet(req.user!.id).mainBalance;
      db.prepare(`
        UPDATE game_rounds SET payout = ?, net_result = ?, result = ?, wallet_after = ?, state_json = ?, settled_at = datetime('now') WHERE id = ?
      `).run(payout, netResult, isWin ? 'WIN' : 'LOSS', wNow, JSON.stringify(st), roundId);

      if (netResult < 0) {
        recordLossStat(req.user!.id, Math.abs(netResult));
      }
    } else {
      st.cur = st.nxt;
      st.nxt = brxMakeRocket(false, st.grid);
      const present = brxPresentColors(st.grid);
      if (st.cur.t === 'n' && present.length && !present.includes(st.cur.c)) {
        st.cur.c = present[0];
      }
      db.prepare(`UPDATE game_rounds SET state_json = ? WHERE id = ?`).run(JSON.stringify(st), roundId);
    }

    return res.json({
      state: st,
      hitR: r,
      hitC: c,
      blast,
      crossed,
      poppedList,
      droppedList,
      payout,
      wallet: getWallet(req.user!.id),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Shot failed' });
  }
});

gameRouter.post('/bubble/leave', (req: AuthedRequest, res: Response) => {
  const roundId = String(req.body?.roundId || '');
  const row = db
    .prepare(`SELECT * FROM game_rounds WHERE id = ? AND user_id = ? AND game_id = 'bubble-rocket-x' AND result = 'ACTIVE'`)
    .get(roundId, req.user!.id) as any;
  if (!row) return res.json({ ok: true, wallet: getWallet(req.user!.id) });

  const st = JSON.parse(row.state_json) as BubbleState;
  st.over = true;
  const wNow = getWallet(req.user!.id).mainBalance;
  db.prepare(`
    UPDATE game_rounds SET payout = 0, net_result = ?, result = 'LOSS', wallet_after = ?, state_json = ?, settled_at = datetime('now') WHERE id = ?
  `).run(roundMoney(-st.bet), wNow, JSON.stringify(st), roundId);
  recordLossStat(req.user!.id, st.bet);
  return res.json({ ok: true, wallet: getWallet(req.user!.id) });
});

// --- SKYLINE CRASH ENDPOINTS ---

gameRouter.get('/skyline/state', (req: AuthedRequest, res: Response) => {
  const cfg = getGameConfig('skyline-crash');
  return res.json({
    ...skylineEngine.getPublicState(req.user!.id),
    config: {
      enabled: cfg.enabled,
      minStake: cfg.minStake,
      maxStake: cfg.maxStake,
    },
    wallet: getWallet(req.user!.id),
  });
});

gameRouter.post('/skyline/bet', checkMaintenanceMode, (req: AuthedRequest, res: Response) => {
  try {
    const amount = Number(req.body?.amount);
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;
    const result = skylineEngine.placeBet(req.user!.id, req.user!.uid, req.user!.username, amount, idempotencyKey);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not place bet' });
  }
});

gameRouter.post('/skyline/cancel', (req: AuthedRequest, res: Response) => {
  try {
    const result = skylineEngine.cancelBet(req.user!.id);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not cancel bet' });
  }
});

gameRouter.post('/skyline/cashout', (req: AuthedRequest, res: Response) => {
  try {
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;
    const result = skylineEngine.cashout(req.user!.id, idempotencyKey);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not cash out' });
  }
});
