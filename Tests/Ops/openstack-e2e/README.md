# OpenStack E2E

OpenStack answers differently by release, network backend and deployment tool, and its failures show up in ways a mock would have to guess: which series go away, which read 0, what a service says while it is down. So the OpenStack product is built and tested on recordings from a real cloud, and this folder makes them.

`.github/workflows/test.openstack-e2e.yaml` deploys DevStack on a GitHub runner and runs these in order:

| Script | What it does |
| --- | --- |
| `estate.sh` | Builds a known estate: two projects with quotas, instances running, shut off and in `ERROR`, volumes available, attached and in `error`, a network, router and floating IPs. Every name starts with `ou-`. |
| `start-agent.sh` | Starts the OpenStack agent's pinned exporter and collector, with the real `agents/OpenStackAgent/otel-collector-config.yaml`, writing to a file in place of OneUptime. Beside it, the exporter's last non-alpha release, so the two can be compared. |
| `access-matrix.sh` | Tests least privilege on the cloud's real policies: what an admin, a plain reader and the OneUptime monitoring role can each read, and that the monitoring role cannot write. |
| `drills.sh` | Breaks the cloud one way at a time (`record.sh` after each) and puts it back: a compute service disabled on purpose, `nova-compute`, a Neutron agent, `cinder-volume` and `nova-scheduler` stopped, and Nova's API down. |
| `record.sh <scene>` | Records one scene: the exporter's answer per service with how long it took, each read-only API call's answer, and what the `openstack` CLI says, for a person to check a page against. |
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
access/matrix.json           what each credential could read and write
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

## Running it elsewhere

Everything runs on any machine with a DevStack deployed and Docker installed: `OS_CLOUD=devstack-admin bash estate.sh`, then the others in the order above with `OUTPUT_DIR` set. `drills.sh` stops and starts `devstack@*` systemd units, so it needs `sudo` and should never be pointed at a cloud that matters.
