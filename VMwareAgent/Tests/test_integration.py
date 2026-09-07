"""A fake VMware API lifecycle exported through a real local OTLP HTTP server."""

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from VMwareAgent.agent import Agent
from VMwareAgent.inventory import Snapshot
from VMwareAgent.transport import Exporter
from VMwareAgent.Tests.test_agent import config, flatten
from VMwareAgent.Tests.test_inventory import host, vm


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.payloads.append(json.loads(body))
        self.server.content_types.append(self.headers["Content-Type"])
        status = self.server.statuses.pop(0) if self.server.statuses else 200
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(self.server.response).encode())

    def log_message(self, *_):
        pass


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
        self.server.payloads, self.server.statuses, self.server.content_types = (
            [],
            [],
            [],
        )
        self.server.response = {}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cfg = config(
            Path(self.directory.name) / "inventory.json",
            otlp_endpoint="http://127.0.0.1:%d/v1/metrics" % self.server.server_port,
        )
        self.stop = threading.Event()
        self.exporter = Exporter(self.cfg, self.stop)

    def test_full_lifecycle_restart_permissions_missing_recovery(self):
        client = Mock()
        client.collect.side_effect = [
            Snapshot([host(), vm()], instance_uuid="server"),
            PermissionError(),
            Snapshot([host()], instance_uuid="server"),
            Snapshot([host(), vm(**{"name": "renamed"})], instance_uuid="server"),
        ]
        agent = Agent(self.cfg, client, self.exporter, self.stop)
        self.assertTrue(agent.poll())
        restarted = Agent(self.cfg, client, self.exporter, self.stop)
        self.assertTrue(restarted.poll())
        self.assertTrue(restarted.poll())
        self.assertTrue(restarted.poll())
        states = [flatten(payload) for payload in self.server.payloads]
        self.assertEqual([state[0][1]["source.up"] for state in states], [1, 0, 1, 1])
        third_vm = next(
            (attrs, metrics)
            for attrs, metrics in states[2]
            if attrs.get("resource.type") == "vm"
        )
        self.assertFalse(third_vm[0]["resource.observed"])
        self.assertEqual(third_vm[1]["resource.state"], 0)
        fourth_vm = next(
            attrs for attrs, _ in states[3] if attrs.get("resource.type") == "vm"
        )
        self.assertEqual(fourth_vm["resource.id"], "uuid-1")
        self.assertEqual(fourth_vm["resource.name"], "renamed")
        self.assertEqual(set(self.server.content_types), {"application/json"})

    def test_transient_http_failure_retries_same_sample(self):
        self.server.statuses = [503, 200]
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = False
        self.assertTrue(Exporter(self.cfg, stop).export({"resourceMetrics": []}))
        self.assertEqual(len(self.server.payloads), 2)
        self.assertEqual(self.server.payloads[0], self.server.payloads[1])
        stop.wait.assert_called_once_with(1)

    def test_large_inventory_is_split_without_losing_resources(self):
        resources = [
            {
                "resource": {
                    "attributes": [
                        {
                            "key": "identity",
                            "value": {"stringValue": str(index) + "x" * 120},
                        }
                    ]
                },
                "scopeMetrics": [],
            }
            for index in range(4)
        ]
        with patch("VMwareAgent.transport.MAX_REQUEST_BYTES", 350):
            self.assertTrue(self.exporter.export({"resourceMetrics": resources}))
        self.assertEqual(len(self.server.payloads), 4)
        self.assertEqual(
            [
                resource
                for batch in self.server.payloads
                for resource in batch["resourceMetrics"]
            ],
            resources,
        )
        self.assertTrue(
            all(
                len(json.dumps(batch, separators=(",", ":")).encode()) <= 350
                for batch in self.server.payloads
            )
        )

    def test_oversized_single_resource_is_rejected(self):
        with patch("VMwareAgent.transport.MAX_REQUEST_BYTES", 20):
            self.assertFalse(
                self.exporter.export({"resourceMetrics": [{"resource": {}}]})
            )
        self.assertEqual(self.server.payloads, [])

    def test_permanent_failure_and_partial_success_not_retried(self):
        self.server.statuses = [401]
        self.assertFalse(self.exporter.export({"resourceMetrics": []}))
        self.assertEqual(len(self.server.payloads), 1)
        self.server.response = {
            "partialSuccess": {"rejectedDataPoints": "1", "errorMessage": "bad data"}
        }
        self.assertFalse(self.exporter.export({"resourceMetrics": []}))
        self.assertEqual(len(self.server.payloads), 2)

    def test_retries_are_bounded_and_stop_interrupts_backoff(self):
        self.server.statuses = [503] * 10
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = False
        self.assertFalse(Exporter(self.cfg, stop).export({"resourceMetrics": []}))
        self.assertEqual(len(self.server.payloads), 3)
        stop.wait.return_value = True
        self.assertFalse(Exporter(self.cfg, stop).export({"resourceMetrics": []}))
        self.assertEqual(len(self.server.payloads), 4)


if __name__ == "__main__":
    unittest.main()
