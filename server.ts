import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { initDatabase, logServerError, startAutoBackupJob } from './src/server/db.ts';
import { authRouter } from './src/server/auth.ts';
import { gameRouter, skylineEngine } from './src/server/gameEngine.ts';
import { apiRouter, startScreenshotCleanupJob } from './src/server/routes.ts';
import { attachWebSocket } from './src/server/realtime.ts';
import { injectOpenGraphHtml } from './src/server/ogMeta.ts';

async function bootstrap() {
  initDatabase();
  skylineEngine.start();
  startScreenshotCleanupJob();
  startAutoBackupJob();

  const app = express();
  const server = http.createServer(app);
  attachWebSocket(server);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  const originPatterns = [process.env.CORS_ORIGINS || '', process.env.APP_URL || '']
    .flatMap((v) => v.split(','))
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const isOriginAllowed = (origin: string): boolean => {
    if (originPatterns.length === 0) return true;
    for (const pat of originPatterns) {
      if (pat === '*' || pat === origin) return true;
      if (pat.includes('*')) {
        const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+');
        if (new RegExp(`^${escaped}$`, 'i').test(origin)) return true;
      }
    }
    return false;
  };

  app.use('/api', (req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : '';
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'SW88', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/games', gameRouter);
  app.use('/api', apiRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server, path: '/vite-hmr' },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server, path: '/vite-hmr' },
      },
      appType: 'custom',
    });
    app.get('/sw.js', (_req, res) => {
      res
        .status(200)
        .set({
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        })
        .send('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",()=>self.clients.claim());');
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
          return next();
        }
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = injectOpenGraphHtml(html, req);
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === 'sw.js' || base === 'registerSW.js' || base.startsWith('workbox-')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (base === 'manifest.webmanifest') {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        const raw = fs.readFileSync(indexFile, 'utf-8');
        const html = injectOpenGraphHtml(raw, req);
        return res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).send(html);
      }
      return res.json({ ok: true, service: 'SW88 API', status: 'running' });
    });
  }

  app.use((err: any, _req: any, res: any, _next: any) => {
    logServerError('EXPRESS', err?.message || 'Unhandled server error', { stack: err?.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SW88 server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  logServerError('BOOTSTRAP', err?.message || 'Fatal server startup error');
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
