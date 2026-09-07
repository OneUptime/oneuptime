"""Read-only, paginated PropertyCollector access; no performance API polling."""

import ssl
import time
from urllib.parse import urlsplit

from pyVim.connect import Connect, Disconnect
from pyVmomi import vim, vmodl

from VMwareAgent.inventory import Record, Snapshot


PROPERTIES = {
    "host": (
        vim.HostSystem,
        [
            "name",
            "parent",
            "overallStatus",
            "runtime.powerState",
            "runtime.connectionState",
            "runtime.inMaintenanceMode",
            "summary.hardware.cpuMhz",
            "summary.hardware.numCpuCores",
            "summary.hardware.memorySize",
            "summary.quickStats.overallCpuUsage",
            "summary.quickStats.overallMemoryUsage",
        ],
    ),
    "vm": (
        vim.VirtualMachine,
        [
            "name",
            "overallStatus",
            "config.instanceUuid",
            "config.template",
            "runtime.powerState",
            "runtime.connectionState",
            "runtime.host",
            "runtime.maxCpuUsage",
            "config.hardware.numCPU",
            "config.hardware.memoryMB",
            "summary.quickStats.overallCpuUsage",
            "summary.quickStats.guestMemoryUsage",
        ],
    ),
    "datastore": (
        vim.Datastore,
        [
            "name",
            "overallStatus",
            "summary.capacity",
            "summary.freeSpace",
            "summary.accessible",
        ],
    ),
    "cluster": (vim.ClusterComputeResource, ["name", "overallStatus"]),
}


class VSphereClient:
    def __init__(self, config, stop):
        self.config = config
        self.stop = stop
        self.context = ssl.create_default_context(cafile=config.ca_file)
        self.connection = None

    def close(self):
        connection, self.connection = self.connection, None
        if connection is not None:
            Disconnect(connection)

    def collect(self):
        endpoint = urlsplit(self.config.endpoint)
        # One bounded connection attempt per poll. Failures retry next poll,
        # keeping source-failure telemetry flowing instead of blocking forever.
        if self.connection is None:
            # Use the supported 7.0 API contract directly. SmartConnect's version
            # discovery GET ignores httpConnectionTimeout in pyVmomi 9.1.1.0.
            self.connection = Connect(
                host=endpoint.hostname,
                port=endpoint.port or 443,
                user=self.config.username,
                pwd=self.config.password,
                sslContext=self.context,
                httpConnectionTimeout=self.config.timeout,
                version="vim.version.v7_0",
            )
        content = self.connection.RetrieveContent()
        source_kind = "esxi" if content.about.apiType == "HostAgent" else "vcenter"
        records = []
        complete = True
        view = None
        token = None
        # Each RPC has a timeout; the total traversal also has a bounded budget.
        deadline = time.monotonic() + max(self.config.interval, self.config.timeout)
        collector = content.propertyCollector
        try:
            view = content.viewManager.CreateContainerView(
                content.rootFolder, [entry[0] for entry in PROPERTIES.values()], True
            )
            traversal = vmodl.query.PropertyCollector.TraversalSpec(
                name="inventory", type=vim.view.ContainerView, path="view", skip=False
            )
            objects = vmodl.query.PropertyCollector.ObjectSpec(
                obj=view, skip=True, selectSet=[traversal]
            )
            specs = [
                vmodl.query.PropertyCollector.PropertySpec(
                    type=kind, pathSet=paths, all=False
                )
                for kind, paths in PROPERTIES.values()
            ]
            query = vmodl.query.PropertyCollector.FilterSpec(
                objectSet=[objects], propSet=specs
            )
            result = collector.RetrievePropertiesEx(
                specSet=[query],
                options=vmodl.query.PropertyCollector.RetrieveOptions(maxObjects=250),
            )
            while result is not None:
                token = result.token or None
                for item in result.objects or []:
                    if len(records) >= self.config.max_objects:
                        raise ValueError("VMware inventory exceeds configured limit")
                    kind = next(
                        (
                            name
                            for name, (sdk_type, _) in PROPERTIES.items()
                            if isinstance(item.obj, sdk_type)
                        ),
                        None,
                    )
                    if not kind:
                        complete = False
                        continue
                    properties = {}
                    for prop in item.propSet or []:
                        value = prop.val
                        if isinstance(value, vim.ManagedEntity):
                            value = value._moId
                        properties[prop.name] = value
                    # Templates are inventory, but never implicitly expected to run.
                    if properties.get("config.template") is True:
                        properties["is_template"] = True
                    item_complete = not bool(item.missingSet)
                    complete = complete and item_complete
                    records.append(
                        Record(kind, item.obj._moId, properties, item_complete)
                    )
                if not token:
                    break
                if self.stop.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError(
                        "VMware inventory traversal stopped or exceeded budget"
                    )
                result = collector.ContinueRetrievePropertiesEx(token=token)
            return Snapshot(
                records, complete, source_kind, content.about.instanceUuid or ""
            )
        finally:
            # Cancel server-side pagination state even on stop/timeout/limit errors.
            if token:
                try:
                    collector.CancelRetrievePropertiesEx(token=token)
                except Exception:
                    pass
            if view is not None:
                try:
                    view.Destroy()
                except Exception:
                    pass
