# PTT Server — Watch voice receiver + Whisper transcription + OpenClaw routing
#
# Dependencies:
# - onnxruntime-node: native ONNX bindings for Silero VAD
# - ws: WebSocket for watch connection + gateway RPC
# - express-rate-limit: rate limiting for HTTP endpoints

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
COPY sessions.json ./
# Silero VAD v6.2 model (Dec 2025) — improved low-quality mic audio detection.
# Drop-in replacement: same ONNX input/output API, better weights.
# Downloaded from: https://github.com/snakers4/silero-vad/tree/v6.2
COPY silero_vad_v6.2.onnx ./

# Give the node user write access so metrics.json can be persisted at runtime
RUN chown -R node:node /app

EXPOSE 9876

USER node
CMD ["node", "server.js"]
