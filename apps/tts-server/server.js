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

const Fastify = require("fastify");
const fastifyRateLimit = require("@fastify/rate-limit");
const crypto = require("node:crypto");
const fs = require("node:fs");

const PORT = process.env.TTS_PORT || 3090;
const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN || "";
const HUME_API_KEY =
  process.env.HUME_API_KEY ||
  (() => {
    const keyPath = `${process.env.HOME}/.config/hume/api_key`;
    try {
      return fs.readFileSync(keyPath, "utf8").trim();
    } catch {
      return "";
    }
  })();

if (!HUME_API_KEY) {
  console.error(
    "FATAL: HUME_API_KEY not set and ~/.config/hume/api_key not found",
  );
  process.exit(1);
}

// Default voice config
const DEFAULT_VOICE = { name: "Arthur", provider: "CUSTOM_VOICE" };

// In-memory store: token → job
const jobs = new Map();

// Cleanup expired jobs (5 min TTL)
const JOB_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.mp3Path)
        try {
          fs.unlinkSync(job.mp3Path);
        } catch {
          // Best-effort cleanup only; the periodic sweep should not crash on stale temp files.
        }
      jobs.delete(token);
    }
  }
}, 60_000);

// ─── Normalise input to utterances array ───
function normaliseUtterances(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  if (Array.isArray(body.utterances) && body.utterances.length > 0) {
    return body.utterances
      .map((u) => ({
        text: String(u.text || "").trim(),
        acting: u.acting || u.description || "",
        voice: u.voice || body.voice || null,
      }))
      .filter((u) => u.text.length > 0);
  }

  if (body.text && typeof body.text === "string") {
    return [
      {
        text: body.text.trim(),
        acting: body.acting || body.description || "",
        voice: body.voice || null,
      },
    ];
  }

  return [];
}

// ─── Setup & Start ───
async function start() {
  const app = Fastify({ logger: false, bodyLimit: 102400 }); // 100KB — matches prior Express limit

  await app.register(fastifyRateLimit, {
    global: true,
    max: 30,
    timeWindow: 60_000,
    skipOnError: false,
    errorResponseBuilder: () => ({ error: "Too many requests" }),
  });

  // Auth preHandler
  const authCheck = async (request, reply) => {
    if (!AUTH_TOKEN) return;
    const provided = (request.headers.authorization || "").replace(
      "Bearer ",
      "",
    );
    if (provided !== AUTH_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };

  // ─── POST /prepare ───
  app.post("/prepare", { preHandler: authCheck }, async (request, reply) => {
    const utterances = normaliseUtterances(request.body);

    if (utterances.length === 0) {
      return reply.code(400).send({
        error: "No utterances provided",
        usage: {
          array: '{ utterances: [{ text: "Hello", acting: "warm" }, ...] }',
          legacy: '{ text: "Hello", acting: "warm" }',
        },
      });
    }

    const totalChars = utterances.reduce((sum, u) => sum + u.text.length, 0);
    if (totalChars > 10000) {
      return reply
        .code(400)
        .send({ error: `Total text too long (${totalChars}/10000 chars)` });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const job = {
      utterances,
      createdAt: Date.now(),
      status: "pending",
      mp3Path: null,
      error: null,
    };

    jobs.set(token, job);

    generateTTS(token, job).catch((err) => {
      console.error(`[${token}] Pre-generation failed:`, err.message);
    });

    const baseUrl = process.env.PUBLIC_URL || `http://192.168.1.201:${PORT}`;
    return reply.send({
      token,
      url: `${baseUrl.replace(/\/+$/, "")}/play/${token}`,
      utteranceCount: utterances.length,
      totalChars,
    });
  });

  // ─── GET /play/:token ───
  // Rate limit: 10 plays/min (Nest usually requests once per prepared token)
  app.get(
    "/play/:token",
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const { token } = request.params;
      const job = jobs.get(token);

      if (!job) {
        return reply.code(404).send({ error: "Token not found or expired" });
      }

      try {
        const deadline = Date.now() + 30_000;
        while (job.status === "pending" || job.status === "generating") {
          if (Date.now() > deadline) {
            return reply.code(504).send({ error: "TTS generation timed out" });
          }
          await sleep(200);
        }

        if (job.status === "error") {
          return reply
            .code(500)
            .send({ error: "TTS generation failed", detail: job.error });
        }

        if (!job.mp3Path || !fs.existsSync(job.mp3Path)) {
          return reply.code(500).send({ error: "MP3 file not found" });
        }

        const stat = fs.statSync(job.mp3Path);
        reply.header("Content-Type", "audio/mpeg");
        reply.header("Content-Length", stat.size);
        reply.header("Cache-Control", "no-cache");

        const stream = fs.createReadStream(job.mp3Path);
        stream.on("end", () => {
          setTimeout(() => {
            try {
              fs.unlinkSync(job.mp3Path);
            } catch {
              // Intentionally ignoring cleanup errors — file removal is best-effort
            }
            jobs.delete(token);
          }, 5000);
        });
        return reply.send(stream);
      } catch (err) {
        console.error("[play] error:", err.message);
        if (!reply.sent)
          return reply.code(500).send({ error: "Internal error" });
      }
    },
  );

  // ─── GET /health ───
  app.get("/health", { config: { rateLimit: false } }, async () => {
    return { status: "ok", jobs: jobs.size, uptime: process.uptime() };
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log("TTS Server listening on :%d", PORT);
  console.log("Hume API key: %s", HUME_API_KEY ? "configured" : "MISSING");
  console.log("Auth: %s", AUTH_TOKEN ? "enabled" : "disabled");
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

// ─── Hume TTS Generation ───
async function generateTTS(token, job) {
  job.status = "generating";
  const outputPath = `/tmp/tts-${token}.mp3`;

  try {
    const humeUtterances = job.utterances.map((u) => {
      const entry = { text: u.text };
      if (u.voice && typeof u.voice === "object") {
        entry.voice = u.voice;
      } else if (u.voice && typeof u.voice === "string") {
        entry.voice = { name: u.voice, provider: "CUSTOM_VOICE" };
      } else {
        entry.voice = { ...DEFAULT_VOICE };
      }
      if (u.acting) entry.description = u.acting;
      return entry;
    });

    const humeAbort = new AbortController();
    const humeTimeout = setTimeout(() => humeAbort.abort(), 30_000);
    let resp;
    try {
      resp = await fetch("https://api.hume.ai/v0/tts", {
        method: "POST",
        headers: {
          "X-Hume-Api-Key": HUME_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          utterances: humeUtterances,
          format: { type: "mp3" },
        }),
        signal: humeAbort.signal,
      });
    } finally {
      clearTimeout(humeTimeout);
    }

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Hume API ${resp.status}: ${body}`);
    }

    const data = await resp.json();
    if (data.status_code) throw new Error(data.message || "Hume error");

    const b64 = data.generations?.[0]?.audio;
    if (!b64) throw new Error("No audio in response");

    const audio = Buffer.from(b64, "base64");
    fs.writeFileSync(outputPath, audio);
    job.mp3Path = outputPath;
    job.status = "ready";
    console.log(
      "[%s] Ready: %d utterances, %d bytes",
      token,
      job.utterances.length,
      audio.length,
    );
  } catch (err) {
    console.error(`[${token}] Hume failed:`, err.message);
    job.status = "error";
    job.error = err.message;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
