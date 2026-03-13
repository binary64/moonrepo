FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl iputils-ping \
    && python3 -m venv /opt/catt-venv \
    && /opt/catt-venv/bin/pip install catt \
    && ln -s /opt/catt-venv/bin/catt /usr/local/bin/catt \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./

EXPOSE 3080

USER node
CMD ["node", "server.js"]
