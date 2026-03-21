# PTT Server — Watch voice receiver + Whisper transcription + OpenClaw routing
#
# Dependencies:
# - onnxruntime-node: native ONNX bindings for Silero VAD
# - ws: WebSocket for watch connection + gateway RPC

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
COPY sessions.json ./

# Give the node user write access so metrics.json can be persisted at runtime
RUN chown -R node:node /app

EXPOSE 9876

USER node
CMD ["node", "server.js"]
