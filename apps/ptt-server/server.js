#!/usr/bin/env node
// PTT Server v8 — Watch Voice → Main Session Router
//
// Protocol: Each binary chunk has a 4-byte prefix (session index, uint32 LE)
// This ensures in-flight audio always routes to the correct session even
// after rapid session switches.
//
// Watch connects via WebSocket, streams tagged binary PCM frames continuously.
// Server runs Silero VAD per-frame, transcribes via Whisper, then sends to
// the main Arthur session with HA location context. Arthur decides routing.
//
// Events sent back to watch:
//   {"event":"speech_start"}               — voice activity detected
//   {"event":"vad_end"}                    — speech endpoint detected
//   {"event":"result","status":"ok","text":"..."} — transcription done

const express = require('express');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');

const PORT = process.env.PORT || 9876;
const MAIN_SESSION = process.env.MAIN_SESSION || 'agent:main:main';
const HA_URL = process.env.HA_URL || 'https://home.brandwhisper.cloud';
const HA_TOKEN = process.env.HA_TOKEN || '';
const BERMUDA_ENTITY = process.env.BERMUDA_ENTITY || 'sensor.bermuda_952259c0553c46c2b1870c091fcb182a_100_40004_area';

// ── Latency Metrics ──
const METRICS_FILE = path.join(__dirname, 'metrics.json');
const metrics = {
  totalUtterances: 0,
  totalHallucinations: 0,
  avgWhisperMs: 0,
  avgVadSpeechMs: 0,
  avgEndToEndMs: 0,
  p95WhisperMs: 0,
  p95EndToEndMs: 0,
  recentLatencies: [],     // last 100 entries: { ts, whisperMs, vadSpeechMs, endToEndMs, text }
  lastUpdated: null
};

// Load persisted metrics
try {
  const saved = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
  Object.assign(metrics, saved);
} catch {}

function recordMetric(entry) {
  metrics.recentLatencies.push(entry);
  if (metrics.recentLatencies.length > 100) metrics.recentLatencies.shift();
  metrics.totalUtterances++;
  metrics.lastUpdated = new Date().toISOString();

  // Recompute averages from recent entries
  const latencies = metrics.recentLatencies;
  const whisperArr = latencies.map(l => l.whisperMs).filter(Boolean).sort((a,b) => a-b);
  const e2eArr = latencies.map(l => l.endToEndMs).filter(Boolean).sort((a,b) => a-b);
  const vadArr = latencies.map(l => l.vadSpeechMs).filter(Boolean);

  if (whisperArr.length > 0) {
    metrics.avgWhisperMs = Math.round(whisperArr.reduce((a,b) => a+b, 0) / whisperArr.length);
    metrics.p95WhisperMs = whisperArr[Math.floor(whisperArr.length * 0.95)] || 0;
  }
  if (e2eArr.length > 0) {
    metrics.avgEndToEndMs = Math.round(e2eArr.reduce((a,b) => a+b, 0) / e2eArr.length);
    metrics.p95EndToEndMs = e2eArr[Math.floor(e2eArr.length * 0.95)] || 0;
  }
  if (vadArr.length > 0) {
    metrics.avgVadSpeechMs = Math.round(vadArr.reduce((a,b) => a+b, 0) / vadArr.length);
  }

  // Persist (debounced via write-through)
  try { fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2)); } catch {}
}

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || (() => {
  try { return fs.readFileSync(path.join(process.env.HOME, '.config', 'openai', 'api_key'), 'utf-8').trim(); }
  catch { return ''; }
})();

// Audio config
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

// VAD config
const SPEECH_THRESHOLD = 0.85;
const SILENCE_AFTER_SPEECH_MS = 1600;
const MIN_SPEECH_MS = 400;
const MIN_SPEECH_FRAMES = 3;  // Need 3 consecutive frames above threshold before triggering
const MAX_SPEECH_MS = 20000;  // Safety: force-end after 20s of continuous speech
const PRE_SPEECH_BUFFER_MS = 300;
const FRAME_SAMPLES = 1536;
const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

// Silero ONNX model
let ortSession = null;

async function initVAD() {
  const modelPath = require.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');
  ortSession = await ort.InferenceSession.create(modelPath);
  console.log('Silero VAD model loaded');
}

function createVADState() {
  return {
    h: new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]),
    c: new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]),
    sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [1])
  };
}

async function runVADFrame(state, float32Frame) {
  const input = new ort.Tensor('float32', float32Frame, [1, float32Frame.length]);
  const result = await ortSession.run({
    input, sr: state.sr, h: state.h, c: state.c
  });
  state.h = result.hn;
  state.c = result.cn;
  return result.output.data[0];
}

// Create per-session VAD + buffer state
function createSessionState(sessionKey) {
  const preSpeechFrames = Math.ceil(PRE_SPEECH_BUFFER_MS / FRAME_MS);
  return {
    sessionKey,
    vadState: createVADState(),
    frameBuffer: Buffer.alloc(0),
    speechStarted: false,
    speechMs: 0,
    silenceMs: 0,
    consecutiveSpeechFrames: 0,
    preSpeechRing: [],
    speechChunks: [],
    transcribing: false,
    preSpeechFrames
  };
}

// Reset a session's VAD state (keep sessionKey)
function resetSessionState(state) {
  state.vadState = createVADState();
  state.frameBuffer = Buffer.alloc(0);
  state.speechStarted = false;
  state.speechMs = 0;
  state.silenceMs = 0;
  state.consecutiveSpeechFrames = 0;
  state.preSpeechRing = [];
  state.speechChunks = [];
  state.transcribing = false;
}

// ── Express (health, battery, text) ──

const app = express();
app.use(express.json());

// HA battery reporting (optional)
let lastBatteryUpdate = 0;

function updateHABattery(level, charging) {
  if (!HA_TOKEN) return;
  const now = Date.now();
  if (now - lastBatteryUpdate < 5 * 60 * 1000 && level > 0) return;
  lastBatteryUpdate = now;

  const state = {
    state: level,
    attributes: {
      unit_of_measurement: '%',
      device_class: 'battery',
      friendly_name: 'Galaxy Watch Battery',
      icon: charging ? 'mdi:battery-charging' : (level <= 20 ? 'mdi:battery-low' : 'mdi:battery'),
      charging: charging
    }
  };

  const data = JSON.stringify(state);
  const url = new URL('/api/states/sensor.galaxy_watch_battery', HA_URL);
  const mod = url.protocol === 'https:' ? https : http;
  const req = mod.request(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HA_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log(`[${ts()}] 🔋 Watch battery: ${level}%${charging ? ' ⚡' : ''}`);
      }
    });
  });
  req.on('error', () => {});
  req.end(data);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ptt-server', version: 8 });
});

app.get('/metrics', (req, res) => {
  const { recentLatencies, ...summary } = metrics;
  summary.recentCount = recentLatencies.length;
  summary.last5 = recentLatencies.slice(-5).map(l => ({
    ts: l.ts, whisperMs: l.whisperMs, endToEndMs: l.endToEndMs, text: (l.text || '').slice(0, 40)
  }));
  res.json(summary);
});

app.post('/battery', (req, res) => {
  const level = req.body?.level ?? -1;
  const charging = req.body?.charging ?? false;
  if (level >= 0) updateHABattery(level, charging);
  res.json({ status: 'ok' });
});

app.post('/text', (req, res) => {
  const text = req.body?.text?.trim();
  const sessionKey = req.body?.sessionKey;
  if (!text) return res.status(400).json({ error: 'No text' });
  sendToOpenClaw(text, null, sessionKey);
  res.json({ status: 'ok' });
});

// Simple rate limiter for routes with file system access
function rateLimit(windowMs, maxRequests) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const record = hits.get(key);
    if (record && now - record.start < windowMs) {
      record.count++;
      if (record.count > maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
      }
    } else {
      hits.set(key, { start: now, count: 1 });
    }
    next();
  };
}

// Curated session list for watch pager
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
app.get('/sessions', rateLimit(60000, 30), (req, res) => {
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read sessions.json' });
  }
});

// ── HTTP server + WebSocket ──

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Extract initial target session from query string: /ws?session=agent:main:...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const initialSessionKey = url.searchParams.get('session') || 'default';

  // Per-session state storage: index -> session state
  const sessionStates = new Map();
  // Map session key -> index (for looking up index on switch)
  const sessionKeyToIndex = new Map();
  // Next available index
  let nextIndex = 0;
  // Current target index (for backwards compat with untagged chunks)
  let targetIndex = 0;
  // Global processing lock (only one drain at a time)
  let processing = false;
  let pendingData = false;

  // Get or create session state by key
  function getOrCreateSession(sessionKey) {
    if (sessionKeyToIndex.has(sessionKey)) {
      return { index: sessionKeyToIndex.get(sessionKey), state: sessionStates.get(sessionKeyToIndex.get(sessionKey)) };
    }
    const index = nextIndex++;
    const state = createSessionState(sessionKey);
    sessionStates.set(index, state);
    sessionKeyToIndex.set(sessionKey, index);
    return { index, state };
  }

  // Initialize first session
  const initial = getOrCreateSession(initialSessionKey);
  targetIndex = initial.index;

  console.log(`[${ts()}] 🎙️ WS connected (session: ${initialSessionKey}, index: ${targetIndex})`);

  function send(event) {
    if (ws.readyState === 1) {  // OPEN
      ws.send(JSON.stringify(event));
    }
  }

  // Send initial session index to watch so it tags chunks correctly
  send({ event: 'session_switched', session: initialSessionKey, index: targetIndex });

  // Finish utterance for a specific session state
  function finishUtteranceForState(state) {
    const pcmData = Buffer.concat(state.speechChunks);
    const wavBuffer = buildWav(pcmData);
    const vadSpeechMs = Math.round(state.speechMs);
    const e2eStart = Date.now();

    transcribeAndSend(wavBuffer, state.sessionKey)
      .then((result) => {
        const endToEndMs = Date.now() - e2eStart;
        const text = result?.text || '';
        const whisperMs = result?.whisperMs || endToEndMs;
        console.log(`[${ts()}] ✅ "${text}" (whisper: ${whisperMs}ms, e2e: ${endToEndMs}ms)`);
        send({ event: 'result', status: 'ok', text });

        if (text) {
          recordMetric({
            ts: new Date().toISOString(),
            whisperMs,
            vadSpeechMs,
            endToEndMs,
            text: text.slice(0, 80)
          });
        }
      })
      .catch((err) => {
        console.error(`[${ts()}] ❌ ${err.message}`);
        send({ event: 'result', status: 'error', text: '', error: err.message });
      })
      .finally(() => {
        resetSessionState(state);
      });
  }

  // Handle session switch — just update target index
  // Old audio will still route correctly via its tag
  function handleSessionSwitch(newSessionKey) {
    const oldIndex = targetIndex;
    const { index, state } = getOrCreateSession(newSessionKey);
    console.log(`[${ts()}] 🔄 Session switch: index ${oldIndex} → ${index} (${newSessionKey})`);

    // Finish any pending speech on old session if it has enough audio
    const oldState = sessionStates.get(oldIndex);
    if (oldState && oldState.speechStarted && oldState.speechMs >= MIN_SPEECH_MS && !oldState.transcribing) {
      oldState.transcribing = true;
      send({ event: 'vad_end' });
      const pcmData = Buffer.concat(oldState.speechChunks);
      const wavBuffer = buildWav(pcmData);
      const durationMs = Math.round(pcmData.length / BYTES_PER_SAMPLE / SAMPLE_RATE * 1000);
      console.log(`[${ts()}] 📤 ${durationMs}ms (switch-triggered) → Whisper [${oldState.sessionKey}]`);
      finishUtteranceForState(oldState);
    } else if (oldState && oldState.speechStarted) {
      console.log(`[${ts()}] 🗑️ Discarding short speech (${Math.round(oldState.speechMs)}ms)`);
      resetSessionState(oldState);
    }

    targetIndex = index;
    send({ event: 'session_switched', session: newSessionKey, index });
    console.log(`[${ts()}] ✅ Now targeting: index ${index} (${newSessionKey})`);
  }

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // Text message — JSON command
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'battery') {
          if (msg.level >= 0) updateHABattery(msg.level, msg.charging ?? false);
        } else if (msg.type === 'switch_session' && msg.session) {
          handleSessionSwitch(msg.session);
        }
      } catch (e) {}
      return;
    }

    // Binary message — tagged PCM audio
    // First 4 bytes = session index (uint32 LE), rest = PCM data
    if (data.length < 4) return;  // Too short

    const chunkIndex = data.readUInt32LE(0);
    const pcmData = data.subarray(4);

    // Look up session state (fallback to target if index unknown)
    let state = sessionStates.get(chunkIndex);
    if (!state) {
      // Unknown index — use current target (backwards compat)
      state = sessionStates.get(targetIndex);
    }

    if (!state || state.transcribing) return;

    state.frameBuffer = Buffer.concat([state.frameBuffer, pcmData]);

    if (!processing) {
      drainFrames();
    } else {
      pendingData = true;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[${ts()}] 🔚 WS closed (code: ${code}, reason: ${reason || 'none'})`);
    // Finish any pending utterances across all sessions
    for (const [index, state] of sessionStates) {
      if (state.speechStarted && state.speechMs >= MIN_SPEECH_MS && !state.transcribing) {
        state.transcribing = true;
        send({ event: 'vad_end' });
        finishUtteranceForState(state);
      }
    }
  });

  ws.on('error', (err) => {
    console.log(`[${ts()}] ⚠️ WS error: ${err.message}`);
  });

  async function drainFrames() {
    processing = true;
    try {
      // Process frames from all sessions that have buffered data
      let hadWork = true;
      while (hadWork) {
        hadWork = false;
        for (const [index, state] of sessionStates) {
          if (state.frameBuffer.length < FRAME_BYTES || state.transcribing) continue;
          hadWork = true;

          const frame = state.frameBuffer.subarray(0, FRAME_BYTES);
          state.frameBuffer = state.frameBuffer.subarray(FRAME_BYTES);

          const float32 = pcm16ToFloat32(frame);
          const prob = await runVADFrame(state.vadState, float32);
          const isSpeech = prob > SPEECH_THRESHOLD;

          if (!state.speechStarted) {
            state.preSpeechRing.push(Buffer.from(frame));
            if (state.preSpeechRing.length > state.preSpeechFrames) state.preSpeechRing.shift();

            if (isSpeech) {
              state.consecutiveSpeechFrames++;
              if (state.consecutiveSpeechFrames >= MIN_SPEECH_FRAMES) {
                state.speechStarted = true;
                state.speechMs = FRAME_MS * state.consecutiveSpeechFrames;
                state.silenceMs = 0;
                for (const f of state.preSpeechRing) state.speechChunks.push(f);
                state.speechChunks.push(Buffer.from(frame));
                console.log(`[${ts()}] 🟢 Speech (prob: ${prob.toFixed(2)}, ${state.consecutiveSpeechFrames} frames) [index ${index}]`);
                send({ event: 'speech_start', index });
              }
            } else {
              state.consecutiveSpeechFrames = 0;
            }
          } else {
            state.speechChunks.push(Buffer.from(frame));

            if (isSpeech) {
              state.speechMs += FRAME_MS;
              state.silenceMs = 0;
            } else {
              state.silenceMs += FRAME_MS;
            }

            // Periodic diagnostic log
            if (Math.round(state.speechMs + state.silenceMs) % 4992 < FRAME_MS) {
              console.log(`[${ts()}] 📊 [${index}] Speech: ${Math.round(state.speechMs)}ms, silence: ${Math.round(state.silenceMs)}ms`);
            }

            // Safety: force-end after MAX_SPEECH_MS
            if (state.speechMs >= MAX_SPEECH_MS) {
              console.log(`[${ts()}] ⏰ Max speech timeout [${index}]`);
              send({ event: 'vad_end', index });
              state.transcribing = true;
              finishUtteranceForState(state);
              continue;
            }

            if (state.silenceMs >= SILENCE_AFTER_SPEECH_MS && state.speechMs >= MIN_SPEECH_MS) {
              console.log(`[${ts()}] 🔴 End (${Math.round(state.speechMs)}ms speech, ${Math.round(state.silenceMs)}ms silence) [${index}]`);
              send({ event: 'vad_end', index });
              state.transcribing = true;
              finishUtteranceForState(state);
              continue;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[${ts()}] ⚠️ VAD error: ${err.message}`);
      send({ event: 'result', status: 'error', text: '', error: 'VAD failed' });
    } finally {
      processing = false;
      if (pendingData) {
        pendingData = false;
        // Check if any session has pending data and isn't transcribing
        for (const [index, state] of sessionStates) {
          if (state.frameBuffer.length >= FRAME_BYTES && !state.transcribing) {
            drainFrames();
            break;
          }
        }
      }
    }
  }
});

// ── Shared utilities ──

function pcm16ToFloat32(buf) {
  const len = buf.length / 2;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = buf.readInt16LE(i * 2) / 32768.0;
  return out;
}

function buildWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ── Whisper hallucination filter ──

const HALLUCINATION_PATTERNS = [
  /sound of keyboard/i,
  /keyboard typing/i,
  /typing sound/i,
  /background noise/i,
  /silence/i,
  /music playing/i,
  /\[.*\]/,                    // Whisper meta-descriptions: [music], [noise], etc.
  /^\s*\.+\s*$/,               // Just dots/periods
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /like and subscribe/i,
  /bye\.?\s*bye\.?\s*bye/i,
  /thanks\.?\s*bye\.?\s*bye/i,
  /thank you\.?\s*$/i,         // Just "thank you" — classic hallucination
  /thanks\.?\s*$/i,            // Just "thanks"
  /you$/i,                     // Just "you"
  /yeah\.?\s*$/i,              // Just "yeah"
  /okay\.?\s*$/i,              // Just "okay"
  /oh\.?\s*$/i,                // Just "oh"
  /so\.?\s*$/i,                // Just "so"
  /the end\.?\s*$/i,
  /goodbye\.?\s*$/i,
  /good night\.?\s*$/i,
  /see you next time/i,
  /see you later/i,
  /i'll see you/i,
  /♪/,                         // Musical notes
  /🎵/,
  /^\s*\.\.\.\s*$/,            // Ellipsis
  /^\W+$/,                     // Only non-word characters
];

function isHallucination(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  // Single word under 5 chars is almost always noise
  if (trimmed.split(/\s+/).length === 1 && trimmed.length < 5) return true;
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}



function transcribeAndSend(wavBuffer, sessionKey) {
  return new Promise((resolve, reject) => {
    const boundary = '----WatchPTT' + Date.now();
    const prompt = 'Arthur, radio on, lights off, TV on, skip track, what\'s the weather [BRITISH]';

    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    );
    const post = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n` +
      `--${boundary}--\r\n`
    );
    const body = Buffer.concat([pre, wavBuffer, post]);

    const whisperStart = Date.now();
    const apiReq = https.request({
      hostname: 'api.openai.com', path: '/v1/audio/transcriptions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', (c) => data += c);
      apiRes.on('end', () => {
        const whisperMs = Date.now() - whisperStart;
        if (apiRes.statusCode !== 200) return reject(new Error(`Whisper ${apiRes.statusCode}: ${data}`));
        const text = data.trim();
        console.log(`[${ts()}] 🗣️ Whisper: "${text}" (${whisperMs}ms)`);
        if (!text || text.length < 2) return resolve({ text: '', whisperMs });
        if (isHallucination(text)) {
          console.log(`[${ts()}] 🚫 Filtered hallucination: "${text}"`);
          metrics.totalHallucinations++;
          return resolve({ text: '', whisperMs });
        }

        // Send to main session with location context — Arthur routes it
        sendToOpenClaw(text, (err) => err ? reject(err) : resolve({ text, whisperMs }));
      });
    });
    apiReq.on('error', reject);
    apiReq.end(body);
  });
}

// Fetch James's current room from HA Bermuda BLE tracker
function getLocation() {
  return new Promise((resolve) => {
    if (!HA_TOKEN) return resolve('unknown');
    const url = new URL(`/api/states/${BERMUDA_ENTITY}`, HA_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${HA_TOKEN}` },
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const state = JSON.parse(data).state;
          resolve(state || 'unknown');
        } catch { resolve('unknown'); }
      });
    });
    req.on('error', () => resolve('unknown'));
    req.on('timeout', () => { req.destroy(); resolve('unknown'); });
    req.end();
  });
}

// Send transcription to Arthur's main session via Gateway WebSocket RPC
function gatewayRPC(method, params) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const wsUrl = GATEWAY_TOKEN ? `${GATEWAY_URL}?token=${GATEWAY_TOKEN}` : GATEWAY_URL;
    const gwWs = new WebSocket(wsUrl);
    const id = `ptt-${Date.now()}`;
    const timeout = setTimeout(() => {
      gwWs.close();
      reject(new Error('Gateway RPC timeout'));
    }, 10000);

    gwWs.on('open', () => {
      gwWs.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
    gwWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          gwWs.close();
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    gwWs.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

async function sendToOpenClaw(text, cb) {
  try {
    const location = await getLocation();
    const messageText = `⌚ User spoke into his watch from the ${location}: "${text}"`;
    await gatewayRPC('chat.send', {
      message: messageText,
      sessionKey: MAIN_SESSION,
      idempotencyKey: `ptt-${Date.now()}`
    });
    console.log(`[${ts()}] → Main session: "${text}" (location: ${location})`);
    if (cb) cb(null);
  } catch (err) {
    console.error(`[${ts()}] OpenClaw error: ${err.message}`);
    if (cb) cb(err);
  }
}

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, -4); }

// ── Start ──

initVAD().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PTT Server v8 — Watch Voice → Main Session Router`);
    console.log(`  WS: ws://0.0.0.0:${PORT}/ws`);
    console.log(`  HTTP: health, battery, text on :${PORT}`);
    console.log(`  Target: ${MAIN_SESSION}`);
    console.log(`  HA: ${HA_URL} (location: ${BERMUDA_ENTITY})`);
    console.log(`  Speech: >${SPEECH_THRESHOLD} | Silence: ${SILENCE_AFTER_SPEECH_MS}ms | Min: ${MIN_SPEECH_MS}ms`);
  });
}).catch(err => { console.error('VAD init failed:', err); process.exit(1); });
