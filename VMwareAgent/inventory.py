"""Normalize VMware properties, preserve inventory, and encode OTLP gauges."""

import json
import math
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


PREFIX = "oneuptime.vmware."
POWER = {"poweredOn": 1, "poweredOff": 2, "suspended": 3, "standBy": 4, "standby": 4}
CONNECTION = {
    "connected": 1,
    "disconnected": 2,
    "notResponding": 3,
    "inaccessible": 4,
    "orphaned": 5,
}
HEALTH = {"green": 1, "yellow": 2, "red": 3}
STATE_NAMES = {0: "unknown", 1: "healthy", 2: "warning", 3: "critical"}


@dataclass
class Record:
    kind: str
    moref: str
    properties: dict
    complete: bool = True


@dataclass
class Snapshot:
    records: list[Record]
    complete: bool = True
    source_kind: str = "vcenter"
    instance_uuid: str = ""


@dataclass
class Resource:
    attributes: dict
    metrics: dict = field(default_factory=dict)


def number(value):
    # bool is a Python int subclass, but is never a valid utilization input.
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def text(value):
    return value if isinstance(value, str) and value else None


def identity(record):
    return (
        text(record.properties.get("config.instanceUuid")) or record.moref
        if record.kind == "vm"
        else record.moref
    )


def key(kind, resource_id):
    return kind + "/" + resource_id


def ratio(metrics, name, used, capacity):
    if number(used) and number(capacity) and capacity > 0:
        metrics[name] = (100.0 * used / capacity, "%")


def normalize(snapshot, expected, known=None):
    """Keep changing metadata separate from the stable source/type/id identity."""
    resources = {}
    by_ref = {
        (r.kind, r.moref): r for r in snapshot.records if isinstance(r.properties, dict)
    }
    previous_vm_ids = {
        attrs.get("resource.moref"): attrs["resource.id"]
        for attrs in (known or {}).values()
        if attrs.get("resource.type") == "vm"
    }
    for record in snapshot.records:
        if (
            record.kind not in {"host", "vm", "datastore", "cluster"}
            or not text(record.moref)
            or not isinstance(record.properties, dict)
        ):
            snapshot.complete = False
            continue
        props = record.properties
        resource_id = identity(record)
        # Preserve a previously selected identity when VMware temporarily omits
        # config.instanceUuid, and keep an initial MoRef fallback stable later.
        if record.kind == "vm":
            previous_id = previous_vm_ids.get(record.moref)
            if previous_id and (
                not text(props.get("config.instanceUuid"))
                or previous_id == record.moref
            ):
                resource_id = previous_id
        attributes = {
            "resource.id": resource_id,
            "resource.type": record.kind,
            "resource.name": text(props.get("name")) or resource_id,
            "resource.moref": record.moref,
            "resource.observed": True,
            "resource.retired": False,
        }
        metrics = {"resource.observed": (1, "1"), "resource.retired": (0, "1")}
        complete = record.complete and text(props.get("name")) is not None
        power = POWER.get(text(props.get("runtime.powerState")), 0)
        connection = CONNECTION.get(text(props.get("runtime.connectionState")), 0)
        state = HEALTH.get(text(props.get("overallStatus")), 0)
        if record.kind in {"host", "vm"}:
            attributes["resource.power_state"] = (
                props.get("runtime.powerState") if power else "unknown"
            )
            attributes["resource.connection_state"] = (
                props.get("runtime.connectionState") if connection else "unknown"
            )
            metrics["resource.power_state"] = (power, "1")
            metrics["resource.connection_state"] = (connection, "1")
            # vSphere explicitly reports a disconnected/notResponding host's
            # power as "unknown". This is a successfully read state, not an
            # incomplete inventory: its known connection failure must still
            # alert. Missing or malformed properties remain incomplete.
            valid_power = power != 0 or (
                record.kind == "host" and props.get("runtime.powerState") == "unknown"
            )
            complete = complete and valid_power and connection != 0
        if record.kind == "host":
            maintenance = props.get("runtime.inMaintenanceMode")
            if isinstance(maintenance, bool):
                attributes["host.maintenance"] = maintenance
                metrics["host.maintenance"] = (int(maintenance), "1")
                if connection:
                    metrics["host.unavailable"] = (
                        int(connection != 1 and not maintenance),
                        "1",
                    )
                    if connection != 1 and not maintenance:
                        state = 3
            else:
                complete = False
            self_cpu = props.get("summary.quickStats.overallCpuUsage")
            memory = props.get("summary.quickStats.overallMemoryUsage")
            mhz, cores = props.get("summary.hardware.cpuMhz"), props.get(
                "summary.hardware.numCpuCores"
            )
            capacity = mhz * cores if number(mhz) and number(cores) else None
            memory_bytes = props.get("summary.hardware.memorySize")
            # A disconnected host can retain stale quickStats; never re-stamp them.
            if power == 1 and connection == 1:
                ratio(metrics, "host.cpu.utilization", self_cpu, capacity)
                ratio(
                    metrics,
                    "host.memory.utilization",
                    memory * 1048576 if number(memory) else None,
                    memory_bytes,
                )
            parent = by_ref.get(("cluster", text(props.get("parent"))))
            if parent:
                for part, value in (
                    ("id", identity(parent)),
                    ("name", parent.properties.get("name") or identity(parent)),
                ):
                    attributes["cluster." + part] = value
                    attributes["parent." + part] = value
                attributes["parent.type"] = "cluster"
        elif record.kind == "vm":
            expecting = resource_id in expected and props.get("is_template") is not True
            attributes["vm.template"] = props.get("is_template") is True
            attributes["vm.expected_running"] = expecting
            metrics["vm.expected_running"] = (int(expecting), "1")
            if power:
                # Emit explicit recovery when policy is removed or the VM becomes
                # a template. An absent metric means unknown to the server and
                # cannot clear a previously reported unexpected-power incident.
                metrics["vm.unexpected_power_off"] = (
                    int(expecting and power != 1), "1"
                )
                # Desired power policy is separate from reported health. The
                # server may override this expectation without changing vSphere.
            if connection and connection != 1:
                state = 3
            parent = by_ref.get(("host", text(props.get("runtime.host"))))
            if parent:
                for part, value in (
                    ("id", identity(parent)),
                    ("name", parent.properties.get("name") or identity(parent)),
                ):
                    attributes["host." + part] = value
                    attributes["parent." + part] = value
                attributes["parent.type"] = "host"
                cluster = by_ref.get(("cluster", text(parent.properties.get("parent"))))
                if cluster:
                    attributes["cluster.id"] = identity(cluster)
                    attributes["cluster.name"] = cluster.properties.get(
                        "name"
                    ) or identity(cluster)
            # Zero is valid; an absent quickStats property is not a zero.
            if power == 1 and connection == 1:
                limit = props.get("runtime.maxCpuUsage")
                if not number(limit) or limit == 0:
                    count = props.get("config.hardware.numCPU")
                    host_mhz = (
                        parent.properties.get("summary.hardware.cpuMhz")
                        if parent
                        else None
                    )
                    limit = (
                        count * host_mhz if number(count) and number(host_mhz) else None
                    )
                ratio(
                    metrics,
                    "vm.cpu.utilization",
                    props.get("summary.quickStats.overallCpuUsage"),
                    limit,
                )
                ratio(
                    metrics,
                    "vm.memory.utilization",
                    props.get("summary.quickStats.guestMemoryUsage"),
                    props.get("config.hardware.memoryMB"),
                )
        elif record.kind == "datastore":
            accessible = props.get("summary.accessible")
            if isinstance(accessible, bool):
                attributes["datastore.accessible"] = accessible
                metrics["datastore.accessible"] = (int(accessible), "1")
                if not accessible:
                    state = 3
            else:
                complete = False
            capacity, free = props.get("summary.capacity"), props.get(
                "summary.freeSpace"
            )
            if (
                accessible is True
                and number(capacity)
                and number(free)
                and free <= capacity
            ):
                for name, value in (
                    ("capacity", capacity),
                    ("used", capacity - free),
                    ("free", free),
                ):
                    metrics["datastore.disk." + name] = (value, "By")
                ratio(metrics, "datastore.disk.utilization", capacity - free, capacity)
        if not complete:
            snapshot.complete = False
            state = 0
        attributes["resource.state"] = STATE_NAMES[state]
        metrics["resource.state"] = (state, "1")
        resource_key = key(record.kind, resource_id)
        if resource_key in resources:
            raise ValueError("Duplicate VMware resource identity")
        resources[resource_key] = Resource(attributes, metrics)
    return resources


class InventoryStore:
    """An atomic, source-scoped inventory, containing no credentials or samples."""

    def __init__(self, path, source_id, max_objects):
        self.path = Path(path)
        self.source_id = source_id
        self.max_objects = max_objects
        self.instance_uuid = ""
        self.known = {}
        if self.path.exists():
            data = json.loads(self.path.read_text())
            if data.get("version") != 1 or data.get("source_id") != source_id:
                raise ValueError(
                    "Inventory state belongs to a different source or version"
                )
            self.known = data["resources"]
            self.instance_uuid = data.get("instance_uuid", "")
            if not isinstance(self.known, dict) or len(self.known) > max_objects:
                raise ValueError("Invalid persisted inventory")
            for resource_key, attrs in self.known.items():
                if not isinstance(attrs, dict) or resource_key != key(
                    attrs.get("resource.type", ""), attrs.get("resource.id", "")
                ):
                    raise ValueError("Invalid persisted resource identity")

    def reconcile(self, resources, retired, instance_uuid=""):
        if self.instance_uuid and instance_uuid and self.instance_uuid != instance_uuid:
            raise ValueError(
                "VMware source server identity changed; use a new source ID"
            )
        if len(set(self.known) | set(resources)) > self.max_objects:
            raise ValueError("Persistent inventory object limit exceeded")
        self.instance_uuid = instance_uuid or self.instance_uuid
        for resource_key, resource in resources.items():
            self.known[resource_key] = dict(resource.attributes)
        for resource_key, previous in self.known.items():
            if resource_key in resources:
                continue
            attrs = dict(previous)
            attrs.update(
                {
                    "resource.observed": False,
                    "resource.retired": resource_key in retired,
                    "resource.state": "unknown",
                }
            )
            # Last reported runtime metadata must never masquerade as fresh state.
            for name in ("resource.power_state", "resource.connection_state"):
                if name in attrs:
                    attrs[name] = "unknown"
            attrs.pop("host.maintenance", None)
            attrs.pop("datastore.accessible", None)
            resources[resource_key] = Resource(
                attrs,
                {
                    "resource.observed": (0, "1"),
                    "resource.retired": (int(resource_key in retired), "1"),
                    "resource.state": (0, "1"),
                },
            )
        return resources

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "source_id": self.source_id,
            "instance_uuid": self.instance_uuid,
            "resources": self.known,
        }
        descriptor, temporary = tempfile.mkstemp(
            prefix="inventory-", dir=self.path.parent
        )
        try:
            with os.fdopen(descriptor, "w") as stream:
                json.dump(data, stream, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def encode_otlp(source_attrs, resources, timestamp_ns):
    batches = []
    for resource in resources:
        attrs = {**source_attrs, **resource.attributes}
        attributes = []
        for name, value in sorted(attrs.items()):
            if isinstance(value, bool):
                encoded = {"boolValue": value}
            elif number(value):
                encoded = {"doubleValue": float(value)}
            else:
                encoded = {"stringValue": str(value)}
            attributes.append({"key": PREFIX + name, "value": encoded})
        metrics = []
        for name, (value, unit) in sorted(resource.metrics.items()):
            if not number(value):
                continue
            point = {"timeUnixNano": str(timestamp_ns), "asDouble": float(value)}
            metrics.append(
                {"name": PREFIX + name, "unit": unit, "gauge": {"dataPoints": [point]}}
            )
        batches.append(
            {
                "resource": {"attributes": attributes},
                "scopeMetrics": [
                    {
                        "scope": {
                            "name": "oneuptime.vmware.inventory",
                            "version": "1.0.0",
                        },
                        "metrics": metrics,
                    }
                ],
            }
        )
    return {"resourceMetrics": batches}
