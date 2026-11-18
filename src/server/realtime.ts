import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './db.ts';
import { hashToken } from './utils.ts';

interface AuthedSocket extends WebSocket {
  userId?: number;
  role?: string;
  isAlive?: boolean;
}

const userSockets = new Map<number, Set<AuthedSocket>>();
const adminSockets = new Set<AuthedSocket>();
const allSockets = new Set<AuthedSocket>();

let wss: WebSocketServer | null = null;

export function attachWebSocket(server: HttpServer) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/ws') {
        wss!.handleUpgrade(req, socket, head, (ws) => {
          wss!.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: AuthedSocket, req) => {
    ws.isAlive = true;
    allSockets.add(ws);

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        const session = db.prepare(`
          SELECT s.user_id, u.role, u.status, s.expires_at, s.revoked
          FROM user_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
        `).get(hashToken(token)) as
          | { user_id: number; role: string; status: string; expires_at: string; revoked: number }
          | undefined;

        if (
          session &&
          !session.revoked &&
          session.status !== 'BANNED' &&
          new Date(session.expires_at).getTime() > Date.now()
        ) {
          ws.userId = session.user_id;
          ws.role = session.role;
          if (!userSockets.has(session.user_id)) {
            userSockets.set(session.user_id, new Set());
          }
          userSockets.get(session.user_id)!.add(ws);
          if (session.role === 'ADMIN') {
            adminSockets.add(ws);
          }
        }
      }
    } catch {
      // Ignore malformed token
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      allSockets.delete(ws);
      adminSockets.delete(ws);
      if (ws.userId && userSockets.has(ws.userId)) {
        userSockets.get(ws.userId)!.delete(ws);
        if (userSockets.get(ws.userId)!.size === 0) {
          userSockets.delete(ws.userId);
        }
      }
    });
  });

  const pingInterval = setInterval(() => {
    for (const ws of allSockets) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(pingInterval));
}

export function emitToUser(userId: number, type: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify({ type, payload });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function emitToAdmins(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of adminSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function broadcastAll(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of allSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}
