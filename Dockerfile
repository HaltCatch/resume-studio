FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 RESUME_DATA_DIR=/data/resumes STATIC_DIR=/app/dist CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium font-noto-cjk tini && corepack enable && mkdir -p /data/resumes && chown -R node:node /data /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/dist-server ./dist-server
USER node
EXPOSE 8080
VOLUME ["/data/resumes"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist-server/index.js"]
