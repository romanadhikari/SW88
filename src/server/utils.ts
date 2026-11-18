import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

export function makeId(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

export function generateUniqueUid(username: string): string {
  const clean = username.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = (clean.slice(0, 4) || 'SW').padEnd(4, 'X');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  for (let attempt = 0; attempt < 40; attempt++) {
    let candidate = '';
    if (attempt < 15) {
      const n1 = crypto.randomInt(0, 10);
      const n2 = crypto.randomInt(0, 10);
      candidate = `${prefix}${n1}${n2}`;
    } else {
      for (let i = 0; i < 6; i++) {
        candidate += chars[crypto.randomInt(0, chars.length)];
      }
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE uid = ?').get(candidate);
    if (!exists) return candidate;
  }

  // Guaranteed fallback
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Nepal Standard Time is UTC+05:45 (+345 minutes)
const NST_OFFSET_MS = 345 * 60 * 1000;

export function getNstDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + NST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10); // YYYY-MM-DD in NST
}

export function nstRangeToUtcBounds(
  range: string,
  customStart?: string,
  customEnd?: string
): { startUtc: string; endUtc: string } {
  const now = new Date();
  const todayNst = getNstDateString(now);

  const nstMidnightToUtcSql = (yyyyMmDd: string, endOfDay = false): string => {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - NST_OFFSET_MS + (endOfDay ? 86400 * 1000 - 1 : 0);
    return new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19);
  };

  if (range === 'today') {
    return {
      startUtc: nstMidnightToUtcSql(todayNst, false),
      endUtc: nstMidnightToUtcSql(todayNst, true),
    };
  }
  if (range === 'yesterday') {
    const yest = getNstDateString(new Date(now.getTime() - 86400 * 1000));
    return {
      startUtc: nstMidnightToUtcSql(yest, false),
      endUtc: nstMidnightToUtcSql(yest, true),
    };
  }
  if (range === '7d') {
    const start = getNstDateString(new Date(now.getTime() - 6 * 86400 * 1000));
    return {
      startUtc: nstMidnightToUtcSql(start, false),
      endUtc: nstMidnightToUtcSql(todayNst, true),
    };
  }
  if (range === 'month') {
    const start = `${todayNst.slice(0, 7)}-01`;
    return {
      startUtc: nstMidnightToUtcSql(start, false),
      endUtc: nstMidnightToUtcSql(todayNst, true),
    };
  }
  if (range === 'custom' && customStart && customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customStart) && /^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
    return {
      startUtc: nstMidnightToUtcSql(customStart, false),
      endUtc: nstMidnightToUtcSql(customEnd, true),
    };
  }

  return {
    startUtc: '1970-01-01 00:00:00',
    endUtc: '2999-12-31 23:59:59',
  };
}

export function validateImageBuffer(buf: Buffer): { valid: boolean; ext: string; mime: string } {
  if (!buf || buf.length < 12) return { valid: false, ext: '', mime: '' };
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { valid: true, ext: '.jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { valid: true, ext: '.png', mime: 'image/png' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { valid: true, ext: '.webp', mime: 'image/webp' };
  }
  return { valid: false, ext: '', mime: '' };
}

// Simple sliding-window rate limiter per IP + route bucket
const rateStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const record = rateStore.get(key);
    if (!record || record.resetAt < now) {
      rateStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    record.count += 1;
    return next();
  };
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
