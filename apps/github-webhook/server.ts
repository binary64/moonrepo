#!/usr/bin/env node

// github-webhook — GitHub CI notification relay for OpenClaw
//
// Receives GitHub check_suite and workflow_run webhook events.
// When CI completes on a PR, fires a chat.send RPC to the OpenClaw Gateway.
//
// Config (env vars):
//   GITHUB_WEBHOOK_SECRET  — required, HMAC-SHA256 secret for signature verification
//   OPENCLAW_GATEWAY_URL   — default http://localhost:6798
//   OPENCLAW_SESSION_KEY   — required, OpenClaw session key for notification delivery
//   PORT                   — default 3200

import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import Fastify from "fastify";

const PORT = parseInt(process.env.PORT || "3200", 10);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT} (must be 1-65535)`);
  process.exit(1);
}

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "http://localhost:6798";
const SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || "";

if (!WEBHOOK_SECRET) {
  console.error("GITHUB_WEBHOOK_SECRET is required");
  process.exit(1);
}

if (!SESSION_KEY) {
  console.error("OPENCLAW_SESSION_KEY is required");
  process.exit(1);
}

// Validate GATEWAY_URL at startup
let parsedGatewayUrl: URL;
try {
  parsedGatewayUrl = new URL(GATEWAY_URL);
  if (
    parsedGatewayUrl.protocol !== "http:" &&
    parsedGatewayUrl.protocol !== "https:"
  ) {
    throw new Error(`Unsupported protocol: ${parsedGatewayUrl.protocol}`);
  }
} catch (err: unknown) {
  console.error(
    "Invalid OPENCLAW_GATEWAY_URL:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}

// Deduplication: repoFullName+prNumber → lastNotifiedConclusion
const lastNotified = new Map<string, string>();

const GATEWAY_TIMEOUT_MS = parseInt(
  process.env.GATEWAY_TIMEOUT_MS || "10000",
  10,
);
if (!Number.isFinite(GATEWAY_TIMEOUT_MS) || GATEWAY_TIMEOUT_MS < 0) {
  console.error(
    `Invalid GATEWAY_TIMEOUT_MS: ${process.env.GATEWAY_TIMEOUT_MS} (must be >= 0)`,
  );
  process.exit(1);
}

const fastify = Fastify({ logger: false });

// Health check
fastify.get("/health", async () => {
  return { ok: true };
});

// Raw body needed for HMAC signature verification
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (_req, body, done) => {
    done(null, body);
  },
);

fastify.post("/webhook", async (request, reply) => {
  const sig = request.headers["x-hub-signature-256"] as string | undefined;
  if (!sig) {
    console.warn("Missing X-Hub-Signature-256 header");
    return reply.code(401).send({ error: "Missing signature" });
  }

  const rawBody = request.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    console.warn("Webhook payload is not a raw JSON buffer");
    return reply.code(400).send({ error: "Invalid payload type" });
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    console.warn("Invalid webhook signature");
    return reply.code(401).send({ error: "Invalid signature" });
  }

  const event = request.headers["x-github-event"] as string | undefined;
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody.toString());
  } catch (err: unknown) {
    console.error(
      "Failed to parse webhook payload:",
      err instanceof Error ? err.message : String(err),
    );
    return reply.code(400).send({ error: "Invalid JSON payload" });
  }

  try {
    await handleEvent(event || "", payload);
    return reply.code(200).send({ ok: true });
  } catch (err: unknown) {
    console.error(
      "Error handling event:",
      err instanceof Error ? err.message : String(err),
    );
    return reply.code(500).send({ error: "Internal server error" });
  }
});

type PullRequestRef = {
  number: number;
  head: { ref: string; sha: string };
  html_url?: string;
};

async function handleEvent(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (event === "check_suite") {
    const action = payload.action as string;
    if (action !== "completed") return;

    const suite = payload.check_suite as Record<string, unknown>;
    const prs = (suite.pull_requests as PullRequestRef[]) || [];
    if (prs.length === 0) return;

    const conclusion = suite.conclusion as string;
    const suiteName = suite.app
      ? ((suite.app as Record<string, unknown>).name as string)
      : "CI";

    await notifyPRs(
      prs,
      conclusion,
      suiteName,
      payload.repository as Record<string, unknown>,
    );
  } else if (event === "workflow_run") {
    const action = payload.action as string;
    if (action !== "completed") return;

    const run = payload.workflow_run as Record<string, unknown>;
    const prs = (run.pull_requests as PullRequestRef[]) || [];
    if (prs.length === 0) return;

    const conclusion = run.conclusion as string;
    const workflowName = (run.name as string) || "Workflow";

    await notifyPRs(
      prs,
      conclusion,
      workflowName,
      payload.repository as Record<string, unknown>,
    );
  }
}

async function notifyPRs(
  prs: PullRequestRef[],
  conclusion: string,
  checkName: string,
  repo: Record<string, unknown>,
): Promise<void> {
  const repoFullName = (repo?.full_name as string) || "binary64/moonrepo";

  for (const pr of prs) {
    const prNumber = pr.number;
    const branch = pr.head.ref;
    const headSha = pr.head.sha;
    const prUrl =
      pr.html_url || `https://github.com/${repoFullName}/pull/${prNumber}`;

    const dedupeKey = `${repoFullName}-pr-${prNumber}-${headSha}-${conclusion}`;
    const stateKey = `${repoFullName}-pr-${prNumber}-${headSha}`;

    const lastConclusion = lastNotified.get(stateKey);
    if (lastConclusion === conclusion) {
      console.log(
        `Skipping duplicate notification for PR #${prNumber} (${conclusion})`,
      );
      continue;
    }

    const isSuccess = ["success", "neutral", "skipped"].includes(conclusion);
    const emoji = isSuccess ? "✅" : "🔴";
    const message = `${emoji} PR #${prNumber} — ${branch}: ${checkName} ${conclusion}\n${prUrl}`;

    console.log("Notify PR:", prNumber, checkName, conclusion);
    try {
      await sendGatewayMessage(message, dedupeKey);
      lastNotified.set(stateKey, conclusion);
    } catch (err: unknown) {
      console.error(
        "Failed to notify for PR",
        prNumber,
        ":",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function sendGatewayMessage(
  message: string,
  idempotencyKey: string,
): Promise<void> {
  const body = JSON.stringify({
    method: "chat.send",
    params: {
      message,
      sessionKey: SESSION_KEY,
      idempotencyKey,
    },
  });

  const url = new URL("/rpc", parsedGatewayUrl);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || defaultPort,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            console.log(`Gateway accepted message (${status})`);
            resolve();
          } else {
            reject(new Error(`Gateway returned ${status}: ${data}`));
          }
        });
      },
    );

    req.setTimeout(GATEWAY_TIMEOUT_MS, () => {
      req.destroy(
        new Error(`Gateway request timed out after ${GATEWAY_TIMEOUT_MS}ms`),
      );
    });

    req.on("error", (err: Error) => {
      console.error("Gateway request failed:", err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`github-webhook server listening on port ${PORT}`);
});
