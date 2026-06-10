#!/usr/bin/env python3
"""
start-page health proxy.

Runs INSIDE the cluster (Jupiter, on the LAN). The start page is served over
HTTPS, so the browser cannot probe plain-HTTP LAN IPs directly (mixed-content
policy). This service does the probing server-side via raw TCP connect and
exposes the result as same-origin JSON at /healthz, which the page fetches.

Semantics: a target is "up" iff this pod can open a TCP connection to it.
That means "reachable from the cluster", which for these LAN/k8s services is
effectively "is it up". Results are keyed by host:port so the page can derive
the key straight from each tile's URL — no name coupling, rename-safe.

TCP connect (not HTTP GET) is deliberate: it works for every service type the
page lists, including non-HTTP ones (MQTT, SOCKS, etc.).
"""
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# host:port targets — must match the host:port of every lan/k8s tile on the
# start page (index.html CONFIG). The page derives the lookup key from each
# tile's URL, so keep these in sync with the non-ext tiles there.
TARGETS = [
    # Infrastructure
    "192.168.1.201:31000",   # Argo Rollouts
    # Smart Home
    "192.168.1.201:6052",    # ESPHome
    "192.168.1.201:30080",   # Zigbee2MQTT
    "158.220.90.28:8099",    # Bermuda Mapper
    "158.220.90.28:3003",    # Bermuda Tracking
    "192.168.1.201:55123",   # Ring MQTT
    "192.168.1.201:31883",   # Mosquitto
    "192.168.1.201:80",      # Nextcloud
    # Media & Entertainment
    "192.168.1.201:30033",   # TV Portal
    # AI & Voice
    "192.168.1.201:30090",   # TTS Server
    "192.168.1.201:9876",    # Watch PTT
    "192.168.1.187:3001",    # Desktop Portal
    # Network
    "192.168.1.1:80",        # Router
    "192.168.1.201:1080",    # SOCKS Proxy
]

PROBE_TIMEOUT = 2.0      # seconds per TCP connect
SWEEP_INTERVAL = 20      # seconds between full sweeps

CACHE = {"_ts": 0}
LOCK = threading.Lock()


def probe(target):
    host, port = target.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(port)), timeout=PROBE_TIMEOUT):
            return "up"
    except Exception:
        return "down"


def sweep_loop():
    while True:
        results = {}
        threads = []

        def worker(t):
            results[t] = probe(t)

        for t in TARGETS:
            th = threading.Thread(target=worker, args=(t,), daemon=True)
            th.start()
            threads.append(th)
        for th in threads:
            th.join()

        results["_ts"] = int(time.time())
        with LOCK:
            CACHE.clear()
            CACHE.update(results)
        time.sleep(SWEEP_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] in ("/healthz", "/healthz/"):
            with LOCK:
                body = json.dumps(CACHE).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/livez":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # quiet


if __name__ == "__main__":
    threading.Thread(target=sweep_loop, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
