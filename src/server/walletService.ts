import { db } from './db.ts';
import { emitToUser } from './realtime.ts';
import { getNstDateString, makeId, roundMoney } from './utils.ts';

export interface WalletSnapshot {
  userId: number;
  mainBalance: number;
  availableBalance: number;
  reservedWithdrawal: number;
  withdrawableWinnings: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalStaked: number;
  totalWon: number;
  totalLost: number;
}

export function getWallet(userId: number): WalletSnapshot {
  const row = db.prepare(`
    SELECT user_id, main_balance, reserved_withdrawal, withdrawable_winnings,
           total_deposited, total_withdrawn, total_staked, total_won, total_lost
    FROM wallets WHERE user_id = ?
  `).get(userId) as
    | {
        user_id: number;
        main_balance: number;
        reserved_withdrawal: number;
        withdrawable_winnings: number;
        total_deposited: number;
        total_withdrawn: number;
        total_staked: number;
        total_won: number;
        total_lost: number;
      }
    | undefined;

  if (!row) {
    throw new Error('Wallet not found for user');
  }

  return {
    userId: row.user_id,
    mainBalance: roundMoney(row.main_balance),
    availableBalance: roundMoney(row.main_balance),
    reservedWithdrawal: roundMoney(row.reserved_withdrawal),
    withdrawableWinnings: roundMoney(Math.min(row.withdrawable_winnings, row.main_balance)),
    totalDeposited: roundMoney(row.total_deposited),
    totalWithdrawn: roundMoney(row.total_withdrawn),
    totalStaked: roundMoney(row.total_staked),
    totalWon: roundMoney(row.total_won),
    totalLost: roundMoney(row.total_lost),
  };
}

export function createNotification(params: {
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
}) {
  const id = makeId('NTF');
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, related_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, params.userId, params.type, params.title, params.message, params.relatedId || null);

  const ntf = db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id);
  emitToUser(params.userId, 'notification:new', ntf);
  return ntf;
}

function pushWalletSync(userId: number) {
  const wallet = getWallet(userId);
  emitToUser(userId, 'wallet:updated', wallet);
  return wallet;
}

export function checkDailySpendingLimit(userId: number, additionalStake: number) {
  const user = db.prepare(`SELECT responsible_daily_limit, self_excluded_until FROM users WHERE id = ?`).get(userId) as
    | { responsible_daily_limit: number | null; self_excluded_until: string | null }
    | undefined;
  if (!user) throw new Error('User not found');

  if (user.self_excluded_until && new Date(user.self_excluded_until).getTime() > Date.now()) {
    throw new Error(`Self-exclusion is active until ${user.self_excluded_until.slice(0, 10)}.`);
  }

  if (user.responsible_daily_limit && user.responsible_daily_limit > 0) {
    const todayNst = getNstDateString();
    // Calculate today's stakes in NST
    const startUtc = new Date(Date.UTC(
      Number(todayNst.slice(0, 4)),
      Number(todayNst.slice(5, 7)) - 1,
      Number(todayNst.slice(8, 10)),
      0, 0, 0
    ) - 345 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM wallet_ledger
      WHERE user_id = ? AND tx_type = 'GAME_STAKE' AND created_at >= ?
    `).get(userId, startUtc) as { total: number };

    if (row.total + additionalStake > user.responsible_daily_limit) {
      throw new Error(`Daily spending limit of NPR ${user.responsible_daily_limit.toLocaleString()} reached.`);
    }
  }
}

export function creditWallet(params: {
  userId: number;
  txType: string;
  amount: number;
  relatedId?: string;
  relatedUid?: string;
  relatedUsername?: string;
  idempotencyKey?: string;
  note?: string;
  countAsWinnings?: boolean;
  countAsDeposited?: boolean;
}): { wallet: WalletSnapshot; txId: string; duplicate: boolean } {
  const amount = roundMoney(params.amount);
  if (amount <= 0) throw new Error('Credit amount must be positive');

  const tx = db.transaction(() => {
    if (params.idempotencyKey) {
      const existing = db.prepare(`SELECT id FROM wallet_ledger WHERE idempotency_key = ?`).get(params.idempotencyKey) as
        | { id: string }
        | undefined;
      if (existing) {
        return { wallet: getWallet(params.userId), txId: existing.id, duplicate: true };
      }
    }

    const user = db.prepare(`SELECT uid, status FROM users WHERE id = ?`).get(params.userId) as
      | { uid: string; status: string }
      | undefined;
    if (!user) throw new Error('User not found');

    const w = db.prepare(`
      SELECT main_balance, withdrawable_winnings, total_deposited, total_won
      FROM wallets WHERE user_id = ?
    `).get(params.userId) as {
      main_balance: number;
      withdrawable_winnings: number;
      total_deposited: number;
      total_won: number;
    };

    const prev = roundMoney(w.main_balance);
    const next = roundMoney(prev + amount);
    const nextWinnings = params.countAsWinnings
      ? roundMoney(Math.min(next, w.withdrawable_winnings + amount))
      : roundMoney(w.withdrawable_winnings);
    const nextDeposited = params.countAsDeposited
      ? roundMoney(w.total_deposited + amount)
      : roundMoney(w.total_deposited);
    const nextWon = params.txType === 'GAME_PAYOUT'
      ? roundMoney(w.total_won + amount)
      : roundMoney(w.total_won);

    db.prepare(`
      UPDATE wallets
      SET main_balance = ?,
          withdrawable_winnings = ?,
          total_deposited = ?,
          total_won = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(next, nextWinnings, nextDeposited, nextWon, params.userId);

    const txId = makeId('TXN');
    db.prepare(`
      INSERT INTO wallet_ledger (
        id, user_id, user_uid, tx_type, amount, direction,
        prev_balance, new_balance, related_id, related_uid, related_username,
        status, idempotency_key, note
      ) VALUES (?, ?, ?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(
      txId,
      params.userId,
      user.uid,
      params.txType,
      amount,
      prev,
      next,
      params.relatedId || null,
      params.relatedUid || null,
      params.relatedUsername || null,
      params.idempotencyKey || null,
      params.note || null
    );

    return { wallet: getWallet(params.userId), txId, duplicate: false };
  });

  const result = tx();
  if (!result.duplicate) {
    pushWalletSync(params.userId);
  }
  return result;
}

export function debitWallet(params: {
  userId: number;
  txType: string;
  amount: number;
  relatedId?: string;
  relatedUid?: string;
  relatedUsername?: string;
  idempotencyKey?: string;
  note?: string;
  countAsStake?: boolean;
}): { wallet: WalletSnapshot; txId: string; duplicate: boolean } {
  const amount = roundMoney(params.amount);
  if (amount <= 0) throw new Error('Debit amount must be positive');

  const tx = db.transaction(() => {
    if (params.idempotencyKey) {
      const existing = db.prepare(`SELECT id FROM wallet_ledger WHERE idempotency_key = ?`).get(params.idempotencyKey) as
        | { id: string }
        | undefined;
      if (existing) {
        return { wallet: getWallet(params.userId), txId: existing.id, duplicate: true };
      }
    }

    const user = db.prepare(`SELECT uid, status FROM users WHERE id = ?`).get(params.userId) as
      | { uid: string; status: string }
      | undefined;
    if (!user) throw new Error('User not found');
    if (user.status !== 'ACTIVE') throw new Error('Account is not active');

    if (params.countAsStake) {
      checkDailySpendingLimit(params.userId, amount);
    }

    const w = db.prepare(`
      SELECT main_balance, withdrawable_winnings, total_staked
      FROM wallets WHERE user_id = ?
    `).get(params.userId) as {
      main_balance: number;
      withdrawable_winnings: number;
      total_staked: number;
    };

    const prev = roundMoney(w.main_balance);
    if (prev < amount) {
      throw new Error(`Insufficient balance. Required NPR ${amount.toLocaleString()}, available NPR ${prev.toLocaleString()}.`);
    }

    const next = roundMoney(prev - amount);
    const nextWinnings = roundMoney(Math.min(w.withdrawable_winnings, next));
    const nextStaked = params.countAsStake
      ? roundMoney(w.total_staked + amount)
      : roundMoney(w.total_staked);

    db.prepare(`
      UPDATE wallets
      SET main_balance = ?,
          withdrawable_winnings = ?,
          total_staked = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(next, nextWinnings, nextStaked, params.userId);

    const txId = makeId('TXN');
    db.prepare(`
      INSERT INTO wallet_ledger (
        id, user_id, user_uid, tx_type, amount, direction,
        prev_balance, new_balance, related_id, related_uid, related_username,
        status, idempotency_key, note
      ) VALUES (?, ?, ?, ?, ?, 'DEBIT', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(
      txId,
      params.userId,
      user.uid,
      params.txType,
      amount,
      prev,
      next,
      params.relatedId || null,
      params.relatedUid || null,
      params.relatedUsername || null,
      params.idempotencyKey || null,
      params.note || null
    );

    return { wallet: getWallet(params.userId), txId, duplicate: false };
  });

  const result = tx();
  if (!result.duplicate) {
    pushWalletSync(params.userId);
  }
  return result;
}

export function executeAgentTransfer(params: {
  senderId: number;
  receiverUid: string;
  amount: number;
  idempotencyKey?: string;
}) {
  const amount = roundMoney(params.amount);
  const receiverUid = params.receiverUid.trim().toUpperCase();

  if (!Number.isFinite(amount) || amount < 200) {
    throw new Error('Minimum Agent Transfer amount is NPR 200.');
  }

  const tx = db.transaction(() => {
    if (params.idempotencyKey) {
      const existing = db.prepare(`SELECT * FROM agent_transfers WHERE idempotency_key = ?`).get(params.idempotencyKey);
      if (existing) {
        return { transfer: existing, duplicate: true };
      }
    }

    const sender = db.prepare(`SELECT id, uid, username, status FROM users WHERE id = ?`).get(params.senderId) as
      | { id: number; uid: string; username: string; status: string }
      | undefined;
    if (!sender) throw new Error('Sender account not found.');
    if (sender.status !== 'ACTIVE') throw new Error('Your account is not active.');

    if (sender.uid === receiverUid) {
      throw new Error('Self-transfer is not permitted.');
    }

    const receiver = db.prepare(`SELECT id, uid, username, status FROM users WHERE uid = ?`).get(receiverUid) as
      | { id: number; uid: string; username: string; status: string }
      | undefined;
    if (!receiver) throw new Error(`No SW88 account found for User ID ${receiverUid}.`);
    if (receiver.status === 'BANNED') throw new Error('Cannot transfer funds to a permanently banned account.');

    const sw = db.prepare(`SELECT main_balance, withdrawable_winnings FROM wallets WHERE user_id = ?`).get(sender.id) as {
      main_balance: number;
      withdrawable_winnings: number;
    };
    const rw = db.prepare(`SELECT main_balance FROM wallets WHERE user_id = ?`).get(receiver.id) as {
      main_balance: number;
    };

    const senderPrev = roundMoney(sw.main_balance);
    if (senderPrev < 1500) {
      throw new Error('Agent eligibility requires at least NPR 1,500 available wallet balance.');
    }
    const senderNext = roundMoney(senderPrev - amount);
    if (senderNext < 1500) {
      throw new Error('As an Agent, you must maintain at least NPR 1,500 in your wallet after transfer.');
    }

    const senderNextWin = roundMoney(Math.min(sw.withdrawable_winnings, senderNext));
    const recvPrev = roundMoney(rw.main_balance);
    const recvNext = roundMoney(recvPrev + amount);

    const transferId = makeId('AGT');

    db.prepare(`
      UPDATE wallets SET main_balance = ?, withdrawable_winnings = ?, updated_at = datetime('now') WHERE user_id = ?
    `).run(senderNext, senderNextWin, sender.id);

    db.prepare(`
      UPDATE wallets SET main_balance = ?, updated_at = datetime('now') WHERE user_id = ?
    `).run(recvNext, receiver.id);

    db.prepare(`
      INSERT INTO agent_transfers (
        id, sender_id, sender_uid, sender_username,
        receiver_id, receiver_uid, receiver_username,
        amount, commission, sender_remaining_balance, status, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'COMPLETED', ?)
    `).run(
      transferId, sender.id, sender.uid, sender.username,
      receiver.id, receiver.uid, receiver.username,
      amount, senderNext, params.idempotencyKey || null
    );

    db.prepare(`
      INSERT INTO commission_records (id, source_tx_id, source_type, transfer_amount, commission_rate, commission_collected)
      VALUES (?, ?, 'AGENT_TRANSFER', ?, 0, 0)
    `).run(makeId('COM'), transferId, amount);

    db.prepare(`
      INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, related_uid, related_username, status, note)
      VALUES (?, ?, ?, 'AGENT_TRANSFER_OUT', ?, 'DEBIT', ?, ?, ?, ?, ?, 'COMPLETED', 'Agent transfer (0% commission)')
    `).run(makeId('TXN'), sender.id, sender.uid, amount, senderPrev, senderNext, transferId, receiver.uid, receiver.username);

    db.prepare(`
      INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, related_uid, related_username, status, note)
      VALUES (?, ?, ?, 'AGENT_TRANSFER_IN', ?, 'CREDIT', ?, ?, ?, ?, ?, 'COMPLETED', 'Received via Agent transfer')
    `).run(makeId('TXN'), receiver.id, receiver.uid, amount, recvPrev, recvNext, transferId, sender.uid, sender.username);

    const transfer = db.prepare(`SELECT * FROM agent_transfers WHERE id = ?`).get(transferId);
    return { transfer, duplicate: false, senderId: sender.id, receiverId: receiver.id, senderUsername: sender.username, senderUid: sender.uid, receiverUsername: receiver.username, receiverUid: receiver.uid, amount };
  });

  const res = tx() as {
    transfer: any;
    duplicate: boolean;
    senderId?: number;
    receiverId?: number;
    senderUsername?: string;
    senderUid?: string;
    receiverUsername?: string;
    receiverUid?: string;
    amount?: number;
  };

  if (!res.duplicate && res.senderId && res.receiverId) {
    pushWalletSync(res.senderId);
    pushWalletSync(res.receiverId);
    createNotification({
      userId: res.senderId,
      type: 'TRANSFER_SENT',
      title: 'Agent Transfer Sent',
      message: `Sent NPR ${res.amount?.toLocaleString()} to ${res.receiverUsername} (${res.receiverUid}) with 0% commission.`,
      relatedId: res.transfer.id,
    });
    createNotification({
      userId: res.receiverId,
      type: 'TRANSFER_RECEIVED',
      title: 'Agent Transfer Received',
      message: `Received NPR ${res.amount?.toLocaleString()} from Agent ${res.senderUsername} (${res.senderUid}).`,
      relatedId: res.transfer.id,
    });
  }

  return res;
}

export function executeFriendTransfer(params: {
  senderId: number;
  receiverUid: string;
  amount: number;
  idempotencyKey?: string;
}) {
  const amount = roundMoney(params.amount);
  const receiverUid = params.receiverUid.trim().toUpperCase();

  if (!Number.isFinite(amount) || amount < 100) {
    throw new Error('Minimum Friend Transfer amount is NPR 100.');
  }

  const commission = roundMoney(amount * 0.10);
  const totalDeduction = roundMoney(amount + commission);

  const tx = db.transaction(() => {
    if (params.idempotencyKey) {
      const existing = db.prepare(`SELECT * FROM friend_transfers WHERE idempotency_key = ?`).get(params.idempotencyKey);
      if (existing) {
        return { transfer: existing, duplicate: true };
      }
    }

    const sender = db.prepare(`SELECT id, uid, username, status FROM users WHERE id = ?`).get(params.senderId) as
      | { id: number; uid: string; username: string; status: string }
      | undefined;
    if (!sender) throw new Error('Sender account not found.');
    if (sender.status !== 'ACTIVE') throw new Error('Your account is not active.');

    if (sender.uid === receiverUid) {
      throw new Error('Self-transfer is not permitted.');
    }

    const receiver = db.prepare(`SELECT id, uid, username, status FROM users WHERE uid = ?`).get(receiverUid) as
      | { id: number; uid: string; username: string; status: string }
      | undefined;
    if (!receiver) throw new Error(`No SW88 account found for User ID ${receiverUid}.`);
    if (receiver.status === 'BANNED') throw new Error('Cannot transfer funds to a permanently banned account.');

    const sw = db.prepare(`SELECT main_balance, withdrawable_winnings FROM wallets WHERE user_id = ?`).get(sender.id) as {
      main_balance: number;
      withdrawable_winnings: number;
    };
    const rw = db.prepare(`SELECT main_balance FROM wallets WHERE user_id = ?`).get(receiver.id) as {
      main_balance: number;
    };

    const senderPrev = roundMoney(sw.main_balance);
    if (senderPrev < totalDeduction) {
      throw new Error(
        `Insufficient balance. Transfer of NPR ${amount.toLocaleString()} + 10% commission (NPR ${commission.toLocaleString()}) requires NPR ${totalDeduction.toLocaleString()}.`
      );
    }

    const senderNext = roundMoney(senderPrev - totalDeduction);
    const senderNextWin = roundMoney(Math.min(sw.withdrawable_winnings, senderNext));
    const recvPrev = roundMoney(rw.main_balance);
    const recvNext = roundMoney(recvPrev + amount);

    const transferId = makeId('FRD');

    db.prepare(`
      UPDATE wallets SET main_balance = ?, withdrawable_winnings = ?, updated_at = datetime('now') WHERE user_id = ?
    `).run(senderNext, senderNextWin, sender.id);

    db.prepare(`
      UPDATE wallets SET main_balance = ?, updated_at = datetime('now') WHERE user_id = ?
    `).run(recvNext, receiver.id);

    db.prepare(`
      INSERT INTO friend_transfers (
        id, sender_id, sender_uid, sender_username,
        receiver_id, receiver_uid, receiver_username,
        amount, commission_rate, commission_amount, total_deduction,
        sender_remaining_balance, status, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.10, ?, ?, ?, 'COMPLETED', ?)
    `).run(
      transferId, sender.id, sender.uid, sender.username,
      receiver.id, receiver.uid, receiver.username,
      amount, commission, totalDeduction, senderNext, params.idempotencyKey || null
    );

    db.prepare(`
      INSERT INTO commission_records (id, source_tx_id, source_type, transfer_amount, commission_rate, commission_collected)
      VALUES (?, ?, 'FRIEND_TRANSFER', ?, 0.10, ?)
    `).run(makeId('COM'), transferId, amount, commission);

    db.prepare(`
      INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, related_uid, related_username, status, note)
      VALUES (?, ?, ?, 'FRIEND_TRANSFER_OUT', ?, 'DEBIT', ?, ?, ?, ?, ?, 'COMPLETED', ?)
    `).run(
      makeId('TXN'), sender.id, sender.uid, totalDeduction, senderPrev, senderNext, transferId,
      receiver.uid, receiver.username,
      `Friend transfer NPR ${amount.toLocaleString()} + 10% commission NPR ${commission.toLocaleString()}`
    );

    db.prepare(`
      INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, related_uid, related_username, status, note)
      VALUES (?, ?, ?, 'FRIEND_TRANSFER_IN', ?, 'CREDIT', ?, ?, ?, ?, ?, 'COMPLETED', 'Received via Friend transfer')
    `).run(makeId('TXN'), receiver.id, receiver.uid, amount, recvPrev, recvNext, transferId, sender.uid, sender.username);

    const transfer = db.prepare(`SELECT * FROM friend_transfers WHERE id = ?`).get(transferId);
    return { transfer, duplicate: false, senderId: sender.id, receiverId: receiver.id, senderUsername: sender.username, senderUid: sender.uid, receiverUsername: receiver.username, receiverUid: receiver.uid, amount, commission, totalDeduction };
  });

  const res = tx() as {
    transfer: any;
    duplicate: boolean;
    senderId?: number;
    receiverId?: number;
    senderUsername?: string;
    senderUid?: string;
    receiverUsername?: string;
    receiverUid?: string;
    amount?: number;
    commission?: number;
    totalDeduction?: number;
  };

  if (!res.duplicate && res.senderId && res.receiverId) {
    pushWalletSync(res.senderId);
    pushWalletSync(res.receiverId);
    createNotification({
      userId: res.senderId,
      type: 'TRANSFER_SENT',
      title: 'Friend Transfer Sent',
      message: `Transferred NPR ${res.amount?.toLocaleString()} to ${res.receiverUsername} (${res.receiverUid}). Total deducted: NPR ${res.totalDeduction?.toLocaleString()} (incl. 10% commission).`,
      relatedId: res.transfer.id,
    });
    createNotification({
      userId: res.receiverId,
      type: 'TRANSFER_RECEIVED',
      title: 'Friend Transfer Received',
      message: `Received NPR ${res.amount?.toLocaleString()} from ${res.senderUsername} (${res.senderUid}).`,
      relatedId: res.transfer.id,
    });
  }

  return res;
}
