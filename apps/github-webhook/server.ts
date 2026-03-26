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

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import http from 'http';

const PORT = parseInt(process.env.PORT || '3200', 10);
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:6798';
const SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || 'agent:main:telegram:direct:james';

if (!WEBHOOK_SECRET) {
  console.error('GITHUB_WEBHOOK_SECRET is required');
  process.exit(1);
}

// Deduplication: prNumber → lastNotifiedConclusion
const lastNotified = new Map<number, string>();

const app = express();

// Raw body needed for signature verification
app.use(express.raw({ type: 'application/json' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/webhook', (req: Request, res: Response) => {
  // Verify signature
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  if (!sig) {
    console.warn('Missing X-Hub-Signature-256 header');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const body = req.body as Buffer;
  const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    console.warn('Invalid webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Always return 200 after auth passes
  res.status(200).json({ ok: true });

  const event = req.headers['x-github-event'] as string | undefined;
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(body.toString());
  } catch {
    console.error('Failed to parse webhook payload');
    return;
  }

  handleEvent(event || '', payload).catch((err) => {
    console.error('Error handling event:', err);
  });
});

type PullRequestRef = {
  number: number;
  head: { ref: string };
  html_url?: string;
};

async function handleEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  if (event === 'check_suite') {
    const action = payload.action as string;
    if (action !== 'completed') return;

    const suite = payload.check_suite as Record<string, unknown>;
    const prs = (suite.pull_requests as PullRequestRef[]) || [];
    if (prs.length === 0) return;

    const conclusion = suite.conclusion as string;
    const suiteName = suite.app
      ? ((suite.app as Record<string, unknown>).name as string)
      : 'CI';

    await notifyPRs(prs, conclusion, suiteName, payload.repository as Record<string, unknown>);
  } else if (event === 'workflow_run') {
    const action = payload.action as string;
    if (action !== 'completed') return;

    const run = payload.workflow_run as Record<string, unknown>;
    const prs = (run.pull_requests as PullRequestRef[]) || [];
    if (prs.length === 0) return;

    const conclusion = run.conclusion as string;
    const workflowName = run.name as string || 'Workflow';

    await notifyPRs(prs, conclusion, workflowName, payload.repository as Record<string, unknown>);
  }
}

async function notifyPRs(
  prs: PullRequestRef[],
  conclusion: string,
  checkName: string,
  repo: Record<string, unknown>,
): Promise<void> {
  const repoFullName = repo?.full_name as string || 'binary64/moonrepo';

  for (const pr of prs) {
    const prNumber = pr.number;
    const branch = pr.head.ref;
    const prUrl = pr.html_url || `https://github.com/${repoFullName}/pull/${prNumber}`;

    // Dedup
    const lastConclusion = lastNotified.get(prNumber);
    if (lastConclusion === conclusion) {
      console.log(`Skipping duplicate notification for PR #${prNumber} (${conclusion})`);
      continue;
    }
    lastNotified.set(prNumber, conclusion);

    const isSuccess = ['success', 'neutral', 'skipped'].includes(conclusion);
    let message: string;

    if (isSuccess) {
      message = `✅ PR #${prNumber} — ${branch}: all checks green\n${prUrl}`;
    } else {
      message = `🔴 PR #${prNumber} — ${branch}: CI failed (check: ${checkName})\n${prUrl}`;
    }

    console.log(`Notifying for PR #${prNumber}: ${conclusion}`);
    await sendGatewayMessage(message, `gh-webhook-${prNumber}-${conclusion}`);
  }
}

async function sendGatewayMessage(message: string, idempotencyKey: string): Promise<void> {
  const body = JSON.stringify({
    method: 'chat.send',
    params: {
      message,
      sessionKey: SESSION_KEY,
      idempotencyKey,
    },
  });

  const url = new URL('/rpc', GATEWAY_URL);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`Gateway response (${res.statusCode}): ${data}`);
          resolve();
        });
      },
    );

    req.on('error', (err) => {
      console.error('Gateway request failed:', err);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

app.listen(PORT, () => {
  console.log(`github-webhook server listening on port ${PORT}`);
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Session: ${SESSION_KEY}`);
});
