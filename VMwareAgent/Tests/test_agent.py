import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from VMwareAgent.agent import Agent
from VMwareAgent.config import Config, read_policy
from VMwareAgent.inventory import Snapshot
from VMwareAgent.Tests.test_inventory import host, vm


def config(path, **kwargs):
    return Config(
        "prod",
        "Production",
        "https://vcenter.example.com",
        "reader",
        "secret",
        state_file=path,
        **kwargs
    )


def flatten(payload):
    result = []
    for batch in payload["resourceMetrics"]:
        attrs = {
            item["key"].removeprefix("oneuptime.vmware."): next(
                iter(item["value"].values())
            )
            for item in batch["resource"]["attributes"]
        }
        metrics = {
            metric["name"].removeprefix("oneuptime.vmware."): metric["gauge"][
                "dataPoints"
            ][0]["asDouble"]
            for scope in batch["scopeMetrics"]
            for metric in scope["metrics"]
        }
        result.append((attrs, metrics))
    return result


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "inventory.json"
        self.client, self.exporter = Mock(), Mock()
        self.exporter.export.return_value = True
        self.stop = threading.Event()
        self.agent = Agent(config(self.path), self.client, self.exporter, self.stop)

    def payload(self):
        return self.exporter.export.call_args.args[0]

    def test_api_failure_exports_source_failure_and_unknown_resources(self):
        self.client.collect.return_value = Snapshot(
            [host(), vm()], instance_uuid="server"
        )
        self.agent.poll()
        self.client.collect.side_effect = PermissionError(
            "sensitive password should not be logged"
        )
        with self.assertLogs(level="ERROR") as logs:
            self.agent.poll()
        self.assertNotIn("sensitive password", str(logs.output))
        values = flatten(self.payload())
        self.assertEqual(values[0][1], {"source.up": 0, "source.inventory.complete": 0})
        for attrs, metrics in values[1:]:
            self.assertFalse(attrs["resource.observed"])
            self.assertEqual(metrics["resource.state"], 0)
            self.assertNotIn("vm.unexpected_power_off", metrics)
        self.client.close.assert_called_once()

    def test_partial_inventory_is_reachable_but_incomplete(self):
        record = vm()
        record.complete = False
        self.client.collect.return_value = Snapshot([record])
        self.agent.poll()
        self.assertEqual(
            flatten(self.payload())[0][1],
            {"source.up": 1, "source.inventory.complete": 0},
        )

    def test_disconnected_host_with_documented_unknown_power_can_alert(self):
        for connection in ("disconnected", "notResponding"):
            with self.subTest(connection=connection):
                self.client.collect.return_value = Snapshot(
                    [
                        host(
                            **{
                                "runtime.powerState": "unknown",
                                "runtime.connectionState": connection,
                            }
                        ),
                        vm(),
                    ]
                )
                self.agent.poll()
                values = flatten(self.payload())
                self.assertEqual(
                    values[0][1],
                    {
                        "source.up": 1,
                        "source.inventory.complete": 1,
                    },
                )
                metrics = next(
                    metrics
                    for attrs, metrics in values[1:]
                    if attrs["resource.type"] == "host"
                )
                self.assertEqual(metrics["resource.power_state"], 0)
                self.assertEqual(metrics["host.unavailable"], 1)
                self.assertEqual(metrics["resource.state"], 3)
                self.assertNotIn("host.cpu.utilization", metrics)
                self.assertNotIn("host.memory.utilization", metrics)

    def test_same_timestamp_for_source_and_all_entity_metrics(self):
        self.client.collect.return_value = Snapshot([host(), vm()])
        self.agent.poll()
        timestamps = {
            point["timeUnixNano"]
            for batch in self.payload()["resourceMetrics"]
            for scope in batch["scopeMetrics"]
            for metric in scope["metrics"]
            for point in metric["gauge"]["dataPoints"]
        }
        self.assertEqual(len(timestamps), 1)
        self.assertEqual(
            flatten(self.payload())[0][0]["source.collection_interval_seconds"], 60
        )

    def test_source_identity_change_cannot_replace_known_estate(self):
        self.client.collect.return_value = Snapshot([vm()], instance_uuid="first")
        self.agent.poll()
        self.client.collect.return_value = Snapshot([host()], instance_uuid="different")
        self.agent.poll()
        values = flatten(self.payload())
        self.assertEqual(values[0][1]["source.up"], 0)
        self.assertEqual([attrs["resource.id"] for attrs, _ in values[1:]], ["uuid-1"])

    def test_policy_reload_and_malformed_policy_does_not_clear_expectation(self):
        policy = Path(self.directory.name) / "policy.json"
        policy.write_text(json.dumps({"expected_running_vm_ids": ["uuid-1"]}))
        agent = Agent(
            config(self.path, policy_file=policy), self.client, self.exporter, self.stop
        )
        self.client.collect.return_value = Snapshot(
            [vm(**{"runtime.powerState": "poweredOff"})]
        )
        agent.poll()
        self.assertEqual(flatten(self.payload())[1][1]["vm.unexpected_power_off"], 1)
        policy.write_text("invalid")
        agent.poll()
        self.assertEqual(agent.expected, {"uuid-1"})
        self.assertEqual(flatten(self.payload())[0][1]["source.up"], 0)

    def test_save_failure_is_visible(self):
        self.client.collect.return_value = Snapshot([host()])
        with patch.object(self.agent.store, "save", side_effect=OSError()):
            self.agent.poll()
        self.assertEqual(flatten(self.payload())[0][1]["source.up"], 0)

    def test_stop_does_not_start_poll_and_closes_session(self):
        self.stop.set()
        self.agent.run()
        self.client.collect.assert_not_called()
        self.client.close.assert_called_once()


class ConfigTests(unittest.TestCase):
    def test_no_insecure_vmware_url_and_no_credentials_in_url(self):
        for endpoint in (
            "http://vcenter",
            "https://reader:secret@vcenter",
            "https://vcenter/sdk",
            "https://vcenter?token=a",
        ):
            with self.assertRaises(ValueError):
                Config("prod", "Prod", endpoint, "user", "secret")

    def test_plaintext_export_only_loopback(self):
        with self.assertRaises(ValueError):
            config(Path("unused"), otlp_endpoint="http://collector.remote/v1/metrics")
        config(Path("unused"), otlp_endpoint="http://127.0.0.1:4318/v1/metrics")

    def test_secret_is_not_in_repr(self):
        self.assertNotIn("secret", repr(config(Path("unused"))))

    def test_bounds_and_invalid_source(self):
        for kwargs in (
            {"interval": 0},
            {"timeout": 0},
            {"max_objects": 0},
            {"export_attempts": 20},
        ):
            with self.assertRaises(ValueError):
                config(Path("unused"), **kwargs)
        with self.assertRaises(ValueError):
            Config("../other", "Prod", "https://vcenter", "user", "secret")

    def test_policy_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            for data in (
                {"expected_running_vm_ids": "uuid"},
                {"retired_resources": ["uuid"]},
                {"unexpected": []},
                [],
            ):
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    read_policy(path)


if __name__ == "__main__":
    unittest.main()
