import json
import math
import stat
import tempfile
import unittest
from pathlib import Path

from VMwareAgent.inventory import (
    InventoryStore,
    Record,
    Resource,
    Snapshot,
    encode_otlp,
    normalize,
)


def host(moref="host-1", **overrides):
    props = {
        "name": "esx-1",
        "overallStatus": "green",
        "runtime.powerState": "poweredOn",
        "runtime.connectionState": "connected",
        "runtime.inMaintenanceMode": False,
        "summary.hardware.cpuMhz": 2000,
        "summary.hardware.numCpuCores": 4,
        "summary.hardware.memorySize": 8192 * 1048576,
        "summary.quickStats.overallCpuUsage": 4000,
        "summary.quickStats.overallMemoryUsage": 4096,
        "parent": "domain-c1",
    }
    props.update(overrides)
    return Record("host", moref, props)


def vm(moref="vm-1", **overrides):
    props = {
        "name": "database",
        "config.instanceUuid": "uuid-1",
        "overallStatus": "green",
        "runtime.powerState": "poweredOn",
        "runtime.connectionState": "connected",
        "runtime.host": "host-1",
        "runtime.maxCpuUsage": 4000,
        "config.hardware.numCPU": 2,
        "config.hardware.memoryMB": 1024,
        "summary.quickStats.overallCpuUsage": 0,
        "summary.quickStats.guestMemoryUsage": 0,
    }
    props.update(overrides)
    return Record("vm", moref, props)


class InventoryTests(unittest.TestCase):
    def test_cpu_memory_and_datastore_percent_units(self):
        records = [
            host(),
            vm(),
            Record(
                "datastore",
                "datastore-1",
                {
                    "name": "main",
                    "overallStatus": "green",
                    "summary.accessible": True,
                    "summary.capacity": 1000,
                    "summary.freeSpace": 250,
                },
            ),
        ]
        values = normalize(Snapshot(records), set())
        self.assertEqual(
            values["host/host-1"].metrics["host.cpu.utilization"], (50, "%")
        )
        self.assertEqual(
            values["host/host-1"].metrics["host.memory.utilization"], (50, "%")
        )
        self.assertEqual(
            values["datastore/datastore-1"].metrics["datastore.disk.utilization"],
            (75, "%"),
        )
        self.assertEqual(
            values["datastore/datastore-1"].metrics["datastore.disk.free"], (250, "By")
        )

    def test_zero_is_valid_but_absent_is_not_zero(self):
        values = normalize(Snapshot([host(), vm()]), set())["vm/uuid-1"].metrics
        self.assertEqual(values["vm.cpu.utilization"], (0, "%"))
        self.assertEqual(values["vm.memory.utilization"], (0, "%"))
        record = vm()
        del record.properties["summary.quickStats.overallCpuUsage"]
        del record.properties["summary.quickStats.guestMemoryUsage"]
        values = normalize(Snapshot([host(), record]), set())["vm/uuid-1"].metrics
        self.assertNotIn("vm.cpu.utilization", values)
        self.assertNotIn("vm.memory.utilization", values)

    def test_bad_numeric_properties_do_not_emit_nan_or_fake_zero(self):
        for bad in (None, True, -1, math.nan, math.inf, "0", [], {}):
            with self.subTest(bad=bad):
                record = vm(**{"summary.quickStats.overallCpuUsage": bad})
                values = normalize(Snapshot([host(), record]), set())[
                    "vm/uuid-1"
                ].metrics
                self.assertNotIn("vm.cpu.utilization", values)

    def test_expected_off_alert_is_separate_from_reported_health(self):
        record = vm(**{"runtime.powerState": "poweredOff"})
        values = normalize(Snapshot([host(), record]), set())["vm/uuid-1"]
        self.assertEqual(values.metrics["resource.state"][0], 1)
        self.assertNotIn("vm.unexpected_power_off", values.metrics)
        self.assertNotIn("vm.cpu.utilization", values.metrics)
        values = normalize(Snapshot([host(), record]), {"uuid-1"})["vm/uuid-1"]
        self.assertEqual(values.metrics["resource.state"][0], 1)
        self.assertEqual(values.metrics["vm.unexpected_power_off"][0], 1)

        # Deselecting the expectation, in the agent or through an app override,
        # must not leave a second critical-health incident behind.
        deselected = normalize(Snapshot([host(), record]), set())["vm/uuid-1"]
        self.assertEqual(deselected.metrics["resource.state"][0], 1)
        self.assertNotIn("vm.unexpected_power_off", deselected.metrics)

    def test_unknown_power_is_not_unexpected_off(self):
        for bad in (None, "invalid", [], {}):
            snapshot = Snapshot([vm(**{"runtime.powerState": bad})])
            resource = normalize(snapshot, {"uuid-1"})["vm/uuid-1"]
            self.assertFalse(snapshot.complete)
            self.assertEqual(resource.metrics["resource.state"][0], 0)
            self.assertNotIn("vm.unexpected_power_off", resource.metrics)

    def test_template_never_expected_running(self):
        resource = normalize(
            Snapshot([vm(**{"is_template": True, "runtime.powerState": "poweredOff"})]),
            {"uuid-1"},
        )["vm/uuid-1"]
        self.assertFalse(resource.attributes["vm.expected_running"])
        self.assertNotIn("vm.unexpected_power_off", resource.metrics)

    def test_maintenance_suppresses_host_unavailable(self):
        for maintenance, expected in ((True, 0), (False, 1), (None, None)):
            resource = normalize(
                Snapshot(
                    [
                        host(
                            **{
                                "runtime.connectionState": "notResponding",
                                "runtime.inMaintenanceMode": maintenance,
                            }
                        )
                    ]
                ),
                set(),
            )["host/host-1"]
            if expected is None:
                self.assertNotIn("host.unavailable", resource.metrics)
            else:
                self.assertEqual(resource.metrics["host.unavailable"][0], expected)
            self.assertNotIn("host.cpu.utilization", resource.metrics)

    def test_partial_properties_make_state_unknown(self):
        record = host()
        record.complete = False
        snapshot = Snapshot([record])
        resource = normalize(snapshot, set())["host/host-1"]
        self.assertFalse(snapshot.complete)
        self.assertEqual(resource.metrics["resource.state"][0], 0)

    def test_host_unknown_power_is_distinct_from_missing_or_malformed_power(self):
        for bad in (None, "invalid", [], {}):
            with self.subTest(value=bad):
                snapshot = Snapshot([host(**{"runtime.powerState": bad})])
                resource = normalize(snapshot, set())["host/host-1"]
                self.assertFalse(snapshot.complete)
                self.assertEqual(resource.metrics["resource.state"][0], 0)

    def test_rename_and_vmotion_preserve_uuid(self):
        first = normalize(Snapshot([host(), vm()]), set())["vm/uuid-1"]
        moved = normalize(
            Snapshot(
                [host("host-2"), vm(**{"name": "renamed", "runtime.host": "host-2"})]
            ),
            set(),
        )["vm/uuid-1"]
        self.assertEqual(
            first.attributes["resource.id"], moved.attributes["resource.id"]
        )
        self.assertEqual(moved.attributes["resource.name"], "renamed")
        self.assertEqual(moved.attributes["parent.id"], "host-2")

    def test_temporarily_missing_uuid_keeps_previous_identity(self):
        first = normalize(Snapshot([vm()]), set())
        known = {k: v.attributes for k, v in first.items()}
        second = normalize(
            Snapshot([vm(**{"config.instanceUuid": None})]), set(), known
        )
        self.assertEqual(list(second), ["vm/uuid-1"])

    def test_initial_moref_fallback_stays_stable_if_uuid_appears(self):
        first = normalize(Snapshot([vm(**{"config.instanceUuid": None})]), set())
        known = {k: v.attributes for k, v in first.items()}
        self.assertEqual(list(normalize(Snapshot([vm()]), set(), known)), ["vm/vm-1"])

    def test_duplicate_identity_rejected(self):
        with self.assertRaises(ValueError):
            normalize(Snapshot([vm(), vm("vm-2")]), set())

    def test_inaccessible_datastore_does_not_restamp_capacity(self):
        record = Record(
            "datastore",
            "ds",
            {
                "name": "ds",
                "overallStatus": "red",
                "summary.accessible": False,
                "summary.capacity": 100,
                "summary.freeSpace": 10,
            },
        )
        resource = normalize(Snapshot([record]), set())["datastore/ds"]
        self.assertEqual(resource.metrics["datastore.accessible"][0], 0)
        self.assertNotIn("datastore.disk.utilization", resource.metrics)

    def test_otlp_wire_shape_and_typed_attributes(self):
        result = encode_otlp(
            {"source.id": "prod", "source.collection_interval_seconds": 60},
            [Resource({"resource.observed": False}, {"resource.state": (0, "1")})],
            1700000000000000000,
        )
        decoded = json.loads(json.dumps(result, allow_nan=False))
        batch = decoded["resourceMetrics"][0]
        attrs = {item["key"]: item["value"] for item in batch["resource"]["attributes"]}
        self.assertEqual(
            attrs["oneuptime.vmware.resource.observed"], {"boolValue": False}
        )
        self.assertEqual(
            attrs["oneuptime.vmware.source.collection_interval_seconds"],
            {"doubleValue": 60.0},
        )
        point = batch["scopeMetrics"][0]["metrics"][0]["gauge"]["dataPoints"][0]
        self.assertEqual(
            point, {"timeUnixNano": "1700000000000000000", "asDouble": 0.0}
        )


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "inventory.json"

    def test_missing_persists_across_restart_and_only_explicit_retirement(self):
        store = InventoryStore(self.path, "prod", 10)
        store.reconcile(normalize(Snapshot([vm()]), {"uuid-1"}), set(), "server-1")
        store.save()
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        restarted = InventoryStore(self.path, "prod", 10)
        missing = restarted.reconcile({}, set())["vm/uuid-1"]
        self.assertFalse(missing.attributes["resource.observed"])
        self.assertFalse(missing.attributes["resource.retired"])
        self.assertEqual(missing.attributes["resource.power_state"], "unknown")
        self.assertEqual(
            set(missing.metrics),
            {"resource.observed", "resource.retired", "resource.state"},
        )
        retired = restarted.reconcile({}, {"vm/uuid-1"})["vm/uuid-1"]
        self.assertTrue(retired.attributes["resource.retired"])

    def test_present_resources_cannot_be_hidden_by_retirement(self):
        store = InventoryStore(self.path, "prod", 10)
        resource = store.reconcile(normalize(Snapshot([vm()]), set()), {"vm/uuid-1"})[
            "vm/uuid-1"
        ]
        self.assertFalse(resource.attributes["resource.retired"])

    def test_source_and_server_isolation(self):
        store = InventoryStore(self.path, "prod", 10)
        store.reconcile({}, set(), "server-1")
        store.save()
        with self.assertRaises(ValueError):
            InventoryStore(self.path, "other", 10)
        with self.assertRaises(ValueError):
            store.reconcile({}, set(), "server-2")

    def test_corrupt_state_is_not_silently_discarded(self):
        self.path.write_text("broken")
        with self.assertRaises(ValueError):
            InventoryStore(self.path, "prod", 10)

    def test_object_limit_includes_missing_inventory(self):
        store = InventoryStore(self.path, "prod", 1)
        store.reconcile(normalize(Snapshot([host()]), set()), set())
        with self.assertRaises(ValueError):
            store.reconcile(normalize(Snapshot([vm()]), set()), set())


if __name__ == "__main__":
    unittest.main()
