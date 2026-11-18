import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { db, getMaintenanceState } from './db.ts';
import { generateUniqueUid, hashToken, makeId, rateLimit } from './utils.ts';
import { getWallet } from './walletService.ts';

export const BANNED_ACCOUNT_TITLE = 'YOUR ACCOUNT HAS BEEN PERMANENTLY BANNED';
export const BANNED_ACCOUNT_MESSAGE =
  'Your SW88 account has been permanently banned by the app owner. You no longer have access to this account or its platform services. If you believe this action was made by mistake, please contact official SW88 support.';

export interface AuthedUser {
  id: number;
  uid: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  isAgent?: boolean;
  createdAt: string;
  responsibleDailyLimit: number | null;
  selfExcludedUntil: string | null;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
  sessionTokenHash?: string;
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, s.revoked,
           u.id, u.uid, u.username, u.display_name, u.role, u.status, u.is_agent, u.created_at,
           u.responsible_daily_limit, u.self_excluded_until
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash) as
    | {
        session_id: string;
        expires_at: string;
        revoked: number;
        id: number;
        uid: string;
        username: string;
        display_name: string;
        role: 'USER' | 'ADMIN';
        status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
        is_agent: number;
        created_at: string;
        responsible_daily_limit: number | null;
        self_excluded_until: string | null;
      }
    | undefined;

  if (!row) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  if (row.status === 'BANNED') {
    db.prepare(`UPDATE user_sessions SET revoked = 1 WHERE user_id = ?`).run(row.id);
    return res.status(403).json({
      code: 'ACCOUNT_BANNED',
      title: BANNED_ACCOUNT_TITLE,
      error: BANNED_ACCOUNT_MESSAGE,
    });
  }

  if (row.revoked || new Date(row.expires_at).getTime() <= Date.now()) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  req.user = {
    id: row.id,
    uid: row.uid,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    isAgent: Boolean(row.is_agent),
    createdAt: row.created_at,
    responsibleDailyLimit: row.responsible_daily_limit,
    selfExcludedUntil: row.self_excluded_until,
  };
  req.sessionTokenHash = tokenHash;
  next();
}

export function requireActiveUser(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.status === 'SUSPENDED') {
    return res.status(403).json({ error: 'Your account is currently suspended. Please contact support.' });
  }
  if (req.user.status === 'BANNED') {
    return res.status(403).json({
      code: 'ACCOUNT_BANNED',
      title: BANNED_ACCOUNT_TITLE,
      error: BANNED_ACCOUNT_MESSAGE,
    });
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  // Always verify role against DB record
  const fresh = db.prepare(`SELECT role, status FROM users WHERE id = ?`).get(req.user.id) as
    | { role: string; status: string }
    | undefined;
  if (!fresh || fresh.role !== 'ADMIN' || fresh.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Administrator privileges required' });
  }
  next();
}

export function checkMaintenanceMode(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'ADMIN') return next();
  const maint = getMaintenanceState();
  if (maint.enabled) {
    return res.status(503).json({
      code: 'MAINTENANCE_MODE',
      maintenance: true,
      error: maint.message,
    });
  }
  next();
}

export const authRouter = Router();

authRouter.post('/register', rateLimit(15, 60_000), (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    const ageVerified = Boolean(req.body?.ageVerified);

    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be between 3 and 32 characters.' });
    }
    if (!/^[a-zA-Z0-9_ ]+$/.test(username)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, spaces, and underscores.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (!ageVerified) {
      return res.status(400).json({ error: 'You must confirm you are 18+ and accept SW88 Terms & Responsible Gaming rules.' });
    }

    const existing = db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username);
    if (existing) {
      return res.status(409).json({ error: 'This username is already taken.' });
    }

    const hash = bcrypt.hashSync(password, 10);

    let createdUser: AuthedUser | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const uid = generateUniqueUid(username);
      try {
        const tx = db.transaction(() => {
          const info = db.prepare(`
            INSERT INTO users (uid, username, display_name, password_hash, role, status, age_verified)
            VALUES (?, ?, ?, ?, 'USER', 'ACTIVE', 1)
          `).run(uid, username, username, hash);

          const userId = Number(info.lastInsertRowid);
          db.prepare(`
            INSERT INTO wallets (user_id, main_balance, reserved_withdrawal, withdrawable_winnings)
            VALUES (?, 0, 0, 0)
          `).run(userId);

          db.prepare(`
            INSERT INTO notifications (id, user_id, type, title, message)
            VALUES (?, ?, 'SYSTEM', 'Welcome to SW88', ?)
          `).run(
            makeId('NTF'),
            userId,
            `Your SW88 account is active. Your unique User ID is ${uid}.`
          );

          const row = db.prepare(`SELECT id, uid, username, display_name, role, status, created_at, responsible_daily_limit, self_excluded_until FROM users WHERE id = ?`).get(userId) as any;
          return {
            id: row.id,
            uid: row.uid,
            username: row.username,
            displayName: row.display_name,
            role: row.role,
            status: row.status,
            createdAt: row.created_at,
            responsibleDailyLimit: row.responsible_daily_limit,
            selfExcludedUntil: row.self_excluded_until,
          } as AuthedUser;
        });

        createdUser = tx();
        break;
      } catch (err: any) {
        if (String(err?.message).includes('users.uid')) {
          continue; // Retry UID collision
        }
        throw err;
      }
    }

    if (!createdUser) {
      return res.status(500).json({ error: 'Could not allocate unique User ID. Please try again.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(makeId('SES'), createdUser.id, hashToken(rawToken), expiresAt);

    return res.status(201).json({
      token: rawToken,
      user: createdUser,
      wallet: getWallet(createdUser.id),
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err?.message || 'Registration failed' });
  }
});

authRouter.post('/login', rateLimit(20, 60_000), (req: Request, res: Response) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username or User ID and password are required.' });
    }

    const user = db.prepare(`
      SELECT id, uid, username, display_name, password_hash, role, status, is_agent, ban_reason,
             created_at, responsible_daily_limit, self_excluded_until
      FROM users
      WHERE username = ? OR uid = ?
    `).get(identifier, identifier.toUpperCase()) as any;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials. Check your username/User ID and password.' });
    }

    if (user.status === 'BANNED') {
      db.prepare(`UPDATE user_sessions SET revoked = 1 WHERE user_id = ?`).run(user.id);
      return res.status(403).json({
        code: 'ACCOUNT_BANNED',
        title: BANNED_ACCOUNT_TITLE,
        error: BANNED_ACCOUNT_MESSAGE,
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(makeId('SES'), user.id, hashToken(rawToken), expiresAt);

    if (user.role === 'ADMIN') {
      db.prepare(`
        INSERT INTO admin_audit_logs (id, admin_id, admin_uid, action, affected_record, reason)
        VALUES (?, ?, ?, 'ADMIN_LOGIN', ?, 'Admin authenticated via unified login')
      `).run(makeId('LOG'), user.id, user.uid, user.uid);
    }

    return res.json({
      token: rawToken,
      user: {
        id: user.id,
        uid: user.uid,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        isAgent: Boolean(user.is_agent),
        createdAt: user.created_at,
        responsibleDailyLimit: user.responsible_daily_limit,
        selfExcludedUntil: user.self_excluded_until,
      },
      wallet: getWallet(user.id),
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  if (req.sessionTokenHash) {
    db.prepare(`UPDATE user_sessions SET revoked = 1 WHERE token_hash = ?`).run(req.sessionTokenHash);
  }
  if (req.user?.role === 'ADMIN') {
    db.prepare(`
      INSERT INTO admin_audit_logs (id, admin_id, admin_uid, action, affected_record, reason)
      VALUES (?, ?, ?, 'ADMIN_LOGOUT', ?, 'Admin signed out')
    `).run(makeId('LOG'), req.user.id, req.user.uid, req.user.uid);
  }
  return res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  return res.json({
    user: req.user,
    wallet: getWallet(req.user!.id),
  });
});

authRouter.patch('/profile', requireAuth, requireActiveUser, (req: AuthedRequest, res: Response) => {
  const displayName = String(req.body?.displayName || '').trim();
  if (displayName.length < 2 || displayName.length > 40) {
    return res.status(400).json({ error: 'Display name must be between 2 and 40 characters.' });
  }
  // Never allow changing UID or role
  db.prepare(`UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?`).run(
    displayName,
    req.user!.id
  );
  return res.json({
    user: { ...req.user!, displayName },
  });
});

authRouter.post('/password', requireAuth, requireActiveUser, (req: AuthedRequest, res: Response) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New passwords do not match.' });
  }

  const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user!.id) as { password_hash: string };
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const nextHash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
    nextHash,
    req.user!.id
  );
  return res.json({ ok: true, message: 'Password updated successfully.' });
});

authRouter.patch('/responsible-gaming', requireAuth, requireActiveUser, (req: AuthedRequest, res: Response) => {
  const rawLimit = req.body?.dailyLimit;
  const dailyLimit = rawLimit === null || rawLimit === '' ? null : Number(rawLimit);
  const selfExcludeDays = req.body?.selfExcludeDays ? Number(req.body.selfExcludeDays) : 0;

  if (dailyLimit !== null && (!Number.isFinite(dailyLimit) || dailyLimit < 100)) {
    return res.status(400).json({ error: 'Daily spending limit must be at least NPR 100 or cleared.' });
  }

  let selfExcludedUntil = req.user!.selfExcludedUntil;
  if (selfExcludeDays > 0 && selfExcludeDays <= 365) {
    selfExcludedUntil = new Date(Date.now() + selfExcludeDays * 86400 * 1000).toISOString();
  }

  db.prepare(`
    UPDATE users
    SET responsible_daily_limit = ?, self_excluded_until = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(dailyLimit, selfExcludedUntil, req.user!.id);

  return res.json({
    ok: true,
    responsibleDailyLimit: dailyLimit,
    selfExcludedUntil,
  });
});

// Admin-only credential & security management
authRouter.post('/admin/credentials', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const rawNewUsername = req.body?.newUsername !== undefined ? String(req.body.newUsername).trim() : '';
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required to authorize security changes.' });
    }

    const adminRow = db.prepare(`SELECT id, uid, username, display_name, password_hash, role, status, is_agent, created_at, responsible_daily_limit, self_excluded_until FROM users WHERE id = ? AND role = 'ADMIN'`).get(req.user!.id) as any;
    if (!adminRow) {
      return res.status(403).json({ error: 'Administrator privileges required.' });
    }
    if (!bcrypt.compareSync(currentPassword, adminRow.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const nextUsername = rawNewUsername || adminRow.username;
    const changingUsername = nextUsername.toLowerCase() !== String(adminRow.username).toLowerCase();
    const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;

    if (!changingUsername && !changingPassword) {
      return res.status(400).json({ error: 'Provide a new Admin Login ID or a new Password to update.' });
    }

    if (changingUsername) {
      if (nextUsername.length < 3 || nextUsername.length > 32) {
        return res.status(400).json({ error: 'Admin Login ID must be between 3 and 32 characters.' });
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(nextUsername)) {
        return res.status(400).json({ error: 'Admin Login ID may only contain letters, numbers, underscores, hyphens, and dots.' });
      }
      const conflict = db.prepare(`SELECT id FROM users WHERE username = ? AND id != ?`).get(nextUsername, adminRow.id);
      if (conflict) {
        return res.status(409).json({ error: 'That login ID is already in use by another account.' });
      }
    }

    let nextHash = adminRow.password_hash;
    if (changingPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New admin password must be at least 6 characters.' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'New password and confirm password do not match.' });
      }
      nextHash = bcrypt.hashSync(newPassword, 12);
    }

    const tx = db.transaction(() => {
      db.prepare(`UPDATE users SET username = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
        nextUsername,
        nextHash,
        adminRow.id
      );

      db.prepare(`
        INSERT INTO admin_audit_logs (id, admin_id, admin_uid, action, affected_record, reason)
        VALUES (?, ?, ?, 'ADMIN_CREDENTIALS_UPDATED', ?, ?)
      `).run(
        makeId('LOG'),
        adminRow.id,
        adminRow.uid,
        `${nextUsername} (${adminRow.uid})`,
        [changingUsername ? 'Login ID updated' : null, changingPassword ? 'Password updated' : null]
          .filter(Boolean)
          .join(' & ')
      );
    });
    tx();

    const updatedUser: AuthedUser = {
      id: adminRow.id,
      uid: adminRow.uid,
      username: nextUsername,
      displayName: adminRow.display_name,
      role: 'ADMIN',
      status: adminRow.status,
      isAgent: Boolean(adminRow.is_agent),
      createdAt: adminRow.created_at,
      responsibleDailyLimit: adminRow.responsible_daily_limit,
      selfExcludedUntil: adminRow.self_excluded_until,
    };

    return res.json({
      ok: true,
      user: updatedUser,
      message: 'Admin credentials updated successfully. Future login sessions will use your updated credentials.',
    });
  } catch (err: any) {
    console.error('Admin credentials update error:', err);
    return res.status(500).json({ error: err?.message || 'Could not update admin credentials.' });
  }
});
