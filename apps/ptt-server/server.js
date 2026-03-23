#!/usr/bin/env node
// PTT Server v9 — Containerised Watch Voice Receiver
//
// Protocol: Each binary chunk has a 4-byte prefix (session index, uint32 LE)
// This ensures in-flight audio always routes to the correct session even
// after rapid session switches.
//
// Watch connects via WebSocket, streams tagged binary PCM frames continuously.
// Session switching happens via JSON messages — no reconnection needed.
// Server runs Silero VAD per-frame per-session, sends JSON events back:
//   {"event":"speech_start"}               — voice activity detected
//   {"event":"vad_end"}                    — speech endpoint detected
//   {"event":"result","status":"ok","text":"..."} — transcription done
//   {"event":"session_switched","session":"xxx"}  — session switch confirmed

const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');

const PORT = process.env.PORT || 9876;
const MAIN_SESSION = process.env.MAIN_SESSION || 'agent:main:main';
const HA_URL = process.env.HA_URL || 'https://home.brandwhisper.cloud';
const HA_TOKEN = process.env.HA_TOKEN || '';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

// Fail-fast: validate required env vars before starting
if (!OPENAI_KEY) {
  console.error('FATAL: OPENAI_API_KEY is not set. Cannot transcribe audio — exiting.');
  process.exit(1);
}

// Quick command registry — container mounts at /config/registry.json
const QUICK_COMMANDS_PATH = process.env.QUICK_COMMANDS_PATH || '/config/registry.json';
let quickCommands = {};
try {
  quickCommands = JSON.parse(fs.readFileSync(QUICK_COMMANDS_PATH, 'utf-8')).commands || {};
  console.log(`Loaded ${Object.keys(quickCommands).length} quick commands`);
} catch (e) {
  console.warn('⚠️ Quick commands registry not found — skipping');
}

// ── Latency Metrics ──
const METRICS_FILE = path.join(__dirname, 'metrics.json');
const metrics = {
  totalUtterances: 0,
  totalQuickCommands: 0,
  totalHallucinations: 0,
  avgTranscriptionMs: 0,   // end-to-end latency (Whisper API + network)
  avgVadSpeechMs: 0,
  avgEndToEndMs: 0,
  p95TranscriptionMs: 0,
  p95EndToEndMs: 0,
  recentLatencies: [],     // last 100 entries: { ts, transcriptionMs, vadSpeechMs, endToEndMs, text }
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

  const latencies = metrics.recentLatencies;
  const transcriptionArr = latencies.map(l => l.transcriptionMs).filter(Boolean).sort((a,b) => a-b);
  const e2eArr = latencies.map(l => l.endToEndMs).filter(Boolean).sort((a,b) => a-b);
  const vadArr = latencies.map(l => l.vadSpeechMs).filter(Boolean);

  if (transcriptionArr.length > 0) {
    metrics.avgTranscriptionMs = Math.round(transcriptionArr.reduce((a,b) => a+b, 0) / transcriptionArr.length);
    metrics.p95TranscriptionMs = transcriptionArr[Math.floor(transcriptionArr.length * 0.95)] || 0;
  }
  if (e2eArr.length > 0) {
    metrics.avgEndToEndMs = Math.round(e2eArr.reduce((a,b) => a+b, 0) / e2eArr.length);
    metrics.p95EndToEndMs = e2eArr[Math.floor(e2eArr.length * 0.95)] || 0;
  }
  if (vadArr.length > 0) {
    metrics.avgVadSpeechMs = Math.round(vadArr.reduce((a,b) => a+b, 0) / vadArr.length);
  }

  fs.writeFile(METRICS_FILE, JSON.stringify(metrics, null, 2), (err) => {
    if (err) console.error(`[${ts()}] Failed to persist metrics: ${err.message}`);
  });
}

// Audio config
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

// VAD config
const SPEECH_THRESHOLD = 0.85;
const SILENCE_AFTER_SPEECH_MS = 1600;
const MIN_SPEECH_MS = 400;
const MIN_SPEECH_FRAMES = 3;
const MAX_SPEECH_MS = 20000;
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

function resetSessionState(state) {
  state.vadState = createVADState();
  // Preserve frameBuffer — audio may have arrived during transcription
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

// Rate limiters
const rateLimit = require('express-rate-limit');
const sessionsLimiter = rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false });
const textLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });
const batteryLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });

let lastBatteryUpdate = 0;

// Battery alert thresholds
const BATTERY_LOW = 22;
const BATTERY_HIGH = 85;
let lastAlertType = null;

function checkBatteryAlert(level, charging) {
  if (level <= BATTERY_LOW && !charging && lastAlertType !== 'low') {
    lastAlertType = 'low';
    sendBatteryAlert(`🪫 Watch battery low: ${level}% — stick it on the charger`);
  } else if (level >= BATTERY_HIGH && charging && lastAlertType !== 'high') {
    lastAlertType = 'high';
    sendBatteryAlert(`🔋 Watch battery at ${level}% — good to unplug`);
  } else if (level > BATTERY_LOW && level < BATTERY_HIGH) {
    lastAlertType = null;
  }
}

function sendBatteryAlert(message) {
  sendViaGateway(message, MAIN_SESSION, (err) => {
    if (err) console.error(`[${ts()}] Battery alert error: ${err.message}`);
    else console.log(`[${ts()}] 🔔 Battery alert sent: ${message}`);
  });
}

function updateHABattery(level, charging) {
  checkBatteryAlert(level, charging);

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
  const url = new URL(`${HA_URL}/api/states/sensor.galaxy_watch_battery`);
  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.request(url, {
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
  res.json({ status: 'ok', service: 'ptt-server', version: 9 });
});

app.get('/metrics', (req, res) => {
  const { recentLatencies, ...summary } = metrics;
  summary.recentCount = recentLatencies.length;
  summary.last5 = recentLatencies.slice(-5).map(l => ({
    ts: l.ts, transcriptionMs: l.transcriptionMs, endToEndMs: l.endToEndMs, text: (l.text || '').slice(0, 40)
  }));
  res.json(summary);
});

app.post('/battery', batteryLimiter, (req, res) => {
  const level = req.body?.level ?? -1;
  const charging = req.body?.charging ?? false;
  if (level >= 0) updateHABattery(level, charging);
  res.json({ status: 'ok' });
});

app.post('/text', textLimiter, (req, res) => {
  const text = req.body?.text?.trim();
  const sessionKey = req.body?.sessionKey;
  if (!text) return res.status(400).json({ error: 'No text' });
  sendToOpenClaw(text, null, sessionKey);
  res.json({ status: 'ok' });
});

// Curated session list for watch pager
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
app.get('/sessions', sessionsLimiter, (req, res) => {
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const initialSessionKey = url.searchParams.get('session') || MAIN_SESSION;

  const sessionStates = new Map();
  const sessionKeyToIndex = new Map();
  let nextIndex = 0;
  let targetIndex = 0;
  let processing = false;
  let pendingData = false;

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

  const initial = getOrCreateSession(initialSessionKey);
  targetIndex = initial.index;

  console.log(`[${ts()}] 🎙️ WS connected (session: ${initialSessionKey}, index: ${targetIndex})`);

  function send(event) {
    if (ws.readyState === 1) ws.send(JSON.stringify(event));
  }

  send({ event: 'session_switched', session: initialSessionKey, index: targetIndex });

  function finishUtteranceForState(state) {
    const pcmData = Buffer.concat(state.speechChunks);
    const wavBuffer = buildWav(pcmData);
    const vadSpeechMs = Math.round(state.speechMs);
    const e2eStart = Date.now();

    transcribeAndSend(wavBuffer, state.sessionKey)
      .then((result) => {
        const endToEndMs = Date.now() - e2eStart;
        const text = typeof result === 'object' ? result.text : result;
        console.log(`[${ts()}] ✅ "${text}" [${state.sessionKey}] (e2e: ${endToEndMs}ms)`);
        send({ event: 'result', status: 'ok', text });

        if (text) {
          recordMetric({
            ts: new Date().toISOString(),
            transcriptionMs: endToEndMs,
            vadSpeechMs,
            endToEndMs,
            text: (typeof text === 'string' ? text : '').slice(0, 80),
            quickCommand: typeof result === 'object' ? !!result.quickCommand : false
          });
          if (typeof result === 'object' && result.quickCommand) {
            metrics.totalQuickCommands++;
          }
        }
      })
      .catch((err) => {
        console.error(`[${ts()}] ❌ ${err.message}`);
        send({ event: 'result', status: 'error', text: '', error: err.message });
      })
      .finally(() => {
        // Reset session state here (after async work completes) to avoid
        // a race condition where resetSessionState clears state.transcribing
        // before the transcription promise resolves.
        resetSessionState(state);
        // Drain any audio that was buffered while transcribing
        if (state.frameBuffer.length >= FRAME_BYTES && !processing) {
          drainFrames();
        }
      });
  }

  function handleSessionSwitch(newSessionKey) {
    const oldIndex = targetIndex;
    const { index, state } = getOrCreateSession(newSessionKey);
    console.log(`[${ts()}] 🔄 Session switch: index ${oldIndex} → ${index} (${newSessionKey})`);

    const oldState = sessionStates.get(oldIndex);
    if (oldState && oldState.speechStarted && oldState.speechMs >= MIN_SPEECH_MS && !oldState.transcribing) {
      oldState.transcribing = true;
      send({ event: 'vad_end' });
      const pcmData = Buffer.concat(oldState.speechChunks);
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

    if (data.length < 4) return;

    const chunkIndex = data.readUInt32LE(0);
    const pcmData = data.subarray(4);

    let state = sessionStates.get(chunkIndex);
    if (!state) {
      // chunkIndex not recognised — fall back to current target session
      console.debug(`[${ts()}] Unknown chunkIndex ${chunkIndex}, falling back to targetIndex ${targetIndex}`);
      state = sessionStates.get(targetIndex);
    }
    if (!state) return;

    // Buffer incoming frames even while transcribing so no speech is dropped.
    // resetSessionState preserves frameBuffer, so buffered audio is processed
    // by drainFrames once the transcription completes and state is reset.
    state.frameBuffer = Buffer.concat([state.frameBuffer, pcmData]);

    // Don't run the drain loop while transcribing — frames are queued in
    // frameBuffer and will be drained when transcribing is cleared.
    if (state.transcribing) return;

    if (!processing) {
      drainFrames();
    } else {
      pendingData = true;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[${ts()}] 🔚 WS closed (code: ${code}, reason: ${reason || 'none'})`);
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

            if (Math.round(state.speechMs + state.silenceMs) % 4992 < FRAME_MS) {
              console.log(`[${ts()}] 📊 [${index}] Speech: ${Math.round(state.speechMs)}ms, silence: ${Math.round(state.silenceMs)}ms`);
            }

            if (state.speechMs >= MAX_SPEECH_MS) {
              console.log(`[${ts()}] ⏰ Max speech timeout [${index}]`);
              send({ event: 'vad_end', index });
              state.transcribing = true;
              // resetSessionState is called inside finishUtteranceForState's finally
              // block to avoid a race condition with the async transcription.
              finishUtteranceForState(state);
              continue;
            }

            if (state.silenceMs >= SILENCE_AFTER_SPEECH_MS && state.speechMs >= MIN_SPEECH_MS) {
              console.log(`[${ts()}] 🔴 End (${Math.round(state.speechMs)}ms speech, ${Math.round(state.silenceMs)}ms silence) [${index}]`);
              send({ event: 'vad_end', index });
              state.transcribing = true;
              // resetSessionState is called inside finishUtteranceForState's finally
              // block to avoid a race condition with the async transcription.
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
  /sound of keyboard/i, /keyboard typing/i, /typing sound/i,
  /background noise/i, /silence/i, /music playing/i,
  /\[.*\]/, /^\s*\.+\s*$/, /thank you for watching/i,
  /thanks for watching/i, /please subscribe/i, /like and subscribe/i,
  /bye\.?\s*bye\.?\s*bye/i, /thanks\.?\s*bye\.?\s*bye/i,
  /thank you\.?\s*$/i, /thanks\.?\s*$/i, /you$/i,
  /yeah\.?\s*$/i, /okay\.?\s*$/i, /oh\.?\s*$/i, /so\.?\s*$/i,
  /the end\.?\s*$/i, /goodbye\.?\s*$/i, /good night\.?\s*$/i,
  /see you next time/i, /see you later/i, /i'll see you/i,
  /♪/, /🎵/, /^\s*\.\.\.\s*$/, /^\W+$/,
];

function isHallucination(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (trimmed.split(/\s+/).length === 1 && trimmed.length < 5) return true;
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

// Match transcribed text against quick command registry
function matchQuickCommand(text) {
  const normalized = text.toLowerCase().trim();
  if (quickCommands[normalized]) {
    return { command: normalized, ...quickCommands[normalized] };
  }
  return null;
}

// Execute a quick command via gateway (send as chat message, Arthur handles it).
// Routing is fully handled by Arthur based on the message text — the matched
// registry entry is not needed here, so only `text` is accepted as a parameter.
function executeQuickCommand(text) {
  return new Promise((resolve, reject) => {
    sendViaGateway(`⌚ ${text}`, MAIN_SESSION, (err) => {
      if (err) return reject(err);
      resolve(text);
    });
  });
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
        if (apiRes.statusCode !== 200) return reject(new Error(`Whisper ${apiRes.statusCode}: ${data}`));
        const text = data.trim();
        console.log(`[${ts()}] 🗣️ Whisper: "${text}"`);
        if (!text || text.length < 2) return resolve('');
        if (isHallucination(text)) {
          console.log(`[${ts()}] 🚫 Filtered hallucination: "${text}"`);
          metrics.totalHallucinations++;
          return resolve('');
        }

        // Check for quick command match
        const quickMatch = matchQuickCommand(text);
        if (quickMatch) {
          console.log(`[${ts()}] 🎯 Quick command match: "${text}" → ${quickMatch.skill}.${quickMatch.action}`);
          executeQuickCommand(text)
            .then(() => resolve({ text, quickCommand: true }))
            .catch((err) => {
              console.error(`[${ts()}] Quick command failed, falling back to LLM: ${err.message}`);
              sendToOpenClaw(text, (err) => err ? reject(err) : resolve({ text, quickCommand: false }), sessionKey);
            });
          return;
        }

        sendToOpenClaw(text, (err) => err ? reject(err) : resolve({ text, quickCommand: false }), sessionKey);
      });
    });
    apiReq.on('error', reject);
    apiReq.end(body);
  });
}

// Send message to OpenClaw gateway via WebSocket.
// Note: the gateway token is passed as a URL query parameter — this is acceptable
// because the connection is always to the local loopback (127.0.0.1) over the
// internal pod network, so the token is never transmitted over a public network.
function sendViaGateway(message, sessionKey, cb) {
  const wsUrl = `${GATEWAY_URL}/gateway?token=${GATEWAY_TOKEN}`;
  const idempotencyKey = `watch-ptt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let resolved = false;
  const ws = new WebSocket(wsUrl);
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      ws.close();
      console.error(`[${ts()}] Gateway WS timeout`);
      if (cb) cb(new Error('timeout'));
    }
  }, 30000);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      method: 'chat.send',
      params: { message, sessionKey, idempotencyKey }
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.runId === idempotencyKey || msg.status) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          console.log(`[${ts()}] → Gateway send OK [${sessionKey}]`);
          if (cb) cb(null);
        }
      }
    } catch (_) {}
  });

  ws.on('error', (err) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      console.error(`[${ts()}] Gateway WS error: ${err.message}`);
      if (cb) cb(err);
    }
  });

  ws.on('close', (code, reason) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      const reasonStr = reason ? reason.toString() : 'none';
      console.error(`[${ts()}] Gateway WS closed unexpectedly (code: ${code}, reason: ${reasonStr})`);
      if (cb) cb(new Error(`Gateway WebSocket closed unexpectedly (code: ${code})`));
    }
  });
}

function sendToOpenClaw(text, cb, customSessionKey) {
  const targetSession = customSessionKey || MAIN_SESSION;
  const isDM = targetSession.includes(':direct:');
  const messageText = isDM ? `⌚ ${text}` : text;

  sendViaGateway(messageText, targetSession, cb);
}

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, -4); }

// ── Start ──

initVAD().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PTT Server v9 — Containerised`);
    console.log(`  WS: ws://0.0.0.0:${PORT}/ws`);
    console.log(`  HTTP: health, battery, text on :${PORT}`);
    console.log(`  Gateway: ${GATEWAY_URL}`);
    console.log(`  Speech: >${SPEECH_THRESHOLD} | Silence: ${SILENCE_AFTER_SPEECH_MS}ms | Min: ${MIN_SPEECH_MS}ms`);
  });
}).catch(err => { console.error('VAD init failed:', err); process.exit(1); });
