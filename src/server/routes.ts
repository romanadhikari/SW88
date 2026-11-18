import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router, type Response } from 'express';
import {
  APK_UPLOAD_DIR,
  createDatabaseBackup,
  db,
  getAppDownloadConfig,
  getMaintenanceState,
  listDatabaseBackups,
  QR_UPLOAD_DIR,
  SCREENSHOT_UPLOAD_DIR,
  verifyDatabaseIntegrity,
} from './db.ts';
import {
  BANNED_ACCOUNT_MESSAGE,
  BANNED_ACCOUNT_TITLE,
  checkMaintenanceMode,
  requireActiveUser,
  requireAdmin,
  requireAuth,
  type AuthedRequest,
} from './auth.ts';
import { broadcastAll, emitToAdmins, emitToUser } from './realtime.ts';
import { makeId, nstRangeToUtcBounds, rateLimit, roundMoney, validateImageBuffer } from './utils.ts';
import {
  createNotification,
  creditWallet,
  debitWallet,
  executeAgentTransfer,
  executeFriendTransfer,
  getWallet,
} from './walletService.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const apkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, APK_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() === '.apk' ? '.apk' : '.bin';
    cb(null, `sw88-app-${Date.now()}${ext}`);
  },
});

const apkUpload = multer({
  storage: apkStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

function isValidApkFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return bytesRead === 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  }
}

export function startScreenshotCleanupJob() {
  const sweep = () => {
    try {
      const due = db
        .prepare(`
          SELECT id, screenshot_filename
          FROM deposit_requests
          WHERE status != 'PENDING'
            AND screenshot_deleted = 0
            AND screenshot_delete_after IS NOT NULL
            AND screenshot_delete_after <= datetime('now')
        `)
        .all() as Array<{ id: string; screenshot_filename: string | null }>;

      for (const item of due) {
        if (item.screenshot_filename) {
          const full = path.join(SCREENSHOT_UPLOAD_DIR, path.basename(item.screenshot_filename));
          if (fs.existsSync(full)) {
            try {
              fs.unlinkSync(full);
            } catch {
              // ignore fs race
            }
          }
        }
        db.prepare(`
          UPDATE deposit_requests
          SET screenshot_deleted = 1, screenshot_filename = NULL
          WHERE id = ?
        `).run(item.id);
      }
    } catch (err) {
      console.error('Screenshot cleanup sweep error:', err);
    }
  };

  sweep();
  setInterval(sweep, 15_000);
}

function logAdminAudit(params: {
  adminId: number;
  adminUid: string;
  action: string;
  affectedRecord: string;
  reason?: string;
  details?: unknown;
}) {
  db.prepare(`
    INSERT INTO admin_audit_logs (id, admin_id, admin_uid, action, affected_record, reason, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('LOG'),
    params.adminId,
    params.adminUid,
    params.action,
    params.affectedRecord,
    params.reason || null,
    params.details ? JSON.stringify(params.details) : null
  );
}

export const apiRouter = Router();

// ============================================================================
// PUBLIC / USER ROUTES
// ============================================================================

apiRouter.get('/system/status', (_req, res: Response) => {
  const maint = getMaintenanceState();
  const nameRow = db.prepare(`SELECT value FROM platform_settings WHERE key = 'platform_name'`).get() as
    | { value: string }
    | undefined;
  return res.json({
    platformName: nameRow?.value || 'SW88',
    maintenance: maint,
  });
});

apiRouter.get('/app/download-info', (_req, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(getAppDownloadConfig());
});

apiRouter.get('/app/apk', (_req, res: Response) => {
  const cfg = getAppDownloadConfig();
  if (cfg.mode !== 'uploaded' || !cfg.apkFilename) {
    return res.status(404).json({ error: 'No APK package is currently published.' });
  }
  const filePath = path.join(APK_UPLOAD_DIR, path.basename(cfg.apkFilename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'APK file not found.' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="SW88-App.apk"');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(filePath);
});

apiRouter.get('/games', requireAuth, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT * FROM games ORDER BY id ASC`).all() as any[];
  const games = rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    thumbnail: g.thumbnail,
    enabled: Boolean(g.enabled),
    minStake: Number(g.min_stake),
    maxStake: Number(g.max_stake),
    houseEdgePct: Number(g.house_edge_pct),
    settings: JSON.parse(g.settings_json || '{}'),
  }));
  return res.json({ games });
});

apiRouter.get('/wallet', requireAuth, (req: AuthedRequest, res: Response) => {
  return res.json({ wallet: getWallet(req.user!.id) });
});

apiRouter.get('/qr', requireAuth, (_req: AuthedRequest, res: Response) => {
  const row = db.prepare(`SELECT * FROM deposit_qr_settings WHERE id = 1`).get() as any;
  const hasFile = Boolean(row?.qr_filename && fs.existsSync(path.join(QR_UPLOAD_DIR, path.basename(row.qr_filename))));
  const active = Boolean(row?.is_active && hasFile);
  return res.json({
    active,
    instructions: row?.instructions || '',
    imageUrl: active ? `/api/qr/image?v=${encodeURIComponent(row.updated_at || '')}` : null,
    unavailableMessage: active ? null : 'Deposits are temporarily unavailable.',
    updatedAt: row?.updated_at || null,
  });
});

apiRouter.get('/qr/image', (_req, res: Response) => {
  const row = db.prepare(`SELECT qr_filename, is_active FROM deposit_qr_settings WHERE id = 1`).get() as any;
  if (!row || !row.is_active || !row.qr_filename) {
    return res.status(404).json({ error: 'Deposits are temporarily unavailable.' });
  }
  const filePath = path.join(QR_UPLOAD_DIR, path.basename(row.qr_filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'QR image not found.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(filePath);
});

apiRouter.post(
  '/deposits',
  requireAuth,
  requireActiveUser,
  checkMaintenanceMode,
  rateLimit(10, 60_000),
  upload.single('screenshot'),
  (req: AuthedRequest, res: Response) => {
    try {
      const qr = db.prepare(`SELECT qr_filename, is_active FROM deposit_qr_settings WHERE id = 1`).get() as any;
      const qrExists = Boolean(qr?.qr_filename && fs.existsSync(path.join(QR_UPLOAD_DIR, path.basename(qr.qr_filename))));
      if (!qr?.is_active || !qrExists) {
        return res.status(400).json({ error: 'Deposits are temporarily unavailable.' });
      }

      const amount = roundMoney(Number(req.body?.amount));
      if (!Number.isFinite(amount) || amount < 100) {
        return res.status(400).json({ error: 'Minimum deposit amount is NPR 100.' });
      }
      if (amount > 1_000_000) {
        return res.status(400).json({ error: 'Deposit amount exceeds single request limit.' });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Payment screenshot image is required.' });
      }

      const magic = validateImageBuffer(req.file.buffer);
      if (!magic.valid) {
        return res.status(400).json({ error: 'Invalid image file. Only JPG, PNG, and WEBP screenshots are accepted.' });
      }

      const depId = makeId('DEP');
      const filename = `${depId}${magic.ext}`;
      fs.writeFileSync(path.join(SCREENSHOT_UPLOAD_DIR, filename), req.file.buffer);

      db.prepare(`
        INSERT INTO deposit_requests (id, user_id, user_uid, username, amount, screenshot_filename, status)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
      `).run(depId, req.user!.id, req.user!.uid, req.user!.username, amount, filename);

      createNotification({
        userId: req.user!.id,
        type: 'DEPOSIT_SUBMITTED',
        title: 'Deposit Request Submitted',
        message: `Your deposit request of NPR ${amount.toLocaleString()} (${depId}) is pending admin review.`,
        relatedId: depId,
      });

      emitToAdmins('deposit:new', {
        id: depId,
        userUid: req.user!.uid,
        username: req.user!.username,
        amount,
      });

      return res.status(201).json({
        id: depId,
        status: 'PENDING',
        message: 'Your deposit request has been submitted and is pending admin review.',
      });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Deposit submission failed.' });
    }
  }
);

apiRouter.get('/deposits/my', requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(`
      SELECT id, amount, status, admin_message, screenshot_deleted, created_at, reviewed_at
      FROM deposit_requests
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `)
    .all(req.user!.id);
  return res.json({ deposits: rows });
});

apiRouter.get('/transfers/lookup/:uid', requireAuth, requireActiveUser, (req: AuthedRequest, res: Response) => {
  const uid = String(req.params.uid || '').trim().toUpperCase();
  if (!uid) return res.status(400).json({ error: 'Enter a User ID.' });
  if (uid === req.user!.uid) {
    return res.status(400).json({ error: 'You cannot transfer funds to your own User ID.' });
  }
  const target = db
    .prepare(`SELECT uid, username, display_name, status, role FROM users WHERE uid = ?`)
    .get(uid) as any;
  if (!target || target.role !== 'USER') {
    return res.status(404).json({ error: `No SW88 user found with ID ${uid}.` });
  }
  if (target.status === 'BANNED') {
    return res.status(400).json({ error: 'Transfers to permanently banned accounts are blocked.' });
  }
  return res.json({
    uid: target.uid,
    username: target.username,
    displayName: target.display_name,
  });
});

apiRouter.post('/transfers/agent', requireAuth, requireActiveUser, checkMaintenanceMode, rateLimit(15, 60_000), (req: AuthedRequest, res: Response) => {
  try {
    const receiverUid = String(req.body?.receiverUid || '').trim().toUpperCase();
    const amount = Number(req.body?.amount);
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;
    const result = executeAgentTransfer({
      senderId: req.user!.id,
      receiverUid,
      amount,
      idempotencyKey,
    });
    return res.status(201).json({
      transfer: result.transfer,
      wallet: getWallet(req.user!.id),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Agent transfer failed.' });
  }
});

apiRouter.post('/transfers/friend', requireAuth, requireActiveUser, checkMaintenanceMode, rateLimit(15, 60_000), (req: AuthedRequest, res: Response) => {
  try {
    const receiverUid = String(req.body?.receiverUid || '').trim().toUpperCase();
    const amount = Number(req.body?.amount);
    const idempotencyKey = req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined;
    const result = executeFriendTransfer({
      senderId: req.user!.id,
      receiverUid,
      amount,
      idempotencyKey,
    });
    return res.status(201).json({
      transfer: result.transfer,
      wallet: getWallet(req.user!.id),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Friend transfer failed.' });
  }
});

apiRouter.get('/withdrawals/my', requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(req.user!.id);
  return res.json({ withdrawals: rows });
});

apiRouter.post('/withdrawals', requireAuth, requireActiveUser, checkMaintenanceMode, rateLimit(8, 60_000), (req: AuthedRequest, res: Response) => {
  try {
    const amount = roundMoney(Number(req.body?.amount));
    const method = String(req.body?.method || '').toUpperCase();
    const accountHolderName = String(req.body?.accountHolderName || '').trim();
    const esewaMobile = String(req.body?.esewaMobile || '').trim();
    const bankName = String(req.body?.bankName || '').trim();
    const bankAccountNumber = String(req.body?.bankAccountNumber || '').trim();
    const bankBranch = String(req.body?.bankBranch || '').trim();

    if (!Number.isFinite(amount) || amount < 1000 || amount > 10000) {
      return res.status(400).json({ error: 'Withdrawal amount must be between NPR 1,000 and NPR 10,000.' });
    }
    if (method !== 'ESEWA' && method !== 'BANK') {
      return res.status(400).json({ error: 'Select eSewa or Bank Transfer as withdrawal method.' });
    }
    if (accountHolderName.length < 2) {
      return res.status(400).json({ error: 'Account holder name is required.' });
    }
    if (method === 'ESEWA' && !/^[0-9]{10}$/.test(esewaMobile)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit eSewa mobile number.' });
    }
    if (method === 'BANK' && (!bankName || bankAccountNumber.length < 5 || !bankBranch)) {
      return res.status(400).json({ error: 'Bank name, account number, and branch are required.' });
    }

    const tx = db.transaction(() => {
      const pending = db
        .prepare(`SELECT id FROM withdrawal_requests WHERE user_id = ? AND request_status = 'PENDING' LIMIT 1`)
        .get(req.user!.id) as { id: string } | undefined;
      if (pending) {
        throw new Error(`You already have a pending withdrawal request (${pending.id}). Please wait for review.`);
      }

      const w = db
        .prepare(`SELECT main_balance, reserved_withdrawal, withdrawable_winnings FROM wallets WHERE user_id = ?`)
        .get(req.user!.id) as any;

      const availableWinnings = roundMoney(Math.min(w.withdrawable_winnings, w.main_balance));
      if (availableWinnings < amount) {
        throw new Error(
          `Only game winnings are eligible for withdrawal. Your withdrawable winnings balance is NPR ${availableWinnings.toLocaleString()}.`
        );
      }

      const prevMain = roundMoney(w.main_balance);
      const nextMain = roundMoney(prevMain - amount);
      const nextWinnings = roundMoney(w.withdrawable_winnings - amount);
      const nextReserved = roundMoney(w.reserved_withdrawal + amount);

      db.prepare(`
        UPDATE wallets
        SET main_balance = ?,
            withdrawable_winnings = ?,
            reserved_withdrawal = ?,
            updated_at = datetime('now')
        WHERE user_id = ?
      `).run(nextMain, nextWinnings, nextReserved, req.user!.id);

      const wdrId = makeId('WDR');
      db.prepare(`
        INSERT INTO withdrawal_requests (
          id, user_id, user_uid, username, amount, method,
          account_holder_name, esewa_mobile, bank_name, bank_account_number, bank_branch,
          request_status, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'NOT PAID')
      `).run(
        wdrId,
        req.user!.id,
        req.user!.uid,
        req.user!.username,
        amount,
        method,
        accountHolderName,
        method === 'ESEWA' ? esewaMobile : null,
        method === 'BANK' ? bankName : null,
        method === 'BANK' ? bankAccountNumber : null,
        method === 'BANK' ? bankBranch : null
      );

      db.prepare(`
        INSERT INTO wallet_ledger (
          id, user_id, user_uid, tx_type, amount, direction,
          prev_balance, new_balance, related_id, status, note
        ) VALUES (?, ?, ?, 'WITHDRAWAL_RESERVE', ?, 'RESERVE', ?, ?, ?, 'PENDING', ?)
      `).run(
        makeId('TXN'),
        req.user!.id,
        req.user!.uid,
        amount,
        prevMain,
        nextMain,
        wdrId,
        `Reserved for ${method} withdrawal (${wdrId})`
      );

      return db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(wdrId) as any;
    });

    const withdrawal = tx();
    const wallet = getWallet(req.user!.id);
    emitToUser(req.user!.id, 'wallet:updated', wallet);

    createNotification({
      userId: req.user!.id,
      type: 'WITHDRAWAL_SUBMITTED',
      title: 'Withdrawal Request Submitted',
      message: `Your withdrawal request of NPR ${amount.toLocaleString()} via ${method} (${withdrawal.id}) is pending review.`,
      relatedId: withdrawal.id,
    });

    emitToAdmins('withdrawal:new', {
      id: withdrawal.id,
      userUid: req.user!.uid,
      username: req.user!.username,
      amount,
      method,
    });

    return res.status(201).json({
      withdrawal,
      wallet,
      message: 'Your withdrawal request has been submitted for admin review.',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Withdrawal request failed.' });
  }
});

apiRouter.get('/history', requireAuth, (req: AuthedRequest, res: Response) => {
  const uid = req.user!.id;
  const ledger = db
    .prepare(`SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`)
    .all(uid);
  const deposits = db
    .prepare(`SELECT id, amount, status, admin_message, created_at, reviewed_at FROM deposit_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(uid);
  const withdrawals = db
    .prepare(`SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(uid);
  const agentTransfers = db
    .prepare(`SELECT * FROM agent_transfers WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(uid, uid);
  const friendTransfers = db
    .prepare(`SELECT * FROM friend_transfers WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(uid, uid);
  const gameRounds = db
    .prepare(`
      SELECT r.id, r.game_id, g.name AS game_name, r.stake, r.payout, r.net_result, r.result, r.wallet_before, r.wallet_after, r.created_at, r.settled_at
      FROM game_rounds r
      JOIN games g ON g.id = r.game_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT 150
    `)
    .all(uid);

  return res.json({
    ledger,
    deposits,
    withdrawals,
    agentTransfers,
    friendTransfers,
    gameRounds,
  });
});

apiRouter.get('/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
  const notifications = db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(req.user!.id);
  const unreadRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`)
    .get(req.user!.id) as { cnt: number };
  return res.json({ notifications, unreadCount: unreadRow.cnt });
});

apiRouter.post('/notifications/read', requireAuth, (req: AuthedRequest, res: Response) => {
  const id = req.body?.id ? String(req.body.id) : null;
  if (id) {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(id, req.user!.id);
  } else {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
  }
  return res.json({ ok: true });
});

// ============================================================================
// ADMIN ROUTES (STRICT BACKEND ROLE ENFORCEMENT)
// ============================================================================

apiRouter.get('/admin/overview', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const range = String(req.query.range || 'today');
  const start = req.query.start ? String(req.query.start) : undefined;
  const end = req.query.end ? String(req.query.end) : undefined;
  const { startUtc, endUtc } = nstRangeToUtcBounds(range, start, end);

  const depApproved = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM deposit_requests
      WHERE status = 'APPROVED' AND reviewed_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc) as { total: number; cnt: number };

  const depPending = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM deposit_requests
      WHERE status = 'PENDING'
    `)
    .get() as { total: number; cnt: number };

  const totalUserWallets = db
    .prepare(`
      SELECT COALESCE(SUM(w.main_balance), 0) AS mainTotal,
             COALESCE(SUM(w.reserved_withdrawal), 0) AS reservedTotal,
             COALESCE(SUM(w.withdrawable_winnings), 0) AS winningsTotal
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      WHERE u.role = 'USER'
    `)
    .get() as { mainTotal: number; reservedTotal: number; winningsTotal: number };

  const agentVol = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM agent_transfers
      WHERE created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc) as { total: number; cnt: number };

  const friendVol = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM friend_transfers
      WHERE created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc) as { total: number; cnt: number };

  const commissions = db
    .prepare(`
      SELECT COALESCE(SUM(commission_collected), 0) AS total, COUNT(*) AS cnt
      FROM commission_records
      WHERE created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc) as { total: number; cnt: number };

  // Separate Games & Withdrawals Summary (strictly NOT mixed into the 6 core KPIs)
  const gameStats = db
    .prepare(`
      SELECT COALESCE(SUM(stake), 0) AS totalStakes,
             COALESCE(SUM(payout), 0) AS totalPayouts,
             COUNT(*) AS totalRounds
      FROM game_rounds
      WHERE result != 'CANCELLED' AND created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc) as { totalStakes: number; totalPayouts: number; totalRounds: number };

  const wdrStats = db
    .prepare(`
      SELECT
        SUM(CASE WHEN request_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingCount,
        COALESCE(SUM(CASE WHEN request_status = 'PENDING' THEN amount ELSE 0 END), 0) AS pendingAmount,
        SUM(CASE WHEN payment_status = 'PAID' AND paid_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS paidCount,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' AND paid_at BETWEEN ? AND ? THEN amount ELSE 0 END), 0) AS paidAmount
      FROM withdrawal_requests
    `)
    .get(startUtc, endUtc, startUtc, endUtc) as {
    pendingCount: number;
    pendingAmount: number;
    paidCount: number;
    paidAmount: number;
  };

  const userCounts = db
    .prepare(`
      SELECT
        COUNT(*) AS totalUsers,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS activeUsers,
        SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspendedUsers,
        SUM(CASE WHEN status = 'BANNED' THEN 1 ELSE 0 END) AS bannedUsers
      FROM users WHERE role = 'USER'
    `)
    .get() as any;

  const recentDeposits = db
    .prepare(`SELECT id, user_uid, username, amount, status, created_at FROM deposit_requests ORDER BY created_at DESC LIMIT 5`)
    .all();
  const recentWithdrawals = db
    .prepare(`SELECT id, user_uid, username, amount, method, request_status, payment_status, created_at FROM withdrawal_requests ORDER BY created_at DESC LIMIT 5`)
    .all();
  const recentLogs = db
    .prepare(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 8`)
    .all();

  return res.json({
    range,
    startUtc,
    endUtc,
    kpis: {
      totalDepositsApproved: roundMoney(depApproved.total),
      totalDepositsApprovedCount: depApproved.cnt,
      totalPendingDepositCount: depPending.cnt,
      totalPendingDepositAmount: roundMoney(depPending.total),
      totalUsersWalletBalance: roundMoney(totalUserWallets.mainTotal),
      totalUsersReservedWithdrawal: roundMoney(totalUserWallets.reservedTotal),
      totalUsersWithdrawableWinnings: roundMoney(totalUserWallets.winningsTotal),
      totalAgentTransferVolume: roundMoney(agentVol.total),
      totalAgentTransferCount: agentVol.cnt,
      totalFriendTransferVolume: roundMoney(friendVol.total),
      totalFriendTransferCount: friendVol.cnt,
      totalCommissionCollected: roundMoney(commissions.total),
    },
    gamesAndWithdrawalsSummary: {
      totalGameStakes: roundMoney(gameStats.totalStakes),
      totalGamePayouts: roundMoney(gameStats.totalPayouts),
      totalGameNetRevenue: roundMoney(gameStats.totalStakes - gameStats.totalPayouts),
      totalGameRounds: gameStats.totalRounds,
      pendingWithdrawalsCount: wdrStats.pendingCount || 0,
      pendingWithdrawalsAmount: roundMoney(wdrStats.pendingAmount || 0),
      paidWithdrawalsCount: wdrStats.paidCount || 0,
      paidWithdrawalsAmount: roundMoney(wdrStats.paidAmount || 0),
    },
    userCounts,
    recentActivity: {
      deposits: recentDeposits,
      withdrawals: recentWithdrawals,
      auditLogs: recentLogs,
    },
  });
});

apiRouter.get('/admin/users', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim().toUpperCase();

  let sql = `
    SELECT u.id, u.uid, u.username, u.display_name, u.status, u.is_agent, u.ban_reason, u.created_at,
           u.responsible_daily_limit, u.self_excluded_until,
           w.main_balance, w.reserved_withdrawal, w.withdrawable_winnings,
           w.total_deposited, w.total_withdrawn, w.total_staked, w.total_won, w.total_lost
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    WHERE u.role = 'USER'
  `;
  const params: any[] = [];
  if (search) {
    sql += ` AND (u.username LIKE ? OR u.uid LIKE ? OR u.display_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status && ['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
    sql += ` AND u.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY u.created_at DESC LIMIT 300`;

  const users = db.prepare(sql).all(...params);
  return res.json({ users });
});

apiRouter.get('/admin/users/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const userId = Number(req.params.id);
  const user = db
    .prepare(`
      SELECT u.id, u.uid, u.username, u.display_name, u.role, u.status, u.is_agent, u.ban_reason, u.created_at,
             w.main_balance, w.reserved_withdrawal, w.withdrawable_winnings,
             w.total_deposited, w.total_withdrawn, w.total_staked, w.total_won, w.total_lost
      FROM users u JOIN wallets w ON w.user_id = u.id
      WHERE u.id = ? AND u.role = 'USER'
    `)
    .get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const ledger = db.prepare(`SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`).all(userId);
  const rounds = db
    .prepare(`SELECT r.*, g.name AS game_name FROM game_rounds r JOIN games g ON g.id = r.game_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 40`)
    .all(userId);
  const agentTransfers = db
    .prepare(`SELECT *, 'AGENT' AS transfer_type FROM agent_transfers WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC LIMIT 60`)
    .all(userId, userId);
  const friendTransfers = db
    .prepare(`SELECT *, 'FRIEND' AS transfer_type FROM friend_transfers WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC LIMIT 60`)
    .all(userId, userId);
  const transferSummary = db
    .prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM agent_transfers WHERE sender_id = ?) AS agentSent,
        (SELECT COALESCE(SUM(amount), 0) FROM agent_transfers WHERE receiver_id = ?) AS agentReceived,
        (SELECT COALESCE(SUM(amount), 0) FROM friend_transfers WHERE sender_id = ?) AS friendSent,
        (SELECT COALESCE(SUM(amount), 0) FROM friend_transfers WHERE receiver_id = ?) AS friendReceived
    `)
    .get(userId, userId, userId, userId);
  return res.json({ user, ledger, rounds, agentTransfers, friendTransfers, transferSummary });
});

apiRouter.post('/admin/users/:id/agent', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const userId = Number(req.params.id);
  const isAgent = Boolean(req.body?.isAgent);
  const target = db.prepare(`SELECT id, uid, username, role FROM users WHERE id = ?`).get(userId) as any;
  if (!target || target.role !== 'USER') return res.status(404).json({ error: 'User not found.' });

  db.prepare(`UPDATE users SET is_agent = ?, updated_at = datetime('now') WHERE id = ?`).run(isAgent ? 1 : 0, userId);
  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: isAgent ? 'USER_DESIGNATED_AGENT' : 'USER_AGENT_REMOVED',
    affectedRecord: `${target.username} (${target.uid})`,
    reason: isAgent ? 'Designated verified SW88 Agent' : 'Removed Agent badge',
  });
  return res.json({ ok: true, isAgent });
});

apiRouter.post('/admin/users/:id/status', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const userId = Number(req.params.id);
  const status = String(req.body?.status || '').toUpperCase();
  const reason = String(req.body?.reason || '').trim();

  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    return res.status(400).json({ error: 'Invalid status. Use ACTIVE or SUSPENDED.' });
  }
  const target = db.prepare(`SELECT id, uid, username, role, status FROM users WHERE id = ?`).get(userId) as any;
  if (!target || target.role !== 'USER') return res.status(404).json({ error: 'User not found.' });
  if (target.status === 'BANNED') {
    return res.status(400).json({ error: 'Permanently banned accounts cannot be reactivated via status toggle.' });
  }

  db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, userId);
  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
    affectedRecord: `${target.username} (${target.uid})`,
    reason: reason || `Status updated to ${status}`,
  });

  createNotification({
    userId,
    type: 'ACCOUNT_STATUS',
    title: status === 'SUSPENDED' ? 'Account Suspended' : 'Account Reactivated',
    message:
      status === 'SUSPENDED'
        ? `Your account has been temporarily suspended. ${reason ? 'Reason: ' + reason : ''}`
        : 'Your SW88 account has been reactivated.',
  });

  emitToUser(userId, 'account:status', { status });
  return res.json({ ok: true, status });
});

apiRouter.post('/admin/users/:id/ban', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const userId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) {
    return res.status(400).json({ error: 'A ban reason is required (min 3 characters).' });
  }

  const target = db.prepare(`SELECT id, uid, username, role, status FROM users WHERE id = ?`).get(userId) as any;
  if (!target || target.role !== 'USER') return res.status(404).json({ error: 'User not found.' });
  if (target.status === 'BANNED') return res.status(400).json({ error: 'User is already permanently banned.' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET status = 'BANNED', ban_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(
      reason,
      userId
    );
    db.prepare(`UPDATE user_sessions SET revoked = 1 WHERE user_id = ?`).run(userId);
    db.prepare(`
      INSERT INTO account_bans (id, user_id, user_uid, username, reason, banned_by_uid)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(makeId('BAN'), userId, target.uid, target.username, reason, req.user!.uid);
  });
  tx();

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'USER_PERMANENT_BAN',
    affectedRecord: `${target.username} (${target.uid})`,
    reason,
  });

  emitToUser(userId, 'account:banned', {
    title: BANNED_ACCOUNT_TITLE,
    message: BANNED_ACCOUNT_MESSAGE,
  });

  return res.json({ ok: true });
});

apiRouter.post('/admin/users/:id/wallet-adjust', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const direction = String(req.body?.direction || '').toUpperCase();
    const amount = roundMoney(Number(req.body?.amount));
    const reason = String(req.body?.reason || '').trim();
    const countAsWinnings = Boolean(req.body?.countAsWinnings);

    if (direction !== 'CREDIT' && direction !== 'DEBIT') {
      return res.status(400).json({ error: 'Direction must be CREDIT or DEBIT.' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0.' });
    }
    if (reason.length < 3) {
      return res.status(400).json({ error: 'An adjustment reason is required.' });
    }

    const target = db.prepare(`SELECT id, uid, username, role FROM users WHERE id = ?`).get(userId) as any;
    if (!target || target.role !== 'USER') return res.status(404).json({ error: 'User not found.' });

    const adjId = makeId('ADJ');
    let wallet;
    if (direction === 'CREDIT') {
      wallet = creditWallet({
        userId,
        txType: 'ADMIN_CREDIT',
        amount,
        relatedId: adjId,
        note: `Admin adjustment: ${reason}`,
        countAsWinnings,
      }).wallet;
    } else {
      wallet = debitWallet({
        userId,
        txType: 'ADMIN_DEBIT',
        amount,
        relatedId: adjId,
        note: `Admin adjustment: ${reason}`,
      }).wallet;
    }

    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: direction === 'CREDIT' ? 'ADMIN_WALLET_CREDIT' : 'ADMIN_WALLET_DEBIT',
      affectedRecord: `${target.username} (${target.uid}) · NPR ${amount}`,
      reason,
      details: { adjId, countAsWinnings },
    });

    createNotification({
      userId,
      type: 'WALLET_ADJUSTMENT',
      title: direction === 'CREDIT' ? 'Wallet Credited by Admin' : 'Wallet Debited by Admin',
      message: `${direction === 'CREDIT' ? '+' : '-'}NPR ${amount.toLocaleString()}. Reason: ${reason}`,
      relatedId: adjId,
    });

    return res.json({ ok: true, wallet });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Wallet adjustment failed.' });
  }
});

apiRouter.get('/admin/deposits', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || '').toUpperCase();
  let sql = `SELECT * FROM deposit_requests`;
  const params: any[] = [];
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY CASE WHEN status = 'PENDING' THEN 0 ELSE 1 END, created_at DESC LIMIT 300`;
  const rows = db.prepare(sql).all(...params) as any[];
  const deposits = rows.map((d) => ({
    ...d,
    screenshotAvailable: Boolean(
      !d.screenshot_deleted &&
        d.screenshot_filename &&
        fs.existsSync(path.join(SCREENSHOT_UPLOAD_DIR, path.basename(d.screenshot_filename)))
    ),
  }));
  return res.json({ deposits });
});

apiRouter.get('/admin/deposits/:id/screenshot', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const row = db.prepare(`SELECT screenshot_filename, screenshot_deleted FROM deposit_requests WHERE id = ?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Deposit not found.' });
  if (row.screenshot_deleted || !row.screenshot_filename) {
    return res.status(404).json({ error: 'Screenshot has been permanently deleted after review.' });
  }
  const full = path.join(SCREENSHOT_UPLOAD_DIR, path.basename(row.screenshot_filename));
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'Screenshot file missing.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(full);
});

apiRouter.post('/admin/deposits/:id/review', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const depId = String(req.params.id);
    const action = String(req.body?.action || '').toUpperCase();
    const adminMessage = String(req.body?.adminMessage || '').trim();

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
    }
    if (action === 'REJECT' && adminMessage.length < 2) {
      return res.status(400).json({ error: 'Please provide a rejection message for the user.' });
    }

    const dep = db.prepare(`SELECT * FROM deposit_requests WHERE id = ?`).get(depId) as any;
    if (!dep) return res.status(404).json({ error: 'Deposit request not found.' });
    if (dep.status !== 'PENDING') {
      return res.status(400).json({ error: `Deposit ${depId} has already been ${dep.status}.` });
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE deposit_requests
        SET status = ?,
            admin_message = ?,
            reviewed_by_uid = ?,
            reviewed_at = datetime('now'),
            screenshot_delete_after = datetime('now', '+5 minutes')
        WHERE id = ?
      `).run(
        newStatus,
        adminMessage || (newStatus === 'APPROVED' ? 'Deposit verified and credited.' : 'Deposit rejected.'),
        req.user!.uid,
        depId
      );
    });
    tx();

    if (newStatus === 'APPROVED') {
      creditWallet({
        userId: dep.user_id,
        txType: 'DEPOSIT_APPROVED',
        amount: dep.amount,
        relatedId: depId,
        idempotencyKey: `dep-approve-${depId}`,
        note: `Deposit ${depId} approved${adminMessage ? ': ' + adminMessage : ''}`,
        countAsDeposited: true,
      });
    }

    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: newStatus === 'APPROVED' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
      affectedRecord: `${depId} · ${dep.username} (${dep.user_uid}) · NPR ${dep.amount}`,
      reason: adminMessage || newStatus,
    });

    createNotification({
      userId: dep.user_id,
      type: newStatus === 'APPROVED' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
      title: newStatus === 'APPROVED' ? 'Deposit Approved' : 'Deposit Rejected',
      message:
        newStatus === 'APPROVED'
          ? `Your deposit of NPR ${Number(dep.amount).toLocaleString()} (${depId}) was approved and credited.${adminMessage ? ' Note: ' + adminMessage : ''}`
          : `Your deposit of NPR ${Number(dep.amount).toLocaleString()} (${depId}) was rejected. Reason: ${adminMessage}`,
      relatedId: depId,
    });

    return res.json({ ok: true, status: newStatus });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Deposit review failed.' });
  }
});

apiRouter.get('/admin/qr', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const row = db.prepare(`SELECT * FROM deposit_qr_settings WHERE id = 1`).get() as any;
  const hasFile = Boolean(row?.qr_filename && fs.existsSync(path.join(QR_UPLOAD_DIR, path.basename(row.qr_filename))));
  return res.json({
    active: Boolean(row?.is_active && hasFile),
    hasFile,
    instructions: row?.instructions || '',
    updatedByUid: row?.updated_by_uid || null,
    updatedAt: row?.updated_at || null,
    imageUrl: hasFile ? `/api/qr/image?v=${encodeURIComponent(row.updated_at || '')}` : null,
  });
});

apiRouter.post('/admin/qr', requireAuth, requireAdmin, upload.single('qr'), (req: AuthedRequest, res: Response) => {
  try {
    const instructions = String(req.body?.instructions || '').trim();
    const activeParam = req.body?.active !== undefined ? req.body.active === 'true' || req.body.active === true : true;
    const current = db.prepare(`SELECT * FROM deposit_qr_settings WHERE id = 1`).get() as any;

    let filename = current?.qr_filename || null;
    if (req.file && req.file.buffer) {
      const magic = validateImageBuffer(req.file.buffer);
      if (!magic.valid) {
        return res.status(400).json({ error: 'Invalid QR image. Use PNG, JPG, or WEBP.' });
      }
      if (filename) {
        const oldPath = path.join(QR_UPLOAD_DIR, path.basename(filename));
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // ignore
          }
        }
      }
      filename = `sw88-deposit-qr-${Date.now()}${magic.ext}`;
      fs.writeFileSync(path.join(QR_UPLOAD_DIR, filename), req.file.buffer);
    }

    if (!filename && activeParam) {
      return res.status(400).json({ error: 'Please upload a QR image before activating deposits.' });
    }

    db.prepare(`
      UPDATE deposit_qr_settings
      SET qr_filename = ?,
          instructions = COALESCE(NULLIF(?, ''), instructions),
          is_active = ?,
          updated_by_uid = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `).run(filename, instructions, activeParam && filename ? 1 : 0, req.user!.uid);

    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: req.file ? 'DEPOSIT_QR_UPLOADED' : 'DEPOSIT_QR_UPDATED',
      affectedRecord: filename || 'QR_SETTINGS',
      reason: activeParam ? 'Active deposit QR published' : 'Deposit QR paused',
    });

    broadcastAll('qr:updated', { active: Boolean(activeParam && filename) });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not update QR settings.' });
  }
});

apiRouter.delete('/admin/qr', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const current = db.prepare(`SELECT qr_filename FROM deposit_qr_settings WHERE id = 1`).get() as any;
  if (current?.qr_filename) {
    const full = path.join(QR_UPLOAD_DIR, path.basename(current.qr_filename));
    if (fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
      } catch {
        // ignore
      }
    }
  }
  db.prepare(`
    UPDATE deposit_qr_settings
    SET qr_filename = NULL, is_active = 0, updated_by_uid = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(req.user!.uid);

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'DEPOSIT_QR_REMOVED',
    affectedRecord: 'QR_SETTINGS',
    reason: 'Admin removed active deposit QR',
  });

  broadcastAll('qr:updated', { active: false });
  return res.json({ ok: true });
});

apiRouter.get('/admin/agent-transfers', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const search = String(req.query.search || '').trim();
  const uid = String(req.query.uid || '').trim().toUpperCase();
  const agentUid = String(req.query.agentUid || '').trim().toUpperCase();
  const txId = String(req.query.txId || '').trim().toUpperCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const start = req.query.start ? String(req.query.start) : undefined;
  const end = req.query.end ? String(req.query.end) : undefined;

  let sql = `SELECT * FROM agent_transfers WHERE 1 = 1`;
  const params: any[] = [];
  if (search) {
    sql += ` AND (id LIKE ? OR sender_uid LIKE ? OR sender_username LIKE ? OR receiver_uid LIKE ? OR receiver_username LIKE ?)`;
    const pat = `%${search}%`;
    params.push(pat, pat, pat, pat, pat);
  }
  if (uid) {
    sql += ` AND (sender_uid = ? OR receiver_uid = ?)`;
    params.push(uid, uid);
  }
  if (agentUid) {
    sql += ` AND sender_uid = ?`;
    params.push(agentUid);
  }
  if (txId) {
    sql += ` AND id LIKE ?`;
    params.push(`%${txId}%`);
  }
  if (status && status !== 'ALL') {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (start || end) {
    const { startUtc, endUtc } = nstRangeToUtcBounds('custom', start, end);
    sql += ` AND created_at BETWEEN ? AND ?`;
    params.push(startUtc, endUtc);
  }
  sql += ` ORDER BY created_at DESC LIMIT 300`;
  const transfers = db.prepare(sql).all(...params) as any[];
  const totalAmount = roundMoney(transfers.reduce((s, t) => s + Number(t.amount || 0), 0));
  return res.json({ transfers, summary: { count: transfers.length, totalAmount } });
});

apiRouter.get('/admin/friend-transfers', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const search = String(req.query.search || '').trim();
  const uid = String(req.query.uid || '').trim().toUpperCase();
  const txId = String(req.query.txId || '').trim().toUpperCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const start = req.query.start ? String(req.query.start) : undefined;
  const end = req.query.end ? String(req.query.end) : undefined;

  let sql = `SELECT * FROM friend_transfers WHERE 1 = 1`;
  const params: any[] = [];
  if (search) {
    sql += ` AND (id LIKE ? OR sender_uid LIKE ? OR sender_username LIKE ? OR receiver_uid LIKE ? OR receiver_username LIKE ?)`;
    const pat = `%${search}%`;
    params.push(pat, pat, pat, pat, pat);
  }
  if (uid) {
    sql += ` AND (sender_uid = ? OR receiver_uid = ?)`;
    params.push(uid, uid);
  }
  if (txId) {
    sql += ` AND id LIKE ?`;
    params.push(`%${txId}%`);
  }
  if (status && status !== 'ALL') {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (start || end) {
    const { startUtc, endUtc } = nstRangeToUtcBounds('custom', start, end);
    sql += ` AND created_at BETWEEN ? AND ?`;
    params.push(startUtc, endUtc);
  }
  sql += ` ORDER BY created_at DESC LIMIT 300`;
  const transfers = db.prepare(sql).all(...params) as any[];
  const totalAmount = roundMoney(transfers.reduce((s, t) => s + Number(t.amount || 0), 0));
  const totalCommission = roundMoney(transfers.reduce((s, t) => s + Number(t.commission_amount || 0), 0));
  return res.json({ transfers, summary: { count: transfers.length, totalAmount, totalCommission } });
});

apiRouter.get('/admin/transfers', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const typeFilter = String(req.query.type || 'ALL').trim().toUpperCase();
  const search = String(req.query.search || '').trim();
  const uid = String(req.query.uid || '').trim().toUpperCase();
  const agentUid = String(req.query.agentUid || '').trim().toUpperCase();
  const txId = String(req.query.txId || '').trim().toUpperCase();
  const status = String(req.query.status || 'ALL').trim().toUpperCase();
  const direction = String(req.query.direction || 'ALL').trim().toUpperCase();
  const start = req.query.start ? String(req.query.start) : undefined;
  const end = req.query.end ? String(req.query.end) : undefined;

  let dateClause = '';
  const dateParams: any[] = [];
  if (start || end) {
    const { startUtc, endUtc } = nstRangeToUtcBounds('custom', start, end);
    dateClause = ` AND created_at BETWEEN ? AND ?`;
    dateParams.push(startUtc, endUtc);
  }

  const rows: any[] = [];
  if (typeFilter === 'ALL' || typeFilter === 'AGENT') {
    let sql = `
      SELECT id, 'AGENT' AS transfer_type, sender_id, sender_uid, sender_username,
             receiver_id, receiver_uid, receiver_username, amount,
             0 AS commission_amount, amount AS total_deduction,
             sender_remaining_balance, status, idempotency_key, created_at
      FROM agent_transfers WHERE 1 = 1 ${dateClause}
    `;
    const p: any[] = [...dateParams];
    if (search) {
      const pat = `%${search}%`;
      sql += ` AND (id LIKE ? OR sender_uid LIKE ? OR sender_username LIKE ? OR receiver_uid LIKE ? OR receiver_username LIKE ?)`;
      p.push(pat, pat, pat, pat, pat);
    }
    if (uid) {
      if (direction === 'OUTGOING') {
        sql += ` AND sender_uid = ?`;
        p.push(uid);
      } else if (direction === 'INCOMING') {
        sql += ` AND receiver_uid = ?`;
        p.push(uid);
      } else {
        sql += ` AND (sender_uid = ? OR receiver_uid = ?)`;
        p.push(uid, uid);
      }
    }
    if (agentUid) {
      sql += ` AND sender_uid = ?`;
      p.push(agentUid);
    }
    if (txId) {
      sql += ` AND id LIKE ?`;
      p.push(`%${txId}%`);
    }
    if (status && status !== 'ALL') {
      sql += ` AND status = ?`;
      p.push(status);
    }
    sql += ` ORDER BY created_at DESC LIMIT 300`;
    rows.push(...(db.prepare(sql).all(...p) as any[]));
  }

  if (typeFilter === 'ALL' || typeFilter === 'FRIEND') {
    let sql = `
      SELECT id, 'FRIEND' AS transfer_type, sender_id, sender_uid, sender_username,
             receiver_id, receiver_uid, receiver_username, amount,
             commission_amount, total_deduction,
             sender_remaining_balance, status, idempotency_key, created_at
      FROM friend_transfers WHERE 1 = 1 ${dateClause}
    `;
    const p: any[] = [...dateParams];
    if (search) {
      const pat = `%${search}%`;
      sql += ` AND (id LIKE ? OR sender_uid LIKE ? OR sender_username LIKE ? OR receiver_uid LIKE ? OR receiver_username LIKE ?)`;
      p.push(pat, pat, pat, pat, pat);
    }
    if (uid) {
      if (direction === 'OUTGOING') {
        sql += ` AND sender_uid = ?`;
        p.push(uid);
      } else if (direction === 'INCOMING') {
        sql += ` AND receiver_uid = ?`;
        p.push(uid);
      } else {
        sql += ` AND (sender_uid = ? OR receiver_uid = ?)`;
        p.push(uid, uid);
      }
    }
    if (agentUid) {
      sql += ` AND 1 = 0`; // agentUid filter excludes friend transfers unless matched
    }
    if (txId) {
      sql += ` AND id LIKE ?`;
      p.push(`%${txId}%`);
    }
    if (status && status !== 'ALL') {
      sql += ` AND status = ?`;
      p.push(status);
    }
    sql += ` ORDER BY created_at DESC LIMIT 300`;
    rows.push(...(db.prepare(sql).all(...p) as any[]));
  }

  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const sliced = rows.slice(0, 400);

  const agentVolume = roundMoney(
    sliced.filter((r) => r.transfer_type === 'AGENT').reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const friendVolume = roundMoney(
    sliced.filter((r) => r.transfer_type === 'FRIEND').reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const totalCommission = roundMoney(
    sliced.reduce((s, r) => s + Number(r.commission_amount || 0), 0)
  );

  return res.json({
    transfers: sliced,
    summary: {
      totalCount: sliced.length,
      totalAmount: roundMoney(agentVolume + friendVolume),
      agentVolume,
      friendVolume,
      totalCommission,
    },
  });
});

apiRouter.get('/admin/commissions', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const records = db
    .prepare(`
      SELECT c.*,
             COALESCE(a.sender_uid, f.sender_uid) AS sender_uid,
             COALESCE(a.receiver_uid, f.receiver_uid) AS receiver_uid,
             ROUND(c.commission_rate * 100, 2) AS commission_rate_pct
      FROM commission_records c
      LEFT JOIN agent_transfers a ON a.id = c.source_tx_id
      LEFT JOIN friend_transfers f ON f.id = c.source_tx_id
      ORDER BY c.created_at DESC
      LIMIT 300
    `)
    .all();
  const totals = db
    .prepare(`
      SELECT COALESCE(SUM(commission_collected), 0) AS totalCommission,
             COALESCE(SUM(CASE WHEN source_type = 'FRIEND_TRANSFER' THEN transfer_amount ELSE 0 END), 0) AS friendVolume,
             COALESCE(SUM(CASE WHEN source_type = 'AGENT_TRANSFER' THEN transfer_amount ELSE 0 END), 0) AS agentVolume
      FROM commission_records
    `)
    .get();
  return res.json({ records, totals });
});

apiRouter.get('/admin/withdrawals', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  let sql = `SELECT * FROM withdrawal_requests`;
  const params: any[] = [];
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    sql += ` WHERE request_status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY CASE WHEN request_status = 'PENDING' THEN 0 ELSE 1 END, created_at DESC LIMIT 300`;
  const withdrawals = db.prepare(sql).all(...params);
  return res.json({ withdrawals });
});

apiRouter.post('/admin/withdrawals/:id/review', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const wdrId = String(req.params.id);
    const action = String(req.body?.action || '').toUpperCase();
    const note = String(req.body?.note || '').trim();

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
    }
    if (action === 'REJECT' && note.length < 2) {
      return res.status(400).json({ error: 'Please provide a rejection reason.' });
    }

    const row = db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(wdrId) as any;
    if (!row) return res.status(404).json({ error: 'Withdrawal request not found.' });
    if (row.request_status !== 'PENDING') {
      return res.status(400).json({ error: `Withdrawal ${wdrId} has already been ${row.request_status}.` });
    }

    const tx = db.transaction(() => {
      if (action === 'APPROVE') {
        db.prepare(`
          UPDATE withdrawal_requests
          SET request_status = 'APPROVED',
              admin_note = COALESCE(NULLIF(?, ''), admin_note),
              reviewed_by_uid = ?,
              reviewed_at = datetime('now')
          WHERE id = ?
        `).run(note, req.user!.uid, wdrId);
      } else {
        // Refund reserved amount back to main_balance and withdrawable_winnings
        const w = db
          .prepare(`SELECT main_balance, reserved_withdrawal, withdrawable_winnings FROM wallets WHERE user_id = ?`)
          .get(row.user_id) as any;

        const prevMain = roundMoney(w.main_balance);
        const nextMain = roundMoney(prevMain + row.amount);
        const nextReserved = roundMoney(Math.max(0, w.reserved_withdrawal - row.amount));
        const nextWinnings = roundMoney(Math.min(nextMain, w.withdrawable_winnings + row.amount));

        db.prepare(`
          UPDATE wallets
          SET main_balance = ?, reserved_withdrawal = ?, withdrawable_winnings = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(nextMain, nextReserved, nextWinnings, row.user_id);

        db.prepare(`
          UPDATE withdrawal_requests
          SET request_status = 'REJECTED',
              rejection_reason = ?,
              admin_note = ?,
              reviewed_by_uid = ?,
              reviewed_at = datetime('now')
          WHERE id = ?
        `).run(note, note, req.user!.uid, wdrId);

        db.prepare(`
          INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, status, note)
          VALUES (?, ?, ?, 'WITHDRAWAL_REFUND', ?, 'RELEASE', ?, ?, ?, 'COMPLETED', ?)
        `).run(
          makeId('TXN'),
          row.user_id,
          row.user_uid,
          row.amount,
          prevMain,
          nextMain,
          wdrId,
          `Withdrawal ${wdrId} rejected & refunded: ${note}`
        );
      }
    });
    tx();

    emitToUser(row.user_id, 'wallet:updated', getWallet(row.user_id));

    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: action === 'APPROVE' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      affectedRecord: `${wdrId} · ${row.username} (${row.user_uid}) · NPR ${row.amount}`,
      reason: note || action,
    });

    createNotification({
      userId: row.user_id,
      type: action === 'APPROVE' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      title: action === 'APPROVE' ? 'Withdrawal Approved' : 'Withdrawal Rejected',
      message:
        action === 'APPROVE'
          ? `Your withdrawal request of NPR ${Number(row.amount).toLocaleString()} (${wdrId}) was approved and queued for payout.`
          : `Your withdrawal request of NPR ${Number(row.amount).toLocaleString()} (${wdrId}) was rejected and refunded to your balance. Reason: ${note}`,
      relatedId: wdrId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Withdrawal review failed.' });
  }
});

apiRouter.patch('/admin/withdrawals/:id/payment-status', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const wdrId = String(req.params.id);
    const paymentStatus = String(req.body?.paymentStatus || '').toUpperCase();
    const adminNote = String(req.body?.adminNote || '').trim();

    if (!['NOT PAID', 'PROCESSING', 'PAID', 'PAYMENT FAILED'].includes(paymentStatus)) {
      return res.status(400).json({ error: 'Invalid payment status.' });
    }

    const row = db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(wdrId) as any;
    if (!row) return res.status(404).json({ error: 'Withdrawal request not found.' });
    if (row.request_status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only APPROVED withdrawal requests can have payment status updated.' });
    }
    if (row.payment_status === 'PAID' && paymentStatus !== 'PAID') {
      return res.status(400).json({ error: 'Completed PAID withdrawals cannot be reverted.' });
    }

    const tx = db.transaction(() => {
      if (paymentStatus === 'PAID' && row.payment_status !== 'PAID') {
        const w = db.prepare(`SELECT main_balance, reserved_withdrawal, total_withdrawn FROM wallets WHERE user_id = ?`).get(row.user_id) as any;
        const nextReserved = roundMoney(Math.max(0, w.reserved_withdrawal - row.amount));
        const nextWithdrawn = roundMoney(w.total_withdrawn + row.amount);

        db.prepare(`
          UPDATE wallets
          SET reserved_withdrawal = ?, total_withdrawn = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(nextReserved, nextWithdrawn, row.user_id);

        db.prepare(`
          INSERT INTO wallet_ledger (id, user_id, user_uid, tx_type, amount, direction, prev_balance, new_balance, related_id, status, note)
          VALUES (?, ?, ?, 'WITHDRAWAL_PAID', ?, 'DEBIT', ?, ?, ?, 'COMPLETED', ?)
        `).run(
          makeId('TXN'),
          row.user_id,
          row.user_uid,
          row.amount,
          w.main_balance,
          w.main_balance,
          wdrId,
          `Withdrawal ${wdrId} paid via ${row.method}${adminNote ? ' · ' + adminNote : ''}`
        );

        db.prepare(`
          UPDATE withdrawal_requests
          SET payment_status = 'PAID', admin_note = COALESCE(NULLIF(?, ''), admin_note), paid_at = datetime('now')
          WHERE id = ?
        `).run(adminNote, wdrId);
      } else {
        db.prepare(`
          UPDATE withdrawal_requests
          SET payment_status = ?, admin_note = COALESCE(NULLIF(?, ''), admin_note)
          WHERE id = ?
        `).run(paymentStatus, adminNote, wdrId);
      }
    });
    tx();

    emitToUser(row.user_id, 'wallet:updated', getWallet(row.user_id));

    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: 'WITHDRAWAL_PAYMENT_STATUS',
      affectedRecord: `${wdrId} · ${paymentStatus}`,
      reason: adminNote || `Payment status updated to ${paymentStatus}`,
    });

    createNotification({
      userId: row.user_id,
      type: 'WITHDRAWAL_PAYMENT',
      title: `Withdrawal Payment: ${paymentStatus}`,
      message: `Withdrawal ${wdrId} (NPR ${Number(row.amount).toLocaleString()}) payment status is now ${paymentStatus}.${adminNote ? ' Note: ' + adminNote : ''}`,
      relatedId: wdrId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Could not update payment status.' });
  }
});

apiRouter.get('/admin/games', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT * FROM games ORDER BY id ASC`).all() as any[];
  const games = rows.map((g) => {
    const stats = db
      .prepare(`
        SELECT COUNT(*) AS rounds, COALESCE(SUM(stake), 0) AS totalStake, COALESCE(SUM(payout), 0) AS totalPayout
        FROM game_rounds WHERE game_id = ? AND result != 'CANCELLED'
      `)
      .get(g.id) as any;
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      thumbnail: g.thumbnail,
      enabled: Boolean(g.enabled),
      minStake: Number(g.min_stake),
      maxStake: Number(g.max_stake),
      houseEdgePct: Number(g.house_edge_pct),
      settings: JSON.parse(g.settings_json || '{}'),
      updatedAt: g.updated_at,
      stats: {
        rounds: stats.rounds || 0,
        totalStake: roundMoney(stats.totalStake || 0),
        totalPayout: roundMoney(stats.totalPayout || 0),
        netRevenue: roundMoney((stats.totalStake || 0) - (stats.totalPayout || 0)),
      },
    };
  });
  return res.json({ games });
});

apiRouter.patch('/admin/games/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const gameId = String(req.params.id);
  const existing = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId) as any;
  if (!existing) return res.status(404).json({ error: 'Game not found.' });

  const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : existing.enabled;
  const minStake = req.body?.minStake !== undefined ? Number(req.body.minStake) : existing.min_stake;
  const maxStake = req.body?.maxStake !== undefined ? Number(req.body.maxStake) : existing.max_stake;
  const houseEdgePct = req.body?.houseEdgePct !== undefined ? Number(req.body.houseEdgePct) : existing.house_edge_pct;

  if (!Number.isFinite(minStake) || minStake <= 0 || !Number.isFinite(maxStake) || maxStake < minStake) {
    return res.status(400).json({ error: 'Invalid stake limits (max must be >= min > 0).' });
  }
  if (!Number.isFinite(houseEdgePct) || houseEdgePct < 0 || houseEdgePct > 30) {
    return res.status(400).json({ error: 'Transparent house edge must be between 0% and 30%.' });
  }

  let nextSettings = JSON.parse(existing.settings_json || '{}');
  if (req.body?.settings && typeof req.body.settings === 'object') {
    nextSettings = { ...nextSettings, ...req.body.settings };
  }

  db.prepare(`
    UPDATE games
    SET enabled = ?, min_stake = ?, max_stake = ?, house_edge_pct = ?, settings_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(enabled, minStake, maxStake, houseEdgePct, JSON.stringify(nextSettings), gameId);

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'GAME_SETTINGS_UPDATED',
    affectedRecord: existing.name,
    reason: `Enabled=${Boolean(enabled)}, Min=${minStake}, Max=${maxStake}, Edge=${houseEdgePct}%`,
    details: { enabled: Boolean(enabled), minStake, maxStake, houseEdgePct, settings: nextSettings },
  });

  broadcastAll('games:updated', { gameId, enabled: Boolean(enabled) });
  return res.json({ ok: true });
});

apiRouter.get('/admin/game-transactions', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const gameId = String(req.query.gameId || '').trim();
  const result = String(req.query.result || '').trim().toUpperCase();
  const search = String(req.query.search || '').trim();

  let sql = `
    SELECT r.id, r.game_id, g.name AS game_name, r.user_id, r.user_uid, u.username,
           r.stake, r.payout, r.net_result, r.result, r.wallet_before, r.wallet_after,
           r.created_at, r.settled_at
    FROM game_rounds r
    JOIN games g ON g.id = r.game_id
    JOIN users u ON u.id = r.user_id
    WHERE 1 = 1
  `;
  const params: any[] = [];
  if (gameId) {
    sql += ` AND r.game_id = ?`;
    params.push(gameId);
  }
  if (result && ['ACTIVE', 'WIN', 'LOSS', 'CANCELLED'].includes(result)) {
    sql += ` AND r.result = ?`;
    params.push(result);
  }
  if (search) {
    sql += ` AND (r.id LIKE ? OR r.user_uid LIKE ? OR u.username LIKE ?)`;
    const pat = `%${search}%`;
    params.push(pat, pat, pat);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 300`;

  const rounds = db.prepare(sql).all(...params);
  return res.json({ rounds });
});

apiRouter.get('/admin/reports', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const range = String(req.query.range || '7d');
  const start = req.query.start ? String(req.query.start) : undefined;
  const end = req.query.end ? String(req.query.end) : undefined;
  const { startUtc, endUtc } = nstRangeToUtcBounds(range, start, end);

  const deposits = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approvedCount,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount ELSE 0 END), 0) AS approvedAmount,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedCount,
        COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN amount ELSE 0 END), 0) AS rejectedAmount,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pendingCount
      FROM deposit_requests
      WHERE created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc);

  const withdrawals = db
    .prepare(`
      SELECT
        SUM(CASE WHEN request_status = 'APPROVED' THEN 1 ELSE 0 END) AS approvedCount,
        COALESCE(SUM(CASE WHEN request_status = 'APPROVED' THEN amount ELSE 0 END), 0) AS approvedAmount,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) AS paidCount,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN amount ELSE 0 END), 0) AS paidAmount,
        SUM(CASE WHEN request_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedCount
      FROM withdrawal_requests
      WHERE created_at BETWEEN ? AND ?
    `)
    .get(startUtc, endUtc);

  const perGame = db
    .prepare(`
      SELECT g.id, g.name,
             COUNT(r.id) AS rounds,
             COALESCE(SUM(r.stake), 0) AS totalStake,
             COALESCE(SUM(r.payout), 0) AS totalPayout,
             COALESCE(SUM(r.stake - r.payout), 0) AS netRevenue
      FROM games g
      LEFT JOIN game_rounds r ON r.game_id = g.id AND r.result != 'CANCELLED' AND r.created_at BETWEEN ? AND ?
      GROUP BY g.id, g.name
    `)
    .all(startUtc, endUtc);

  const transfers = db
    .prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM agent_transfers WHERE created_at BETWEEN ? AND ?) AS agentVolume,
        (SELECT COUNT(*) FROM agent_transfers WHERE created_at BETWEEN ? AND ?) AS agentCount,
        (SELECT COALESCE(SUM(amount), 0) FROM friend_transfers WHERE created_at BETWEEN ? AND ?) AS friendVolume,
        (SELECT COUNT(*) FROM friend_transfers WHERE created_at BETWEEN ? AND ?) AS friendCount,
        (SELECT COALESCE(SUM(commission_collected), 0) FROM commission_records WHERE created_at BETWEEN ? AND ?) AS totalCommission
    `)
    .get(startUtc, endUtc, startUtc, endUtc, startUtc, endUtc, startUtc, endUtc, startUtc, endUtc);

  return res.json({
    range,
    startUtc,
    endUtc,
    deposits,
    withdrawals,
    perGame,
    transfers,
  });
});

apiRouter.get('/admin/banned-users', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const bans = db
    .prepare(`
      SELECT b.*, u.created_at AS user_created_at, w.main_balance
      FROM account_bans b
      JOIN users u ON u.id = b.user_id
      JOIN wallets w ON w.user_id = b.user_id
      ORDER BY b.created_at DESC
    `)
    .all();
  return res.json({ bans });
});

apiRouter.get('/admin/audit-logs', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const logs = db.prepare(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 300`).all();
  return res.json({ logs });
});

apiRouter.get('/admin/settings', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT key, value, updated_at FROM platform_settings ORDER BY key ASC`).all() as Array<{
    key: string;
    value: string;
    updated_at: string;
  }>;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  return res.json({ settings });
});

apiRouter.patch('/admin/settings', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const updates = req.body?.settings;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Settings object required.' });
  }
  const stmt = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  for (const [k, v] of Object.entries(updates)) {
    stmt.run(String(k), String(v));
  }
  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'PLATFORM_SETTINGS_UPDATED',
    affectedRecord: 'platform_settings',
    details: updates,
  });
  return res.json({ ok: true });
});

apiRouter.get('/admin/system/health', requireAuth, requireAdmin, (_req: AuthedRequest, res: Response) => {
  const maintenance = getMaintenanceState();
  const integrity = verifyDatabaseIntegrity();
  const backups = listDatabaseBackups();
  const errorLogs = db.prepare(`SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 50`).all();
  return res.json({
    maintenance,
    integrity,
    backups,
    errorLogs,
  });
});

apiRouter.post('/admin/system/maintenance', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const enabled = Boolean(req.body?.enabled);
  const message =
    String(req.body?.message || '').trim() ||
    'SW88 is currently undergoing scheduled maintenance. All user accounts, wallet balances, and transaction histories remain completely safe. Please check back shortly.';

  const stmt = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  stmt.run('maintenance_mode', enabled ? 'true' : 'false');
  stmt.run('maintenance_message', message);

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: enabled ? 'MAINTENANCE_MODE_ENABLED' : 'MAINTENANCE_MODE_DISABLED',
    affectedRecord: 'platform_settings.maintenance_mode',
    reason: message,
  });

  const nextState = { enabled, message };
  broadcastAll('system:maintenance', nextState);
  return res.json({ ok: true, maintenance: nextState });
});

apiRouter.post('/admin/backup', requireAuth, requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const dest = await createDatabaseBackup();
    const filename = path.basename(dest);
    logAdminAudit({
      adminId: req.user!.id,
      adminUid: req.user!.uid,
      action: 'DATABASE_BACKUP_CREATED',
      affectedRecord: filename,
      reason: 'Manual admin database backup',
    });
    return res.json({ ok: true, filename, backups: listDatabaseBackups() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Backup failed.' });
  }
});

apiRouter.post('/admin/app/apk', requireAuth, requireAdmin, apkUpload.single('apk'), (req: AuthedRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please select a valid Android .apk file to upload.' });
  }
  const uploadedPath = req.file.path;
  const origExt = path.extname(req.file.originalname || '').toLowerCase();
  if (origExt !== '.apk' || !isValidApkFile(uploadedPath)) {
    try {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    } catch {
      // ignore cleanup
    }
    return res.status(400).json({ error: 'Invalid file. Only authentic signed Android .apk packages are accepted.' });
  }

  const version = String(req.body?.version || '1.0.0').trim().slice(0, 32) || '1.0.0';
  const prevRow = db.prepare(`SELECT value FROM platform_settings WHERE key = 'app_apk_filename'`).get() as
    | { value: string }
    | undefined;
  if (prevRow?.value && prevRow.value !== path.basename(uploadedPath)) {
    const prevPath = path.join(APK_UPLOAD_DIR, path.basename(prevRow.value));
    if (fs.existsSync(prevPath)) {
      try {
        fs.unlinkSync(prevPath);
      } catch {
        // ignore
      }
    }
  }

  const upsert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  const nextFilename = path.basename(uploadedPath);
  upsert.run('app_download_mode', 'uploaded');
  upsert.run('app_apk_filename', nextFilename);
  upsert.run('app_apk_version', version);

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'APP_APK_UPLOADED',
    affectedRecord: nextFilename,
    reason: `Published SW88 APK v${version}`,
  });

  const config = getAppDownloadConfig();
  broadcastAll('app:download-updated', config);
  return res.json({ ok: true, config });
});

apiRouter.post('/admin/app/config', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const modeRaw = String(req.body?.mode || 'pwa').trim().toLowerCase();
  const mode: 'pwa' | 'uploaded' | 'external' =
    modeRaw === 'uploaded' || modeRaw === 'external' ? modeRaw : 'pwa';
  const externalUrl = String(req.body?.externalUrl || '').trim();
  const version = String(req.body?.version || '1.0.0').trim().slice(0, 32) || '1.0.0';

  if (mode === 'external' && !/^https?:\/\/.+/i.test(externalUrl)) {
    return res.status(400).json({ error: 'Please enter a valid http:// or https:// APK download link.' });
  }
  if (mode === 'uploaded') {
    const current = getAppDownloadConfig();
    if (!current.apkFilename) {
      return res.status(400).json({ error: 'Please upload an .apk file first before selecting Uploaded APK mode.' });
    }
  }

  const upsert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  upsert.run('app_download_mode', mode);
  upsert.run('app_apk_external_url', externalUrl);
  upsert.run('app_apk_version', version);

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'APP_DOWNLOAD_CONFIG_UPDATED',
    affectedRecord: 'platform_settings.app_download_mode',
    reason: `Set app distribution mode to ${mode}`,
    details: { mode, externalUrl, version },
  });

  const config = getAppDownloadConfig();
  broadcastAll('app:download-updated', config);
  return res.json({ ok: true, config });
});

apiRouter.delete('/admin/app/apk', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const prevRow = db.prepare(`SELECT value FROM platform_settings WHERE key = 'app_apk_filename'`).get() as
    | { value: string }
    | undefined;
  if (prevRow?.value) {
    const prevPath = path.join(APK_UPLOAD_DIR, path.basename(prevRow.value));
    if (fs.existsSync(prevPath)) {
      try {
        fs.unlinkSync(prevPath);
      } catch {
        // ignore
      }
    }
  }
  const upsert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  upsert.run('app_apk_filename', '');
  upsert.run('app_download_mode', 'pwa');

  logAdminAudit({
    adminId: req.user!.id,
    adminUid: req.user!.uid,
    action: 'APP_APK_REMOVED',
    affectedRecord: 'platform_settings.app_apk_filename',
    reason: 'Switched back to 1-Tap Web App Auto-Installer',
  });

  const config = getAppDownloadConfig();
  broadcastAll('app:download-updated', config);
  return res.json({ ok: true, config });
});
