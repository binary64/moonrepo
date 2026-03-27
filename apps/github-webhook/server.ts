#!/usr/bin/env node

// github-webhook — GitHub CI notification relay for OpenClaw
//
// Receives GitHub check_suite and workflow_run webhook events.
// When CI completes on a PR, fires a chat.send RPC to the OpenClaw Gateway.
//
// Config (env vars):
//   GITHUB_WEBHOOK_SECRET  — required, HMAC-SHA256 secret for signature verification
//   OPENCLAW_GATEWAY_URL   — default http://localhost:6798
//   OPENCLAW_SESSION_KEY   — default agent:main:telegram:direct:james
//   PORT                   — default 3200

import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import express, { type Request, type Response } from "express";

const PORT = parseInt(process.env.PORT || "3200", 10);
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "http://localhost:6798";
const SESSION_KEY =
  process.env.OPENCLAW_SESSION_KEY || "agent:main:telegram:direct:james";

if (!WEBHOOK_SECRET) {
  console.error("GITHUB_WEBHOOK_SECRET is required");
  process.exit(1);
}

// Deduplication: repoFullName+prNumber → lastNotifiedConclusion
// Keyed by repo+PR to avoid cross-repo collisions on shared PR numbers.
// Written only after successful gateway delivery to avoid suppressing retries on failure.
const lastNotified = new Map<string, string>();

const GATEWAY_TIMEOUT_MS = parseInt(
  process.env.GATEWAY_TIMEOUT_MS || "10000",
  10,
);

const app = express();

// Raw body needed for HMAC signature verification
app.use(express.raw({ type: "application/json" }));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/webhook", async (req: Request, res: Response) => {
  // Verify HMAC-SHA256 signature
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig) {
    console.warn("Missing X-Hub-Signature-256 header");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = req.body;
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : typeof rawBody === "string" || rawBody instanceof Uint8Array
      ? Buffer.from(rawBody)
      : null;
  if (!body) {
    console.warn("Webhook payload is not a raw JSON buffer");
    res.status(400).json({ error: "Invalid payload type" });
    return;
  }
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

  // Guard against length mismatch before timingSafeEqual (throws on unequal lengths)
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    console.warn("Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.headers["x-github-event"] as string | undefined;
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(body.toString());
  } catch (err: unknown) {
    console.error(
      "Failed to parse webhook payload:",
      err instanceof Error ? err.message : String(err),
    );
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  // Await processing before responding so GitHub retries on failure (non-2xx).
  // Return 200 only when the event was handled successfully; 500 on error causes
  // GitHub to re-deliver with exponential back-off.
  try {
    await handleEvent(event || "", payload);
    res.status(200).json({ ok: true });
  } catch (err: unknown) {
    console.error(
      "Error handling event:",
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

type PullRequestRef = {
  number: number;
  head: { ref: string };
  html_url?: string;
};

/**
 * Routes an incoming GitHub webhook event to the appropriate handler.
 * Only check_suite and workflow_run completed events are acted upon.
 *
 * @param event - The X-GitHub-Event header value
 * @param payload - The parsed webhook payload
 */
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

/**
 * Sends a notification for each PR in the list, respecting deduplication.
 * Dedup state is written only after successful gateway delivery.
 *
 * @param prs - Pull request refs from the webhook payload
 * @param conclusion - The check conclusion (success, failure, cancelled, etc.)
 * @param checkName - The name of the check suite or workflow
 * @param repo - The repository object from the payload
 */
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
    const prUrl =
      pr.html_url || `https://github.com/${repoFullName}/pull/${prNumber}`;

    // Dedupe key is scoped to repo+PR+conclusion to be globally unique across repos
    const dedupeKey = `${repoFullName}-pr-${prNumber}-${conclusion}`;
    const stateKey = `${repoFullName}-pr-${prNumber}`;

    // Skip if we already successfully delivered this conclusion for this PR
    const lastConclusion = lastNotified.get(stateKey);
    if (lastConclusion === conclusion) {
      console.log(
        `Skipping duplicate notification for PR #${prNumber} (${conclusion})`,
      );
      continue;
    }

    const isSuccess = ["success", "neutral", "skipped"].includes(conclusion);
    let message: string;

    if (isSuccess) {
      message = `✅ PR #${prNumber} — ${branch}: all checks green\n${prUrl}`;
    } else {
      message = `🔴 PR #${prNumber} — ${branch}: CI failed (check: ${checkName})\n${prUrl}`;
    }

    console.log(`Notifying for PR #${prNumber}: ${conclusion}`);
    // Only mark as sent after successful delivery
    await sendGatewayMessage(message, dedupeKey);
    lastNotified.set(stateKey, conclusion);
  }
}

/**
 * Sends a message to the OpenClaw Gateway via the chat.send RPC method.
 * Supports both HTTP and HTTPS gateway URLs.
 * Rejects on non-2xx responses so callers can handle failures.
 *
 * @param message - The message text to deliver
 * @param idempotencyKey - Unique key to prevent duplicate delivery
 */
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

  const url = new URL("/rpc", GATEWAY_URL);
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

    req.on("error", (err) => {
      console.error("Gateway request failed:", err);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

app.listen(PORT, () => {
  console.log(`github-webhook server listening on port ${PORT}`);
  // Intentionally omit SESSION_KEY from logs — it is sensitive routing config
});
