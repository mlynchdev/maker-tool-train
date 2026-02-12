FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bunjs
USER bunjs

# Copy built application
COPY --from=builder --chown=bunjs:nodejs /app/.output ./.output
COPY --from=builder --chown=bunjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=bunjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=bunjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=bunjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=bunjs:nodejs /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["bun", "run", ".output/server/index.mjs"]
