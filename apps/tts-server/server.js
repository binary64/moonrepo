/**
 * TTS Server — On-demand Hume AI voice generation for Nest speakers
 *
 * Two-endpoint design:
 *   POST /prepare  — accepts text + acting instructions, returns a short-lived token URL
 *   GET  /play/:token — Nest fetches this, streams back MP3 bytes
 *   GET  /health — health check
 *
 * Flow:
 *   Jupiter → POST /prepare {text, acting} → gets back {url: "http://nuc:3090/play/abc123"}
 *   Jupiter → HA play_media(url) → Nest GETs /play/abc123 → server calls Hume → streams MP3
 *
 * Fallback: Kokoro local TTS if Hume is down
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const app = express();
app.use(express.json());

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

// In-memory store for prepared TTS jobs
// token → { text, acting, voice, createdAt, status, mp3Path }
const jobs = new Map();

// Cleanup old jobs every 5 minutes (expire after 5 min)
const JOB_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.mp3Path) {
        try { fs.unlinkSync(job.mp3Path); } catch {}
      }
      jobs.delete(token);
    }
  }
}, 60_000);

// Auth middleware (skip for /health and /play)
function authCheck(req, res, next) {
  if (!AUTH_TOKEN) return next(); // no auth configured
  const provided = (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── POST /prepare ───
// Body: { text: string, acting?: string, voice?: string }
// Returns: { token: string, url: string }
app.post('/prepare', authCheck, (req, res) => {
  const { text, acting, voice } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text too long (max 5000 chars)' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const job = {
    text: text.trim(),
    acting: acting || '',
    voice: voice || 'Arthur',
    createdAt: Date.now(),
    status: 'pending',
    mp3Path: null,
  };

  jobs.set(token, job);

  // Pre-generate the audio immediately (don't wait for Nest to fetch)
  generateTTS(token, job).catch(err => {
    console.error(`[${token}] Pre-generation failed:`, err.message);
  });

  const host = req.headers.host || `192.168.1.201:${PORT}`;
  res.json({
    token,
    url: `http://${host}/play/${token}`,
  });
});

// ─── GET /play/:token ───
// Nest fetches this. Returns MP3 audio.
app.get('/play/:token', async (req, res) => {
  const { token } = req.params;
  const job = jobs.get(token);

  if (!job) {
    return res.status(404).json({ error: 'Token not found or expired' });
  }

  try {
    // Wait for generation if still in progress (up to 15s)
    const deadline = Date.now() + 15_000;
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

    // Cleanup after serving
    stream.on('end', () => {
      setTimeout(() => {
        try { fs.unlinkSync(job.mp3Path); } catch {}
        jobs.delete(token);
      }, 5000);
    });
  } catch (err) {
    console.error(`[${token}] Play error:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal error' });
    }
  }
});

// ─── GET /health ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    jobs: jobs.size,
    uptime: process.uptime(),
  });
});

// ─── Hume TTS Generation ───
async function generateTTS(token, job) {
  job.status = 'generating';
  const outputPath = `/tmp/tts-${token}.mp3`;

  try {
    const audio = await humeGenerate(job.text, job.acting, job.voice);

    if (audio) {
      fs.writeFileSync(outputPath, audio);
      job.mp3Path = outputPath;
      job.status = 'ready';
      console.log(`[${token}] Hume TTS ready (${audio.length} bytes)`);
      return;
    }

    throw new Error('Empty audio response from Hume');
  } catch (err) {
    console.error(`[${token}] Hume failed:`, err.message);

    // Fallback to Kokoro
    try {
      console.log(`[${token}] Trying Kokoro fallback...`);
      await kokoroGenerate(job.text, outputPath);
      job.mp3Path = outputPath;
      job.status = 'ready';
      console.log(`[${token}] Kokoro fallback ready`);
    } catch (fallbackErr) {
      console.error(`[${token}] Kokoro also failed:`, fallbackErr.message);
      job.status = 'error';
      job.error = `Hume: ${err.message}, Kokoro: ${fallbackErr.message}`;
    }
  }
}

async function humeGenerate(text, acting, voiceName) {
  const utterance = {
    text,
    voice: { name: voiceName || 'Arthur', provider: 'CUSTOM_VOICE' },
  };
  if (acting) {
    utterance.description = acting;
  }

  const resp = await fetch('https://api.hume.ai/v0/tts', {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': HUME_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      utterances: [utterance],
      format: { type: 'mp3' },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Hume API ${resp.status}: ${body}`);
  }

  const data = await resp.json();

  if (data.status_code) {
    throw new Error(data.message || 'Hume error');
  }

  const b64 = data.generations?.[0]?.audio;
  if (!b64) throw new Error('No audio in response');

  return Buffer.from(b64, 'base64');
}

function kokoroGenerate(text, outputPath) {
  // Kokoro fallback not available in container — reject immediately
  return Promise.reject(new Error('Kokoro not available in container'));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TTS Server listening on :${PORT}`);
  console.log(`Hume API key: ${HUME_API_KEY.slice(0, 5)}...`);
  console.log(`Auth: ${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
});
