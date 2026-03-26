# Dependencies:
# - node 22: TypeScript runtime
# - express: HTTP server
# No external binaries needed — pure Node.js

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json server.ts ./
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3200

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
