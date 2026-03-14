/**
 * TTS Server — On-demand Hume AI voice generation for Nest speakers
 *
 * Two-endpoint design:
 *   POST /prepare  — accepts utterances array with per-segment acting, returns a token URL
 *   GET  /play/:token — Nest fetches this, streams back MP3 bytes
 *   GET  /health — health check
 *
 * Utterances format (mirrors Hume API):
 *   { utterances: [{ text: "Hello", acting: "warm" }, { text: "News!", acting: "excited" }] }
 *
 * Legacy format still supported:
 *   { text: "Hello", acting: "warm" }  →  converted to single-element utterances array
 *
 * Flow:
 *   Jupiter → POST /prepare {utterances} → gets back {url: "http://nuc:3090/play/abc123"}
 *   Jupiter → HA play_media(url) → Nest GETs /play/abc123 → server calls Hume → streams MP3
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json({ limit: '100kb' }));

const PORT = process.env.TTS_PORT || 3090;
const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN || '';
const HUME_API_KEY = process.env.HUME_API_KEY || (() => {
  const keyPath = `${process.env.HOME}/.config/hume/api_key`;
  try { return fs.readFileSync(keyPath, 'utf8').trim(); }
  catch { return ''; }
})();

if (!HUME_API_KEY) {
  console.error('FATAL: HUME_API_KEY not set and ~/.config/hume/api_key not found');
  process.exit(1);
}

// Default voice config
const DEFAULT_VOICE = { name: 'Arthur', provider: 'CUSTOM_VOICE' };

// Rate limiting — exempt /health
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests' },
});
app.use(limiter);

// In-memory store: token → job
const jobs = new Map();

// Cleanup expired jobs (5 min TTL)
const JOB_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.mp3Path) try { fs.unlinkSync(job.mp3Path); } catch {}
      jobs.delete(token);
    }
  }
}, 60_000);

// Auth middleware
function authCheck(req, res, next) {
  if (!AUTH_TOKEN) return next();
  const provided = (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Normalise input to utterances array ───
function normaliseUtterances(body) {
  // New format: { utterances: [{ text, acting?, voice? }] }
  if (Array.isArray(body.utterances) && body.utterances.length > 0) {
    return body.utterances.map(u => ({
      text: String(u.text || '').trim(),
      acting: u.acting || u.description || '',
      voice: u.voice || body.voice || null,
    })).filter(u => u.text.length > 0);
  }

  // Legacy format: { text, acting?, voice? }
  if (body.text && typeof body.text === 'string') {
    return [{
      text: body.text.trim(),
      acting: body.acting || body.description || '',
      voice: body.voice || null,
    }];
  }

  return [];
}

// ─── POST /prepare ───
app.post('/prepare', authCheck, (req, res) => {
  const utterances = normaliseUtterances(req.body);

  if (utterances.length === 0) {
    return res.status(400).json({
      error: 'No utterances provided',
      usage: {
        array: '{ utterances: [{ text: "Hello", acting: "warm" }, ...] }',
        legacy: '{ text: "Hello", acting: "warm" }',
      },
    });
  }

  // Validate total text length
  const totalChars = utterances.reduce((sum, u) => sum + u.text.length, 0);
  if (totalChars > 10000) {
    return res.status(400).json({ error: `Total text too long (${totalChars}/10000 chars)` });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const job = {
    utterances,
    createdAt: Date.now(),
    status: 'pending',
    mp3Path: null,
    error: null,
  };

  jobs.set(token, job);

  // Pre-generate immediately
  generateTTS(token, job).catch(err => {
    console.error(`[${token}] Pre-generation failed:`, err.message);
  });

  const host = req.headers.host || `192.168.1.201:${PORT}`;
  res.json({
    token,
    url: `http://${host}/play/${token}`,
    utteranceCount: utterances.length,
    totalChars,
  });
});

// ─── GET /play/:token ───
app.get('/play/:token', async (req, res) => {
  const { token } = req.params;
  const job = jobs.get(token);

  if (!job) {
    return res.status(404).json({ error: 'Token not found or expired' });
  }

  try {
    // Wait for generation (up to 30s for multi-utterance)
    const deadline = Date.now() + 30_000;
    while (job.status === 'pending' || job.status === 'generating') {
      if (Date.now() > deadline) {
        return res.status(504).json({ error: 'TTS generation timed out' });
      }
      await sleep(200);
    }

    if (job.status === 'error') {
      return res.status(500).json({ error: 'TTS generation failed', detail: job.error });
    }

    if (!job.mp3Path || !fs.existsSync(job.mp3Path)) {
      return res.status(500).json({ error: 'MP3 file not found' });
    }

    const stat = fs.statSync(job.mp3Path);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache');

    const stream = fs.createReadStream(job.mp3Path);
    stream.pipe(res);

    stream.on('end', () => {
      setTimeout(() => {
        try { fs.unlinkSync(job.mp3Path); } catch {}
        jobs.delete(token);
      }, 5000);
    });
  } catch (err) {
    console.error('[play] error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /health ───
app.get('/health', (req, res) => {
  res.json({ status: 'ok', jobs: jobs.size, uptime: process.uptime() });
});

// ─── Hume TTS Generation ───
async function generateTTS(token, job) {
  job.status = 'generating';
  const outputPath = `/tmp/tts-${token}.mp3`;

  try {
    // Build Hume utterances array — each segment gets its own acting instructions
    const humeUtterances = job.utterances.map(u => {
      const entry = {
        text: u.text,
        voice: u.voice
          ? { name: u.voice, provider: 'CUSTOM_VOICE' }
          : { ...DEFAULT_VOICE },
      };
      if (u.acting) entry.description = u.acting;
      return entry;
    });

    const resp = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': HUME_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: humeUtterances,
        format: { type: 'mp3' },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Hume API ${resp.status}: ${body}`);
    }

    const data = await resp.json();
    if (data.status_code) throw new Error(data.message || 'Hume error');

    // Hume returns one audio per generation — with multiple utterances
    // they're concatenated into a single audio output
    const b64 = data.generations?.[0]?.audio;
    if (!b64) throw new Error('No audio in response');

    const audio = Buffer.from(b64, 'base64');
    fs.writeFileSync(outputPath, audio);
    job.mp3Path = outputPath;
    job.status = 'ready';
    console.log('[%s] Ready: %d utterances, %d bytes', token, job.utterances.length, audio.length);
  } catch (err) {
    console.error(`[${token}] Hume failed:`, err.message);
    job.status = 'error';
    job.error = err.message;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log('TTS Server listening on :%d', PORT);
  console.log('Hume API key: %s', HUME_API_KEY ? 'configured' : 'MISSING');
  console.log('Auth: %s', AUTH_TOKEN ? 'enabled' : 'disabled');
});
