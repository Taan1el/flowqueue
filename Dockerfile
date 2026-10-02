# Stage 1: build the server and the client
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/
RUN npm run build

# Stage 2: production runtime
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/app/data/flowqueue.db

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --workspace=server --include-workspace-root

# tsc's rootDir spans server/src and ../shared, so server/dist already holds
# the compiled shared modules and the entry point is server/dist/server/src/index.js.
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# The SQLite file lives in /app/data; mount a volume there to keep jobs across restarts.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/server/src/index.js"]
