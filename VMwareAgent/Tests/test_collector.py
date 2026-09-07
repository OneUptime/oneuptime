"""Opt-in wire interoperability test against the pinned real collector image."""

import json
import os
import subprocess
import time
import unittest
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

from VMwareAgent.inventory import Snapshot, encode_otlp, normalize
from VMwareAgent.Tests.test_inventory import vm


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
            output = command("logs", name)
            self.assertIn("oneuptime.vmware.vm.cpu.utilization", output)
            self.assertIn("oneuptime.vmware.source.id", output)
            self.assertIn("wire-test", output)
            self.assertIn("uuid-1", output)
        finally:
            try:
                command("rm", "--force", name)
            except subprocess.CalledProcessError:
                pass


if __name__ == "__main__":
    unittest.main()
