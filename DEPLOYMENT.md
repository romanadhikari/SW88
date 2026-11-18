# SW88 — GitHub, Vercel & Production Deployment Guide

## 1. Architecture Summary & Why Vercel Alone Is Not Enough

SW88 runs **zero Google AI Studio dependencies** and **zero mock/localStorage financial logic**. However, deploying the entire project strictly on Vercel Serverless Functions without a persistent backend host fails for four technical reasons:

1. **Database & File Storage (`better-sqlite3` + `./data/uploads`)**: Vercel Serverless Functions use a read-only/ephemeral filesystem. User accounts, wallets, deposits, screenshots, QR images, and APKs cannot persist inside Vercel Serverless.
2. **WebSockets (`/ws`)**: Real-time wallet sync, instant notifications, admin ticks, and live Skyline Crash multiplier broadcasts require a persistent WebSocket server (`ws`), which Vercel Serverless does not host.
3. **Continuous Background Engine (`skylineEngine`)**: The server runs a 120ms crash multiplier loop, screenshot cleanup sweeps, and automatic SQLite backups in-process.
4. **Large Upload Limit**: Vercel Serverless enforces a 4.5 MB request body limit, which rejects larger `.apk` uploads (supported up to 100 MB).

### Recommended Production Setup
- **Frontend (React + Vite + PWA + `/download`)** → **Vercel** (auto-deployed from GitHub via `vercel.json`)
- **Backend + Database + WebSockets (`Express + ws + SQLite`)** → **Render** (via `render.yaml`) or **Railway / Fly.io / VPS** (via `Dockerfile`) with a persistent disk mounted at `/var/data` (or `/data`).

*(Alternative: You can also deploy the single combined full-stack container on Render/Railway/Fly.io without Vercel if you want one single URL.)*

---

## 2. External Services Required

1. **GitHub** — Source repository hosting.
2. **Vercel** — Static CDN & SPA frontend hosting (imports directly from GitHub).
3. **Render or Railway (or any Docker/Node host with a persistent volume)** — Hosts the always-on Node.js backend (`server.js`), SQLite database (`sw88.db`), WebSockets (`/ws`), and uploaded QR/screenshot/APK assets.

No Google AI Studio account, Firebase project, or Gemini API key is required for SW88 to run.

---

## 3. Step-by-Step Deployment

### Step 1: Push Project to GitHub
`.gitignore` is pre-configured to exclude `data/`, `dist/`, `dev-dist/`, `server.js`, and `.env` secrets so local databases are never pushed to GitHub.

```bash
git init
git add .
git commit -m "Configure SW88 for GitHub + Vercel + persistent backend"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

### Step 2: Deploy Backend (Render Example via `render.yaml`)
1. Open Render → **New + → Blueprint** and connect your GitHub repository.
2. Render reads `render.yaml`, mounts a persistent disk at `/var/data`, builds `server.js`, and starts `node server.js`.
3. Set these Environment Variables on Render:
   - `SW88_DATA_DIR=/var/data`
   - `SW88_ADMIN_USERNAME=sw88admin` (or your preferred initial admin ID)
   - `SW88_ADMIN_PASSWORD=<strong-password>`
   - `SW88_SESSION_SECRET=<random-32+-char-string>`
   - `CORS_ORIGINS=https://<your-vercel-domain>.vercel.app`
   - `APP_URL=https://<your-vercel-domain>.vercel.app`
4. Verify backend health once deployed: `https://<your-backend>.onrender.com/api/health` → `{ "ok": true }`.

*(For Railway or Fly.io, deploy using the included `Dockerfile` and attach a persistent volume mounted at `/data` with `SW88_DATA_DIR=/data`.)*

### Step 3: Deploy Frontend on Vercel
1. Open Vercel → **Add New → Project** and import your GitHub repository.
2. Vercel auto-detects `vercel.json` (`buildCommand: npm run build:client`, `outputDirectory: dist`).
3. Add Environment Variable in Vercel Project Settings:
   - `VITE_API_URL=https://<your-backend>.onrender.com` *(exact backend URL, no trailing slash)*
4. Click **Deploy**.
5. Once live, copy your `https://<your-app>.vercel.app` URL into `CORS_ORIGINS` and `APP_URL` on your backend host (if not already set) and redeploy/restart the backend.

---

## 4. Database Initialization & Migration

- **Automatic on Boot**: Starting `node server.js` runs `initDatabase()`, executes pending `schema_migrations`, creates tables/indexes, seeds the 3 games, and creates the initial `ADMIN` account (from `SW88_ADMIN_USERNAME` / `SW88_ADMIN_PASSWORD`) only if no admin exists yet.
- **Manual Migration / Integrity Verification Command**:
  ```bash
  npm run db:migrate
  ```
- **Migrating Existing Local Data (`./data/sw88.db`) to Production**:
  1. Create a clean backup from Admin Console → **Settings → Create SQLite Backup Now** (or copy `./data/sw88.db` + `./data/uploads/`).
  2. Upload `sw88.db` and `uploads/` into the mounted persistent volume (`/var/data` on Render or `/data` on Docker/Railway), then run `npm run db:migrate` to confirm integrity (`"ok": true`).
