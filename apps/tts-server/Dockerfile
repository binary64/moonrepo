# Dependencies:
# - node: Express server runtime
# - kokoro fallback requires host scripts (optional, graceful failure)
# No heavy native deps — pure Node.js + Hume API calls

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --production
COPY server.js ./

EXPOSE 3090

USER node
CMD ["node", "server.js"]
