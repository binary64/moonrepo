#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import subprocess
import urllib.request
import urllib.error

import sys; sys.dont_write_bytecode = True  # Disable .pyc on read-only ConfigMap
PORT = int(os.environ.get('API_PORT', '8080'))
STATE_DIR = '/state'
LIQUIDSOAP_HOST = os.environ.get('LIQUIDSOAP_HOST', 'liquidsoap.radio-dj.svc.cluster.local')
LIQUIDSOAP_PORT = os.environ.get('LIQUIDSOAP_PORT', '1234')
TTS_SERVER_URL = os.environ.get('TTS_SERVER_URL', 'http://tts-server.tts-server.svc.cluster.local:3090')
TTS_AUTH_TOKEN = os.environ.get('TTS_AUTH_TOKEN', '')

class DJHandler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        elif self.path == '/queue':
            queue_file = os.path.join(STATE_DIR, 'queue.json')
            if os.path.exists(queue_file):
                with open(queue_file) as f:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(f.read().encode())
            else:
                self._send_json({'queue': []})
        elif self.path == '/status':
            status_file = os.path.join(STATE_DIR, 'last-dj.json')
            if os.path.exists(status_file):
                with open(status_file) as f:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(f.read().encode())
            else:
                self._send_json({'status': 'idle'})
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')

    def do_POST(self):
        if self.path == '/speak':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len)
            try:
                data = json.loads(body)
                text = data.get('text', '')
                voice = data.get('voice', 'cara')
            except Exception:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Invalid JSON')
                return

            if not text:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing text')
                return

            # Call dj-commentary.sh
            proc = subprocess.Popen(
                ['/radio/dj-commentary.sh', voice, 'api-call', text],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            stdout, stderr = proc.communicate(timeout=30)
            if proc.returncode == 0:
                self._send_json({'status': 'queued'})
            else:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(stderr or b'Error')
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), DJHandler) as httpd:
        print(f'DJ Brain API listening on :{PORT}')
        httpd.serve_forever()
