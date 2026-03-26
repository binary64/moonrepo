#!/usr/bin/env node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const PORT = parseInt(process.env.PORT || '3200', 10);
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:6798';
const SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || 'agent:main:telegram:direct:james';
if (!WEBHOOK_SECRET) {
    console.error('GITHUB_WEBHOOK_SECRET is required');
    process.exit(1);
}
// Deduplication: prNumber → lastNotifiedConclusion
const lastNotified = new Map();
const app = (0, express_1.default)();
// Raw body needed for signature verification
app.use(express_1.default.raw({ type: 'application/json' }));
// Health check
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
app.post('/webhook', (req, res) => {
    // Verify signature
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) {
        console.warn('Missing X-Hub-Signature-256 header');
        res.status(401).json({ error: 'Missing signature' });
        return;
    }
    const body = req.body;
    const expected = 'sha256=' + crypto_1.default.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    if (!crypto_1.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        console.warn('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }
    // Always return 200 after auth passes
    res.status(200).json({ ok: true });
    const event = req.headers['x-github-event'];
    let payload;
    try {
        payload = JSON.parse(body.toString());
    }
    catch {
        console.error('Failed to parse webhook payload');
        return;
    }
    handleEvent(event || '', payload).catch((err) => {
        console.error('Error handling event:', err);
    });
});
async function handleEvent(event, payload) {
    if (event === 'check_suite') {
        const action = payload.action;
        if (action !== 'completed')
            return;
        const suite = payload.check_suite;
        const prs = suite.pull_requests || [];
        if (prs.length === 0)
            return;
        const conclusion = suite.conclusion;
        const suiteName = suite.app
            ? suite.app.name
            : 'CI';
        await notifyPRs(prs, conclusion, suiteName, payload.repository);
    }
    else if (event === 'workflow_run') {
        const action = payload.action;
        if (action !== 'completed')
            return;
        const run = payload.workflow_run;
        const prs = run.pull_requests || [];
        if (prs.length === 0)
            return;
        const conclusion = run.conclusion;
        const workflowName = run.name || 'Workflow';
        await notifyPRs(prs, conclusion, workflowName, payload.repository);
    }
}
async function notifyPRs(prs, conclusion, checkName, repo) {
    const repoFullName = repo?.full_name || 'binary64/moonrepo';
    for (const pr of prs) {
        const prNumber = pr.number;
        const branch = pr.head.ref;
        const prUrl = pr.html_url || `https://github.com/${repoFullName}/pull/${prNumber}`;
        // Dedup check — only write after successful send
        const lastConclusion = lastNotified.get(prNumber);
        if (lastConclusion === conclusion) {
            console.log(`Skipping duplicate notification for PR #${prNumber} (${conclusion})`);
            continue;
        }
        const isSuccess = ['success', 'neutral', 'skipped'].includes(conclusion);
        let message;
        if (isSuccess) {
            message = `✅ PR #${prNumber} — ${branch}: all checks green\n${prUrl}`;
        }
        else {
            message = `🔴 PR #${prNumber} — ${branch}: CI failed (check: ${checkName})\n${prUrl}`;
        }
        console.log(`Notifying for PR #${prNumber}: ${conclusion}`);
        await sendGatewayMessage(message, `gh-webhook-${prNumber}-${conclusion}`);
        // Write dedup only after successful send
        lastNotified.set(prNumber, conclusion);
    }
}
async function sendGatewayMessage(message, idempotencyKey) {
    const body = JSON.stringify({
        method: 'chat.send',
        params: {
            message,
            sessionKey: SESSION_KEY,
            idempotencyKey,
        },
    });
    const url = new URL('/rpc', GATEWAY_URL);
    const transport = url.protocol === 'https:' ? https_1.default : http_1.default;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    return new Promise((resolve, reject) => {
        const req = transport.request({
            hostname: url.hostname,
            port: url.port || defaultPort,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                if (status >= 200 && status < 300) {
                    console.log(`Gateway response (${status}): ${data}`);
                    resolve();
                }
                else {
                    const err = new Error(`Gateway returned non-2xx status ${status}: ${data}`);
                    console.error(err.message);
                    reject(err);
                }
            });
        });
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
    // SESSION_KEY intentionally not logged (sensitive routing key)
});
//# sourceMappingURL=server.js.map