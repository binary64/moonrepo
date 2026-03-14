# Dependencies:
# - catt: Chromecast control (cast media, cast_site, stop)
# - curl: Sony Bravia IRCC API calls (power on/off)
# - python3 + androidtvremote2: TV status script (is_on, current_app)
# - ffmpeg/ffprobe: Media processing for TTS endpoint
# - iputils-ping: Network diagnostics via /exec endpoint

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl iputils-ping \
    && python3 -m venv /opt/catt-venv \
    && /opt/catt-venv/bin/pip install catt==0.12.14 androidtvremote2 \
    && ln -s /opt/catt-venv/bin/catt /usr/local/bin/catt \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --production
COPY server.js ./
COPY scripts/ ./scripts/

EXPOSE 3080

USER node
CMD ["node", "server.js"]
