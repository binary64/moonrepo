import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import rateLimit from "express-rate-limit";

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3080;
const TOKEN = process.env.LAN_BRIDGE_TOKEN;

if (!TOKEN) {
  console.error(
    "FATAL: LAN_BRIDGE_TOKEN not set. Refusing to start without auth.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Auth middleware (skip for /health — needed for k8s probes)
// ---------------------------------------------------------------------------
function auth(req, res, next) {
  if (req.path === "/health") return next();
  const header = req.headers.authorization;
  if (!header || header !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.use(auth);

// ---------------------------------------------------------------------------
// Rate limiting for routes that execute system commands (CodeQL security fix)
// ---------------------------------------------------------------------------
const commandRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// ---------------------------------------------------------------------------
// Device aliases
// ---------------------------------------------------------------------------
const DEVICES = {
  "lounge tv": "192.168.1.90",
  "all speakers": "All Speakers",
  "tv portal": "192.168.1.187",
  "sony bravia": "192.168.1.101",
};

function resolveDevice(name) {
  if (!name) return undefined;
  return DEVICES[name.toLowerCase()] || name;
}

// ---------------------------------------------------------------------------
// POST /cast — Cast media or site to Chromecast
// { device, url, type: "media"|"site" }
// ---------------------------------------------------------------------------
app.post("/cast", commandRateLimiter, async (req, res) => {
  try {
    const { url, type = "media" } = req.body;
    if (!url) {
      return res.status(400).json({ error: "missing required parameter: url" });
    }
    const device = resolveDevice(req.body.device) || "192.168.1.90";
    const cmd = type === "site" ? "cast_site" : "cast";
    const { stdout, stderr } = await execFileAsync(
      "catt",
      ["-d", device, cmd, url],
      { timeout: 30_000 },
    );
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err.message, stderr: err.stderr?.trim() });
  }
});

// ---------------------------------------------------------------------------
// POST /tts — Play audio file on Nest speakers
// { device, url }
// ---------------------------------------------------------------------------
app.post("/tts", commandRateLimiter, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "missing required parameter: url" });
    }
    const device = resolveDevice(req.body.device) || "All Speakers";
    const { stdout, stderr } = await execFileAsync(
      "catt",
      ["-d", device, "cast", url],
      { timeout: 30_000 },
    );
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err.message, stderr: err.stderr?.trim() });
  }
});

// ---------------------------------------------------------------------------
// POST /tv/on — Turn TV on via script
// ---------------------------------------------------------------------------
app.post("/tv/on", commandRateLimiter, async (_req, res) => {
  try {
    const scriptPath =
      process.env.TV_ON_SCRIPT ||
      "/home/user/clawd/skills/chromecast/scripts/tv-on.sh";
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
      timeout: 45_000,
    });
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /tv/off — Turn TV off via script
// ---------------------------------------------------------------------------
app.post("/tv/off", commandRateLimiter, async (_req, res) => {
  try {
    const scriptPath =
      process.env.TV_OFF_SCRIPT ||
      "/home/user/clawd/skills/chromecast/scripts/tv-off.sh";
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
      timeout: 15_000,
    });
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /tv/status — Check TV state
// ---------------------------------------------------------------------------
app.get("/tv/status", commandRateLimiter, async (_req, res) => {
  try {
    const scriptPath =
      process.env.TV_STATUS_SCRIPT ||
      "/home/user/clawd/scripts/tv-app-status.py";
    const { stdout } = await execFileAsync("python3", [scriptPath], {
      timeout: 10_000,
    });
    res.json({ ok: true, status: stdout.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /exec — Run allowlisted command on home LAN node
// { command, args: [] }
// ---------------------------------------------------------------------------
const ALLOWED_COMMANDS = new Set(["catt", "curl", "ping", "ffmpeg", "ffprobe"]);

// ---------------------------------------------------------------------------
// Allowlisted arg patterns per command (allowlist > blocklist)
// Only args matching these patterns are permitted.
// ---------------------------------------------------------------------------
const ALLOWED_ARG_PATTERNS = {
  catt: [/^-d$/, /^cast$/, /^cast_site$/, /^stop$/, /^status$/, /^volume$/],
  curl: [
    /^-s$/,
    /^-S$/,
    /^-f$/,
    /^-L$/,
    /^-o$/,
    /^--max-time$/,
    /^--connect-timeout$/,
  ],
  ping: [/^-c$/, /^-W$/],
  ffmpeg: [
    /^-y$/,
    /^-i$/,
    /^-f$/,
    /^-ac$/,
    /^-ar$/,
    /^-filter:a$/,
    /^-t$/,
    /^-ss$/,
  ],
  ffprobe: [
    /^-v$/,
    /^-show_format$/,
    /^-show_streams$/,
    /^-print_format$/,
    /^-of$/,
  ],
};

// Values (non-flag args) must match safe patterns — no shell metacharacters
const SAFE_VALUE = /^[a-zA-Z0-9_./:@=,\-\s"']+$/;

function validateArgs(command, args) {
  const patterns = ALLOWED_ARG_PATTERNS[command] || [];
  for (const arg of args) {
    // Check if it matches an allowed flag
    const isAllowedFlag = patterns.some((p) => p.test(arg));
    if (isAllowedFlag) continue;
    // Otherwise treat as a value — must match safe pattern
    if (!SAFE_VALUE.test(arg)) {
      return `disallowed arg: ${arg}`;
    }
  }
  return null;
}

app.post("/exec", commandRateLimiter, async (req, res) => {
  try {
    const { command, args = [] } = req.body;
    if (!command || !ALLOWED_COMMANDS.has(command)) {
      return res.status(400).json({
        error: `command not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}`,
      });
    }
    const argError = validateArgs(command, args);
    if (argError) {
      return res.status(400).json({ error: argError });
    }
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 60_000,
    });
    res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: err.message, stderr: err.stderr?.trim() });
  }
});

// ---------------------------------------------------------------------------
// GET /health (unauthenticated — used by k8s probes)
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: "1.0.0" });
});

// ---------------------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`lan-bridge listening on :${PORT}`);
});
