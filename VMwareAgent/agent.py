"""Polling orchestration; source failure is telemetry, never estate downtime."""

import logging
import time

from VMwareAgent.config import read_policy
from VMwareAgent.inventory import InventoryStore, Resource, encode_otlp, normalize


class Agent:
    def __init__(self, config, client, exporter, stop):
        self.config = config
        self.client = client
        self.exporter = exporter
        self.stop = stop
        self.store = InventoryStore(
            config.state_file, config.source_id, config.max_objects
        )
        self.expected, self.retired = read_policy(config.policy_file)
        self.source_kind = "unknown"

    def poll(self):
        resources = {}
        up, complete = 0, 0
        try:
            # A malformed policy cannot silently clear previously configured intent.
            expected, retired = read_policy(self.config.policy_file)
            snapshot = self.client.collect()
            resources = normalize(snapshot, expected, self.store.known)
            resources = self.store.reconcile(resources, retired, snapshot.instance_uuid)
            self.expected, self.retired = expected, retired
            self.source_kind = snapshot.source_kind
            up, complete = 1, int(snapshot.complete)
            self.store.save()
        except Exception as error:
            up, complete = 0, 0
            # Do not log exception messages: SDK faults/URLs can contain secrets.
            logging.error(
                "VMware collection failed (%s); resource states are unknown",
                type(error).__name__,
            )
            try:
                self.client.close()
            except Exception:
                pass
            resources = self.store.reconcile({}, self.retired)
        source = Resource(
            {}, {"source.up": (up, "1"), "source.inventory.complete": (complete, "1")}
        )
        attrs = {
            "source.id": self.config.source_id,
            "source.name": self.config.source_name,
            "source.kind": self.source_kind,
            "source.collection_interval_seconds": self.config.interval,
        }
        payload = encode_otlp(attrs, [source, *resources.values()], time.time_ns())
        return self.exporter.export(payload)

    def run(self):
        try:
            while not self.stop.is_set():
                started = time.monotonic()
                self.poll()
                self.stop.wait(
                    max(1, self.config.interval - (time.monotonic() - started))
                )
        finally:
            try:
                self.client.close()
            except Exception:
                logging.warning("VMware session cleanup failed")
