"""Opt-in wire interoperability test against the pinned real collector image."""

import json
import os
import subprocess
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import URLError
from urllib.request import Request, urlopen

from VMwareAgent.inventory import Snapshot, encode_otlp, normalize
from VMwareAgent.Tests.test_inventory import vm


def wait_for_output(read_logs, required, timeout=30):
    # HTTP acceptance precedes asynchronous export/log delivery. Wait for the
    # actual exported content, with a deadline and diagnostics if it never comes.
    deadline = time.monotonic() + timeout
    while True:
        output = read_logs()
        if all(value in output for value in required):
            return output
        if time.monotonic() >= deadline:
            raise AssertionError(
                "Collector did not export expected metrics:\n" + output
            )
        time.sleep(0.25)


class CollectorOutputTests(unittest.TestCase):
    def test_ready_output_does_not_wait(self):
        logs = Mock(return_value="source resource metric")
        with patch.object(time, "sleep") as sleep:
            self.assertEqual(
                wait_for_output(logs, ["source", "metric"]), "source resource metric"
            )
        logs.assert_called_once_with()
        sleep.assert_not_called()

    def test_http_acceptance_can_precede_export_output(self):
        logs = Mock(side_effect=["Starting HTTP server", "metric", "metric source"])
        with patch.object(time, "sleep") as sleep:
            self.assertEqual(
                wait_for_output(logs, ["metric", "source"]), "metric source"
            )
        self.assertEqual(logs.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_missing_export_fails_at_deadline_with_collector_logs(self):
        with patch.object(time, "monotonic", side_effect=[0, 30]):
            with self.assertRaisesRegex(AssertionError, "exporter failed"):
                wait_for_output(lambda: "exporter failed", ["metric"])


@unittest.skipUnless(
    os.environ.get("VMWARE_TEST_COLLECTOR") == "1",
    "Set VMWARE_TEST_COLLECTOR=1 to test the real collector with Docker",
)
class CollectorInteropTests(unittest.TestCase):
    def test_companion_json_is_accepted_by_pinned_collector(self):
        docker = os.environ.get("DOCKER_BIN", "docker")
        name = "oneuptime-vmware-wire-test-" + uuid.uuid4().hex[:12]
        fixture = Path(__file__).with_name("collector-test.yaml").resolve()

        def command(*args):
            return subprocess.check_output(
                [docker, *args], stderr=subprocess.STDOUT, text=True, timeout=60
            )

        try:
            command(
                "run",
                "--detach",
                "--name",
                name,
                "--read-only",
                "-p",
                "127.0.0.1::4318",
                "-v",
                str(fixture) + ":/etc/otel/config.yaml:ro",
                "otel/opentelemetry-collector-contrib:0.160.0",
                "--config=/etc/otel/config.yaml",
            )
            address = command("port", name, "4318/tcp").strip()
            resource = normalize(Snapshot([vm()]), set())["vm/uuid-1"]
            payload = encode_otlp(
                {"source.id": "wire-test", "source.collection_interval_seconds": 60},
                [resource],
                time.time_ns(),
            )
            request = Request(
                "http://" + address + "/v1/metrics",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            # The full contrib distribution has substantial cold-start work,
            # especially on a busy local Docker VM.
            deadline = time.monotonic() + 120
            while True:
                try:
                    with urlopen(request, timeout=2) as response:
                        result = json.loads(response.read())
                        self.assertEqual(response.status, 200)
                        self.assertFalse(
                            result.get("partialSuccess", {}).get("rejectedDataPoints")
                        )
                    break
                except (URLError, OSError):
                    if time.monotonic() >= deadline:
                        self.fail(
                            "Collector did not accept OTLP before deadline:\n"
                            + command("logs", name)
                        )
                    time.sleep(0.25)
            wait_for_output(
                lambda: command("logs", name),
                [
                    "oneuptime.vmware.vm.cpu.utilization",
                    "oneuptime.vmware.vm.unexpected_power_off",
                    "oneuptime.vmware.source.id",
                    "wire-test",
                    "uuid-1",
                ],
            )
        finally:
            try:
                command("rm", "--force", name)
            except subprocess.CalledProcessError:
                pass


if __name__ == "__main__":
    unittest.main()
