FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS runner
ENV NODE_ENV=production
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY db ./db
EXPOSE 3001
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health/ready" > /dev/null || exit 1
CMD ["bun", "run", "start"]
