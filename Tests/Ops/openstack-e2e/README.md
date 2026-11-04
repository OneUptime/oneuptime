# OpenStack E2E

OpenStack answers differently by release, network backend and deployment tool, and its failures show up in ways a mock would have to guess: which series go away, which read 0, what a service says while it is down. So the OpenStack product is built and tested on recordings from a real cloud, and this folder makes them.

`.github/workflows/test.openstack-e2e.yaml` deploys DevStack on a GitHub runner and runs these in order:

| Script | What it does |
| --- | --- |
| `estate.sh` | Builds a known estate: two projects with quotas, instances running, shut off and in `ERROR`, volumes available, attached and in `error`, a network, router and floating IPs. Every name starts with `ou-`. |
| `start-instance-metrics.sh` | Starts `prometheus-libvirt-exporter`, pinned by digest, against the runner's libvirt, and turns on Ceilometer's own exporter (`[polling] enable_prometheus_exporter`). DevStack's Ceilometer plugin runs only its polling agent here, and stores nothing. |
| `start-agent.sh` | Starts the OpenStack agent's pinned exporter and collector, with the real `agents/OpenStackAgent/otel-collector-config.yaml`, writing to a file in place of OneUptime. Beside it, the exporter's last non-alpha release, so the two can be compared. |
| `access-matrix.sh` | Tests least privilege on the cloud's real policies: what an admin, a plain reader, the OneUptime monitoring role and an application credential limited by access rules can each read, that the last two cannot write, and what the agent's own exporter gets with each. Restarts the API services once, because access rules need `service_type` set on each. `merge-policy.py` merges the overrides over what a service's policy file already holds. |
| `drills.sh` | Breaks the cloud one way at a time (`record.sh` after each) and puts it back: a compute service disabled on purpose, `nova-compute`, a Neutron agent, `cinder-volume` and `nova-scheduler` stopped, and Nova's API down. |
| `record.sh <scene>` | Records one scene: the exporter's answer per service with how long it took, each read-only API call's answer, and what the `openstack` CLI says, for a person to check a page against. |
| `instance-metrics.sh` | After the drills, boots `ou-burner`, which spins on its CPU, writes to its disk and sends packets, and records what both sources say about it, the idle `ou-running` and the shut-off `ou-stopped`, at the same moments, every 30 seconds for six minutes. |
| `stop-agent.sh` | Stops the agent, keeps its logs, and fails if the collector exported nothing. |

## What comes out

The workflow uploads an artifact per matrix entry, `openstack-recording-<name>`:

```
healthy/  compute-disabled/  compute-down/  network-agent-down/
volume-service-down/  scheduler-down/  compute-api-down/  recovered/
    api/<call>.json          what each API call answered
    api-status.txt           each call's HTTP status
    exporter/<service>.prom  what the exporter said, one service at a time
    exporter/all-at-once.prom
    exporter/status.txt      each scrape's status and duration
    exporter-stable/...      the same from the exporter's last non-alpha release
    cli.txt                  what the openstack CLI said
access/matrix-default-policy.json    what each credential could read and write, untouched
access/matrix.json                   the same, with the policy overrides applied
access/matrix-access-rules.json      the same, for the access-rule credential
access/exporter/<level>/<service>.prom  what the agent's exporter got with that credential
instance-metrics/scrape-01/libvirt.prom     what the libvirt exporter said, scrape by scrape
instance-metrics/scrape-01/ceilometer.prom  what Ceilometer's exporter said at the same moment
instance-metrics/scrape-01/at.txt           when, in seconds since the epoch
instance-metrics/servers.json               what Nova says each of those instances is, and where
otlp/metrics.json            what the collector would have sent to OneUptime
logs/                        the containers' logs
```

Tokens are scrubbed and addresses replaced, although nothing here is a secret: it is a throwaway cloud on a runner that is gone when the job ends.

## Using a recording

To refresh the fixtures the tests replay, run the workflow by hand, download the artifacts, and copy what the tests read into `packages/Common/Tests/Fixtures/OpenStack/<release>/`:

```bash
gh workflow run test.openstack-e2e.yaml --ref master
gh run download <run id> --pattern 'openstack-recording-*' --dir /tmp/openstack-recordings
```

The tables of what each level of access gets, on the agent's docs page, its README and its in-app guide, are written from `access/` in those fixtures. After a new recording, run `python3 access-table.py` and `python3 access-table.py --series` and paste what they print: `Tests/Ops/OpenStackAgentAccessTable.test.js` fails when a page differs.

## Why DevStack is told how often to report

DevStack sets `report_interval` to 120 seconds and `service_down_time` to 720, so a stopped service stays "up" for 12 minutes. OpenStack's own defaults are 10 and 60, and that is what the workflow sets, so the drills see what a real cloud does and finish in time. DevStack also points Neutron at `policy.json`, which is why `access-matrix.sh` asks each service which file it reads.

## Running it elsewhere

Everything runs on any machine with a DevStack deployed and Docker installed: `OS_CLOUD=devstack-admin bash estate.sh`, then the others in the order above with `OUTPUT_DIR` set. `drills.sh` stops and starts `devstack@*` systemd units, so it needs `sudo` and should never be pointed at a cloud that matters.
