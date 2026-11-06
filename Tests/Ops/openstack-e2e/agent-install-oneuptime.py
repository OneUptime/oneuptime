#!/usr/bin/env python3
"""A stand-in for the OneUptime an installed OpenStack agent reports to.

It does the three things an install asks of a OneUptime, and answers them as the real one does:

  GET  /install/openstack-agent[/<file>]  the script and its files as plain text, and only the
                                          files the real one lists (InstallScripts.ts)
  POST /otlp/v1/*                         401 for any key but the one it was given, and otherwise
                                          keeps what arrived
  GET  /otlp/v1/validate                  whether a key is good, for troubleshoot.sh

What arrives goes in <folder>/requests.jsonl, a line per request, read from the OTLP protobuf
rather than searched for strings: which resource attributes each batch carried, which metrics, how
many datapoints, in which regions. <folder>/bodies/ keeps the bodies themselves, unzipped, so a test
can put them through the real ingest. agent-install-check.py asks the file questions.

Usage: ONEUPTIME_STAND_IN_KEY=<ingestion key> agent-install-oneuptime.py <port> <folder> <served folder> <files list>

The key is in its environment because the rig checks that no secret is on any command line, and
this is one more command line. <served folder> is read on every request, so the rig releases a new version by repointing it. <files
list> is a file naming, one per line, what the real OneUptime serves: a file it does not list is a
404 here too, so an install.sh asking for one fails here, and not on a customer's machine.
"""

import gzip
import json
import os
import struct
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INSTALL_PREFIX = "/install/openstack-agent"
# Plenty for a run: what the rig keeps is to replay, and a body is tens of kilobytes at most.
MAX_BODY_BYTES_KEPT = 64 * 1024 * 1024


def fields(buffer):
    """The (number, wire type, value) of each field of one protobuf message."""
    position = 0
    while position < len(buffer):
        key, position = varint(buffer, position)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, position = varint(buffer, position)
        elif wire == 1:
            value, position = buffer[position : position + 8], position + 8
        elif wire == 2:
            length, position = varint(buffer, position)
            value, position = buffer[position : position + length], position + length
        elif wire == 5:
            value, position = buffer[position : position + 4], position + 4
        else:
            raise ValueError(f"wire type {wire} at byte {position}")
        yield number, wire, value


def varint(buffer, position):
    shift = 0
    value = 0
    while True:
        byte = buffer[position]
        position += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, position
        shift += 7


def any_value(buffer):
    """opentelemetry.proto.common.v1.AnyValue, as what Python would call it."""
    for number, wire, value in fields(buffer):
        if number == 1 and wire == 2:
            return value.decode("utf-8", "replace")
        if number == 2:
            return bool(value)
        if number == 3:
            return value
        if number == 4 and wire == 1:
            return struct.unpack("<d", value)[0]
    return None


def key_value(buffer):
    """opentelemetry.proto.common.v1.KeyValue."""
    key, value = "", None
    for number, _, field in fields(buffer):
        if number == 1:
            key = field.decode("utf-8", "replace")
        elif number == 2:
            value = any_value(field)
    return key, value


def data_point(buffer):
    """NumberDataPoint: its value, and which region it says it is from."""
    value, region = None, None
    for number, _, field in fields(buffer):
        if number == 4:
            value = struct.unpack("<d", field)[0]
        elif number == 6:
            value = struct.unpack("<q", field)[0]
        elif number == 7:
            key, attribute = key_value(field)
            if key == "openstack.region.name":
                region = attribute
    return value, region


def metric(buffer, into):
    """Metric: its name, how many datapoints, its regions, and its last value."""
    name, points, regions, last = "", 0, set(), None
    for number, wire, field in fields(buffer):
        if number == 1:
            name = field.decode("utf-8", "replace")
        elif number in (5, 7) and wire == 2:
            # Gauge and Sum: their datapoints are field 1 of each.
            for inner, _, point in fields(field):
                if inner == 1:
                    last, region = data_point(point)
                    points += 1
                    if region is not None:
                        regions.add(region)
    entry = into.setdefault(name, {"points": 0, "regions": [], "last": None})
    entry["points"] += points
    entry["regions"] = sorted(set(entry["regions"]) | regions)
    entry["last"] = last


def resources(buffer):
    """ExportMetricsServiceRequest, as a list of what each ResourceMetrics held."""
    answer = []
    for number, _, resource_metrics in fields(buffer):
        if number != 1:
            continue
        attributes, metrics = {}, {}
        for inner, _, field in fields(resource_metrics):
            if inner == 1:
                for attribute_number, _, attribute in fields(field):
                    if attribute_number == 1:
                        key, value = key_value(attribute)
                        attributes[key] = value
            elif inner == 2:
                for scope_number, _, scope_field in fields(field):
                    if scope_number == 2:
                        metric(scope_field, metrics)
        answer.append({"attributes": attributes, "metrics": metrics})
    return answer


class StandIn(ThreadingHTTPServer):
    daemon_threads = True
    # The collector and troubleshoot.sh both ask at once.
    request_queue_size = 64


def run(port, folder, served, key, listed):
    os.makedirs(os.path.join(folder, "bodies"), exist_ok=True)
    log = open(os.path.join(folder, "requests.jsonl"), "a", encoding="utf-8")
    served_log = open(os.path.join(folder, "served.log"), "a", encoding="utf-8")
    lock = threading.Lock()
    state = {"received": 0, "kept": 0}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *arguments):
            pass

        def answer(self, status, body=b"", content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def token(self):
            return (
                self.headers.get("x-oneuptime-token")
                or self.headers.get("x-oneuptime-service-token")
                or self.headers.get("x-oneuptime-ingestion-key")
            )

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/otlp/v1/validate":
                self.validate()
            elif path == INSTALL_PREFIX or path.startswith(INSTALL_PREFIX + "/"):
                self.install_file(path)
            else:
                # What an older OneUptime answers: the script takes its files from GitHub.
                self.answer(404, b'{"message":"Not found"}')

        def validate(self):
            token = self.token()
            if token == key:
                body = {
                    "tokenProvided": True,
                    "valid": True,
                    "projectId": "00000000-0000-4000-8000-000000000000",
                    "keyType": "Server",
                    "isEnabled": True,
                    "isExpired": False,
                }
                self.answer(200, json.dumps(body).encode())
            else:
                body = {
                    "tokenProvided": bool(token),
                    "valid": False,
                    "message": "This ingestion token is unknown or has been revoked.",
                }
                self.answer(401, json.dumps(body).encode())

        def install_file(self, path):
            name = path[len(INSTALL_PREFIX) + 1 :] or "install.sh"
            # By its exact name in the list, never a path on disk, as the real one does.
            status = 404
            body = b"Not found\n"
            if name in listed:
                try:
                    with open(os.path.join(served, name), "rb") as handle:
                        body = handle.read()
                    status = 200
                except OSError:
                    status = 500
                    body = b"Could not read it\n"
            with lock:
                served_log.write(f"{time.time():.3f} {status} {name}\n")
                served_log.flush()
            self.answer(status, body, "text/plain; charset=utf-8")

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length)
            path = self.path.split("?", 1)[0]
            if not path.startswith("/otlp/v1/"):
                self.answer(404, b'{"message":"Not found"}')
                return
            record = {
                "at": time.time(),
                "path": path,
                "keyAccepted": self.token() == key,
                "bytes": length,
                "encoding": (self.headers.get("Content-Encoding") or "").lower(),
                "contentType": (self.headers.get("Content-Type") or "").lower(),
            }
            if record["keyAccepted"]:
                try:
                    plain = body
                    if record["encoding"] == "gzip":
                        plain = gzip.decompress(body)
                    elif record["encoding"] == "deflate":
                        plain = zlib.decompress(body)
                    if path == "/otlp/v1/metrics":
                        record["resources"] = resources(plain)
                    with lock:
                        if state["kept"] + len(plain) <= MAX_BODY_BYTES_KEPT:
                            state["kept"] += len(plain)
                            state["received"] += 1
                            name = f"{state['received']:05d}.pb"
                            record["body"] = name
                            with open(os.path.join(folder, "bodies", name), "wb") as handle:
                                handle.write(plain)
                except (OSError, ValueError, IndexError, struct.error, zlib.error) as error:
                    record["unreadable"] = str(error)
            with lock:
                log.write(json.dumps(record, sort_keys=True) + "\n")
                log.flush()
            if record["keyAccepted"]:
                # An empty ExportMetricsServiceResponse.
                self.answer(200, b"", "application/x-protobuf")
            else:
                self.answer(
                    401,
                    b'{"message":"Invalid ingestion token."}',
                )

    StandIn(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    with open(sys.argv[4], encoding="utf-8") as files:
        LISTED = {line.strip() for line in files if line.strip()}
    run(int(sys.argv[1]), sys.argv[2], sys.argv[3], os.environ["ONEUPTIME_STAND_IN_KEY"], LISTED)
