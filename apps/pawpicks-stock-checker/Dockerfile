FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application
COPY index.js ./

# Output directory (mounted as PVC in k8s)
RUN mkdir -p /data

# Run as non-root
RUN addgroup -S checker && adduser -S checker -G checker && chown -R checker:checker /app /data
USER checker

CMD ["node", "index.js"]
