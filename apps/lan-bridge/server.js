import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";

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
app.post("/cast", async (req, res) => {
	try {
		const { url, type = "media" } = req.body;
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
app.post("/tts", async (req, res) => {
	try {
		const { url } = req.body;
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
app.post("/tv/on", async (_req, res) => {
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
app.post("/tv/off", async (_req, res) => {
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
app.get("/tv/status", async (_req, res) => {
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

// Reject args that look like they write to arbitrary paths
const BLOCKED_ARG_PATTERNS = [
	/^-o$/,
	/^--output$/,
	/^--output=/,
	/^-O$/,
	/^\/etc\//,
	/^\/root\//,
	/^\/var\//,
];

function validateArgs(args) {
	for (const arg of args) {
		for (const pattern of BLOCKED_ARG_PATTERNS) {
			if (pattern.test(arg)) {
				return `blocked arg: ${arg}`;
			}
		}
	}
	return null;
}

app.post("/exec", async (req, res) => {
	try {
		const { command, args = [] } = req.body;
		if (!command || !ALLOWED_COMMANDS.has(command)) {
			return res.status(400).json({
				error: `command not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}`,
			});
		}
		const argError = validateArgs(args);
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
