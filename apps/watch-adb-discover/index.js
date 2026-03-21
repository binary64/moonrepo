/**
 * watch-adb-discover — Galaxy Watch wireless ADB port discovery service
 *
 * The Galaxy Watch's wireless ADB port is ephemeral (range 30000-49000) and
 * changes every time the screen sleeps or WiFi reconnects. This service
 * periodically port-scans the watch to find the current port and exposes it
 * via a simple HTTP API so other services (e.g. lan-proxy on Jupiter) can
 * query it without manual intervention.
 *
 * Endpoints:
 *   GET /       → { watch_ip, adb_port, last_scan, online }
 *   GET /health → { ok: true }
 *   POST /scan  → trigger immediate rescan, return result
 */

'use strict';

const http = require('http');
const net = require('net');

const WATCH_IP = process.env.WATCH_IP || '192.168.1.141';
const PORT_MIN = parseInt(process.env.PORT_MIN || '30000', 10);
const PORT_MAX = parseInt(process.env.PORT_MAX || '49000', 10);
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10);
const CONNECT_TIMEOUT_MS = parseInt(process.env.CONNECT_TIMEOUT_MS || '500', 10);
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '200', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3200', 10);

// State
let state = {
  watch_ip: WATCH_IP,
  adb_port: null,
  last_scan: null,
  online: false,
};

let scanInProgress = false;

/**
 * Check if a single TCP port is open.
 * Resolves true if open, false if closed/timeout.
 */
function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, host);
  });
}

/**
 * Scan a list of ports in parallel (up to CHUNK_SIZE at a time).
 * Returns the first open port found, or null.
 */
async function scanPorts(host, ports) {
  for (let i = 0; i < ports.length; i += CHUNK_SIZE) {
    const chunk = ports.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((p) => checkPort(host, p).then((open) => ({ port: p, open })))
    );
    const found = results.find((r) => r.open);
    if (found) return found.port;
  }
  return null;
}

/**
 * Run a full scan of the watch.
 * If the last known port is still open, return it immediately without a full scan.
 */
async function runScan() {
  if (scanInProgress) {
    console.log('[scan] already in progress, skipping');
    return;
  }
  scanInProgress = true;
  const startedAt = Date.now();
  console.log(`[scan] starting scan of ${WATCH_IP} ports ${PORT_MIN}-${PORT_MAX}`);

  try {
    // Smart: check last known port first
    if (state.adb_port !== null) {
      const stillOpen = await checkPort(WATCH_IP, state.adb_port);
      if (stillOpen) {
        console.log(
          `[scan] last known port ${state.adb_port} still open — skipping full scan (${Date.now() - startedAt}ms)`
        );
        state.last_scan = new Date().toISOString();
        state.online = true;
        return;
      }
      console.log(`[scan] last known port ${state.adb_port} closed — running full scan`);
    }

    // Build port list: full range
    const ports = [];
    for (let p = PORT_MIN; p <= PORT_MAX; p++) ports.push(p);

    const found = await scanPorts(WATCH_IP, ports);
    const elapsed = Date.now() - startedAt;

    if (found !== null) {
      console.log(`[scan] found ADB port ${found} on ${WATCH_IP} (${elapsed}ms)`);
      state.adb_port = found;
      state.online = true;
    } else {
      console.log(`[scan] no open ADB port found on ${WATCH_IP} (${elapsed}ms)`);
      state.online = false;
      // Keep last known adb_port so callers have a hint, but mark offline
    }
    state.last_scan = new Date().toISOString();
  } catch (err) {
    console.error(`[scan] error: ${err.message}`);
    state.online = false;
    state.last_scan = new Date().toISOString();
  } finally {
    scanInProgress = false;
  }
}

// HTTP server
const server = http.createServer((req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (method === 'POST' && url === '/scan') {
    runScan()
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(HTTP_PORT, () => {
  console.log(`[server] watch-adb-discover listening on port ${HTTP_PORT}`);
  console.log(`[server] watch target: ${WATCH_IP} ports ${PORT_MIN}-${PORT_MAX}`);
  console.log(
    `[server] scan interval: ${SCAN_INTERVAL_MS}ms, chunk size: ${CHUNK_SIZE}, timeout: ${CONNECT_TIMEOUT_MS}ms`
  );

  // Initial scan on startup
  runScan();

  // Periodic scan
  setInterval(runScan, SCAN_INTERVAL_MS);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
