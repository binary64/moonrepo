# Arthur Radio Web — Next.js frontend for live radio dashboard
# Dependencies:
# - next: React framework (App Router)
# - @apollo/client: GraphQL subscriptions to Hasura
# - tailwindcss: Styling

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (replaced at build, public vars baked into client bundle)
ARG NEXT_PUBLIC_HASURA_HTTP_URL
ARG NEXT_PUBLIC_HASURA_WS_URL
ENV NEXT_PUBLIC_HASURA_HTTP_URL=${NEXT_PUBLIC_HASURA_HTTP_URL}
ENV NEXT_PUBLIC_HASURA_WS_URL=${NEXT_PUBLIC_HASURA_WS_URL}

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3004
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3004

CMD ["node", "server.js"]
