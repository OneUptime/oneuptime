#!/usr/bin/env python3
"""A backend for the HAProxy drills: answers /healthcheck with 200, anything else as told.

Usage: control-plane-backend.py <port> <file holding the status to answer with>
"""

import http.server
import sys

PORT = int(sys.argv[1])
STATUS_FILE = sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthcheck":
            status = 200
        else:
            with open(STATUS_FILE, encoding="utf-8") as handle:
                status = int(handle.read().strip())
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *arguments):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
