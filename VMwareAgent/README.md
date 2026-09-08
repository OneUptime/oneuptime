# VMware agent

Monitor a vCenter or standalone ESXi endpoint from a machine with network access
to its HTTPS SDK API. Run one agent deployment per source. VMware credentials stay
on this machine; the agent sends inventory, state, and metrics to OneUptime.

The bundle combines the stock OpenTelemetry Contrib vCenter receiver **0.160.0**
with a small read-only inventory companion. The stock receiver supplies its wider
performance catalog. The companion supplies individual resource states, stable
identity, and core utilization under `oneuptime.vmware.*` for native pages and
alerts. It does not call the performance API or manage VMware resources.

## Install

Requirements: Docker Engine with Compose, an HTTPS vCenter/ESXi endpoint, a
read-only VMware account with propagated visibility over all intended inventory,
and a OneUptime telemetry ingestion key for the project.

From this directory in a OneUptime checkout:

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your endpoint, credentials, OneUptime URL and ingestion key. Give
the source a stable, project-unique `VMWARE_SOURCE_ID` such as `prod-vcenter`.
`VMWARE_SOURCE_NAME` is its changeable display name. The source ID is stamped onto
both receiver pipelines. Do not use a different source ID after a rename, or reuse
an ID for a different VMware server.

```sh
docker compose up -d --build
docker compose logs --tail=100 inventory collector
```

The source and its resources appear in OneUptime's VMware section after the first
successful collection. No inbound ports are published. The companion sends OTLP
JSON to a loopback listener in the collector's shared network namespace; the
collector exports to the configured OneUptime project.

For a private VMware CA, put the CA certificate chain at `certs/vmware-ca.pem` and
set `VMWARE_CA_FILE=/etc/vmware-certs/vmware-ca.pem` in `.env`. Certificates and
hostnames are verified by both clients. There is no insecure mode in the
companion. Install the correct CA instead of disabling verification. The PEM must
be readable by the unprivileged containers. Never place a private key here.

The Compose bundle accepts the VMware password through `.env`. For deployments
with an external secret manager, the companion also accepts `VMWARE_PASSWORD_FILE`
containing a mounted secret; adapt the stock collector configuration to your
secret provider too. Single-quote `.env` passwords containing `$` so Compose does
not interpolate them. Never commit `.env` or credentials.

## Intent and retirement

`policy.json` is reloaded each poll. Add the stable resource IDs shown in OneUptime
to `expected_running_vm_ids` for VMs that should continuously run:

```json
{
  "expected_running_vm_ids": ["503d6c8b-8ba9-409c-a321-a12b6c640fe5"],
  "retired_resources": ["vm/503d5be1-d0a0-4d4c-9acb-c3a189016acc"]
}
```

Unselected powered-off VMs are not automatically outages. Suspended selected VMs
also violate expected-running intent. Templates are never marked expected-running.
OneUptime can additionally maintain user overrides for alert evaluation.

An entity absent from a collection remains in persistent inventory as **unknown**,
with `resource.observed=0`. It is not assumed down or deleted. A missing object
becomes retired only when explicitly listed as `type/resource-id` in
`retired_resources`. An object that is still observed cannot be hidden by that
list. Retired tombstones remain persisted so restarts and temporary export failures
cannot lose a retirement decision. Remove it from the list to undo a retirement.

The `inventory` volume holds last-known identities and display metadata, never
credentials or historic utilization. Preserve this volume during upgrades; do not
use `docker compose down -v`. A corrupt state file or wrong source ID fails startup
instead of silently forgetting previously monitored entities. Back up this volume
with the agent's configuration.

## Collection and availability

The companion polls every 60 seconds by default. Set
`VMWARE_COLLECTION_INTERVAL_SECONDS` (10–3600) and
`VMWARE_REQUEST_TIMEOUT_SECONDS` (1–60, default 15) to suit the inventory size.
The stock performance receiver polls every two minutes; tune its interval and
`max_query_metrics` in `otel-collector-config.yaml` for your vCenter capacity.
vSAN metrics are disabled in the bundled stock configuration; enable them when
needed. Inventory collection uses paginated PropertyCollector requests with a
10,000-object default limit, a request timeout and a traversal time budget. Change
`VMWARE_MAX_OBJECTS` only after sizing the companion's memory limit and validating
the target inventory; the limit includes persisted missing/retired objects. Failed API
connections retry on the next poll, and local metric exports retry at most three
times with interruptible backoff. OTLP requests are split at resource boundaries
and capped at 1 MiB so larger inventories do not require oversized HTTP requests.

All companion samples in a poll share one timestamp. Source health is separate
from resource state:

| Metric (prefix `oneuptime.vmware.`) | Meaning |
| --- | --- |
| `source.up` | 1 when the companion completed API collection; 0 on connection, authentication, traversal, policy or persistence failure |
| `source.inventory.complete` | 1 only when required inventory properties were complete; 0 for partial collection or failure |
| `resource.observed` | 1 when this entity was observed in this poll; 0 for persisted missing entities |
| `resource.retired` | 1 only for an explicitly retired, absent entity |
| `resource.state` | 0 unknown, 1 healthy, 2 warning, 3 critical |
| `resource.power_state` | 0 unknown, 1 on, 2 off, 3 suspended, 4 standby |
| `resource.connection_state` | 0 unknown, 1 connected, 2 disconnected, 3 not responding, 4 inaccessible, 5 orphaned |
| `host.maintenance` | 0/1 when VMware supplied maintenance state; omitted if unknown |
| `host.unavailable` | 1 for a known connection problem outside maintenance; 0 otherwise; omitted if connection/maintenance is unknown |
| `vm.expected_running` | 0/1 operator intent |
| `vm.unexpected_power_off` | 1 for selected VMs with known non-running power state; 0 for other VMs with known power state, including when expected-running intent is removed; omitted when power state is unknown |
| `datastore.accessible` | 0/1 when VMware supplied datastore accessibility |
| `host.cpu.utilization`, `host.memory.utilization` | Host utilization, percent (0–100 in normal operation) |
| `vm.cpu.utilization`, `vm.memory.utilization` | VM utilization, percent; VM memory uses VMware guest-memory quick stats |
| `datastore.disk.utilization` | Allocated datastore capacity, percent |
| `datastore.disk.capacity`, `datastore.disk.used`, `datastore.disk.free` | Bytes |

Zero utilization is a valid measurement. Missing properties do not become zero.
Disconnected or powered-off hosts/VMs do not emit fresh utilization based on stale
quick stats. Missing entities emit only observed/retired/unknown state metrics.
Datastore capacity is not guest filesystem usage, and VM power-on is not proof
that the guest OS or an application is serving traffic.

If the SDK/API fails, the companion still exports `source.up=0` and marks previous
resources unknown. If the entire agent or outbound connection fails, no heartbeat
can arrive: use OneUptime collection freshness alerts for that condition. Keep
independent ICMP/TCP/HTTP checks for reachability or application availability;
vCenter observations cannot establish availability independently of vCenter.

The collector has a bounded in-memory export queue and retries transient outbound
failures for up to two minutes. Queued metric samples are not durable across a
collector restart; inventory identities are durable. Check both container logs
when telemetry is missing. Source metrics report the companion's health; the stock
receiver's performance-scrape errors are reported in collector logs.

## Identity contract

All companion resource attributes use the `oneuptime.vmware.` prefix:

- `source.id`, `source.name`, `source.kind` (`vcenter`, `esxi`, or `unknown`), and
  numeric `source.collection_interval_seconds`.
- `resource.type` (`host`, `vm`, `datastore`, `cluster`), `resource.id`,
  `resource.name`, and `resource.moref`.
- `parent.id/type/name`, `host.id/name`, and `cluster.id/name` where available.
- `resource.observed`, `resource.retired`, `host.maintenance`, `vm.expected_running`,
  `vm.template`, and `datastore.accessible` are booleans when available.
- Runtime attributes `resource.power_state` and `resource.connection_state` carry
  SDK enum strings or `unknown`. `resource.state` is
  `unknown|healthy|warning|critical`.

Identity is **source ID + resource type + resource ID**. Host/datastore/cluster IDs
are source-scoped SDK managed-object references. VM IDs use instance UUID, with a
persisted managed-object reference fallback if UUID is unavailable on first sight.
A transiently missing UUID preserves the previous identity. Names and parent
relationships change on rename/vMotion without changing identity. Cross-vCenter
migration, re-registering an object, and restoring a different VMware server can
change identity; do not assume universal identity across those operations.

Stock `vcenter.*` metrics carry the same source ID but retain upstream's mostly
name-based resource attributes. Use the companion `oneuptime.vmware.*` metrics for
stable-ID native alerts; do not join stock metrics by name when names are ambiguous.

## Support and validation

Upstream Contrib 0.160.0 documents vCenter/ESXi **7.0 and 8**, including standalone
ESXi SDK endpoints. Its receiver is alpha. VMware 9 is not in that upstream matrix.
The companion pins pyVmomi 9.1.1.0. A newer SDK dependency does not certify a newer
VMware server version. Validate your specific VMware build and permissions before
production rollout.

This bundle's automated tests exercise normalization, SDK request construction,
pagination/fault cleanup, permissions/partial properties, stable identity,
retirement and restart behavior, and real local OTLP HTTP export through a fake
VMware lifecycle. They do not replace testing against licensed vCenter and
standalone ESXi systems, particularly large estates and version upgrades.

The `VMware Agent Test` GitHub Actions workflow builds the shipped companion
image, runs the unit and fake-server integration suites inside it, validates the
Compose and collector configurations, and runs the real collector OTLP wire test.
It uses no VMware credentials or live VMware systems.

From the repository root, with Python 3.10 or newer (required by pyVmomi):

```sh
python3 -m venv /tmp/oneuptime-vmware-test
/tmp/oneuptime-vmware-test/bin/pip install -r VMwareAgent/requirements.txt
/tmp/oneuptime-vmware-test/bin/python -m unittest discover -s VMwareAgent/Tests -v
python3 -m compileall -q VMwareAgent
```

With Docker available, also verify the companion's OTLP JSON against the actual
pinned collector. This creates and removes an isolated collector test container:

```sh
VMWARE_TEST_COLLECTOR=1 python3 -m unittest VMwareAgent.Tests.test_collector -v
```

Validate the stock collector configuration using the exact bundled version and
non-production configuration values:

```sh
docker compose run --rm collector validate --config=/etc/otelcol/config.yaml
```

References: [upstream receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.160.0/receiver/vcenterreceiver),
[VMware runtime API](https://developer.broadcom.com/xapis/vsphere-web-services-api/latest/vim.host.RuntimeInfo.html),
[pyVmomi](https://github.com/vmware/pyvmomi).
