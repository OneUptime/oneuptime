#!/usr/bin/env python3
"""OneUptime, as far as what a guide starts on this runner can tell.

The deployment guides are followed here with their exact commands, and those commands name a
OneUptime: the install scripts and their files come from it, what the agent collects goes to
it, and Alertmanager posts to it. This answers those addresses the way OneUptime answers them,
and keeps what it is sent:

    GET  /install/<agent>         the install script, as text/plain
    GET  /install/<agent>/<file>  one of its files, from the agent's folder in this checkout
    GET  /otlp/v1/validate        says every ingestion key is good: troubleshoot.sh asks
    POST /otlp/v1/<signal>        handed to a real collector, which decodes it and keeps it
    POST /heartbeat/<key>         kept as a webhook, numbered, exactly as it arrived

It proves what reaches OneUptime, never what OneUptime does with it: the replay tests in
packages/Common/Tests do that, on what this kept.

    fake-oneuptime.py <port> <agent folder> <recording folder> <collector's OTLP/HTTP URL>

Only standard library, because this runs on a bare runner.
"""
import http.server
import json
import os
import sys
import threading
import urllib.error
import urllib.request

PORT = int(sys.argv[1])
AGENT_FOLDER = os.path.realpath(sys.argv[2])
RECORDING = sys.argv[3]
COLLECTOR = sys.argv[4].rstrip("/")

AGENT_PATH = "/install/openstack-agent"
WEBHOOKS = os.path.join(RECORDING, "alertmanager")
REQUESTS_LOG = os.path.join(RECORDING, "fake-oneuptime-requests.txt")
LOCK = threading.Lock()
RECEIVED = [0]

os.makedirs(WEBHOOKS, exist_ok=True)


def noted(line):
    with LOCK:
        with open(REQUESTS_LOG, "a") as handle:
            handle.write(line + "\n")


class Handler(http.server.BaseHTTPRequestHandler):
    def answer(self, status, body=b"", content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        noted(f"{self.command} {self.path.split('?')[0]} {status} {len(body)}")

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", "0")))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/otlp/v1/validate":
            self.answer(200, json.dumps({"valid": True, "keyType": "telemetryIngestionKey"}).encode())
            return
        if path == AGENT_PATH:
            self.serve_agent_file("install.sh")
            return
        if path.startswith(AGENT_PATH + "/"):
            self.serve_agent_file(path[len(AGENT_PATH) + 1 :])
            return
        self.answer(404, b'{"error":"not found"}')

    def serve_agent_file(self, name):
        wanted = os.path.realpath(os.path.join(AGENT_FOLDER, name))
        if not wanted.startswith(AGENT_FOLDER + os.sep) or not os.path.isfile(wanted):
            self.answer(404, b'{"error":"not found"}')
            return
        with open(wanted, "rb") as handle:
            self.answer(200, handle.read(), "text/plain; charset=utf-8")

    def do_POST(self):
        path = self.path.split("?")[0]
        if path.startswith("/heartbeat/"):
            self.keep_webhook()
            return
        if path.startswith("/otlp/v1/"):
            self.forward(path[len("/otlp") :])
            return
        self.body()
        self.answer(404, b'{"error":"not found"}')

    def keep_webhook(self):
        body = self.body()
        with LOCK:
            RECEIVED[0] += 1
            number = RECEIVED[0]
        with open(os.path.join(WEBHOOKS, f"webhook-{number:03d}.json"), "wb") as handle:
            handle.write(body)
        self.answer(200, b'{"status":"ok"}')

    def forward(self, path):
        request = urllib.request.Request(COLLECTOR + path, data=self.body(), method="POST")
        for header in ("Content-Type", "Content-Encoding"):
            value = self.headers.get(header)
            if value:
                request.add_header(header, value)
        try:
            with urllib.request.urlopen(request, timeout=60) as answer:
                self.answer(answer.status, answer.read(), answer.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as error:
            self.answer(error.code, error.read(), error.headers.get("Content-Type", "application/json"))
        except OSError as error:
            # The agent is told to try again, as it would be when a OneUptime is restarting.
            self.answer(503, json.dumps({"error": str(error)}).encode())

    def log_message(self, *arguments):
        pass


http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
