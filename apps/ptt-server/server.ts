#!/usr/bin/env node
// PTT Server v10 — Containerised Watch Voice Receiver
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

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import * as ort from 'onnxruntime-node';
import rateLimit from 'express-rate-limit';

const PORT = parseInt(process.env.PORT || '9876', 10);
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

interface QuickCommand {
  skill: string;
  action: string;
  [key: string]: unknown;
}

interface QuickCommandRegistry {
  commands?: Record<string, QuickCommand>;
}

let quickCommands: Record<string, QuickCommand> = {};
try {
  const reg = JSON.parse(fs.readFileSync(QUICK_COMMANDS_PATH, 'utf-8')) as QuickCommandRegistry;
  quickCommands = reg.commands || {};
  console.log(`Loaded ${Object.keys(quickCommands).length} quick commands`);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOENT') {
    console.warn('⚠️ Quick commands registry not found — skipping');
  } else {
    console.error(`Failed to load quick commands from ${QUICK_COMMANDS_PATH}: ${e.message}`);
  }
}

// ── Latency Metrics ──

interface LatencyEntry {
  ts: string;
  transcriptionMs: number;
  vadSpeechMs: number;
  endToEndMs: number;
  quickCommand: boolean;
}

interface Metrics {
  totalUtterances: number;
  totalQuickCommands: number;
  totalHallucinations: number;
  avgTranscriptionMs: number;
  avgVadSpeechMs: number;
  avgEndToEndMs: number;
  p95TranscriptionMs: number;
  p95EndToEndMs: number;
  recentLatencies: LatencyEntry[];
  lastUpdated: string | null;
}

const METRICS_FILE = path.join(__dirname, 'metrics.json');
const metrics: Metrics = {
  totalUtterances: 0,
  totalQuickCommands: 0,
  totalHallucinations: 0,
  avgTranscriptionMs: 0,
  avgVadSpeechMs: 0,
  avgEndToEndMs: 0,
  p95TranscriptionMs: 0,
  p95EndToEndMs: 0,
  recentLatencies: [],
  lastUpdated: null
};

// Load persisted metrics
try {
  const saved = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8')) as Metrics;
  Object.assign(metrics, saved);
} catch {}

// Serialise metrics writes — prevents concurrent calls from persisting stale data
let metricsWrite = Promise.resolve();

function recordMetric(entry: LatencyEntry): void {
  metrics.recentLatencies.push(entry);
  if (metrics.recentLatencies.length > 100) metrics.recentLatencies.shift();
  metrics.totalUtterances++;
  metrics.lastUpdated = new Date().toISOString();

  const latencies = metrics.recentLatencies;
  const transcriptionArr = latencies.map(l => l.transcriptionMs).filter(Boolean).sort((a, b) => a - b);
  const e2eArr = latencies.map(l => l.endToEndMs).filter(Boolean).sort((a, b) => a - b);
  const vadArr = latencies.map(l => l.vadSpeechMs).filter(Boolean);

  if (transcriptionArr.length > 0) {
    metrics.avgTranscriptionMs = Math.round(transcriptionArr.reduce((a, b) => a + b, 0) / transcriptionArr.length);
    metrics.p95TranscriptionMs = transcriptionArr[Math.floor(transcriptionArr.length * 0.95)] || 0;
  }
  if (e2eArr.length > 0) {
    metrics.avgEndToEndMs = Math.round(e2eArr.reduce((a, b) => a + b, 0) / e2eArr.length);
    metrics.p95EndToEndMs = e2eArr[Math.floor(e2eArr.length * 0.95)] || 0;
  }
  if (vadArr.length > 0) {
    metrics.avgVadSpeechMs = Math.round(vadArr.reduce((a, b) => a + b, 0) / vadArr.length);
  }

  const snapshot = JSON.stringify(metrics, null, 2);
  metricsWrite = metricsWrite
    .then(() => fs.promises.writeFile(METRICS_FILE, snapshot))
    .catch((err: Error) => {
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
const MIN_SPEECH_FRAMES = 10; // Silero v6.2 requires 512-sample frames (32ms each). 10 × 32ms = 320ms minimum speech, matching legacy behaviour (was 5 × 96ms = 480ms with 1536-sample frames).
const STALE_SPEECH_TIMEOUT_MS = 5000;
const MAX_SPEECH_MS = 20000;
const PRE_SPEECH_BUFFER_MS = 300;
const FRAME_SAMPLES = 512; // Silero VAD v6.2 only accepts 512-sample frames at 16kHz. Legacy v4 used 1536 — keeping that caused ONNX LSTM tensor shape errors on every inference.
const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

// Silero ONNX model
let ortSession: ort.InferenceSession | null = null;

interface VADState {
  state: ort.Tensor;
  sr: ort.Tensor;
}

async function initVAD(): Promise<void> {
  const bundledModelPath = path.join(__dirname, 'silero_vad_v6.2.onnx');
  let modelPath: string;
  if (fs.existsSync(bundledModelPath)) {
    modelPath = bundledModelPath;
    console.log('Using bundled Silero VAD v6.2 (primary) — confirmed working with onnxruntime-node 1.24.3+');
  } else {
    modelPath = require.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');
    console.warn('⚠️ silero_vad_v6.2.onnx not found — falling back to @ricky0123/vad-node bundled model');
  }
  ortSession = await ort.InferenceSession.create(modelPath);
  console.log(`Silero VAD model loaded: ${path.basename(modelPath)}`);
}

function createVADState(): VADState {
  return {
    state: new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]),
    sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [])
  };
}

async function runVADFrame(vadState: VADState, float32Frame: Float32Array): Promise<number> {
  const input = new ort.Tensor('float32', float32Frame, [1, float32Frame.length]);
  const result = await ortSession!.run({
    input, sr: vadState.sr, state: vadState.state
  });
  vadState.state = result['stateN'] as ort.Tensor;
  return (result['output'].data as Float32Array)[0];
}

interface SessionState {
  sessionKey: string;
  vadState: VADState;
  frameBuffer: Buffer;
  speechStarted: boolean;
  speechMs: number;
  silenceMs: number;
  consecutiveSpeechFrames: number;
  preSpeechRing: Buffer[];
  speechChunks: Buffer[];
  transcribing: boolean;
  preSpeechFrames: number;
  staleSpeechTimer: ReturnType<typeof setTimeout> | null;
}

function createSessionState(sessionKey: string): SessionState {
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
    staleSpeechTimer: null
  };
}

function resetSessionState(state: SessionState): void {
  if (state.staleSpeechTimer) {
    clearTimeout(state.staleSpeechTimer);
    state.staleSpeechTimer = null;
  }
  state.vadState = createVADState();
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

const sessionsLimiter = rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false });
const textLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });
const batteryLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });

const PTT_API_TOKEN = process.env.PTT_API_TOKEN || '';

function verifyApiToken(req: Request, res: Response, next: NextFunction): void {
  if (!PTT_API_TOKEN) {
    if (process.env.PTT_AUTH_DEV_BYPASS === '1') { next(); return; }
    res.status(401).json({ error: 'Unauthorized: PTT_API_TOKEN not configured' });
    return;
  }
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${PTT_API_TOKEN}`) { next(); return; }
  res.status(401).json({ error: 'Unauthorized' });
}

let lastBatteryUpdate = 0;
const BATTERY_LOW = 22;
const BATTERY_HIGH = 85;
let lastAlertType: 'low' | 'high' | null = null;

function checkBatteryAlert(level: number, charging: boolean): void {
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

function sendBatteryAlert(message: string): void {
  sendViaGateway(message, MAIN_SESSION, (err) => {
    if (err) console.error(`[${ts()}] Battery alert error: ${err.message}`);
    else console.log(`[${ts()}] 🔔 Battery alert sent: ${message}`);
  });
}

function updateHABattery(level: number, charging: boolean): void {
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
      charging
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
    res.on('data', (c: string) => body += c);
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log(`[${ts()}] 🔋 Watch battery: ${level}%${charging ? ' ⚡' : ''}`);
      }
    });
  });
  req.on('error', () => {});
  req.end(data);
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'ptt-server', version: 10 });
});

app.get('/metrics', (_req: Request, res: Response) => {
  const { recentLatencies, ...summary } = metrics;
  const summaryOut = {
    ...summary,
    recentCount: recentLatencies.length,
    last5: recentLatencies.slice(-5).map(l => ({
      ts: l.ts, transcriptionMs: l.transcriptionMs, endToEndMs: l.endToEndMs, quickCommand: !!l.quickCommand
    }))
  };
  res.json(summaryOut);
});

app.post('/battery', verifyApiToken, batteryLimiter, (req: Request, res: Response) => {
  const level: number = req.body?.level ?? -1;
  const charging: boolean = req.body?.charging ?? false;
  if (level >= 0) updateHABattery(level, charging);
  res.json({ status: 'ok' });
});

app.post('/text', verifyApiToken, textLimiter, (req: Request, res: Response) => {
  const text: string = req.body?.text?.trim();
  const sessionKey: string | undefined = req.body?.sessionKey;
  if (!text) { res.status(400).json({ error: 'No text' }); return; }
  sendToOpenClaw(text, (err) => {
    if (err) {
      console.error(`[${ts()}] /text send failed: ${err.message}`);
      res.status(502).json({ error: 'Gateway send failed' });
      return;
    }
    res.json({ status: 'ok' });
  }, sessionKey);
});

const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
app.get('/sessions', sessionsLimiter, (_req: Request, res: Response) => {
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    res.json({ sessions });
  } catch {
    res.status(500).json({ error: 'Failed to read sessions.json' });
  }
});

// ── HTTP server + WebSocket ──

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const initialSessionKey = url.searchParams.get('session') || MAIN_SESSION;

  const sessionStates = new Map<number, SessionState>();
  const sessionKeyToIndex = new Map<string, number>();
  let nextIndex = 0;
  let targetIndex = 0;
  let processing = false;
  let pendingData = false;

  function getOrCreateSession(sessionKey: string): { index: number; state: SessionState } {
    if (sessionKeyToIndex.has(sessionKey)) {
      const index = sessionKeyToIndex.get(sessionKey)!;
      return { index, state: sessionStates.get(index)! };
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

  function send(event: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  send({ event: 'session_switched', session: initialSessionKey, index: targetIndex });

  function finishUtteranceForState(state: SessionState): void {
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
      .catch((err: Error) => {
        console.error(`[${ts()}] ❌ ${err.message}`);
        send({ event: 'result', status: 'error', text: '', error: err.message });
      })
      .finally(() => {
        resetSessionState(state);
        if (state.frameBuffer.length >= FRAME_BYTES && !processing) {
          drainFrames();
        }
      });
  }

  function handleSessionSwitch(newSessionKey: string): void {
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

  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; level?: number; charging?: boolean; session?: string };
        if (msg.type === 'battery') {
          if ((msg.level ?? -1) >= 0) updateHABattery(msg.level!, msg.charging ?? false);
        } else if (msg.type === 'switch_session' && msg.session) {
          handleSessionSwitch(msg.session);
        }
      } catch {}
      return;
    }

    const buf = data as Buffer;
    if (buf.length < 4) return;

    const chunkIndex = buf.readUInt32LE(0);
    const pcmData = buf.subarray(4);

    let state = sessionStates.get(chunkIndex);
    if (!state) {
      console.debug(`[${ts()}] Unknown chunkIndex ${chunkIndex}, falling back to targetIndex ${targetIndex}`);
      state = sessionStates.get(targetIndex);
    }
    if (!state) return;

    state.frameBuffer = Buffer.concat([state.frameBuffer, pcmData]);

    if (state.transcribing) return;

    if (!processing) {
      drainFrames();
    } else {
      pendingData = true;
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason ? reason.toString() : '';
    console.log(`[${ts()}] 🔚 WS closed (code: ${code}, reason: ${reasonStr || 'none'})`);

    // Clean close from watch ("done") — grab all buffered audio regardless of VAD state
    // (server-side VAD may be broken; client signals end-of-utterance by closing with "done")
    if (reasonStr === 'done') {
      for (const [, state] of sessionStates) {
        if (state.transcribing) continue;
        let pcmData: Buffer | undefined;
        if (state.speechChunks && state.speechChunks.length > 0) {
          pcmData = Buffer.concat(state.speechChunks);
        } else if (state.frameBuffer && state.frameBuffer.length > 0) {
          pcmData = state.frameBuffer;
        }
        if (!pcmData || pcmData.length < SAMPLE_RATE * 2 * 0.3) {
          console.log(`[${ts()}] 🗑️ No usable audio on close`);
          continue;
        }
        const durationMs = Math.round(pcmData.length / 2 / SAMPLE_RATE * 1000);
        console.log(`[${ts()}] 📤 ${durationMs}ms audio on close → Whisper+route`);
        state.transcribing = true;
        const wavBuffer = buildWav(pcmData);
        transcribeAndRoute(wavBuffer).catch((e: Error) => console.error(`[${ts()}] transcribeAndRoute error: ${e.message}`));
      }
      return;
    }

    // Non-clean close — old VAD-gated path
    for (const [, state] of sessionStates) {
      if (state.speechStarted && state.speechMs >= MIN_SPEECH_MS && !state.transcribing) {
        state.transcribing = true;
        send({ event: 'vad_end' });
        finishUtteranceForState(state);
      }
    }
  });

  ws.on('error', (err: Error) => {
    console.log(`[${ts()}] ⚠️ WS error: ${err.message}`);
  });

  async function drainFrames(): Promise<void> {
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
              finishUtteranceForState(state);
              continue;
            }

            if (state.silenceMs >= SILENCE_AFTER_SPEECH_MS && state.speechMs >= MIN_SPEECH_MS) {
              console.log(`[${ts()}] 🔴 End (${Math.round(state.speechMs)}ms speech, ${Math.round(state.silenceMs)}ms silence) [${index}]`);
              if (state.staleSpeechTimer) { clearTimeout(state.staleSpeechTimer); state.staleSpeechTimer = null; }
              send({ event: 'vad_end', index });
              state.transcribing = true;
              finishUtteranceForState(state);
              continue;
            }
          }
        }
      }
    } catch (err) {
      const e = err as Error;
      console.error(`[${ts()}] ⚠️ VAD error: ${e.message}`);
      send({ event: 'result', status: 'error', text: '', error: 'VAD failed' });
    } finally {
      processing = false;
      if (pendingData) {
        pendingData = false;
        for (const [, state] of sessionStates) {
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

function pcm16ToFloat32(buf: Buffer): Float32Array {
  const len = buf.length / 2;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = buf.readInt16LE(i * 2) / 32768.0;
  return out;
}

function buildWav(pcm: Buffer): Buffer {
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

const HALLUCINATION_PATTERNS: RegExp[] = [
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

function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (trimmed.split(/\s+/).length === 1 && trimmed.length < 5) return true;
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

function matchQuickCommand(text: string): (QuickCommand & { command: string }) | null {
  const normalized = text.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!;:]+$/, '');
  if (quickCommands[normalized]) {
    return { command: normalized, ...quickCommands[normalized] };
  }
  return null;
}

function executeQuickCommand(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sendViaGateway(`⌚ ${text}`, MAIN_SESSION, (err) => {
      if (err) return reject(err);
      resolve(text);
    });
  });
}

interface TranscribeResult {
  text: string;
  quickCommand: boolean;
}

function transcribeAndSend(wavBuffer: Buffer, sessionKey: string): Promise<TranscribeResult | string> {
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
      apiRes.on('data', (c: string) => data += c);
      apiRes.on('end', () => {
        clearTimeout(whisperTimeout);
        if (apiRes.statusCode !== 200) return reject(new Error(`Whisper ${apiRes.statusCode}: ${data}`));
        const text = data.trim();
        console.log(`[${ts()}] 🗣️ Whisper: [len:${text.length}]`);
        if (!text || text.length < 2) return resolve('');
        if (isHallucination(text)) {
          console.log(`[${ts()}] 🚫 Filtered hallucination: [len:${text.length}]`);
          metrics.totalHallucinations++;
          const snapshot = JSON.stringify(metrics, null, 2);
          metricsWrite = metricsWrite
            .then(() => fs.promises.writeFile(METRICS_FILE, snapshot))
            .catch((err: Error) => console.error(`[${ts()}] Failed to persist hallucination count: ${err.message}`));
          return resolve('');
        }

        const quickMatch = matchQuickCommand(text);
        if (quickMatch) {
          console.log(`[${ts()}] 🎯 Quick command match: [len:${text.length}] → ${quickMatch.skill}.${quickMatch.action}`);
          executeQuickCommand(text)
            .then(() => resolve({ text, quickCommand: true }))
            .catch((err: Error) => {
              console.error(`[${ts()}] Quick command failed, falling back to LLM: ${err.message}`);
              sendToOpenClaw(text, (sendErr) => sendErr ? reject(sendErr) : resolve({ text, quickCommand: false }), sessionKey);
            });
          return;
        }

        sendToOpenClaw(text, (err) => err ? reject(err) : resolve({ text, quickCommand: false }), sessionKey);
      });
    });

    const whisperTimeout = setTimeout(() => {
      apiReq.destroy(new Error('Whisper API timeout after 30s'));
    }, 30000);

    apiReq.on('error', (err: Error) => {
      clearTimeout(whisperTimeout);
      reject(err);
    });
    apiReq.end(body);
  });
}

function sendViaGateway(message: string, sessionKey: string, cb: (err: Error | null) => void): void {
  const wsUrl = `${GATEWAY_URL}/gateway?token=${GATEWAY_TOKEN}`;
  const idempotencyKey = `watch-ptt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let resolved = false;
  const ws = new WebSocket(wsUrl);
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      ws.close();
      console.error(`[${ts()}] Gateway WS timeout`);
      cb(new Error('timeout'));
    }
  }, 30000);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      method: 'chat.send',
      params: { message, sessionKey, idempotencyKey }
    }));
  });

  ws.on('message', (data: Buffer | string) => {
    const raw = data.toString();
    let msg: { runId?: string; status?: string };
    try {
      msg = JSON.parse(raw);
    } catch (parseErr) {
      console.error(`[${ts()}] Gateway WS malformed frame: ${(parseErr as Error).message} — raw: ${raw.slice(0, 200)}`);
      return;
    }
    if (msg.runId === idempotencyKey && msg.status === 'ok') {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        console.log(`[${ts()}] → Gateway send OK [${sessionKey}]`);
        cb(null);
      }
    }
  });

  ws.on('error', (err: Error) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      console.error(`[${ts()}] Gateway WS error: ${err.message}`);
      cb(err);
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      const reasonStr = reason ? reason.toString() : 'none';
      console.error(`[${ts()}] Gateway WS closed unexpectedly (code: ${code}, reason: ${reasonStr})`);
      cb(new Error(`Gateway WebSocket closed unexpectedly (code: ${code})`));
    }
  });
}

function sendToOpenClaw(text: string, cb: (err: Error | null) => void, customSessionKey?: string): void {
  const targetSession = customSessionKey || MAIN_SESSION;
  const isDM = targetSession.includes(':direct:');
  const messageText = isDM ? `⌚ ${text}` : text;
  sendViaGateway(messageText, targetSession, cb);
}

// ── LLM-powered session routing ───────────────────────────────────────────────
const ROUTING_OPTIONS: Array<{ session: string; label: string; desc: string }> = [
  { session: 'agent:main:telegram:direct:james',         label: 'James DM',        desc: 'General questions, personal tasks, anything not clearly matching a project' },
  { session: 'agent:main:telegram:group:-5166572823',    label: 'arthur-haiku',     desc: 'moonrepo, k8s, kubernetes, CI, PRs, infra, deployments, ArgoCD, Docker, cluster, Jupiter, NUC' },
  { session: 'agent:main:telegram:group:-5173870517',    label: 'arthur-saas',      desc: 'SaaS business ideas, Notion, biz projects' },
  { session: 'agent:main:telegram:group:-5297868919',    label: 'arthur-smarthome', desc: 'Home Assistant, Nest speakers, lights, Roomba, ESPHome, Zigbee, MQTT, home automation' },
  { session: 'agent:main:telegram:group:-5175546187',    label: 'arthur-tv-portal', desc: 'TV portal, Chromecast, dashboard, Android TV, whiteboard' },
  { session: 'agent:main:telegram:group:-5182444525',    label: 'arthur-watch',     desc: 'Watch PTT, watch app, ptt-server, watch development' },
];

async function pickSessionViaLLM(text: string): Promise<string> {
  const optionsList = ROUTING_OPTIONS.map((o, i) => `${i + 1}. "${o.label}" — ${o.desc}`).join('\n');
  const prompt = `You are a routing assistant. Given a voice message transcription, pick the best session to route it to.\n\nSessions:\n${optionsList}\n\nTranscription: "${text}"\n\nReply with ONLY the number (1-${ROUTING_OPTIONS.length}) of the best session. No explanation.`;

  return new Promise<string>((resolve) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reply: string = json.choices?.[0]?.message?.content?.trim() ?? '';
          const idx = parseInt(reply, 10) - 1;
          if (idx >= 0 && idx < ROUTING_OPTIONS.length) {
            console.log(`[${ts()}] 🧠 Routed "${text.slice(0, 40)}" → ${ROUTING_OPTIONS[idx].label}`);
            resolve(ROUTING_OPTIONS[idx].session);
          } else {
            console.warn(`[${ts()}] ⚠️ LLM returned unexpected: "${reply}" — defaulting to James DM`);
            resolve(ROUTING_OPTIONS[0].session);
          }
        } catch (e) {
          console.error(`[${ts()}] LLM parse error: ${(e as Error).message}`);
          resolve(ROUTING_OPTIONS[0].session);
        }
      });
    });
    req.on('error', (e: Error) => { console.error(`[${ts()}] LLM routing error: ${e.message}`); resolve(ROUTING_OPTIONS[0].session); });
    req.setTimeout(8000, () => { req.destroy(); resolve(ROUTING_OPTIONS[0].session); });
    req.end(body);
  });
}

// Transcribe raw PCM buffer and route via LLM, echo to Telegram immediately
async function transcribeAndRoute(wavBuffer: Buffer): Promise<void> {
  let text: string;
  try {
    const result = await transcribeAndSend(wavBuffer, MAIN_SESSION);
    text = typeof result === 'object' ? (result as { text: string }).text : result as string;
  } catch (e) {
    console.error(`[${ts()}] ❌ Whisper failed: ${(e as Error).message}`);
    return;
  }
  if (!text || text.length < 2) { console.log(`[${ts()}] 🚫 Empty transcription, skipping`); return; }
  if (isHallucination(text)) { console.log(`[${ts()}] 🚫 Hallucination: "${text}"`); return; }
  console.log(`[${ts()}] 🗣️ "${text}"`);

  // 1. Echo to James's DM immediately (he sees it on Telegram)
  sendViaGateway(`⌚ ${text}`, 'agent:main:telegram:direct:james', (err) => {
    if (err) console.error(`[${ts()}] Echo failed: ${err.message}`);
    else console.log(`[${ts()}] 📱 Echoed to James DM`);
  });

  // 2. LLM picks best session
  const routedSession = await pickSessionViaLLM(text);

  // 3. Post ⌚ turn to routed session — triggers agent reply
  sendViaGateway(`⌚ ${text}`, routedSession, (err) => {
    if (err) console.error(`[${ts()}] Turn failed: ${err.message}`);
    else console.log(`[${ts()}] ✅ Turn sent to ${routedSession}`);
  });
}

function ts(): string { return new Date().toISOString().replace('T', ' ').slice(0, -4); }

// ── Start ──

initVAD().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Watch PTT v10 — Containerised Voice Receiver`);
    console.log(`  WS: ws://0.0.0.0:${PORT}/ws`);
    console.log(`  HTTP: health, battery, text on :${PORT}`);
    console.log(`  Speech: >${SPEECH_THRESHOLD} | Silence: ${SILENCE_AFTER_SPEECH_MS}ms | Min: ${MIN_SPEECH_MS}ms`);
  });
}).catch((err: Error) => { console.error('VAD init failed:', err); process.exit(1); });
