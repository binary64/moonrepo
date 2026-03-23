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
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.warn('⚠️ Quick commands registry not found — skipping');
  } else {
    console.error(`Failed to load quick commands from ${QUICK_COMMANDS_PATH}: ${err.message}`);
  }
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
  recentLatencies: [],     // last 100 entries: { ts, transcriptionMs, vadSpeechMs, endToEndMs, quickCommand }
  lastUpdated: null
};

// Load persisted metrics
try {
  const saved = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
  Object.assign(metrics, saved);
} catch {}

// Serialise metrics writes — prevents concurrent calls from persisting stale data
let metricsWrite = Promise.resolve();

/**
 * Record a latency entry and update aggregated metrics, then persist the metrics snapshot.
 *
 * Updates the in-memory metrics summary (maintaining only the most recent 100 entries),
 * increments totalUtterances, refreshes lastUpdated, recomputes averages and p95 for
 * transcription and end-to-end latencies, and recomputes average VAD speech duration.
 * Schedules an asynchronous write of the full metrics snapshot to disk via the existing
 * serialized `metricsWrite` promise chain; persistence failures are logged.
 *
 * @param {Object} entry - A metrics entry to record.
 * @param {number} [entry.transcriptionMs] - Time spent in transcription, in milliseconds.
 * @param {number} [entry.endToEndMs] - End-to-end processing time, in milliseconds.
 * @param {number} [entry.vadSpeechMs] - Detected speech duration by VAD, in milliseconds.
 */
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

  const snapshot = JSON.stringify(metrics, null, 2);
  metricsWrite = metricsWrite
    .then(() => fs.promises.writeFile(METRICS_FILE, snapshot))
    .catch((err) => {
      console.error(`[${ts()}] Failed to persist metrics: ${err.message}`);
    });
}

// Audio config
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

// VAD config
const SPEECH_THRESHOLD = 0.85;
const SILENCE_AFTER_SPEECH_MS = 1600;
const MIN_SPEECH_MS = 400;
// MIN_SPEECH_FRAMES must satisfy: MIN_SPEECH_FRAMES × FRAME_MS ≥ MIN_SPEECH_MS
// With FRAME_SAMPLES=1536 @ 16kHz, FRAME_MS ≈ 96ms:
//   3 frames = ~288ms < 400ms  → deadlock: speech_start fires but speechMs<400 never ends
//   5 frames = ~480ms ≥ 400ms  → safe: speech_start implies speechMs is already ≥ MIN_SPEECH_MS
const MIN_SPEECH_FRAMES = 5;
// Stale-speech safety valve: if speech_start fired but no vad_end within this window,
// force-finish the utterance. Prevents silent hangs when silence never accumulates.
const STALE_SPEECH_TIMEOUT_MS = 5000;
const MAX_SPEECH_MS = 20000;
const PRE_SPEECH_BUFFER_MS = 300;
const FRAME_SAMPLES = 1536;
const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

// Silero ONNX model
// We ship the v6.2 model (Dec 2025) directly in the image for better low-quality
// mic audio detection. The model is API-compatible with prior versions — same
// input/output tensors, just improved weights.
// Fallback: if the bundled model is missing, use the one from @ricky0123/vad-node.
let ortSession = null;

/**
 * Initializes the Silero VAD ONNX inference session used by the service.
 *
 * Prefers a bundled model file named `silero_vad_v6.2.onnx` located in the module
 * directory; if that file is absent, falls back to the ONNX model supplied by
 * the `@ricky0123/vad-node` package. Sets the global `ortSession` used for VAD
 * inference and logs which model path was loaded.
 */
async function initVAD() {
  const bundledModelPath = path.join(__dirname, 'silero_vad_v6.2.onnx');
  let modelPath;
  if (fs.existsSync(bundledModelPath)) {
    modelPath = bundledModelPath;
    console.log('Silero VAD v6.2 model found — using bundled weights');
  } else {
    modelPath = require.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');
    console.warn('⚠️ silero_vad_v6.2.onnx not found — falling back to @ricky0123/vad-node bundled model');
  }
  ortSession = await ort.InferenceSession.create(modelPath);
  console.log(`Silero VAD model loaded: ${path.basename(modelPath)}`);
}

/**
 * Create the initial recurrent state tensors required by the Silero VAD model.
 * @returns {{h: ort.Tensor, c: ort.Tensor, sr: ort.Tensor}} An object containing:
 *  - `h`: Float32 tensor of shape [2,1,64] initialized to zeros for the LSTM hidden state.
 *  - `c`: Float32 tensor of shape [2,1,64] initialized to zeros for the LSTM cell state.
 *  - `sr`: Int64 tensor containing the sample rate value `16000`.
 */
function createVADState() {
  return {
    h: new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]),
    c: new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]),
    sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [1])
  };
}

/**
 * Compute the Silero VAD speech probability for a single audio frame and update the model's recurrent state.
 * @param {Object} state - VAD recurrent state; must contain `sr`, `h`, and `c` ort.Tensors. `h` and `c` are updated in-place with the model outputs.
 * @param {Float32Array} float32Frame - One frame of audio samples (float32, normalized) to evaluate.
 * @returns {number} Speech probability in the range 0 to 1.
 */
async function runVADFrame(state, float32Frame) {
  const input = new ort.Tensor('float32', float32Frame, [1, float32Frame.length]);
  const result = await ortSession.run({
    input, sr: state.sr, h: state.h, c: state.c
  });
  state.h = result.hn;
  state.c = result.cn;
  return result.output.data[0];
}

/**
 * Create and return the initial VAD and transcription state for a session.
 * @param {string} sessionKey - Unique session identifier (used to map audio and events).
 * @returns {Object} Session state containing VAD tensors, buffered audio, and VAD/transcription tracking fields.
 * @returns {string} return.sessionKey - The provided session identifier.
 * @returns {*} return.vadState - Recurrent VAD state (h, c, sr) initialized for Silero inference.
 * @returns {Buffer} return.frameBuffer - Accumulated raw PCM bytes for the session.
 * @returns {boolean} return.speechStarted - Whether an utterance is currently considered started.
 * @returns {number} return.speechMs - Milliseconds of detected speech in the current utterance.
 * @returns {number} return.silenceMs - Milliseconds of silence since the last detected speech frame.
 * @returns {number} return.consecutiveSpeechFrames - Count of consecutive frames exceeding the speech threshold.
 * @returns {Buffer[]} return.preSpeechRing - Ring buffer of frames kept before speech start.
 * @returns {Buffer[]} return.speechChunks - Collected frames forming the current utterance.
 * @returns {boolean} return.transcribing - True while the session's utterance is being transcribed.
 * @returns {number} return.preSpeechFrames - Number of frames retained in the pre-speech ring.
 * @returns {NodeJS.Timeout|null} return.staleSpeechTimer - Timer handle used to detect stale/abandoned speech; null when not armed.
 */
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
    preSpeechFrames,
    staleSpeechTimer: null   // cleared by resetSessionState; set when speech_start fires
  };
}

/**
 * Reset VAD/transcription tracking for a session while preserving in-flight audio.
 *
 * Cancels any pending stale-speech timer, reinitializes the session's VAD state,
 * and clears speech-tracking fields so the session is ready for a new utterance.
 * The session's frameBuffer is intentionally preserved.
 *
 * @param {object} state - Session state object to reset. Expected to contain fields such as `staleSpeechTimer`, `vadState`, `frameBuffer`, `speechStarted`, `speechMs`, `silenceMs`, `consecutiveSpeechFrames`, `preSpeechRing`, `speechChunks`, and `transcribing`.
 */
function resetSessionState(state) {
  // Cancel any pending stale-speech timer before clearing speechStarted.
  // This is important in both normal and error paths.
  if (state.staleSpeechTimer) {
    clearTimeout(state.staleSpeechTimer);
    state.staleSpeechTimer = null;
  }
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

// Auth token for write endpoints — prevents untrusted clients on the NodePort
// from injecting battery events or arbitrary chat messages into OpenClaw.
// Set PTT_API_TOKEN in the deployment secret; if unset, auth is disabled (dev mode).
const PTT_API_TOKEN = process.env.PTT_API_TOKEN || '';
/**
 * Enforces bearer-token authentication using PTT_API_TOKEN with an optional developer bypass.
 *
 * If `PTT_API_TOKEN` is unset and `PTT_AUTH_DEV_BYPASS === '1'`, the request is allowed.
 * Otherwise the middleware requires the `Authorization` header to be `Bearer <PTT_API_TOKEN>`.
 * On authentication failure the middleware responds with HTTP 401 and a JSON error message.
 */
function verifyApiToken(req, res, next) {
  if (!PTT_API_TOKEN) {
    // Fail-closed: require explicit opt-in for dev bypass when token is unset
    if (process.env.PTT_AUTH_DEV_BYPASS === '1') return next();
    return res.status(401).json({ error: 'Unauthorized: PTT_API_TOKEN not configured' });
  }
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${PTT_API_TOKEN}`) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

let lastBatteryUpdate = 0;

// Battery alert thresholds
const BATTERY_LOW = 22;
const BATTERY_HIGH = 85;
let lastAlertType = null;

/**
 * Sends a gateway battery alert when the battery state transitions into low or high thresholds and tracks the last alert state.
 *
 * If `level` is less than or equal to `BATTERY_LOW` and the device is not charging, sends a low-battery alert and records the alert as `'low'`.
 * If `level` is greater than or equal to `BATTERY_HIGH` and the device is charging, sends a high-battery alert and records the alert as `'high'`.
 * If `level` is between the low and high thresholds, clears the recorded alert state.
 *
 * @param {number} level - Battery percentage (0–100).
 * @param {boolean} charging - True when the device is currently charging.
 */
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

/**
 * Send a battery alert message through the gateway to the main session.
 * @param {string} message - Plain-text alert message to deliver to the MAIN_SESSION via the gateway.
 */
function sendBatteryAlert(message) {
  sendViaGateway(message, MAIN_SESSION, (err) => {
    if (err) console.error(`[${ts()}] Battery alert error: ${err.message}`);
    else console.log(`[${ts()}] 🔔 Battery alert sent: ${message}`);
  });
}

/**
 * Update Home Assistant sensor state for the watch battery and throttle updates.
 *
 * Sends the battery level and charging status to the Home Assistant REST states API for
 * sensor.galaxy_watch_battery, but does nothing if the Home Assistant token is not configured.
 * Updates are rate-limited to at most one request every 5 minutes for positive battery values.
 * Successful updates are logged; network errors are ignored.
 *
 * @param {number} level - Battery percentage (0–100). Values <= 0 are allowed but still subject to throttling.
 * @param {boolean} charging - Whether the device is currently charging.
 */
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
  // Transcript text is intentionally omitted — this is an operational endpoint only.
  // Exposing user speech here would be an avoidable personal-data leak.
  summary.last5 = recentLatencies.slice(-5).map(l => ({
    ts: l.ts, transcriptionMs: l.transcriptionMs, endToEndMs: l.endToEndMs, quickCommand: !!l.quickCommand
  }));
  res.json(summary);
});

app.post('/battery', verifyApiToken, batteryLimiter, (req, res) => {
  const level = req.body?.level ?? -1;
  const charging = req.body?.charging ?? false;
  if (level >= 0) updateHABattery(level, charging);
  res.json({ status: 'ok' });
});

app.post('/text', verifyApiToken, textLimiter, (req, res) => {
  const text = req.body?.text?.trim();
  const sessionKey = req.body?.sessionKey;
  if (!text) return res.status(400).json({ error: 'No text' });
  sendToOpenClaw(text, (err) => {
    if (err) {
      console.error(`[${ts()}] /text send failed: ${err.message}`);
      return res.status(502).json({ error: 'Gateway send failed' });
    }
    return res.json({ status: 'ok' });
  }, sessionKey);
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

  /**
   * Retrieve the numeric session index and associated session state for a given session key, creating and registering a new session if none exists.
   * @param {string} sessionKey - Unique identifier for the session.
   * @returns {{index: number, state: Object}} The session's numeric index and its state object.
   */
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

  /**
   * Send an event object to the connected WebSocket client if the socket is open.
   * @param {Object} event - JSON-serializable event object to serialize and send to the client.
   */
  function send(event) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  send({ event: 'session_switched', session: initialSessionKey, index: targetIndex });

  /**
   * Finalizes the current utterance for a session: builds a WAV from the session's buffered speech, sends it for transcription, emits a `result` event with the transcription (or an error), updates metrics and quick-command counters when applicable, and resets the session state.
   *
   * @param {Object} state - Session state object whose `speechChunks` are consumed for transcription and whose `sessionKey` is used for logging and routing.
   */
  function finishUtteranceForState(state) {
    const pcmData = Buffer.concat(state.speechChunks);
    const wavBuffer = buildWav(pcmData);
    const vadSpeechMs = Math.round(state.speechMs);
    const e2eStart = Date.now();

    transcribeAndSend(wavBuffer, state.sessionKey)
      .then((result) => {
        const endToEndMs = Date.now() - e2eStart;
        const text = typeof result === 'object' ? result.text : result;
        console.log(`[${ts()}] ✅ [${state.sessionKey}] (e2e: ${endToEndMs}ms, len: ${text?.length ?? 0})`);
        send({ event: 'result', status: 'ok', text });

        if (text) {
          // Increment before recordMetric so the count is included in the persisted snapshot
          if (typeof result === 'object' && result.quickCommand) {
            metrics.totalQuickCommands++;
          }
          recordMetric({
            ts: new Date().toISOString(),
            transcriptionMs: endToEndMs,
            vadSpeechMs,
            endToEndMs,
            quickCommand: typeof result === 'object' ? !!result.quickCommand : false
          });
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

  /**
   * Switches the active audio session to the provided session key and handles any in-progress speech on the previously targeted session.
   *
   * If the previously targeted session had an active utterance meeting the minimum speech duration and was not already being transcribed, this finalizes that utterance (marks it transcribing and emits a `vad_end` event) so it will be sent for transcription. If the previous session had speech that did not meet the minimum duration, that partial speech is discarded and the session VAD state is reset. After handling the previous session, the function updates the target session index and emits a `session_switched` event.
   *
   * @param {string} newSessionKey - The session key to switch to (identifies the new target session).
   */
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

  /**
   * Process buffered per-session PCM frames through the VAD and emit speech lifecycle events.
   *
   * Drains complete audio frames from each session's buffer, evaluates voice activity, and
   * transitions session state through pre-speech, speech-start, and speech-end conditions.
   * On speech start it emits a `speech_start` event and buffers pre-speech frames; while in
   * an active utterance it accumulates frames, updates speech/silence timers, extends a
   * stale-speech safety timer, and emits `vad_end` when end conditions (silence threshold,
   * max speech duration, or stale timeout) are met. When an utterance ends this function
   * marks the session as transcribing and invokes finishUtteranceForState to produce a
   * transcription result. Errors during VAD processing send a result error event and are logged.
   *
   * This function also coordinates the global processing state and will re-schedule itself
   * if new complete frames arrive while a pass is not active.
   */
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

                // Arm stale-speech safety valve: if this utterance never reaches a
                // natural end (silence ≥ SILENCE_AFTER_SPEECH_MS or MAX_SPEECH_MS)
                // within STALE_SPEECH_TIMEOUT_MS, force-finish it so the session
                // doesn't hang indefinitely waiting for an end condition that won't fire.
                if (state.staleSpeechTimer) clearTimeout(state.staleSpeechTimer);
                state.staleSpeechTimer = setTimeout(() => {
                  state.staleSpeechTimer = null;
                  if (state.speechStarted && !state.transcribing) {
                    console.warn(`[${ts()}] ⏳ Stale speech timeout (${Math.round(state.speechMs)}ms) — force-ending [index ${index}]`);
                    send({ event: 'vad_end', index });
                    state.transcribing = true;
                    finishUtteranceForState(state);
                  }
                }, STALE_SPEECH_TIMEOUT_MS);
              }
            } else {
              state.consecutiveSpeechFrames = 0;
            }
          } else {
            state.speechChunks.push(Buffer.from(frame));

            if (isSpeech) {
              state.speechMs += FRAME_MS;
              state.silenceMs = 0;
              // Extend stale-speech timer on each active speech frame so it only
              // fires 5s after the LAST speech frame, not the first.
              if (state.staleSpeechTimer) clearTimeout(state.staleSpeechTimer);
              state.staleSpeechTimer = setTimeout(() => {
                state.staleSpeechTimer = null;
                if (state.speechStarted && !state.transcribing) {
                  console.warn(`[${ts()}] ⏳ Stale speech timeout (${Math.round(state.speechMs)}ms) — force-ending [index ${index}]`);
                  send({ event: 'vad_end', index });
                  state.transcribing = true;
                  finishUtteranceForState(state);
                }
              }, STALE_SPEECH_TIMEOUT_MS);
            } else {
              state.silenceMs += FRAME_MS;
            }

            if (Math.round(state.speechMs + state.silenceMs) % 4992 < FRAME_MS) {
              console.log(`[${ts()}] 📊 [${index}] Speech: ${Math.round(state.speechMs)}ms, silence: ${Math.round(state.silenceMs)}ms`);
            }

            if (state.speechMs >= MAX_SPEECH_MS) {
              console.log(`[${ts()}] ⏰ Max speech timeout [${index}]`);
              if (state.staleSpeechTimer) { clearTimeout(state.staleSpeechTimer); state.staleSpeechTimer = null; }
              send({ event: 'vad_end', index });
              state.transcribing = true;
              // resetSessionState is called inside finishUtteranceForState's finally
              // block to avoid a race condition with the async transcription.
              finishUtteranceForState(state);
              continue;
            }

            if (state.silenceMs >= SILENCE_AFTER_SPEECH_MS && state.speechMs >= MIN_SPEECH_MS) {
              console.log(`[${ts()}] 🔴 End (${Math.round(state.speechMs)}ms speech, ${Math.round(state.silenceMs)}ms silence) [${index}]`);
              if (state.staleSpeechTimer) { clearTimeout(state.staleSpeechTimer); state.staleSpeechTimer = null; }
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

/**
 * Determines whether a transcription string is likely a hallucination or non-speech artifact.
 *
 * Considers very short strings, single short tokens, and explicit regex patterns defined
 * in `HALLUCINATION_PATTERNS` as indicators of hallucination.
 *
 * @param {string} text - The transcription text to evaluate.
 * @returns {boolean} `true` if the text is likely a hallucination or non-speech artifact, `false` otherwise.
 */
function isHallucination(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (trimmed.split(/\s+/).length === 1 && trimmed.length < 5) return true;
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

/**
 * Normalize transcribed text and look up a matching quick-command registry entry.
 * @param {string} text - Transcribed text to normalize (lowercase, trimmed, collapsed whitespace, trailing punctuation removed) before lookup.
 * @returns {{command: string}|null} The matched entry as an object containing `command` (the normalized key) merged with the registry entry fields, or `null` if no match is found.
 */
function matchQuickCommand(text) {
  const normalized = text.toLowerCase().trim()
    .replace(/\s+/g, ' ')          // collapse consecutive whitespace
    .replace(/[.?!;:]+$/, '');     // strip trailing punctuation
  if (quickCommands[normalized]) {
    return { command: normalized, ...quickCommands[normalized] };
  }
  return null;
}

// Execute a quick command via gateway (send as chat message, Arthur handles it).
// Routing is fully handled by Arthur based on the message text — the matched
/**
 * Dispatches a quick-command message to the gateway for execution.
 *
 * @param {string} text - The quick command text to send (will be prefixed with a watch marker).
 * @returns {Promise<string>} Resolves with the original `text` when the gateway acknowledges successful delivery, rejects with an error on failure.
 */
function executeQuickCommand(text) {
  return new Promise((resolve, reject) => {
    sendViaGateway(`⌚ ${text}`, MAIN_SESSION, (err) => {
      if (err) return reject(err);
      resolve(text);
    });
  });
}

/**
 * Transcribes a WAV audio buffer using OpenAI Whisper, filters/records hallucinations, matches and optionally executes quick commands, and forwards the resulting text to the gateway.
 *
 * Performs a 30-second application-level timeout for the Whisper request. If the transcription is empty or filtered as a hallucination, resolves to an empty string and increments/persists the hallucination metric. If a quick-command match is found, attempts to execute it via the gateway and resolves with `{ text, quickCommand: true }` on success; on quick-command execution failure, falls back to sending the text to the OpenClaw gateway and resolves with `{ text, quickCommand: false }`. If no quick command matches, sends the transcription to the gateway and resolves with `{ text, quickCommand: false }`.
 *
 * @param {Buffer} wavBuffer - WAV-formatted PCM audio data to transcribe (expected 16 kHz, 16-bit PCM mono).
 * @param {string} sessionKey - Session identifier used when routing the final text to the gateway.
 * @returns {Promise<""|{text: string, quickCommand: boolean}>} Resolves to an empty string when the transcription is empty or filtered; otherwise resolves to an object containing the transcribed `text` and a `quickCommand` boolean indicating whether a quick command was executed. Rejects on network/API or gateway errors.
 */
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
        clearTimeout(whisperTimeout);
        if (apiRes.statusCode !== 200) return reject(new Error(`Whisper ${apiRes.statusCode}: ${data}`));
        const text = data.trim();
        console.log(`[${ts()}] 🗣️ Whisper: [len:${text.length}]`);
        if (!text || text.length < 2) return resolve('');
        if (isHallucination(text)) {
          console.log(`[${ts()}] 🚫 Filtered hallucination: [len:${text.length}]`);
          metrics.totalHallucinations++;
          // Persist the updated hallucination count through the serialised write queue
          const snapshot = JSON.stringify(metrics, null, 2);
          metricsWrite = metricsWrite
            .then(() => fs.promises.writeFile(METRICS_FILE, snapshot))
            .catch((err) => console.error(`[${ts()}] Failed to persist hallucination count: ${err.message}`));
          return resolve('');
        }

        // Check for quick command match
        const quickMatch = matchQuickCommand(text);
        if (quickMatch) {
          console.log(`[${ts()}] 🎯 Quick command match: [len:${text.length}] → ${quickMatch.skill}.${quickMatch.action}`);
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
    // 30-second application-level timeout — if Whisper stalls, destroy the request
    // so state.transcribing is cleared and the frameBuffer doesn't grow unbounded.
    const whisperTimeout = setTimeout(() => {
      apiReq.destroy(new Error('Whisper API timeout after 30s'));
    }, 30000);

    apiReq.on('error', (err) => {
      clearTimeout(whisperTimeout);
      reject(err);
    });
    apiReq.end(body);
  });
}

// Send message to OpenClaw gateway via WebSocket.
// Note: the gateway token is passed as a URL query parameter — this is acceptable
// because the connection is always to the local loopback (127.0.0.1) over the
/**
 * Send a chat message to the gateway and invoke the callback when the gateway acknowledges it.
 *
 * Attempts to deliver `message` to the gateway for `sessionKey`, correlating the request with
 * an idempotency key and waiting up to 30 seconds for an acknowledgement. The provided callback
 * is invoked with `null` on successful acknowledgement, or with an `Error` on timeout, WebSocket
 * error, unexpected close, or a gateway-side failure.
 *
 * @param {string} message - The message payload to send.
 * @param {string} sessionKey - Destination session identifier for the gateway.
 * @param {(function(Error|null):void)=} cb - Optional callback called with `null` on success or an `Error` on failure.
 */
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
    const raw = data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (parseErr) {
      console.error(`[${ts()}] Gateway WS malformed frame: ${parseErr.message} — raw: ${raw.slice(0, 200)}`);
      return;
    }
    // Only treat an ack correlated by idempotency key as success.
    // Compare against the concrete gateway success value ("ok") rather than
    // relying on truthiness — prevents "error" status frames from resolving.
    if (msg.runId === idempotencyKey && msg.status === 'ok') {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        console.log(`[${ts()}] → Gateway send OK [${sessionKey}]`);
        if (cb) cb(null);
      }
    }
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

/**
 * Send a message to the OpenClaw gateway for a specific session, prefixing the message with "⌚ " when the target session appears to be a direct message.
 *
 * @param {string} text - The message text to send.
 * @param {function(Error|null, any=):void} cb - Node-style callback invoked with an error or the gateway response when the send completes or fails.
 * @param {string} [customSessionKey] - Optional session key to target; defaults to MAIN_SESSION when omitted. If the session key includes ":direct:" the message will be prefixed with "⌚ ".
 */
function sendToOpenClaw(text, cb, customSessionKey) {
  const targetSession = customSessionKey || MAIN_SESSION;
  const isDM = targetSession.includes(':direct:');
  const messageText = isDM ? `⌚ ${text}` : text;

  sendViaGateway(messageText, targetSession, cb);
}

/**
 * Format the current time as an ISO-like timestamp with seconds precision.
 * @returns {string} Timestamp string formatted as "YYYY-MM-DD HH:MM:SS".
 */
function ts() { return new Date().toISOString().replace('T', ' ').slice(0, -4); }

// ── Start ──

initVAD().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PTT Server v9 — Containerised`);
    console.log(`  WS: ws://0.0.0.0:${PORT}/ws`);
    console.log(`  HTTP: health, battery, text on :${PORT}`);
    console.log(`  Gateway: ${GATEWAY_URL}`);
    console.log(`  Speech: >${SPEECH_THRESHOLD} | Silence: ${SILENCE_AFTER_SPEECH_MS}ms | Min: ${MIN_SPEECH_MS}ms | MinFrames: ${MIN_SPEECH_FRAMES} | StaleTimeout: ${STALE_SPEECH_TIMEOUT_MS}ms`);
  });
}).catch(err => { console.error('VAD init failed:', err); process.exit(1); });
