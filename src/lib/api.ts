import { useEffect, useState } from 'react';
import type { BannedPayload } from '../types';

const TOKEN_KEY = 'sw88_auth_token';

export const API_BASE = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '');
const EXPLICIT_WS_BASE = ((import.meta as any).env?.VITE_WS_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path) return API_BASE || '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

export function wsUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (EXPLICIT_WS_BASE) {
    return `${EXPLICIT_WS_BASE}${normalized}`;
  }
  if (API_BASE) {
    const wsBase = API_BASE.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    return `${wsBase}${normalized}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${normalized}`;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage quota errors
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  title?: string;
  constructor(message: string, status: number, code?: string, title?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.title = title;
  }
}

let bannedListener: ((payload: BannedPayload) => void) | null = null;
export function onBannedEvent(cb: ((payload: BannedPayload) => void) | null) {
  bannedListener = cb;
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { isFormData?: boolean } = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!options.isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  const text = await res.text();
  const isHtmlResponse = /^\s*(?:<!doctype|<html|<head|<body)/i.test(text);
  let data: any = {};
  try {
    data = text && !isHtmlResponse ? JSON.parse(text) : {};
  } catch {
    data = { error: isHtmlResponse ? '' : text || 'Unexpected server response' };
  }

  if (!res.ok) {
    if (data?.code === 'ACCOUNT_BANNED' && bannedListener) {
      bannedListener({
        title: data.title || 'YOUR ACCOUNT HAS BEEN PERMANENTLY BANNED',
        message:
          data.error ||
          'Your SW88 account has been permanently banned by the app owner. You no longer have access to this account or its platform services. If you believe this action was made by mistake, please contact official SW88 support.',
      });
    }
    const fallbackMsg = isHtmlResponse
      ? res.status === 404
        ? 'Service route not found. Please open the official SW88 app URL and refresh.'
        : `Server connection error (${res.status}). Please refresh and try again.`
      : `Request failed (${res.status})`;
    throw new ApiError(data?.error || fallbackMsg, res.status, data?.code, data?.title);
  }

  if (isHtmlResponse) {
    throw new ApiError(
      'Received an invalid page response instead of server data. Please open the official SW88 app URL.',
      res.status || 502
    );
  }

  return data as T;
}

export function formatNpr(amount: number | undefined | null): string {
  const val = Number(amount || 0);
  return `NPR ${val.toLocaleString('en-US', {
    minimumFractionDigits: val % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRs(amount: number | undefined | null): string {
  const val = Math.round(Number(amount || 0));
  return `Rs ${val.toLocaleString('en-IN')}`;
}

export function parseUtcDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  // SQLite datetime('now') produces 'YYYY-MM-DD HH:MM:SS' in UTC
  const normalized = str.includes('T') ? str : str.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatNstDateTime(str: string | null | undefined): string {
  const d = parseUtcDate(str);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatNstDateShort(str: string | null | undefined): string {
  const d = parseUtcDate(str);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function useNstClock() {
  const [clock, setClock] = useState(() => getNstNowFormatted());

  useEffect(() => {
    const id = setInterval(() => setClock(getNstNowFormatted()), 1000);
    return () => clearInterval(id);
  }, []);

  return clock;
}

function getNstNowFormatted(): { time: string; date: string } {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const date = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kathmandu',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
  return { time, date };
}

export function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text)
    );
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
