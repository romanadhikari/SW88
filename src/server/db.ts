import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const QR_UPLOAD_DIR = path.join(UPLOAD_DIR, 'qr');
export const SCREENSHOT_UPLOAD_DIR = path.join(UPLOAD_DIR, 'screenshots');
export const APK_UPLOAD_DIR = path.join(UPLOAD_DIR, 'apk');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

for (const dir of [DATA_DIR, UPLOAD_DIR, QR_UPLOAD_DIR, SCREENSHOT_UPLOAD_DIR, APK_UPLOAD_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DB_PATH = path.join(DATA_DIR, 'sw88.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('USER', 'ADMIN')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
      ban_reason TEXT,
      age_verified INTEGER NOT NULL DEFAULT 1,
      responsible_daily_limit REAL,
      self_excluded_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      main_balance REAL NOT NULL DEFAULT 0 CHECK(main_balance >= 0),
      reserved_withdrawal REAL NOT NULL DEFAULT 0 CHECK(reserved_withdrawal >= 0),
      withdrawable_winnings REAL NOT NULL DEFAULT 0 CHECK(withdrawable_winnings >= 0),
      total_deposited REAL NOT NULL DEFAULT 0,
      total_withdrawn REAL NOT NULL DEFAULT 0,
      total_staked REAL NOT NULL DEFAULT 0,
      total_won REAL NOT NULL DEFAULT 0,
      total_lost REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      amount REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('CREDIT', 'DEBIT', 'RESERVE', 'RELEASE')),
      prev_balance REAL NOT NULL,
      new_balance REAL NOT NULL,
      related_id TEXT,
      related_uid TEXT,
      related_username TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      idempotency_key TEXT UNIQUE,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      thumbnail TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_stake REAL NOT NULL,
      max_stake REAL NOT NULL,
      house_edge_pct REAL NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_rounds (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      stake REAL NOT NULL,
      payout REAL NOT NULL DEFAULT 0,
      net_result REAL NOT NULL DEFAULT 0,
      result TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(result IN ('ACTIVE', 'WIN', 'LOSS', 'CANCELLED')),
      wallet_before REAL NOT NULL,
      wallet_after REAL NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS game_transactions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES game_rounds(id),
      game_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      action TEXT NOT NULL,
      amount REAL NOT NULL,
      wallet_before REAL NOT NULL,
      wallet_after REAL NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deposit_qr_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      qr_filename TEXT,
      instructions TEXT NOT NULL DEFAULT 'Scan the QR code via eSewa, Khalti, or Mobile Banking and upload your payment screenshot below.',
      is_active INTEGER NOT NULL DEFAULT 0,
      updated_by_uid TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deposit_requests (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      username TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 100),
      screenshot_filename TEXT,
      screenshot_deleted INTEGER NOT NULL DEFAULT 0,
      screenshot_delete_after TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      admin_message TEXT,
      reviewed_by_uid TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_transfers (
      id TEXT PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      sender_uid TEXT NOT NULL,
      sender_username TEXT NOT NULL,
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      receiver_uid TEXT NOT NULL,
      receiver_username TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 200),
      commission REAL NOT NULL DEFAULT 0,
      sender_remaining_balance REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friend_transfers (
      id TEXT PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      sender_uid TEXT NOT NULL,
      sender_username TEXT NOT NULL,
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      receiver_uid TEXT NOT NULL,
      receiver_username TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 100),
      commission_rate REAL NOT NULL DEFAULT 0.10,
      commission_amount REAL NOT NULL,
      total_deduction REAL NOT NULL,
      sender_remaining_balance REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commission_records (
      id TEXT PRIMARY KEY,
      source_tx_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      transfer_amount REAL NOT NULL,
      commission_rate REAL NOT NULL,
      commission_collected REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      username TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 1000 AND amount <= 10000),
      method TEXT NOT NULL CHECK(method IN ('ESEWA', 'BANK')),
      account_holder_name TEXT NOT NULL,
      esewa_mobile TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_branch TEXT,
      request_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(request_status IN ('PENDING', 'APPROVED', 'REJECTED')),
      payment_status TEXT NOT NULL DEFAULT 'NOT PAID' CHECK(payment_status IN ('NOT PAID', 'PROCESSING', 'PAID', 'PAYMENT FAILED')),
      admin_note TEXT,
      rejection_reason TEXT,
      reviewed_by_uid TEXT,
      reviewed_at TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      related_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      admin_uid TEXT NOT NULL,
      action TEXT NOT NULL,
      affected_record TEXT NOT NULL,
      reason TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_bans (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_uid TEXT NOT NULL,
      username TEXT NOT NULL,
      reason TEXT NOT NULL,
      banned_by_uid TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS error_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      user_uid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_user ON wallet_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_type ON wallet_ledger(tx_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rounds_user ON game_rounds(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rounds_game ON game_rounds(game_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposit_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(request_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
  `);

  runMigrations();

  // Ensure QR settings singleton exists
  db.prepare(`
    INSERT OR IGNORE INTO deposit_qr_settings (id, is_active) VALUES (1, 0)
  `).run();

  // Seed default platform settings (never overwrites existing settings)
  const defaultSettings: Array<[string, string]> = [
    ['platform_name', 'SW88'],
    ['min_deposit', '100'],
    ['min_withdrawal', '1000'],
    ['max_withdrawal', '10000'],
    ['agent_min_balance', '1500'],
    ['agent_min_transfer', '200'],
    ['friend_min_transfer', '100'],
    ['friend_commission_pct', '10'],
    ['real_money_enabled', 'true'],
    ['maintenance_mode', 'false'],
    [
      'maintenance_message',
      'SW88 is currently undergoing scheduled maintenance. All user accounts, wallet balances, and transaction histories remain completely safe. Please check back shortly.',
    ],
    ['legal_notice', 'SW88 operates strictly for verified 18+ eligible participants in accordance with local compliance and responsible gaming rules.'],
    ['app_download_mode', 'pwa'],
    ['app_apk_filename', ''],
    ['app_apk_external_url', ''],
    ['app_apk_version', '1.0.0'],
  ];
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of defaultSettings) {
    insertSetting.run(k, v);
  }

  // Seed the 3 supplied games idempotently (never overwrites user-modified admin config)
  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (id, name, description, thumbnail, enabled, min_stake, max_stake, house_edge_pct, settings_json)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  `);

  insertGame.run(
    '3-patti-royale',
    '3 Patti Royale',
    'Classic 3-card Teen Patti table with Blind, Seen, Chaal, Double, and Show gameplay.',
    '/src/assets/images/sw88_thumb_3patti_1794976007848.jpg',
    5,
    2000,
    0,
    JSON.stringify({ boot: 5, blindMax: 2000, turnSeconds: 10 })
  );

  insertGame.run(
    'bubble-rocket-x',
    'Bubble Rocket X',
    'Precision 5-shot arcade bubble blaster with doubling blast multipliers up to 8x.',
    '/src/assets/images/sw88_thumb_bubble_1794976008608.jpg',
    50,
    5000,
    0,
    JSON.stringify({ step: 50, shotsPerRound: 5, specialBubbles: true })
  );

  insertGame.run(
    'skyline-crash',
    'Skyline Crash',
    'Real-time flight multiplier game. Place your bet, watch the plane climb, and cash out before flyaway.',
    '/src/assets/images/sw88_thumb_skyline_1794976008575.jpg',
    50,
    10000,
    8,
    JSON.stringify({ maxMultiplier: 16.8, countdownSeconds: 5, speed: 0.11 })
  );

  // Provision initial ADMIN account on backend ONLY if no ADMIN exists yet
  const existingAdmin = db.prepare(`SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`).get();
  if (!existingAdmin) {
    const adminUsername = (process.env.SW88_ADMIN_USERNAME || 'sw88admin').trim();
    const adminPassword = process.env.SW88_ADMIN_PASSWORD || 'ChangeMe_SW88Admin!';
    const hash = bcrypt.hashSync(adminPassword, 12);
    const adminUid = 'SW88AD';

    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (uid, username, display_name, password_hash, role, status, age_verified)
        VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', 1)
      `).run(adminUid, adminUsername, 'SW88 Administrator', hash);

      db.prepare(`
        INSERT INTO wallets (user_id, main_balance, reserved_withdrawal, withdrawable_winnings)
        VALUES (?, 0, 0, 0)
      `).run(info.lastInsertRowid);
    });
    tx();
  }
}

function runMigrations() {
  const appliedRows = db.prepare(`SELECT version FROM schema_migrations`).all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  const migrations: Array<{ version: number; name: string; up: () => void }> = [
    {
      version: 1,
      name: 'initial_schema',
      up: () => {
        // Base schema already ensured via CREATE TABLE IF NOT EXISTS
      },
    },
    {
      version: 2,
      name: 'add_users_is_agent_and_transfer_indexes',
      up: () => {
        const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === 'is_agent')) {
          db.exec(`ALTER TABLE users ADD COLUMN is_agent INTEGER NOT NULL DEFAULT 0;`);
        }
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_agent_transfers_sender ON agent_transfers(sender_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_agent_transfers_receiver ON agent_transfers(receiver_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_friend_transfers_sender ON friend_transfers(sender_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_friend_transfers_receiver ON friend_transfers(receiver_id, created_at DESC);
        `);
      },
    },
  ];

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return;

  // Create automatic synchronous pre-migration snapshot if upgrading an existing database
  const hasExistingUsers = (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt > 0;
  if (hasExistingUsers && fs.existsSync(DB_PATH)) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapPath = path.join(BACKUP_DIR, `sw88-pre-migration-${stamp}.db`);
      fs.copyFileSync(DB_PATH, snapPath);
    } catch (err) {
      console.error('Pre-migration snapshot warning:', err);
    }
  }

  for (const mig of pending) {
    const tx = db.transaction(() => {
      mig.up();
      db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`).run(mig.version, mig.name);
    });
    tx();
  }
}

export function getMaintenanceState(): { enabled: boolean; message: string } {
  try {
    const modeRow = db.prepare(`SELECT value FROM platform_settings WHERE key = 'maintenance_mode'`).get() as
      | { value: string }
      | undefined;
    const msgRow = db.prepare(`SELECT value FROM platform_settings WHERE key = 'maintenance_message'`).get() as
      | { value: string }
      | undefined;
    return {
      enabled: modeRow?.value === 'true',
      message:
        msgRow?.value ||
        'SW88 is currently undergoing scheduled maintenance. All accounts and balances are safe.',
    };
  } catch {
    return { enabled: false, message: '' };
  }
}

export interface AppDownloadConfig {
  mode: 'pwa' | 'uploaded' | 'external';
  hasApk: boolean;
  apkDownloadUrl: string | null;
  apkFilename: string | null;
  apkSizeBytes: number;
  externalUrl: string;
  version: string;
  updatedAt: string | null;
}

export function getAppDownloadConfig(): AppDownloadConfig {
  try {
    const rows = db
      .prepare(
        `SELECT key, value, updated_at FROM platform_settings WHERE key IN ('app_download_mode', 'app_apk_filename', 'app_apk_external_url', 'app_apk_version')`
      )
      .all() as Array<{ key: string; value: string; updated_at: string }>;
    const map: Record<string, { value: string; updatedAt: string }> = {};
    for (const r of rows) {
      map[r.key] = { value: r.value, updatedAt: r.updated_at };
    }
    const rawMode = map.app_download_mode?.value || 'pwa';
    const mode: 'pwa' | 'uploaded' | 'external' =
      rawMode === 'uploaded' || rawMode === 'external' ? rawMode : 'pwa';
    const filename = map.app_apk_filename?.value ? path.basename(map.app_apk_filename.value) : '';
    const externalUrl = (map.app_apk_external_url?.value || '').trim();
    const version = (map.app_apk_version?.value || '1.0.0').trim() || '1.0.0';

    let apkExists = false;
    let apkSizeBytes = 0;
    if (filename) {
      const fullPath = path.join(APK_UPLOAD_DIR, filename);
      if (fs.existsSync(fullPath)) {
        const st = fs.statSync(fullPath);
        if (st.isFile() && st.size > 0) {
          apkExists = true;
          apkSizeBytes = st.size;
        }
      }
    }

    if (mode === 'uploaded' && apkExists) {
      return {
        mode: 'uploaded',
        hasApk: true,
        apkDownloadUrl: `/api/app/apk?v=${encodeURIComponent(map.app_apk_filename?.updatedAt || version)}`,
        apkFilename: filename,
        apkSizeBytes,
        externalUrl,
        version,
        updatedAt: map.app_apk_filename?.updatedAt || null,
      };
    }

    if (mode === 'external' && /^https?:\/\/.+/i.test(externalUrl)) {
      return {
        mode: 'external',
        hasApk: true,
        apkDownloadUrl: externalUrl,
        apkFilename: null,
        apkSizeBytes: 0,
        externalUrl,
        version,
        updatedAt: map.app_apk_external_url?.updatedAt || null,
      };
    }

    return {
      mode: 'pwa',
      hasApk: false,
      apkDownloadUrl: null,
      apkFilename: apkExists ? filename : null,
      apkSizeBytes,
      externalUrl,
      version,
      updatedAt: map.app_download_mode?.updatedAt || null,
    };
  } catch {
    return {
      mode: 'pwa',
      hasApk: false,
      apkDownloadUrl: null,
      apkFilename: null,
      apkSizeBytes: 0,
      externalUrl: '',
      version: '1.0.0',
      updatedAt: null,
    };
  }
}

export function logServerError(source: string, message: string, details?: unknown, userUid?: string) {
  try {
    const id = `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    db.prepare(`
      INSERT INTO error_logs (id, source, message, details, user_uid)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, source, message, details ? JSON.stringify(details).slice(0, 2000) : null, userUid || null);
  } catch (err) {
    console.error('Failed to persist error log:', err);
  }
}

export function listDatabaseBackups(): Array<{ filename: string; sizeBytes: number; createdAt: string }> {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((filename) => {
        const st = fs.statSync(path.join(BACKUP_DIR, filename));
        return {
          filename,
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function verifyDatabaseIntegrity() {
  const integrityRow = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const sqliteIntegrity = integrityRow?.[0]?.integrity_check || 'unknown';
  const fkErrors = db.pragma('foreign_key_check') as unknown[];
  const negWallets = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM wallets WHERE main_balance < 0 OR reserved_withdrawal < 0 OR withdrawable_winnings < 0`).get() as {
      cnt: number;
    }
  ).cnt;
  const ledgerRows = (db.prepare(`SELECT COUNT(*) AS cnt FROM wallet_ledger`).get() as { cnt: number }).cnt;
  const migRow = db.prepare(`SELECT COALESCE(MAX(version), 0) AS ver FROM schema_migrations`).get() as { ver: number };

  const details: string[] = [];
  if (sqliteIntegrity !== 'ok') details.push(`SQLite integrity check returned: ${sqliteIntegrity}`);
  if (fkErrors.length > 0) details.push(`Foreign key violations found: ${fkErrors.length}`);
  if (negWallets > 0) details.push(`Negative wallet balances detected: ${negWallets}`);

  return {
    ok: sqliteIntegrity === 'ok' && fkErrors.length === 0 && negWallets === 0,
    sqliteIntegrity,
    foreignKeyErrors: fkErrors.length,
    negativeWallets: negWallets,
    ledgerCheckCount: ledgerRows,
    migrationVersion: migRow.ver,
    details,
  };
}

export async function createDatabaseBackup(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `sw88-backup-${stamp}.db`);
  await db.backup(dest);
  // Keep latest 25 automatic/manual backups
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('sw88-backup-') && f.endsWith('.db'))
      .map((filename) => ({ filename, mtime: fs.statSync(path.join(BACKUP_DIR, filename)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(25)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.filename));
    }
  } catch {
    // ignore cleanup error
  }
  return dest;
}

export function startAutoBackupJob() {
  // Take a startup backup if none exists in the last 6 hours
  const backups = listDatabaseBackups();
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
  const recentExists = backups.some((b) => new Date(b.createdAt).getTime() > sixHoursAgo);
  if (!recentExists) {
    createDatabaseBackup().catch((err) => logServerError('AUTO_BACKUP', err?.message || 'Startup backup failed'));
  }
  setInterval(() => {
    createDatabaseBackup().catch((err) => logServerError('AUTO_BACKUP', err?.message || 'Scheduled backup failed'));
  }, 6 * 3600 * 1000);
}

