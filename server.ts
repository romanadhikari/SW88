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

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'SW88', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/games', gameRouter);
  app.use('/api', apiRouter);

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
      appType: 'spa',
    });
    app.use(vite.middlewares);
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
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        return res.sendFile(indexFile);
      }
      return res.status(404).send('Build output not found.');
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
