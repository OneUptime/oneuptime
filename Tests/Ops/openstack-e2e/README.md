# OpenStack E2E

OpenStack answers differently by release, network backend and deployment tool, and its failures show up in ways a mock would have to guess: which series go away, which read 0, what a service says while it is down. So the OpenStack product is built and tested on recordings from a real cloud, and this folder makes them.

`.github/workflows/test.openstack-e2e.yaml` deploys DevStack on a GitHub runner and runs these in order:

| Script | What it does |
| --- | --- |
| `estate.sh` | Builds a known estate: two projects with quotas, instances running, shut off and in `ERROR`, volumes available, attached, in `error` and stuck in `attaching`, a network, router and floating IPs, a host in two aggregates, an image stuck in `queued` and an instance booted from a volume. Every name starts with `ou-`. |
| `quota-record.sh` | On the entries that say so: starts the exporter the agent starts for each project's quotas, with its flags, and records what it says of `estate.sh`'s projects, what the agent's collector would send of it, and what the `openstack` CLI says of the same projects. |
| `start-instance-metrics.sh` | Starts `prometheus-libvirt-exporter`, pinned by digest, against the runner's libvirt, and turns on Ceilometer's own exporter (`[polling] enable_prometheus_exporter`). DevStack's Ceilometer plugin runs only its polling agent here, and stores nothing. |
| `start-agent.sh` | Starts the OpenStack agent's pinned exporter and collector, with the real `agents/OpenStackAgent/otel-collector-config.yaml`, writing to a file in place of OneUptime. Beside it, the exporter's last non-alpha release, so the two can be compared. |
| `access-matrix.sh` | Tests least privilege on the cloud's real policies: what an admin, a plain reader, the OneUptime monitoring role and an application credential limited by access rules can each read, that the last two cannot write, and what the agent's own exporter gets with each. Restarts the API services once, because access rules need `service_type` set on each. `merge-policy.py` merges the overrides over what a service's policy file already holds. |
| `drills.sh` | Breaks the cloud one way at a time (`record.sh` after each) and puts it back: a compute service disabled on purpose and another forced down, `nova-compute`, a Neutron agent, `cinder-volume` and `nova-scheduler` stopped, Nova's API down, and an external network with no addresses left. On ML2/OVS also a router taken off its only L3 agent, and the L3 agent stopped with a floating IP associated while it is. |
| `record.sh <scene>` | Records one scene: the exporter's answer per service with how long it took, each read-only API call's answer, and what the `openstack` CLI says, for a person to check a page against. A service that is not in the catalog costs one empty scrape, and nothing else. `RECORD_SERVICES` narrows which services it scrapes. |
| `instance-metrics.sh` | After the drills, boots `ou-burner`, which spins on its CPU, writes to its disk and sends packets, and records what both sources say about it, the idle `ou-running` and the shut-off `ou-stopped`, at the same moments, every 30 seconds for six minutes. |
| `instance-metrics-drill.sh` | Only with `instance_metrics_only`, in place of everything else above from the access matrix on, because it records for over an hour. A noisy instance, then a noisy neighbour, then quiet, each for long enough that an alert template's window fills and empties, with Ceilometer polling at its real default of five minutes. Then a hard reboot, a shut-off and a delete. What the collector would have sent is what gets replayed. |
| `stop-agent.sh` | Stops the agent, keeps its logs, and fails if the collector exported nothing. |
| `ai-agent-record.sh` | In a job of its own, and only that with `-f ai_agent_only=true`, and on the weekly run: compiles the OpenStack AI agent as its image does, then runs its real policy and executor over real sockets (`ai-agent-read.js`), once on a healthy cloud and once with `nova-compute` stopped, through every command the policy allows. Each command's exact output goes under `ai-agent/<scene>/`, and it fails when a command does not answer, or the `compute-down` output does not name the host, the instances on it and the cause. The model is not called: this proves what an investigation is given, not what it would write. `import-ai-agent-recording.py` copies what it printed into the fixtures, where the agent's tests read it. |
| `agent-install.sh` | In a job of its own, and only that with `-f agent_install_only=true`: installs the agent the way its docs say, with and without Docker, as a person with no rights and with `sudo`, on this runner and on machines with nothing on them. See below. |
| `probe-live.sh` | In a job of its own, on a DevStack with `tls-proxy`, because a probe never sends a credential over plain HTTP, and only that with `-f probe_tls_only=true`: runs the probe's real collector and connection test (`packages/Probe/Tests/Utils/OpenStack/OpenStackLiveCloud.test.ts`) against it, over real TLS. Every other test of the probe replays recordings made with curl, so only this shows a real cloud accepts the probe's own requests. It also meets DNS, TCP, TLS, certificate, credential and project failures on a real network, then stops Neutron and Keystone. What it found is uploaded as `openstack-recording-probe-tls`. |

`capacity-record.sh` is a run of its own (`-f capacity_only=true`, and weekly). A DevStack's one host can't show what capacity is about, so it adds three hosts on Nova's fake driver with allocation ratios and reserved amounts that differ, fills them until memory is spread too thinly for a large flavor, loses one, disables one and leaves an allocation no instance owns. Nova and Placement are real throughout, and it asks Placement what `GET /allocation_candidates` says of every flavor (`capacity-placement.py`). `import-capacity-recording.py` copies what the tests read to `packages/Common/Tests/Fixtures/OpenStack/<release>/capacity/`.

## Real deployments, and the guides followed on them

The rest of this page is about DevStack. These deploy what customers run, and follow the guide for it with the guide's own commands: `gh workflow run test.openstack-e2e.yaml --ref <branch> -f kolla_aio=true`, or `-f osa_aio=true`. Each takes hours and most of a runner, so neither runs on a schedule.

| Script | What it does |
| --- | --- |
| `kolla-aio.sh`, `osa-aio.sh` | Deploy an all-in-one of that tool, as its quick start says. What differs from its defaults is in the script, each with its reason. |
| `kolla-guide.sh`, `osa-guide.sh` | Follow its guide, one part at a time. Every block after `follow` is the guide's own text: `OpenStackDeploymentGuides.test.ts` fails when one and the guide differ. |
| `guide-follow.sh` | What following any guide takes: running a block with its placeholders filled in and a person's answers on its standard input. |
| `fake-oneuptime.py`, `collector-sink.yaml` | The OneUptime those commands name: it serves the install scripts from this checkout, hands OTLP to a real collector that decodes and keeps it, and keeps each webhook. It proves what reaches OneUptime, not what OneUptime does with it. |
| `live-oneuptime.py` | That part, with `-f live_oneuptime=true`: a real OneUptime, its app built from the branch and the rest from its test images, sent what a real agent and a real Alertmanager sent, and read back through its API. |
| `whole-path.py`, `whole-path-template.ts` | With `-f whole_path=true`, in about three hours on one runner: nothing recorded and nothing stood in for. A real DevStack, with the agent installed as its docs say and a project's own probe connected as the dashboard connects one, into a OneUptime built from the branch. nova-compute really stops, and a monitor from the real Compute Service Down template waits out its whole window, fires and recovers. Then a signed boot, as far as its spans read back. The artifact `openstack-whole-path` holds what each check found, in `whole-path.json`, by part. |

The artifact is `openstack-recording-kolla-aio` or `openstack-recording-osa-aio`:

```
guide/commands.log            every command the guide says, what it printed and how it exited
guide/problems.txt            what did not go as the guide says
guide/<part>/otlp/metrics.json  what the agent really sent, decoded, per way of running it
guide/<part>/otlp/logs.json     the same for the logs profile
kolla/ or osa/                what was deployed, how long each step took, and the tool's own files
healthy/                      record.sh's scene: each API, and each exporter (see below)
control-plane/                each exporter under the cloud, as the tool's Prometheus reads it
alertmanager/webhook-*.json   what its Alertmanager posted, byte for byte
```

`import-guide-recording.py` keeps what the tests replay.

## What comes out

The workflow uploads an artifact per matrix entry, `openstack-recording-<name>`:

```
healthy/  compute-disabled/  compute-forced-down/  compute-down/  network-agent-down/
volume-service-down/  scheduler-down/  compute-api-down/  external-network-full/
router-agents-removed/  l3-agent-down/  recovered/
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
quotas/exporter/<service>.prom              what the quota exporter said, one service at a time
quotas/otlp/metrics.json                    what the collector would have sent of it
quotas/cli.txt                              what the openstack CLI said of the same projects
instance-metrics/scrape-01/libvirt.prom     what the libvirt exporter said, scrape by scrape
instance-metrics/scrape-01/ceilometer.prom  what Ceilometer's exporter said at the same moment
instance-metrics/scrape-01/at.txt           when, in seconds since the epoch
instance-metrics/servers.json               what Nova says each of those instances is, and where
instance-metrics-drill/timeline.txt         when each thing in the long drill happened, in seconds since the epoch
instance-metrics-drill/servers.json         what Nova says each instance is, at the end of it
otlp/metrics.json            what the collector would have sent to OneUptime
logs/                        the containers' logs
traces/otlp-driver.json.gz   on the entries that record it: what OSProfiler's driver sent for each signed request
traces/otlp-agent.json.gz    what the agent's traces profile would have sent to OneUptime for them
traces/scenes.jsonl          each scene: how long, its exit code, its Trace IDs, its spans
traces/summary.json          each scene's trace, service by service
traces/check.txt             whether the issue's "done when" held on this run
traces/native-summary.json   what OpenStack's own OpenTelemetry tracing made, where a release ships it
traces/journal.jsonl.gz      what the services logged, to hold a trace's requests against
```

`-f logs_only=true -f traces_only=true` runs only the traces step, on Hibiscus and Flamingo. `traces-record.sh` says what each scene is for. Its fixtures come from `python3 -I import-trace-recording.py <release> <artifact>/traces`, into `packages/Common/Tests/Fixtures/OpenStack/traces/<release>/`.

Tokens are scrubbed and addresses replaced, although nothing here is a secret: it is a throwaway cloud on a runner that is gone when the job ends.

## The services a cloud may not run

Octavia, Ironic, Heat, Magnum, Manila, Designate, Barbican, Swift, Trove and Gnocchi are recorded by a job of their own, `record-services`, only when asked. Each group has a runner to itself, because a runner has 4 vCPUs and 16 GB:

```bash
gh workflow run test.openstack-e2e.yaml --ref <branch> -f services_only=true
# One entry, or several: a retry cancels only a run that asked for the same.
gh workflow run test.openstack-e2e.yaml --ref <branch> -f services_only=true -f services_filter=services-trove
```

| Entry | What it deploys, on `stable/2026.1` | Script |
| --- | --- | --- |
| `services-octavia` | Octavia with its amphora provider, on the runner's KVM, and its OVN provider | `services-octavia.sh` |
| `services-ironic` | Ironic with fake hardware, and Nova's Ironic driver | `services-ironic.sh` |
| `services-heat-magnum` | Heat, and Magnum on it | `services-heat-magnum.sh` |
| `services-manila` | Manila with its dummy driver, on two backends, one held slow | `services-manila.sh` |
| `services-designate-barbican-swift` | Designate on bind9, Barbican and Swift | `services-designate-barbican-swift.sh` |
| `services-trove` | Trove, with the guest image its plugin builds | `services-trove.sh` |
| `services-gnocchi` | Gnocchi, deployed by Ceilometer's plugin, since its own repository no longer has one | `services-gnocchi.sh` |

The configs start from what Gophercloud's own CI runs on this same action and branch. The top of each script says what its scenes are. `services-lib.sh` is what they share, and is why a scene going wrong never costs the scene after it: each scene is recorded whichever way it went, its `how.txt` says how the cloud got there, on its own or written into a row, and a `failed.txt` says why it never did. `scenes.txt` says what became of each.

After the scenes, `access-matrix.sh` runs on the same cloud with the group's `EXPORTER_SERVICES`, on its own, because it restarts APIs. It covers each of these services' reads and writes wherever a catalog has them, and a group can try more credentials with `EXTRA_CREDENTIALS`.

To copy one into the fixtures, which writes only `packages/Common/Tests/Fixtures/OpenStack/services-<group>/`, and leaves out a scene that has a `failed.txt`:

```bash
gh run download <run id> --pattern 'openstack-recording-services-*' --dir /tmp/services-recordings
python3 -I Tests/Ops/openstack-e2e/import-services-recording.py /tmp/services-recordings packages/Common/Tests/Fixtures/OpenStack
```

A scene is never called `healthy`, and a group's access recording goes in `access-check/`: the tests of the releases read a folder holding `healthy/exporter` as a release, and the generated access table reads one holding `access/`. The importer refuses both.

## The install, as the docs say

`agent-install.sh` lifts the commands out of the docs page (`agent-install-docs.py`), so it runs what a person copies, and types the answers on stdin. What the agent sends goes to a stand-in OneUptime (`agent-install-oneuptime.py`), which serves the agent's files as the real one does, refuses any key but the one it was given, and keeps each OTLP request. `agent-install-check.py` asks it what arrived, read from the protobuf.

| Phase | What it runs | What it proves |
| --- | --- | --- |
| `plain-docker` | Docker, as a user with the `docker` group and no other rights | The cloud reports, with its name, version and region. The docs' commands work from that account. `troubleshoot.sh` tells the truth on a healthy agent, a refused key, a stopped exporter, a stopped collector, a stopped Nova API and a revoked credential. Stopping Nova leaves the others reporting. A re-run with a refused secret leaves the agent alone, and a re-run upgrades it from an older release, keeping the answers and any edit. |
| `root-docker` | Docker, with `sudo`, under a root umask of 077 | The exporter really runs as uid 65532 and reads a `clouds.yaml` of mode `0600` it owns, which `start-agent.sh` never exercises. The docs' systemd unit starts, stops and comes back after a kill. `clouds.yaml` given to root is called out, and a re-run puts it right. |
| `without-docker` | The pinned releases, on this machine's systemd, with a password holding every character that could go wrong | The binaries run past their digest check. The units load, start on boot and come back after a kill, as the users they say, with no capabilities, on `127.0.0.1` alone, beside another collector on 8888. A re-run replaces the binary itself. The uninstall leaves nothing behind. |
| `clean-ubuntu`, `clean-rocky`, `clean-docker` | The same commands on a machine with nothing on it but systemd, curl and sudo, in a container of its own on Docker's network | No tool the docs do not ask for is needed, on Ubuntu 24.04 and on Rocky 9, with Docker and without. |
| `old-glibc` | The install without Docker on Rocky 8 | The exporter's release can't run on its glibc 2.28, so the install says so and changes nothing, rather than leave a service restarting for ever. |

`-f agent_install_only=true` runs this alone, on one DevStack, in about an hour and a half. It also runs on the weekly run and on a pull request that changes the agent. `results.txt` in the `openstack-agent-install` artifact says how each check went, `oneuptime/bodies/` holds what the agent really sent, and each phase's folder holds what was run, with no secret in it (the last check looks).

It has not met a real OneUptime: what comes in is held to what ingest needs, and `OpenStackSnapshotScanRecordings.test.ts` puts recordings through the real scan.

## Using a recording

To refresh the fixtures the tests replay, run the workflow by hand, download the artifacts, and copy what the tests read into `packages/Common/Tests/Fixtures/OpenStack/<release>/`:

```bash
gh workflow run test.openstack-e2e.yaml --ref master
gh run download <run id> --pattern 'openstack-recording-*' --dir /tmp/openstack-recordings
```

To record new scenes without the rest, `-f scenes_only=true` deploys only the two entries every scene is kept from, and runs the estate and the drills, and the access matrix on ML2/OVS.

The tables of what each level of access gets, on the agent's docs page, its README and its in-app guide, are written from `access/` in those fixtures. After a new recording, run `python3 access-table.py` and `python3 access-table.py --series` and paste what they print: `Tests/Ops/OpenStackAgentAccessTable.test.js` fails when a page differs.

## Why DevStack is told how often to report

DevStack sets `report_interval` to 120 seconds and `service_down_time` to 720, so a stopped service stays "up" for 12 minutes. OpenStack's own defaults are 10 and 60, and that is what the workflow sets, so the drills see what a real cloud does and finish in time. DevStack also points Neutron at `policy.json`, which is why `access-matrix.sh` asks each service which file it reads.

## Running it elsewhere

Everything runs on any machine with a DevStack deployed and Docker installed: `OS_CLOUD=devstack-admin bash estate.sh`, then the others in the order above with `OUTPUT_DIR` set. `drills.sh` stops and starts `devstack@*` systemd units, so it needs `sudo` and should never be pointed at a cloud that matters.
