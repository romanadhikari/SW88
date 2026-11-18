FROM node:20-bookworm-slim

WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* package-lock.json* ./
RUN npm install --omit=dev

# Install devDependencies needed to compile frontend + server bundle, then prune
COPY . .
RUN npm install && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
ENV SW88_DATA_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
