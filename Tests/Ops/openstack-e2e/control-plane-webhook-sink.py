#!/usr/bin/env python3
"""Keeps each body POSTed to it, numbered: what Alertmanager really sends.

Usage: control-plane-webhook-sink.py <port> <folder>
"""

import http.server
import os
import sys

PORT = int(sys.argv[1])
FOLDER = sys.argv[2]
RECEIVED = [0]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        RECEIVED[0] += 1
        path = os.path.join(FOLDER, f"webhook-{RECEIVED[0]:03d}.json")
        with open(path, "wb") as handle:
            handle.write(body)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *arguments):
        pass


http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
